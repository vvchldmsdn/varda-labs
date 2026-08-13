import "server-only";

import { and, asc, eq, inArray, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/db/client";
import { getPortfolioAnalysisScopeTargets } from "@/db/queries/portfolio-analysis-scope-targets";
import { getReadOnlyTenantPortfolioStructureForScope } from "@/db/queries/portfolio-structure";
import {
  accounts,
  assets,
  portfolioTargetPolicyRevisions,
  portfolioTargetPolicyRows,
} from "@/db/schema";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import {
  buildPortfolioTargetPolicyRecord,
  buildCurrentAllocationStartingWeights,
  createPortfolioTargetUniverseHash,
  normalizePortfolioTargetUniverse,
  portfolioTargetScopeColumns,
  type PortfolioTargetUniverseInput,
  type PortfolioTargetUniverseRow,
} from "@/lib/portfolio-target-policy";
import { toNumber } from "@/lib/portfolio-math";
import type { TenantContext } from "@/lib/session-resolver-contract";

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

  const [assetRows, structure, approvedPolicy] = await Promise.all([
    scopePredicate === null
      ? Promise.resolve([])
      : db
          .select({
            accountCode: accounts.code,
            accountId: accounts.id,
            accountName: accounts.name,
            assetId: assets.id,
            assetName: assets.name,
            market: assets.market,
            currency: assets.currency,
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
  ]);

  const currentValues = new Map(
    structure.holdingRows.map((row) => [holdingIdentityKey(row), row.currentValueKrw]),
  );
  const universeInput: PortfolioTargetUniverseInput[] = assetRows.map((row) => ({
    accountCode: row.accountCode,
    accountId: row.accountId,
    accountName: row.accountName,
    assetId: row.assetId,
    assetName: row.assetName,
    market: row.market,
    currency: row.currency,
    ticker: row.ticker,
    currentValueKrw:
      (row.ticker === null
        ? undefined
        : currentValues.get(holdingIdentityKey(row))) ??
      fallbackCurrentValueKrw(row, structure.usdKrwRate),
  }));
  const universe = normalizePortfolioTargetUniverse(universeInput);
  const currentPolicyRows = approvedPolicy.policy?.rows ?? [];
  const exactPolicyUniverse =
    approvedPolicy.status === "available" &&
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
  const currentUniverseHash =
    universe.status === "ready"
      ? createPortfolioTargetUniverseHash({ scope, universe: universe.rows })
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

  return Object.freeze({
    status: universe.status,
    scope,
    serviceDate,
    universe,
    structureHealth: structure.dataHealth,
    approvedPolicy,
    policyValidation,
    exactPolicyUniverse,
    currentUniverseHash,
    ma120HoldingRows: Object.freeze(structure.holdingRows),
    startingWeightSource: policyValidation.status === "available"
      ? ("approved_policy" as const)
      : ("current_allocation_starting_point" as const),
    rows: Object.freeze(
      universe.rows.map((row) =>
        Object.freeze({
          ...row,
          targetWeightBps: startingWeights.get(row.assetId) ?? 0,
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
  const revisions = await db
    .select({
      id: portfolioTargetPolicyRevisions.id,
      approvalRevision: portfolioTargetPolicyRevisions.approvalRevision,
      policyVersion: portfolioTargetPolicyRevisions.policyVersion,
      effectiveServiceDate:
        portfolioTargetPolicyRevisions.effectiveServiceDate,
      universeHash: portfolioTargetPolicyRevisions.universeHash,
      vectorHash: portfolioTargetPolicyRevisions.vectorHash,
      approvedAt: portfolioTargetPolicyRevisions.approvedAt,
    })
    .from(portfolioTargetPolicyRevisions)
    .where(
      and(
        eq(
          portfolioTargetPolicyRevisions.canonicalOwnerUserId,
          tenantContext.ownerUserId,
        ),
        eq(portfolioTargetPolicyRevisions.scopeKind, columns.scopeKind),
        nullableEquals(
          portfolioTargetPolicyRevisions.scopeAccountId,
          columns.scopeAccountId,
        ),
        nullableEquals(
          portfolioTargetPolicyRevisions.scopePortfolioGroupId,
          columns.scopePortfolioGroupId,
        ),
        eq(portfolioTargetPolicyRevisions.lifecycleStatus, "approved"),
      ),
    )
    .limit(2);
  if (revisions.length === 0) {
    return Object.freeze({ status: "missing" as const, policy: null });
  }
  if (revisions.length !== 1) {
    return Object.freeze({ status: "conflict" as const, policy: null });
  }

  const [revision] = revisions;
  const rows = await db
    .select({
      accountId: portfolioTargetPolicyRows.accountId,
      assetId: portfolioTargetPolicyRows.assetId,
      assetName: portfolioTargetPolicyRows.assetName,
      market: portfolioTargetPolicyRows.market,
      currency: portfolioTargetPolicyRows.currency,
      ticker: portfolioTargetPolicyRows.ticker,
      buyability: portfolioTargetPolicyRows.buyability,
      targetWeightBps: portfolioTargetPolicyRows.targetWeightBps,
    })
    .from(portfolioTargetPolicyRows)
    .where(eq(portfolioTargetPolicyRows.approvalRevisionId, revision.id))
    .orderBy(
      asc(portfolioTargetPolicyRows.accountId),
      asc(portfolioTargetPolicyRows.assetId),
    )
    .limit(65);
  if (rows.length > 64) {
    return Object.freeze({ status: "conflict" as const, policy: null });
  }

  return Object.freeze({
    status: "available" as const,
    policy: Object.freeze({ ...revision, rows: Object.freeze(rows) }),
  });
}

function holdingIdentityKey(row: {
  account?: string;
  accountCode?: string;
  market: string;
  currency: string;
  ticker: string | null;
}) {
  return [
    row.account ?? row.accountCode,
    row.market.trim().toLowerCase(),
    row.currency.trim().toUpperCase(),
    row.ticker?.trim().toUpperCase() ?? "",
  ].join(":");
}

function fallbackCurrentValueKrw(
  row: {
    currency: string;
    currentPrice: string;
    fractionalKrwValue: string | null;
    quantity: string;
  },
  usdKrwRate: number | null,
) {
  const quantity = toNumber(row.quantity);
  const currentPrice = toNumber(row.currentPrice);
  const fractional = toNumber(row.fractionalKrwValue) ?? 0;
  const currency = row.currency.trim().toUpperCase();
  const fx = currency === "KRW" ? 1 : currency === "USD" ? usdKrwRate : null;
  return quantity !== null &&
    currentPrice !== null &&
    quantity >= 0 &&
    currentPrice > 0 &&
    fx !== null &&
    fx > 0
    ? quantity * currentPrice * fx + fractional
    : null;
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

function nullableEquals(
  column:
    | typeof portfolioTargetPolicyRevisions.scopeAccountId
    | typeof portfolioTargetPolicyRevisions.scopePortfolioGroupId,
  value: string | null,
) {
  return value === null ? sql`${column} is null` : eq(column, value);
}
