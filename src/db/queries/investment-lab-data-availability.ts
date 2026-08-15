import "server-only";

import { and, asc, eq, inArray, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/db/client";
import {
  createTenantPortfolioRiskRepository,
  createTenantPortfolioRiskScopeRepository,
  loadPortfolioRiskPriceCandidates,
} from "@/db/queries/portfolio-risk";
import { getPortfolioAnalysisScopeTargets } from "@/db/queries/portfolio-analysis-scope-targets";
import {
  accounts,
  assets,
  dailyPortfolioSnapshots,
  dailyPositionSnapshots,
} from "@/db/schema";
import { buildInvestmentLabDataAvailability } from "@/lib/investment-lab-data-availability";
import type { InvestmentLabAnalysisScopeEvidence } from "@/lib/investment-lab-analysis-scope";
import {
  DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS,
} from "@/lib/investment-lab-special-holding-authority";
import {
  NAMED_PORTFOLIO_ACCOUNTS,
  accountsForPortfolioScope,
  type PortfolioAccountScope,
} from "@/lib/portfolio-account-scope";
import {
  admitAdjustedHistoricalPriceRows,
  admitPrivateSingleTenantRawHistoricalPriceRows,
  selectPreferredPrivateHistoricalPriceRows,
} from "@/lib/market-data/asset-price-consumer-admission";
import {
  loadPreselectedPortfolioRiskReadModel,
  loadPortfolioRiskReadModel,
} from "@/lib/portfolio-risk-read-loader";
import type { TenantContext } from "@/lib/session-resolver-contract";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";
import { getActivePortfolioOwnerUserIds } from "./active-portfolio-owners";

export async function getReadOnlyTenantInvestmentLabDataAvailability({
  account,
  tenantContext,
}: {
  account: PortfolioAccountScope;
  tenantContext: TenantContext;
}) {
  const selectedAccounts = [...accountsForPortfolioScope(account)];
  const activeOwnerUserIdsPromise = getActivePortfolioOwnerUserIds();
  const goldDecision =
    DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions.krxGold;
  const [
    snapshotRows,
    manualValuationCurrentRows,
    manualValuationSnapshotRows,
    riskModel,
  ] = await Promise.all([
    db
      .select({
        snapshotDate: dailyPortfolioSnapshots.snapshotDate,
        account: sql<string>`lower(trim(${dailyPortfolioSnapshots.account}))`,
        source: dailyPortfolioSnapshots.source,
        ruleVersion: dailyPortfolioSnapshots.ruleVersion,
      })
      .from(dailyPortfolioSnapshots)
      .innerJoin(accounts, eq(dailyPortfolioSnapshots.accountId, accounts.id))
      .where(
        and(
          ...activeOwnedAccountPredicates(tenantContext),
          inArray(accounts.code, selectedAccounts),
          eq(dailyPortfolioSnapshots.account, accounts.code),
          eq(dailyPortfolioSnapshots.isSample, false),
        ),
      )
      .orderBy(
        asc(dailyPortfolioSnapshots.snapshotDate),
        asc(dailyPortfolioSnapshots.account),
      ),
    db
      .select({
        assetId: assets.id,
        assetName: assets.name,
        account: assets.account,
        market: assets.market,
        currency: assets.currency,
        assetType: assets.assetType,
        currentPrice: assets.currentPrice,
        priceSource: assets.priceSource,
        priceAsOf: assets.priceAsOf,
        priceQuoteType: assets.priceQuoteType,
        priceStatus: assets.priceStatus,
      })
      .from(assets)
      .innerJoin(accounts, eq(assets.accountId, accounts.id))
      .where(
        and(
          ...activeOwnedAccountPredicates(tenantContext),
          inArray(accounts.code, selectedAccounts),
          eq(assets.account, accounts.code),
          eq(assets.name, goldDecision.assetName),
          eq(accounts.code, goldDecision.account),
          eq(sql<string>`lower(trim(${assets.market}))`, goldDecision.market),
          eq(sql<string>`upper(trim(${assets.currency}))`, goldDecision.currency),
          eq(sql<string>`lower(trim(${assets.assetType}))`, goldDecision.assetType),
        ),
      )
      .orderBy(asc(assets.account), asc(assets.name)),
    db
      .select({
        snapshotDate: dailyPositionSnapshots.snapshotDate,
        assetId: dailyPositionSnapshots.assetId,
        legacyAssetId: dailyPositionSnapshots.legacyAssetId,
        assetName: dailyPositionSnapshots.assetName,
        account: dailyPositionSnapshots.account,
        market: dailyPositionSnapshots.market,
        currency: dailyPositionSnapshots.currency,
        assetType: dailyPositionSnapshots.assetType,
        source: dailyPositionSnapshots.source,
        priceSource: dailyPositionSnapshots.priceSource,
        priceBasis: dailyPositionSnapshots.priceBasis,
        currentPrice: dailyPositionSnapshots.currentPrice,
        priceDate: dailyPositionSnapshots.priceDate,
        referenceDate: dailyPositionSnapshots.referenceDate,
        capturedAt: dailyPositionSnapshots.capturedAt,
      })
      .from(dailyPositionSnapshots)
      .innerJoin(accounts, eq(dailyPositionSnapshots.accountId, accounts.id))
      .where(
        and(
          ...activeOwnedAccountPredicates(tenantContext),
          inArray(accounts.code, selectedAccounts),
          eq(dailyPositionSnapshots.account, accounts.code),
          eq(dailyPositionSnapshots.isSample, false),
          eq(dailyPositionSnapshots.assetName, goldDecision.assetName),
          eq(accounts.code, goldDecision.account),
          eq(
            sql<string>`lower(trim(${dailyPositionSnapshots.market}))`,
            goldDecision.market,
          ),
          eq(
            sql<string>`upper(trim(${dailyPositionSnapshots.currency}))`,
            goldDecision.currency,
          ),
          eq(
            sql<string>`lower(trim(${dailyPositionSnapshots.assetType}))`,
            goldDecision.assetType,
          ),
        ),
      )
      .orderBy(
        asc(dailyPositionSnapshots.snapshotDate),
        asc(dailyPositionSnapshots.account),
        asc(dailyPositionSnapshots.assetName),
      ),
    loadPortfolioRiskReadModel(
      createTenantInvestmentLabMarketHistoryRepository(
        tenantContext,
        activeOwnerUserIdsPromise,
      ),
      { account, window: 90 },
    ),
  ]);

  return buildInvestmentLabDataAvailability({
    account,
    snapshotRows,
    manualValuationCurrentRows,
    manualValuationSnapshotRows,
    marketHistory: {
      inputStatus: riskModel.inputHealth.status,
      requestedReturnObservations:
        riskModel.provenance.requestedReturnObservations,
      usableReturnObservations:
        riskModel.provenance.usableReturnObservations,
      returnCoveragePct: riskModel.provenance.returnCoveragePct,
      selectedHoldingCount: riskModel.provenance.selectedHoldingCount,
      eligibleHoldingCount: riskModel.provenance.eligibleHoldingCount,
      includedInstrumentCount: riskModel.provenance.includedInstrumentCount,
      excludedHoldings: riskModel.inputHealth.exclusions,
      blockerCount: riskModel.inputHealth.blockers.length,
      priceGapCount: riskModel.inputHealth.missingEvidence.priceGapCount,
      fxGapCount: riskModel.inputHealth.missingEvidence.fxGapCount,
    },
  });
}

export async function getReadOnlyTenantInvestmentLabDataAvailabilityForScope({
  evidencePromise,
  scope,
  tenantContext,
}: {
  evidencePromise: Promise<InvestmentLabAnalysisScopeEvidence>;
  scope: PortfolioAnalysisScope;
  tenantContext: TenantContext;
}) {
  const readNow = new Date();
  const serviceDate = resolveSnapshotCycle(readNow).snapshotDate;
  const activeOwnerUserIdsPromise = getActivePortfolioOwnerUserIds();
  const targetsPromise = getPortfolioAnalysisScopeTargets({
    scope,
    serviceDate,
    tenantContext,
  });
  const riskModelPromise = loadPreselectedPortfolioRiskReadModel(
    createTenantPortfolioRiskScopeRepository({
      loadPrices: createInvestmentLabHistoricalPriceLoader(
        tenantContext,
        activeOwnerUserIdsPromise,
      ),
      scope,
      serviceDate,
      tenantContext,
    }),
    { now: readNow, window: 90 },
  );
  const [evidence, targets, riskModel] = await Promise.all([
    evidencePromise,
    targetsPromise,
    riskModelPromise,
  ]);
  const goldDecision =
    DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions.krxGold;
  const assetScopePredicate = targets.includesAllOwnedAccounts
    ? undefined
    : combineScopePredicates([
        inArrayWhenPresent(accounts.id, targets.wholeAccountIds),
        inArrayWhenPresent(assets.id, targets.directAssetIds),
      ]);
  const manualValuationCurrentRows =
    assetScopePredicate === null
      ? []
      : await db
          .select({
            assetId: assets.id,
            assetName: assets.name,
            account: assets.account,
            market: assets.market,
            currency: assets.currency,
            assetType: assets.assetType,
            currentPrice: assets.currentPrice,
            priceSource: assets.priceSource,
            priceAsOf: assets.priceAsOf,
            priceQuoteType: assets.priceQuoteType,
            priceStatus: assets.priceStatus,
          })
          .from(assets)
          .innerJoin(accounts, eq(assets.accountId, accounts.id))
          .where(
            and(
              eq(accounts.canonicalOwnerUserId, tenantContext.ownerUserId),
              eq(accounts.isActive, true),
              eq(assets.canonicalOwnerUserId, tenantContext.ownerUserId),
              eq(assets.account, accounts.code),
              eq(assets.name, goldDecision.assetName),
              eq(sql<string>`lower(trim(${assets.market}))`, goldDecision.market),
              eq(sql<string>`upper(trim(${assets.currency}))`, goldDecision.currency),
              eq(sql<string>`lower(trim(${assets.assetType}))`, goldDecision.assetType),
              assetScopePredicate,
            ),
          );

  return buildInvestmentLabDataAvailability({
    account: evidence.engineAccount,
    snapshotRows: evidence.snapshotRows,
    manualValuationCurrentRows: manualValuationCurrentRows.map((row) => ({
      ...row,
      account:
        evidence.engineAccount === "all"
          ? row.account
          : evidence.engineAccount,
    })),
    manualValuationSnapshotRows: evidence.anchorPositionRows
      .filter(
        (row) =>
          normalizeText(row.assetName) === normalizeText(goldDecision.assetName) &&
          normalizeText(row.identityAccount ?? row.account) ===
            goldDecision.account &&
          normalizeText(row.market) === goldDecision.market &&
          normalizeUpper(row.currency) === goldDecision.currency &&
          normalizeText(row.assetType) === goldDecision.assetType,
      )
      .map((row) => ({
        snapshotDate: row.snapshotDate,
        assetId: row.assetId ?? null,
        legacyAssetId: row.legacyAssetId ?? null,
        assetName: row.assetName ?? goldDecision.assetName,
        account: row.account,
        market: row.market,
        currency: row.currency,
        assetType: row.assetType,
        source: row.source,
        priceSource: row.priceSource ?? null,
        priceBasis: row.priceBasis ?? null,
        currentPrice: row.currentPrice ?? null,
        priceDate: row.priceDate ?? null,
        referenceDate: row.referenceDate ?? null,
        capturedAt: row.capturedAt ?? null,
      })),
    marketHistory: {
      inputStatus: riskModel.inputHealth.status,
      requestedReturnObservations:
        riskModel.provenance.requestedReturnObservations,
      usableReturnObservations: riskModel.provenance.usableReturnObservations,
      returnCoveragePct: riskModel.provenance.returnCoveragePct,
      selectedHoldingCount: riskModel.provenance.selectedHoldingCount,
      eligibleHoldingCount: riskModel.provenance.eligibleHoldingCount,
      includedInstrumentCount: riskModel.provenance.includedInstrumentCount,
      excludedHoldings: riskModel.inputHealth.exclusions,
      blockerCount: riskModel.inputHealth.blockers.length,
      priceGapCount: riskModel.inputHealth.missingEvidence.priceGapCount,
      fxGapCount: riskModel.inputHealth.missingEvidence.fxGapCount,
    },
  });
}

function createTenantInvestmentLabMarketHistoryRepository(
  tenantContext: TenantContext,
  activeOwnerUserIdsPromise: Promise<readonly string[]>,
) {
  return createTenantPortfolioRiskRepository(
    tenantContext,
    createInvestmentLabHistoricalPriceLoader(
      tenantContext,
      activeOwnerUserIdsPromise,
    ),
  );
}

function createInvestmentLabHistoricalPriceLoader(
  tenantContext: TenantContext,
  activeOwnerUserIdsPromise: Promise<readonly string[]>,
) {
  return async (
    input: Parameters<typeof loadPortfolioRiskPriceCandidates>[0],
  ) => {
    const rows = await loadPortfolioRiskPriceCandidates(input);
    const adjustedRows = admitAdjustedHistoricalPriceRows(rows).rows;
    const privateRawRows = admitPrivateSingleTenantRawHistoricalPriceRows({
      rows,
      requestedOwnerUserId: tenantContext.ownerUserId,
      activeOwnerUserIds: await activeOwnerUserIdsPromise,
    }).rows;
    const preferred = selectPreferredPrivateHistoricalPriceRows({
      adjustedRows,
      privateRawRows,
    });

    return preferred.rows.map(({ row, priceBasis }) => ({
      ticker: row.ticker,
      market: row.market,
      currency: row.currency,
      priceDate: row.priceDate,
      closePrice: row.closePrice,
      adjustedClosePrice:
        priceBasis === "provider_adjusted_close"
          ? row.adjustedClosePrice
          : null,
      source:
        priceBasis === "provider_adjusted_close"
          ? row.adjustedCloseSource
          : row.source,
      isSample: row.isSample,
    }));
  };
}

function activeOwnedAccountPredicates(tenantContext: TenantContext) {
  return [
    eq(accounts.canonicalOwnerUserId, tenantContext.ownerUserId),
    eq(accounts.isActive, true),
    inArray(accounts.code, NAMED_PORTFOLIO_ACCOUNTS),
  ];
}

function inArrayWhenPresent(
  column: typeof accounts.id | typeof assets.id,
  values: readonly string[],
) {
  return values.length > 0 ? inArray(column, values) : null;
}

function combineScopePredicates(predicates: readonly (SQL | null)[]) {
  const available = predicates.filter((value): value is SQL => value !== null);
  if (available.length === 0) return null;
  return available.length === 1 ? available[0] : or(...available);
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeUpper(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}
