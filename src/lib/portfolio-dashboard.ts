import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  accounts,
  assetGroups,
  assetPriceSnapshots,
  assets,
  dailyPortfolioSnapshots,
  dailyPositionSnapshots,
  eventLedgerEntries,
  fxRates,
  livePriceQuotes,
  settings,
} from "@/db/schema";
import {
  assetMetricKey,
  buildReturnMetricsSummary,
  getAssetReturnMetrics,
  getSelectedRealizedRows,
  portfolioEventAccount,
  type AssetReturnMetrics,
  type ReturnMetricsSummary,
} from "@/lib/portfolio-return-metrics";
import {
  convertToKrw,
  diffDays,
  normalizeTicker,
  resolveKrwFxRate,
  percentOrNull,
  sumBy,
  toNumber,
  uniqueStrings,
} from "@/lib/portfolio-math";
import {
  buildDailyPositionMovement,
  buildPreviousCloseMovement,
  type PortfolioMovementContribution,
  type PortfolioMovementCycle,
  type PortfolioMovementCoverage,
  type PortfolioMovementExclusion,
  type PortfolioMovementSource,
} from "@/lib/portfolio-movement";
import { buildCycleForSnapshotDate, resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";

const INVESTMENT_ASSET_TYPES = new Set(["etf", "stock", "pension", "commodity"]);
const NON_INVESTMENT_ASSET_TYPES = new Set([
  "savings",
  "fixed_deposit",
  "housing_subscription",
]);
const ASSET_ACCOUNT_CODES = ["brokerage", "isa", "irp"] as const;
const DEFAULT_TRIM_DRIFT_THRESHOLD = 12;
export type AssetAccount = (typeof ASSET_ACCOUNT_CODES)[number];
export type DashboardAccount = "all" | AssetAccount;

type AssetRow = typeof assets.$inferSelect;
type AssetGroupRow = typeof assetGroups.$inferSelect;
type LivePriceQuoteRow = typeof livePriceQuotes.$inferSelect;
type PortfolioSnapshotRow = typeof dailyPortfolioSnapshots.$inferSelect;
type EventLedgerRow = typeof eventLedgerEntries.$inferSelect;

type MovementSource = PortfolioMovementSource;
type FxFreshnessState = "missing" | "fresh" | "stale";

export type DashboardHolding = {
  id: string;
  legacyBase44Id: string | null;
  name: string;
  ticker: string | null;
  account: string;
  market: string;
  currency: string;
  quantity: number;
  currentPrice: number;
  priceSource: string | null;
  priceFetchedAt: string | null;
  priceAsOf: string | null;
  priceQuoteType: string | null;
  priceStatus: string | null;
  valueKrw: number;
  costBasisKrw: number;
  realizedCostBasisKrw: number;
  unrealizedPnlKrw: number;
  realizedPnlKrw: number;
  totalPnlKrw: number;
  holdingReturnPct: number | null;
  totalReturnPct: number | null;
  currentWeight: number;
  targetWeight: number;
  effectiveTargetWeight: number;
  driftPct: number;
  needsTrim: boolean;
  dailyChangeKrw: number | null;
  dailyReturnPct: number | null;
  dailySource: MovementSource;
  previousCloseValueKrw: number | null;
  fxDailyChangeKrw: number | null;
  groupName: string | null;
};

export type AccountSummary = {
  code: AssetAccount;
  label: string;
  totalValueKrw: number;
  costBasisKrw: number;
  unrealizedPnlKrw: number;
  realizedPnlKrw: number;
  totalPnlKrw: number;
  holdingReturnPct: number | null;
  totalReturnPct: number | null;
  holdingCount: number;
};

export type NonInvestmentAsset = {
  id: string;
  name: string;
  ticker: string | null;
  assetType: string;
  account: string;
  valueKrw: number;
};

export type RecentPortfolioPoint = {
  date: string;
  totalMarketValue: number;
  totalPnl: number | null;
  totalReturnPct: number | null;
};

export type EventActivityMappingStatus = "mapped" | "legacy_only" | "unmatched";

export type DashboardEventActivity = {
  id: string;
  eventDate: string;
  eventType: string;
  account: string | null;
  accountLabel: string;
  ticker: string | null;
  assetName: string;
  source: string | null;
  ruleVersion: string | null;
  mappingStatus: EventActivityMappingStatus;
  amountKrw: number | null;
  quantityDelta: number | null;
  realizedPnlKrw: number | null;
  realizedCostBasisKrw: number | null;
  missingCost: boolean;
};

export type DashboardData = {
  selectedAccount: DashboardAccount;
  generatedAt: string;
  usdKrwRate: number;
  latestSnapshotDate: string | null;
  latestSnapshotReferenceDate: string | null;
  totalValueKrw: number;
  costBasisKrw: number;
  realizedCostBasisKrw: number;
  unrealizedPnlKrw: number;
  realizedPnlKrw: number;
  totalPnlKrw: number;
  holdingReturnPct: number | null;
  totalReturnPct: number | null;
  todayChangeKrw: number | null;
  todayReturnPct: number | null;
  todayFxChangeKrw: number | null;
  tradeFlowKrw: number;
  trimDriftThreshold: number;
  useTrendFilter: boolean;
  accountSummaries: AccountSummary[];
  holdings: DashboardHolding[];
  nonInvestmentAssets: NonInvestmentAsset[];
  nonInvestmentTotalKrw: number;
  recentSnapshots: RecentPortfolioPoint[];
  eventActivity: DashboardEventActivity[];
  topMovers: DashboardHolding[];
  todayMovement: DashboardTodayMovement;
  dataHealth: {
    importedAssetCount: number;
    investmentAssetCount: number;
    nonInvestmentAssetCount: number;
    assetCount: number;
    eventLedgerCount: number;
    selectedEventLedgerCount: number;
    selectedRealizedSellEventCount: number;
    selectedUnmatchedSellEventCount: number;
    latestSnapshotPositions: number;
    unmatchedSnapshotRows: number;
    unmatchedSnapshotRowsAllTime: number;
    movementReady: boolean;
    movementSource: MovementSource;
    movementReason: string | null;
    movementCurrentCoveragePct: number | null;
    movementSnapshotCoveragePct: number | null;
    movementCountCoveragePct: number | null;
    previousCloseCoveragePct: number | null;
    headlineBasis: "current_assets_plus_event_ledger";
    trendBasis: "daily_portfolio_snapshots";
    latestPortfolioSnapshotDate: string | null;
    portfolioSnapshotValueDeltaKrw: number | null;
    portfolioSnapshotPnlDeltaKrw: number | null;
    portfolioSnapshotReturnPctDelta: number | null;
    unsupportedCurrencyCount: number;
    unsupportedCurrencies: string[];
    latestFxRateDate: string | null;
    latestFxSource: string | null;
    latestFxFetchedAt: string | null;
    latestFxAgeDays: number | null;
    fxFreshnessState: FxFreshnessState;
  };
};

type DashboardMovementCycle = PortfolioMovementCycle;

export type DashboardTodayMovement = {
  ready: boolean;
  source: MovementSource;
  reason: string | null;
  previousTotalKrw: number;
  changeKrw: number | null;
  returnPct: number | null;
  tradeFlowKrw: number;
  fxChangeKrw: number | null;
  contributionRows: PortfolioMovementContribution[];
  exclusions: PortfolioMovementExclusion[];
  coverage: PortfolioMovementCoverage;
};

export function normalizeDashboardAccount(value: string | string[] | undefined) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (
    rawValue === "all" ||
    rawValue === "brokerage" ||
    rawValue === "isa" ||
    rawValue === "irp"
  ) {
    return rawValue;
  }
  return "brokerage";
}

export async function getPortfolioDashboard(
  selectedAccount: DashboardAccount,
): Promise<DashboardData> {
  const now = new Date();
  const movementCycle = buildDashboardMovementCycle(now);
  const [
    accountRows,
    assetGroupRows,
    assetRows,
    settingsRows,
    latestFxRows,
    movementSnapshotRows,
    recentPortfolioRows,
    eventRows,
    unmatchedSnapshotCountRows,
  ] = await Promise.all([
    db.select().from(accounts),
    db.select().from(assetGroups),
    db.select().from(assets),
    db.select().from(settings).orderBy(desc(settings.createdAt)).limit(1),
    db.select().from(fxRates).orderBy(desc(fxRates.rateDate)).limit(1),
    getPositionSnapshotDateForCycle(selectedAccount, movementCycle.snapshotDate),
    db
      .select()
      .from(dailyPortfolioSnapshots)
      .where(eq(dailyPortfolioSnapshots.account, selectedAccount))
      .orderBy(desc(dailyPortfolioSnapshots.snapshotDate))
      .limit(30),
    db.select().from(eventLedgerEntries),
    db
      .select({
        count: sql<number>`count(*) filter (where ${dailyPositionSnapshots.assetId} is null)::int`,
      })
      .from(dailyPositionSnapshots),
  ]);

  const latestSnapshotDate = movementSnapshotRows[0]?.snapshotDate ?? null;
  const latestPositionRows = latestSnapshotDate
    ? await db
        .select()
        .from(dailyPositionSnapshots)
        .where(eq(dailyPositionSnapshots.snapshotDate, latestSnapshotDate))
    : [];

  const investmentAssetRows = assetRows.filter((asset) =>
    INVESTMENT_ASSET_TYPES.has(asset.assetType ?? "etf"),
  );
  const quoteTickers = uniqueStrings(
    investmentAssetRows
      .map((asset) => normalizeTicker(asset.ticker))
      .filter((ticker): ticker is string => Boolean(ticker)),
  );
  const liveQuoteRows =
    quoteTickers.length > 0
      ? await db
          .select()
          .from(livePriceQuotes)
          .where(inArray(livePriceQuotes.ticker, quoteTickers))
          .orderBy(desc(livePriceQuotes.fetchedAt))
          .limit(Math.max(100, quoteTickers.length * 4))
      : [];
  const liveQuotesByAssetKey = buildLiveQuotesByAssetKey(liveQuoteRows);
  const valuationAssetRows = investmentAssetRows.map((asset) =>
    applyLiveQuote(asset, liveQuotesByAssetKey.get(assetLiveQuoteKey(asset))),
  );
  const selectedInvestmentAssetRows = valuationAssetRows.filter(
    (asset) => selectedAccount === "all" || asset.account === selectedAccount,
  );
  const priceTickers = uniqueStrings(
    selectedInvestmentAssetRows
      .map((asset) => normalizeTicker(asset.ticker))
      .filter((ticker): ticker is string => Boolean(ticker)),
  );
  const recentPriceRows =
    priceTickers.length > 0
      ? await db
          .select()
          .from(assetPriceSnapshots)
          .where(inArray(assetPriceSnapshots.ticker, priceTickers))
          .orderBy(desc(assetPriceSnapshots.priceDate))
          .limit(Math.max(200, priceTickers.length * 20))
      : [];

  const setting = settingsRows[0] ?? null;
  const latestFxRow = latestFxRows[0] ?? null;
  const usdKrwRate =
    toNumber(latestFxRow?.usdKrw) ?? toNumber(setting?.usdKrwRate) ?? 0;
  const latestFxAgeDays = latestFxRow?.rateDate
    ? diffDays(movementCycle.snapshotDate, latestFxRow.rateDate)
    : null;
  const fxFreshnessState = resolveFxFreshnessState(latestFxAgeDays, usdKrwRate);
  const trimDriftThreshold =
    toNumber(setting?.trimDriftThreshold) ?? DEFAULT_TRIM_DRIFT_THRESHOLD;
  const useTrendFilter = setting?.useTrendFilter ?? false;
  const accountLabels = buildAccountLabels(accountRows);
  const assetGroupNames = buildAssetGroupNames(assetGroupRows);
  const unsupportedCurrencyAssets = valuationAssetRows.filter(
    (asset) => !resolveKrwFxRate(asset.currency, usdKrwRate).ok,
  );
  const returnSummary = buildReturnMetricsSummary(
    eventRows,
    investmentAssetRows,
    usdKrwRate,
  );

  const allHoldingsWithoutWeights = valuationAssetRows.map((asset) =>
    buildHolding({
      asset,
      accountTotalValueKrw: 0,
      groupName: asset.groupId ? assetGroupNames.get(asset.groupId) : null,
      usdKrwRate,
      trimDriftThreshold,
      useTrendFilter,
      returnMetrics: getAssetReturnMetrics(returnSummary, asset, usdKrwRate),
    }),
  );
  const accountTotals = new Map<DashboardAccount, number>();

  for (const code of ASSET_ACCOUNT_CODES) {
    accountTotals.set(
      code,
      allHoldingsWithoutWeights
        .filter((holding) => holding.account === code)
        .reduce((sum, holding) => sum + holding.valueKrw, 0),
    );
  }
  accountTotals.set(
    "all",
    allHoldingsWithoutWeights.reduce((sum, holding) => sum + holding.valueKrw, 0),
  );

  const allHoldings = valuationAssetRows.map((asset) =>
    buildHolding({
      asset,
      accountTotalValueKrw: accountTotals.get(asset.account as AssetAccount) ?? 0,
      groupName: asset.groupId ? assetGroupNames.get(asset.groupId) : null,
      usdKrwRate,
      trimDriftThreshold,
      useTrendFilter,
      returnMetrics: getAssetReturnMetrics(returnSummary, asset, usdKrwRate),
    }),
  );

  const holdingsBase = selectedInvestmentAssetRows.map((asset) =>
    buildHolding({
      asset,
      accountTotalValueKrw: accountTotals.get(selectedAccount) ?? 0,
      groupName: asset.groupId ? assetGroupNames.get(asset.groupId) : null,
      usdKrwRate,
      trimDriftThreshold,
      useTrendFilter,
      returnMetrics: getAssetReturnMetrics(returnSummary, asset, usdKrwRate),
    }),
  );
  const selectedAssetKeys = new Set(
    selectedInvestmentAssetRows.map((asset) => assetMetricKey(asset)),
  );
  const realizedRows = getSelectedRealizedRows(
    returnSummary,
    selectedAccount,
    selectedAssetKeys,
  );
  const dailyPositionMovement = buildDailyPositionMovement({
    holdings: holdingsBase,
    positionRows: latestPositionRows,
    eventRows,
    selectedAccount,
    baselineDate: latestSnapshotDate,
    usdKrwRate,
    movementCycle,
  });
  const previousCloseFallback = buildPreviousCloseMovement({
    holdings: holdingsBase,
    priceRows: recentPriceRows,
    referenceDate: latestSnapshotDate,
    usdKrwRate,
    movementCycle,
  });
  const movement = dailyPositionMovement.ready
    ? dailyPositionMovement
    : previousCloseFallback.ready
      ? previousCloseFallback
      : dailyPositionMovement;
  const fallbackContributions = previousCloseFallback.ready
    ? previousCloseFallback.contributions
    : new Map<string, PortfolioMovementContribution>();
  const holdings = holdingsBase
    .map((holding) =>
      attachDailyContribution(
        holding,
        movement.contributions.get(holding.id) ??
          fallbackContributions.get(holding.id),
      ),
    )
    .sort((a, b) => b.valueKrw - a.valueKrw);

  const totalValueKrw = sumBy(holdings, (holding) => holding.valueKrw);
  const costBasisKrw = sumBy(holdings, (holding) => holding.costBasisKrw);
  const realizedCostBasisKrw =
    sumBy(holdings, (holding) => holding.realizedCostBasisKrw) +
    sumBy(
      realizedRows.filter((row) => !row.assetKey),
      (row) => row.realizedCostBasisKrw,
    );
  const unrealizedPnlKrw = sumBy(holdings, (holding) => holding.unrealizedPnlKrw);
  const realizedPnlKrw =
    sumBy(holdings, (holding) => holding.realizedPnlKrw) +
    sumBy(
      realizedRows.filter((row) => !row.assetKey),
      (row) => row.realizedPnlKrw,
    );
  const totalPnlKrw = unrealizedPnlKrw + realizedPnlKrw;
  const holdingReturnPct = percentOrNull(unrealizedPnlKrw, costBasisKrw);
  const totalReturnPct = percentOrNull(
    totalPnlKrw,
    costBasisKrw + realizedCostBasisKrw,
  );
  const latestPortfolioSnapshot = recentPortfolioRows[0] ?? null;
  const latestPortfolioSnapshotValue = toNumber(
    latestPortfolioSnapshot?.totalMarketValue,
  );
  const latestPortfolioSnapshotPnl = toNumber(latestPortfolioSnapshot?.totalPnl);
  const latestPortfolioSnapshotReturnPct = toNumber(
    latestPortfolioSnapshot?.totalReturnPct,
  );
  const latestAccountPositions = latestPositionRows.filter(
    (position) => selectedAccount === "all" || position.account === selectedAccount,
  );
  const latestSnapshotReferenceDate =
    latestDate(
      latestAccountPositions
        .map((position) => position.referenceDate ?? position.priceDate)
        .filter((date): date is string => Boolean(date)),
    ) ?? latestSnapshotDate;
  const unmatchedSnapshotRows = latestAccountPositions.filter(
    (position) => position.assetId === null,
  ).length;
  const nonInvestmentAssets = buildNonInvestmentAssets(
    assetRows,
    selectedAccount,
    usdKrwRate,
  );

  return {
    selectedAccount,
    generatedAt: new Date().toISOString(),
    usdKrwRate,
    latestSnapshotDate,
    latestSnapshotReferenceDate,
    totalValueKrw,
    costBasisKrw,
    realizedCostBasisKrw,
    unrealizedPnlKrw,
    realizedPnlKrw,
    totalPnlKrw,
    holdingReturnPct,
    totalReturnPct,
    todayChangeKrw: movement.changeKrw,
    todayReturnPct: movement.returnPct,
    todayFxChangeKrw: movement.fxChangeKrw,
    tradeFlowKrw: movement.tradeFlowKrw,
    trimDriftThreshold,
    useTrendFilter,
    accountSummaries: buildAccountSummaries(
      ASSET_ACCOUNT_CODES,
      allHoldings,
      accountLabels,
    ),
    holdings,
    nonInvestmentAssets,
    nonInvestmentTotalKrw: sumBy(
      nonInvestmentAssets,
      (asset) => asset.valueKrw,
    ),
    recentSnapshots: buildRecentSnapshots(recentPortfolioRows),
    eventActivity: buildEventActivity({
      eventRows,
      assetRows: investmentAssetRows,
      selectedAccount,
      accountLabels,
      returnSummary,
    }),
    topMovers: [...holdings]
      .filter((holding) => holding.dailyChangeKrw !== null)
      .sort(
        (a, b) => Math.abs(b.dailyChangeKrw ?? 0) - Math.abs(a.dailyChangeKrw ?? 0),
      )
      .slice(0, 5),
    todayMovement: {
      ready: movement.ready,
      source: movement.source,
      reason: movement.reason,
      previousTotalKrw: movement.previousTotalKrw,
      changeKrw: movement.changeKrw,
      returnPct: movement.returnPct,
      tradeFlowKrw: movement.tradeFlowKrw,
      fxChangeKrw: movement.fxChangeKrw,
      contributionRows: movement.contributionRows,
      exclusions: movement.exclusions,
      coverage: movement.coverage,
    },
    dataHealth: {
      importedAssetCount: assetRows.length,
      investmentAssetCount: investmentAssetRows.length,
      nonInvestmentAssetCount: nonInvestmentAssets.length,
      assetCount: holdings.length,
      eventLedgerCount: eventRows.length,
      selectedEventLedgerCount: filterEventRowsForAccount(
        eventRows,
        investmentAssetRows,
        selectedAccount,
      ).length,
      selectedRealizedSellEventCount: realizedRows.length,
      selectedUnmatchedSellEventCount: realizedRows.filter((row) => !row.assetKey)
        .length,
      latestSnapshotPositions: latestAccountPositions.length,
      unmatchedSnapshotRows,
      unmatchedSnapshotRowsAllTime: Number(unmatchedSnapshotCountRows[0]?.count ?? 0),
      movementReady: movement.ready,
      movementSource: movement.source,
      movementReason: movement.reason,
      movementCurrentCoveragePct: movement.coverage.currentCoveragePct,
      movementSnapshotCoveragePct: movement.coverage.snapshotCoveragePct,
      movementCountCoveragePct: movement.coverage.countCoveragePct,
      previousCloseCoveragePct: previousCloseFallback.coverage.previousCloseCoveragePct,
      headlineBasis: "current_assets_plus_event_ledger",
      trendBasis: "daily_portfolio_snapshots",
      latestPortfolioSnapshotDate: latestPortfolioSnapshot?.snapshotDate ?? null,
      portfolioSnapshotValueDeltaKrw: deltaOrNull(
        totalValueKrw,
        latestPortfolioSnapshotValue,
      ),
      portfolioSnapshotPnlDeltaKrw: deltaOrNull(
        totalPnlKrw,
        latestPortfolioSnapshotPnl,
      ),
      portfolioSnapshotReturnPctDelta: deltaOrNull(
        totalReturnPct,
        latestPortfolioSnapshotReturnPct,
      ),
      unsupportedCurrencyCount: unsupportedCurrencyAssets.length,
      unsupportedCurrencies: uniqueStrings(
        unsupportedCurrencyAssets.map((asset) => asset.currency),
      ).sort(),
      latestFxRateDate: latestFxRow?.rateDate ?? null,
      latestFxSource: latestFxRow?.source ?? null,
      latestFxFetchedAt: latestFxRow?.fetchedAt?.toISOString() ?? null,
      latestFxAgeDays,
      fxFreshnessState,
    },
  };
}

function resolveFxFreshnessState(
  latestFxAgeDays: number | null,
  usdKrwRate: number,
): FxFreshnessState {
  if (usdKrwRate <= 0 || latestFxAgeDays === null) return "missing";
  return latestFxAgeDays <= 1 ? "fresh" : "stale";
}

function getPositionSnapshotDateForCycle(
  selectedAccount: DashboardAccount,
  snapshotDate: string,
) {
  if (selectedAccount === "all") {
    return db
      .select({ snapshotDate: dailyPositionSnapshots.snapshotDate })
      .from(dailyPositionSnapshots)
      .where(eq(dailyPositionSnapshots.snapshotDate, snapshotDate))
      .limit(1);
  }

  return db
    .select({ snapshotDate: dailyPositionSnapshots.snapshotDate })
    .from(dailyPositionSnapshots)
    .where(
      and(
        eq(dailyPositionSnapshots.snapshotDate, snapshotDate),
        eq(dailyPositionSnapshots.account, selectedAccount),
      ),
    )
    .limit(1);
}

function buildDashboardMovementCycle(now: Date): DashboardMovementCycle {
  const { snapshotDate } = resolveSnapshotCycle(now);
  const snapshotCycle = buildCycleForSnapshotDate(snapshotDate, now);
  const liveWindowStartAt = snapshotCycle.cycleEndAt;

  return {
    snapshotDate,
    liveWindowStartAt,
    liveWindowEndAt: new Date(liveWindowStartAt.getTime() + 24 * 60 * 60 * 1000),
  };
}

function buildLiveQuotesByAssetKey(rows: LivePriceQuoteRow[]) {
  const quotes = new Map<string, LivePriceQuoteRow>();

  for (const row of rows) {
    const key = liveQuoteKey(row.market, row.ticker, row.currency);
    if (!quotes.has(key)) quotes.set(key, row);
  }

  return quotes;
}

function applyLiveQuote(asset: AssetRow, quote: LivePriceQuoteRow | undefined) {
  if (!quote || quote.status !== "ok") return asset;

  return {
    ...asset,
    currentPrice: quote.price,
    priceSource: quote.source,
    priceFetchedAt: quote.fetchedAt,
    priceAsOf: quote.priceAsOf,
    priceQuoteType: quote.quoteType,
    priceStatus: quote.status,
    priceError: quote.error,
  };
}

function assetLiveQuoteKey(asset: Pick<AssetRow, "market" | "ticker" | "currency">) {
  return liveQuoteKey(asset.market, normalizeTicker(asset.ticker) ?? "", asset.currency);
}

function liveQuoteKey(market: string, ticker: string, currency: string) {
  return `${market}:${normalizeTicker(ticker) ?? ""}:${currency}`;
}

function buildHolding({
  asset,
  accountTotalValueKrw,
  groupName,
  usdKrwRate,
  trimDriftThreshold,
  useTrendFilter,
  returnMetrics,
}: {
  asset: AssetRow;
  accountTotalValueKrw: number;
  groupName: string | null | undefined;
  usdKrwRate: number;
  trimDriftThreshold: number;
  useTrendFilter: boolean;
  returnMetrics: AssetReturnMetrics;
}): DashboardHolding {
  const quantity = toNumber(asset.quantity) ?? 0;
  const currentPrice = toNumber(asset.currentPrice) ?? 0;
  const targetWeight = toNumber(asset.targetWeight) ?? 0;
  const ma120 = toNumber(asset.ma120);
  const fractionalKrwValue = toNumber(asset.fractionalKrwValue) ?? 0;
  const localValue = quantity * currentPrice;
  const valueKrw =
    (convertToKrw(localValue, asset.currency, usdKrwRate) ?? 0) +
    fractionalKrwValue;
  const costBasisKrw = returnMetrics.costBasisKrw;
  const unrealizedPnlKrw = valueKrw - costBasisKrw;
  const realizedPnlKrw = returnMetrics.realizedPnlKrw;
  const realizedCostBasisKrw = returnMetrics.realizedCostBasisKrw;
  const totalPnlKrw = unrealizedPnlKrw + realizedPnlKrw;
  const currentWeight =
    accountTotalValueKrw > 0 ? (valueKrw / accountTotalValueKrw) * 100 : 0;
  const belowMa =
    useTrendFilter && ma120 !== null && ma120 > 0 && currentPrice <= ma120;
  const effectiveTargetWeight = belowMa ? targetWeight / 2 : targetWeight;
  const driftPct =
    effectiveTargetWeight > 0
      ? (currentWeight / effectiveTargetWeight - 1) * 100
      : 0;

  return {
    id: asset.id,
    legacyBase44Id: asset.legacyBase44Id,
    name: asset.name,
    ticker: asset.ticker,
    account: asset.account,
    market: asset.market,
    currency: asset.currency,
    quantity,
    currentPrice,
    priceSource: asset.priceSource,
    priceFetchedAt: timestampIso(asset.priceFetchedAt),
    priceAsOf: timestampIso(asset.priceAsOf),
    priceQuoteType: asset.priceQuoteType,
    priceStatus: asset.priceStatus,
    valueKrw,
    costBasisKrw,
    realizedCostBasisKrw,
    unrealizedPnlKrw,
    realizedPnlKrw,
    totalPnlKrw,
    holdingReturnPct: percentOrNull(unrealizedPnlKrw, costBasisKrw),
    totalReturnPct: percentOrNull(
      totalPnlKrw,
      costBasisKrw + realizedCostBasisKrw,
    ),
    currentWeight,
    targetWeight,
    effectiveTargetWeight,
    driftPct,
    needsTrim: driftPct > trimDriftThreshold,
    dailyChangeKrw: null,
    dailyReturnPct: null,
    dailySource: null,
    previousCloseValueKrw: null,
    fxDailyChangeKrw: null,
    groupName: groupName ?? null,
  };
}

function attachDailyContribution(
  holding: DashboardHolding,
  contribution: PortfolioMovementContribution | undefined,
) {
  if (!contribution) return holding;

  return {
    ...holding,
    dailyChangeKrw: contribution.changeKrw,
    dailyReturnPct: contribution.returnPct,
    dailySource: contribution.source,
    previousCloseValueKrw: contribution.previousValueKrw,
    fxDailyChangeKrw: contribution.fxChangeKrw,
  };
}

function buildAccountLabels(accountRows: (typeof accounts.$inferSelect)[]) {
  const labels = new Map<string, string>();
  for (const account of accountRows) {
    labels.set(account.code, account.name);
  }
  labels.set(
    "brokerage",
    labels.get("brokerage") === "Brokerage"
      ? "증권"
      : (labels.get("brokerage") ?? "증권"),
  );
  labels.set("isa", labels.get("isa") ?? "ISA");
  labels.set("irp", labels.get("irp") ?? "IRP");
  return labels;
}

function buildAssetGroupNames(groupRows: AssetGroupRow[]) {
  const names = new Map<string, string>();
  for (const group of groupRows) {
    names.set(group.id, group.name);
  }
  return names;
}

function buildAccountSummaries(
  accountCodes: readonly AssetAccount[],
  holdings: DashboardHolding[],
  accountLabels: Map<string, string>,
): AccountSummary[] {
  return accountCodes.map((code) => {
    const accountHoldings = holdings.filter((holding) => holding.account === code);
    const totalValueKrw = sumBy(accountHoldings, (holding) => holding.valueKrw);
    const costBasisKrw = sumBy(accountHoldings, (holding) => holding.costBasisKrw);
    const realizedCostBasisKrw = sumBy(
      accountHoldings,
      (holding) => holding.realizedCostBasisKrw,
    );
    const unrealizedPnlKrw = sumBy(
      accountHoldings,
      (holding) => holding.unrealizedPnlKrw,
    );
    const realizedPnlKrw = sumBy(
      accountHoldings,
      (holding) => holding.realizedPnlKrw,
    );
    const totalPnlKrw = unrealizedPnlKrw + realizedPnlKrw;
    return {
      code,
      label: accountLabels.get(code) ?? code,
      totalValueKrw,
      costBasisKrw,
      unrealizedPnlKrw,
      realizedPnlKrw,
      totalPnlKrw,
      holdingReturnPct: percentOrNull(unrealizedPnlKrw, costBasisKrw),
      totalReturnPct: percentOrNull(
        totalPnlKrw,
        costBasisKrw + realizedCostBasisKrw,
      ),
      holdingCount: accountHoldings.length,
    };
  });
}

function buildNonInvestmentAssets(
  assetRows: AssetRow[],
  selectedAccount: DashboardAccount,
  usdKrwRate: number,
): NonInvestmentAsset[] {
  return assetRows
    .filter((asset) => NON_INVESTMENT_ASSET_TYPES.has(asset.assetType ?? ""))
    .filter((asset) => selectedAccount === "all" || asset.account === selectedAccount)
    .map((asset) => ({
      id: asset.id,
      name: asset.name,
      ticker: asset.ticker,
      assetType: asset.assetType ?? "cash_like",
      account: asset.account,
      valueKrw:
        (convertToKrw(toNumber(asset.currentPrice) ?? 0, asset.currency, usdKrwRate) ??
          0) +
        (toNumber(asset.fractionalKrwValue) ?? 0),
    }))
    .sort((a, b) => b.valueKrw - a.valueKrw);
}

function buildRecentSnapshots(rows: PortfolioSnapshotRow[]) {
  return [...rows]
    .reverse()
    .map((row) => ({
      date: row.snapshotDate,
      totalMarketValue: toNumber(row.totalMarketValue) ?? 0,
      totalPnl: toNumber(row.totalPnl),
      totalReturnPct: toNumber(row.totalReturnPct),
    }))
    .slice(-14);
}

function latestDate(values: string[]) {
  return values.sort((left, right) => right.localeCompare(left))[0] ?? null;
}

function buildEventActivity({
  eventRows,
  assetRows,
  selectedAccount,
  accountLabels,
  returnSummary,
}: {
  eventRows: EventLedgerRow[];
  assetRows: AssetRow[];
  selectedAccount: DashboardAccount;
  accountLabels: Map<string, string>;
  returnSummary: ReturnMetricsSummary;
}): DashboardEventActivity[] {
  const realizedByEventId = new Map(
    returnSummary.realizedRows
      .filter((row) => row.eventId)
      .map((row) => [row.eventId as string, row]),
  );

  return filterEventRowsForAccount(eventRows, assetRows, selectedAccount)
    .sort(compareEventsDescending)
    .slice(0, 8)
    .map((event) => {
      const resolvedAsset = resolveEventActivityAsset(event, assetRows);
      const account = portfolioEventAccount(event) ?? resolvedAsset?.account ?? null;
      const realized = event.id ? realizedByEventId.get(event.id) : null;

      return {
        id: event.id,
        eventDate: event.eventDate,
        eventType: event.eventType,
        account,
        accountLabel: account ? accountLabels.get(account) ?? account : "계정 미상",
        ticker: event.ticker ?? resolvedAsset?.ticker ?? null,
        assetName: event.assetName || resolvedAsset?.name || "이름 없음",
        source: event.source,
        ruleVersion: event.ruleVersion,
        mappingStatus: eventActivityMappingStatus(event, resolvedAsset),
        amountKrw: toNumber(event.amountKrw),
        quantityDelta: toNumber(event.quantityDelta),
        realizedPnlKrw: realized?.realizedPnlKrw ?? null,
        realizedCostBasisKrw: realized?.realizedCostBasisKrw ?? null,
        missingCost: realized?.missingCost ?? false,
      };
    });
}

function filterEventRowsForAccount(
  eventRows: EventLedgerRow[],
  assetRows: AssetRow[],
  selectedAccount: DashboardAccount,
) {
  if (selectedAccount === "all") return eventRows;

  return eventRows.filter((event) => {
    const resolvedAsset = resolveEventActivityAsset(event, assetRows);
    return eventMatchesSelectedAccount(
      event,
      selectedAccount,
      resolvedAsset?.account ?? null,
    );
  });
}

function resolveEventActivityAsset(event: EventLedgerRow, assetRows: AssetRow[]) {
  if (event.assetId) {
    const byId = assetRows.find((asset) => asset.id === event.assetId);
    if (byId) return byId;
  }

  if (event.legacyAssetId) {
    const byLegacyId = assetRows.find(
      (asset) => asset.legacyBase44Id === event.legacyAssetId,
    );
    if (byLegacyId) return byLegacyId;
  }

  const eventAccount = portfolioEventAccount(event);
  const accountsToTry = eventAccount ? [eventAccount] : ASSET_ACCOUNT_CODES;
  const eventTicker = normalizeTicker(event.ticker);

  for (const account of accountsToTry) {
    if (eventTicker) {
      const byTicker = assetRows.find(
        (asset) =>
          asset.account === account &&
          normalizeTicker(asset.ticker) === eventTicker,
      );
      if (byTicker) return byTicker;
    }

    const byName = assetRows.find(
      (asset) => asset.account === account && asset.name === event.assetName,
    );
    if (byName) return byName;
  }

  return null;
}

function eventActivityMappingStatus(
  event: EventLedgerRow,
  resolvedAsset: AssetRow | null,
): EventActivityMappingStatus {
  if (resolvedAsset) return "mapped";
  if (event.legacyAssetId || event.ticker || event.assetName) return "legacy_only";
  return "unmatched";
}

function compareEventsDescending(a: EventLedgerRow, b: EventLedgerRow) {
  const dateCompare = b.eventDate.localeCompare(a.eventDate);
  if (dateCompare !== 0) return dateCompare;
  return eventTimestampMs(b) - eventTimestampMs(a);
}

function eventTimestampMs(event: EventLedgerRow) {
  const timestamp = event.recordedAt ?? event.createdAt;
  return new Date(timestamp).getTime();
}

function eventMatchesSelectedAccount(
  event: EventLedgerRow,
  selectedAccount: DashboardAccount,
  fallbackAccount: string | null,
) {
  if (selectedAccount === "all") return true;
  const eventAccount = portfolioEventAccount(event);
  if (eventAccount) return eventAccount === selectedAccount;
  if (fallbackAccount) return fallbackAccount === selectedAccount;
  return selectedAccount === "brokerage";
}

function deltaOrNull(left: number | null, right: number | null) {
  if (left === null || right === null) return null;
  return left - right;
}

function timestampIso(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
