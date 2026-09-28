import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { db } from "@/db/client";
import { getPortfolioAnalysisScopeTargets } from "@/db/queries/portfolio-analysis-scope-targets";
import { getReadOnlyTenantPortfolioStructureForScope } from "@/db/queries/portfolio-structure";
import { loadCurrentTenantPortfolioTargetPolicy } from "@/db/queries/tenant-target-policies";
import { accounts, assets, livePriceQuotes } from "@/db/schema";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import {
  portfolioStructureHoldingIdentityKey,
  projectPortfolioStructureEffectiveTargets,
} from "@/lib/portfolio-structure-target-policy";
import {
  buildPortfolioTargetPolicyRecord,
  preservePortfolioTargetDraft,
  buildCurrentAllocationStartingWeights,
  createPortfolioTargetUniverseHash,
  normalizePortfolioTargetUniverse,
  portfolioTargetScopeColumns,
  type PortfolioTargetUniverseInput,
  type PortfolioTargetUniverseRow,
} from "@/lib/portfolio-target-policy";
import {
  additionalContributionCostBasisKrw,
  additionalContributionFallbackValueKrw,
} from "@/lib/additional-contribution-policy-input";
import type { TenantContext } from "@/lib/session-resolver-contract";

import { unionTargetPlanRows, targetInstrumentIdentity, TARGET_PLAN_VERSION } from "@/lib/portfolio-target-plan";

const INVESTMENT_ASSET_TYPES = ["etf", "stock", "pension", "commodity"];

export async function getReadOnlyTenantPortfolioTargetPolicyModel({
  scope,
  serviceDate,
  tenantContext,
}: {
  scope: PortfolioAnalysisScope;
  serviceDate: string;
  tenantContext: TenantContext;
}) {
  const targets = await getPortfolioAnalysisScopeTargets({
    scope,
    serviceDate,
    tenantContext,
  });
  const scopePredicate = targets.includesAllOwnedAccounts
    ? undefined
    : combineScopePredicates([
        inArrayWhenPresent(accounts.id, targets.wholeAccountIds),
        inArrayWhenPresent(assets.id, targets.directAssetIds),
      ]);

  const [assetRows, structure, approvedPolicy, ownedAccounts, allHeldIdentities] = await Promise.all([
    scopePredicate === null
      ? Promise.resolve([])
      : db
          .select({
            accountCode: accounts.code,
            accountId: accounts.id,
            accountName: accounts.name,
            assetId: assets.id,
            assetType: assets.assetType,
            assetName: assets.name,
            averageCost: assets.averageCost,
            fractionalAvgCost: assets.fractionalAvgCost,
            market: assets.market,
            currency: assets.currency,
            maAssetClass: assets.maAssetClass,
            maRuleEnabled: assets.maRuleEnabled,
            ticker: assets.ticker,
            quantity: assets.quantity,
            currentPrice: assets.currentPrice,
            fractionalKrwValue: assets.fractionalKrwValue,
          })
          .from(assets)
          .innerJoin(accounts, eq(assets.accountId, accounts.id))
          .where(
            and(
              eq(accounts.canonicalOwnerUserId, tenantContext.ownerUserId),
              eq(accounts.isActive, true),
              eq(assets.canonicalOwnerUserId, tenantContext.ownerUserId),
              eq(assets.account, accounts.code),
              isNull(assets.archivedAt),
              inArray(assets.assetType, INVESTMENT_ASSET_TYPES),
              sql<boolean>`(${assets.quantity} > 0 or coalesce(${assets.fractionalKrwValue}, 0) > 0)`,
              scopePredicate,
            ),
          )
          .orderBy(
            asc(accounts.sortOrder),
            asc(accounts.name),
            asc(assets.market),
            asc(assets.currency),
            asc(assets.ticker),
            asc(assets.name),
          ),
    getReadOnlyTenantPortfolioStructureForScope({
      scope,
      serviceDate,
      tenantContext,
    }),
    readCurrentApprovedPolicy({ scope, tenantContext }),
    db.select({id:accounts.id,code:accounts.code,name:accounts.name}).from(accounts).where(and(eq(accounts.canonicalOwnerUserId,tenantContext.ownerUserId),eq(accounts.isActive,true))),
    db.select({assetId:assets.id,accountId:assets.accountId,market:assets.market,currency:assets.currency,ticker:assets.ticker}).from(assets).where(and(eq(assets.canonicalOwnerUserId,tenantContext.ownerUserId),isNull(assets.archivedAt),sql<boolean>`(${assets.quantity}>0 or coalesce(${assets.fractionalKrwValue},0)>0)`)),

  ]);

  const currentValues = new Map(
    structure.holdingRows.map((row) => [
      portfolioStructureHoldingIdentityKey(row),
      row.currentValueKrw,
    ]),
  );
  const ambiguousValues = duplicateIdentities(structure.holdingRows);
  const ambiguousAssets = duplicateIdentities(assetRows);
  const holdingInput: PortfolioTargetUniverseInput[] = assetRows.map((row) => ({
    accountCode: row.accountCode,
    accountId: row.accountId,
    accountName: row.accountName,
    assetId: row.assetId,
    assetName: row.assetName,
    assetType: row.assetType,
    market: row.market,
    currency: row.currency,
    ticker: row.ticker,
    currentValueKrw: ambiguousValues.has(portfolioStructureHoldingIdentityKey(row)) || ambiguousAssets.has(portfolioStructureHoldingIdentityKey(row))
      ? null
      : currentValues.get(portfolioStructureHoldingIdentityKey(row)) ??
        additionalContributionFallbackValueKrw(row, structure.usdKrwRate),
  }));
  const currentPolicyRows = approvedPolicy.policy?.rows ?? [];
  const selectableAccounts = ownedAccounts.filter(a=>targets.includesAllOwnedAccounts || targets.wholeAccountIds.includes(a.id) || assetRows.some(row=>row.accountId===a.id));
  const outsideScope = new Set(currentPolicyRows.filter(plan=>allHeldIdentities.some(holding=>holding.accountId && targetInstrumentIdentity({...holding,accountId:holding.accountId})===targetInstrumentIdentity(plan) && !holdingInput.some(row=>row.assetId===holding.assetId))).map(row=>row.assetId));
  for (const row of currentPolicyRows) {
    if (!selectableAccounts.some(account=>account.id===row.accountId)) outsideScope.add(row.assetId);
  }
  let planIdentityInvalid = false;
  let unionRows: PortfolioTargetUniverseInput[];
  try { unionRows = unionTargetPlanRows(holdingInput, currentPolicyRows, ownedAccounts); }
  catch { planIdentityInvalid = true; unionRows = holdingInput; }
  const universeInput = unionRows.map(row=>outsideScope.has(row.assetId)?{...row,currentValueKrw:null}:row);
  const policyVersion = approvedPolicy.policy?.policyVersion ?? "portfolio_target_policy_v1";

  const candidateTickers = universeInput.filter(row=>row.heldAssetId===null && !outsideScope.has(row.assetId)).flatMap(row=>row.ticker?[row.ticker]:[]);
  const candidateQuotes = candidateTickers.length ? await db.select().from(livePriceQuotes)
    .where(and(inArray(livePriceQuotes.ticker,candidateTickers),eq(livePriceQuotes.provider,"kis"),eq(livePriceQuotes.status,"ok")))
    .orderBy(desc(livePriceQuotes.fetchedAt),desc(livePriceQuotes.priceAsOf)).limit(candidateTickers.length*4) : [];
  const candidateMaRows = universeInput.filter(row=>row.heldAssetId===null).map(row=>{
    const quote=candidateQuotes.find(q=>q.ticker===row.ticker && q.market===row.market && q.currency===row.currency && q.source?.startsWith("kis") && Number(q.price)>0 && q.priceAsOf && q.priceAsOf<=q.fetchedAt && q.fetchedAt<=new Date());
    return {market:row.market,currency:row.currency,ticker:row.ticker,currentPrice:quote?Number(quote.price):null,priceSource:quote?.source??null,priceAsOf:quote?.priceAsOf?.toISOString()??null};
  });
  const allocationMetadata = new Map(
    assetRows.map((row) => [
      universeInput.find(p=>p.heldAssetId===row.assetId)?.assetId ?? row.assetId,
      Object.freeze({
        assetType: row.assetType,
        costBasisKrw: additionalContributionCostBasisKrw(row, structure.usdKrwRate),
        maAssetClass: row.maAssetClass,
        maRuleEnabled: row.maRuleEnabled ?? true,
      }),
    ]),
  );
  const normalizedUniverse = normalizePortfolioTargetUniverse(universeInput);
  const universe = planIdentityInvalid ? Object.freeze({...normalizedUniverse,status:"blocked" as const,blockers:Object.freeze(["invalid_universe_row" as const])}) : normalizedUniverse;
  const exactPolicyUniverse =
    approvedPolicy.status === "available" && outsideScope.size === 0 &&
    currentPolicyRows.length === universe.rows.length &&
    currentPolicyRows.every(
      (row, index) =>
        row.accountId === universe.rows[index]?.accountId &&
        row.assetId === universe.rows[index]?.assetId &&
        row.market === universe.rows[index]?.market &&
        row.currency === universe.rows[index]?.currency &&
        row.ticker === universe.rows[index]?.ticker &&
        row.buyability === universe.rows[index]?.buyability,
    );
  const editableEmpty = universe.blockers.length === 1 && universe.blockers[0] === "empty_universe" && selectableAccounts.length > 0;
  const currentUniverseHash =
    universe.status === "ready" || editableEmpty
      ? createPortfolioTargetUniverseHash({ scope, universe: universe.rows, policyVersion })
      : null;
  const policyValidation = validateApprovedPolicy({
    approvedPolicy,
    currentUniverseHash,
    exactPolicyUniverse,
    scope,
    serviceDate,
    universe: universe.rows,
  });
  const startingWeights = policyValidation.status === "available"
    ? new Map(currentPolicyRows.map((row) => [row.assetId, row.targetWeightBps]))
    : buildCurrentAllocationStartingWeights(universe.rows);
  const retainedDraft = policyValidation.status === "universe_mismatch" && approvedPolicy.status === "available"
    ? preservePortfolioTargetDraft(universe.rows, currentPolicyRows)
    : null;
  const targetProjection = projectPortfolioStructureEffectiveTargets({
    policyStatus: policyValidation.status,
    structure,
    targets:
      policyValidation.status === "available"
        ? universe.rows.map((row) => ({
            account: row.accountCode,
            assetName: row.assetName,
            assetType: row.assetType,
            market: row.market,
            currency: row.currency,
            ticker: row.ticker,
            targetWeightBps: startingWeights.get(row.assetId) ?? -1,
            plannedOnly: row.heldAssetId === null,
          }))
        : [],
  });
  const { structure: effectiveStructure, ...structureTargetProjection } =
    targetProjection;

  return Object.freeze({
    status: editableEmpty ? "ready" as const : universe.status,
    selectableAccounts,
    policyVersion,
    nextPolicyVersion: TARGET_PLAN_VERSION,
    scope,
    serviceDate,
    universe,
    structureHealth: structure.dataHealth,
    approvedPolicy,
    policyValidation,
    exactPolicyUniverse,
    currentUniverseHash,
    structure: effectiveStructure,
    structureTargetProjection: Object.freeze(structureTargetProjection),
    ma120HoldingRows: Object.freeze([...structure.holdingRows, ...candidateMaRows]),
    startingWeightSource: policyValidation.status === "available"
      ? ("approved_policy" as const)
      : ("current_allocation_starting_point" as const),
    rows: Object.freeze(
      universe.rows.map((row) =>
        Object.freeze({
          ...row,
          assetType: row.assetType,
          costBasisKrw: null as number | null,
          maAssetClass: null as string | null,
          maRuleEnabled: true,
          ...allocationMetadata.get(row.assetId),
          targetWeightBps: startingWeights.get(row.assetId) ?? 0,
          editorTargetWeightBps: retainedDraft ? retainedDraft.get(row.assetId) ?? null : startingWeights.get(row.assetId) ?? 0,
        }),
      ),
    ),
  });
}

function validateApprovedPolicy({
  approvedPolicy,
  currentUniverseHash,
  exactPolicyUniverse,
  scope,
  serviceDate,
  universe,
}: {
  approvedPolicy: Awaited<ReturnType<typeof readCurrentApprovedPolicy>>;
  currentUniverseHash: string | null;
  exactPolicyUniverse: boolean;
  scope: PortfolioAnalysisScope;
  serviceDate: string;
  universe: readonly PortfolioTargetUniverseRow[];
}) {
  if (approvedPolicy.status !== "available" || !approvedPolicy.policy) {
    return Object.freeze({ status: approvedPolicy.status });
  }
  if (!exactPolicyUniverse || currentUniverseHash === null) {
    return Object.freeze({ status: "universe_mismatch" as const });
  }
  if (approvedPolicy.policy.effectiveServiceDate > serviceDate) {
    return Object.freeze({ status: "not_effective" as const });
  }

  const recomputed = buildPortfolioTargetPolicyRecord({
    decisions: approvedPolicy.policy.rows.map((row) => ({
      assetId: row.assetId,
      targetWeightBps: row.targetWeightBps,
    })),
    effectiveServiceDate: approvedPolicy.policy.effectiveServiceDate,
    policyVersion: approvedPolicy.policy.policyVersion,
    scope,
    universe,
  });
  if (
    recomputed.status !== "ready" ||
    recomputed.universeHash !== approvedPolicy.policy.universeHash ||
    recomputed.vectorHash !== approvedPolicy.policy.vectorHash
  ) {
    return Object.freeze({ status: "integrity_error" as const });
  }
  return Object.freeze({ status: "available" as const });
}

async function readCurrentApprovedPolicy({
  scope,
  tenantContext,
}: {
  scope: PortfolioAnalysisScope;
  tenantContext: TenantContext;
}) {
  const columns = portfolioTargetScopeColumns(scope);
  return loadCurrentTenantPortfolioTargetPolicy({
    scopeAccountId: columns.scopeAccountId,
    scopeKind: columns.scopeKind,
    scopePortfolioGroupId: columns.scopePortfolioGroupId,
    tenantContext,
  });
}

function duplicateIdentities(rows: readonly Parameters<typeof portfolioStructureHoldingIdentityKey>[0][]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const row of rows) {
    const key = portfolioStructureHoldingIdentityKey(row);
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return duplicates;
}

function inArrayWhenPresent(
  column: typeof accounts.id | typeof assets.id,
  values: readonly string[],
): SQL | null {
  return values.length > 0 ? inArray(column, values) : null;
}

function combineScopePredicates(predicates: readonly (SQL | null)[]) {
  const available = predicates.filter((predicate): predicate is SQL => predicate !== null);
  if (available.length === 0) return null;
  if (available.length === 1) return available[0];
  return or(...available) ?? null;
}
