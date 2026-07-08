import "server-only";

import { desc, eq, inArray, sql } from "drizzle-orm";

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
  percentOrNull,
  sumBy,
  toNumber,
  uniqueStrings,
} from "@/lib/portfolio-math";

const INVESTMENT_ASSET_TYPES = new Set(["etf", "stock", "pension", "commodity"]);
const NON_INVESTMENT_ASSET_TYPES = new Set([
  "savings",
  "fixed_deposit",
  "housing_subscription",
]);
const ASSET_ACCOUNT_CODES = ["brokerage", "isa", "irp"] as const;
const DEFAULT_TRIM_DRIFT_THRESHOLD = 12;
const DAILY_MOVEMENT_MIN_VALUE_COVERAGE = 0.8;
const DAILY_MOVEMENT_MIN_COUNT_COVERAGE = 0.6;
const PREVIOUS_CLOSE_MAX_AGE_DAYS = 10;

export type AssetAccount = (typeof ASSET_ACCOUNT_CODES)[number];
export type DashboardAccount = "all" | AssetAccount;

type AssetRow = typeof assets.$inferSelect;
type AssetGroupRow = typeof assetGroups.$inferSelect;
type PositionSnapshotRow = typeof dailyPositionSnapshots.$inferSelect;
type PortfolioSnapshotRow = typeof dailyPortfolioSnapshots.$inferSelect;
type EventLedgerRow = typeof eventLedgerEntries.$inferSelect;
type AssetPriceSnapshotRow = typeof assetPriceSnapshots.$inferSelect;

type MovementSource = "daily_position_snapshot" | "asset_price_snapshot" | null;

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
  };
};

type HoldingDailyContribution = {
  holdingId: string;
  previousValueKrw: number;
  changeKrw: number;
  returnPct: number | null;
  tradeFlowKrw: number;
  fxChangeKrw: number;
  source: Exclude<MovementSource, null>;
};

type MovementCoverage = {
  currentCoveragePct: number | null;
  snapshotCoveragePct: number | null;
  countCoveragePct: number | null;
  previousCloseCoveragePct: number | null;
};

type MovementResult = {
  ready: boolean;
  source: MovementSource;
  reason: string | null;
  previousTotalKrw: number;
  changeKrw: number | null;
  returnPct: number | null;
  tradeFlowKrw: number;
  fxChangeKrw: number | null;
  contributions: Map<string, HoldingDailyContribution>;
  coverage: MovementCoverage;
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
  const [
    accountRows,
    assetGroupRows,
    assetRows,
    settingsRows,
    latestFxRows,
    latestSnapshotRows,
    recentPortfolioRows,
    eventRows,
    unmatchedSnapshotCountRows,
  ] = await Promise.all([
    db.select().from(accounts),
    db.select().from(assetGroups),
    db.select().from(assets),
    db.select().from(settings).orderBy(desc(settings.createdAt)).limit(1),
    db.select().from(fxRates).orderBy(desc(fxRates.rateDate)).limit(1),
    getLatestPositionSnapshotDate(selectedAccount),
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

  const latestSnapshotDate = latestSnapshotRows[0]?.snapshotDate ?? null;
  const latestPositionRows = latestSnapshotDate
    ? await db
        .select()
        .from(dailyPositionSnapshots)
        .where(eq(dailyPositionSnapshots.snapshotDate, latestSnapshotDate))
    : [];

  const investmentAssetRows = assetRows.filter((asset) =>
    INVESTMENT_ASSET_TYPES.has(asset.assetType ?? "etf"),
  );
  const selectedInvestmentAssetRows = investmentAssetRows.filter(
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
  const usdKrwRate =
    toNumber(latestFxRows[0]?.usdKrw) ?? toNumber(setting?.usdKrwRate) ?? 0;
  const trimDriftThreshold =
    toNumber(setting?.trimDriftThreshold) ?? DEFAULT_TRIM_DRIFT_THRESHOLD;
  const useTrendFilter = setting?.useTrendFilter ?? false;
  const accountLabels = buildAccountLabels(accountRows);
  const assetGroupNames = buildAssetGroupNames(assetGroupRows);
  const returnSummary = buildReturnMetricsSummary(
    eventRows,
    investmentAssetRows,
    usdKrwRate,
  );

  const allHoldingsWithoutWeights = investmentAssetRows.map((asset) =>
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

  const allHoldings = investmentAssetRows.map((asset) =>
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
    selectedAccount,
    baselineDate: latestSnapshotDate,
    usdKrwRate,
  });
  const previousCloseFallback = buildPreviousCloseMovement({
    holdings: holdingsBase,
    priceRows: recentPriceRows,
    referenceDate: latestSnapshotDate,
    usdKrwRate,
  });
  const movement = dailyPositionMovement.ready
    ? dailyPositionMovement
    : previousCloseFallback.ready
      ? previousCloseFallback
      : dailyPositionMovement;
  const fallbackContributions = previousCloseFallback.contributions;
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
    },
  };
}

function getLatestPositionSnapshotDate(selectedAccount: DashboardAccount) {
  if (selectedAccount === "all") {
    return db
      .select({ snapshotDate: dailyPositionSnapshots.snapshotDate })
      .from(dailyPositionSnapshots)
      .orderBy(desc(dailyPositionSnapshots.snapshotDate))
      .limit(1);
  }

  return db
    .select({ snapshotDate: dailyPositionSnapshots.snapshotDate })
    .from(dailyPositionSnapshots)
    .where(eq(dailyPositionSnapshots.account, selectedAccount))
    .orderBy(desc(dailyPositionSnapshots.snapshotDate))
    .limit(1);
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
  const valueKrw = convertToKrw(localValue, asset.currency, usdKrwRate) + fractionalKrwValue;
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
  contribution: HoldingDailyContribution | undefined,
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

function buildDailyPositionMovement({
  holdings,
  positionRows,
  selectedAccount,
  baselineDate,
  usdKrwRate,
}: {
  holdings: DashboardHolding[];
  positionRows: PositionSnapshotRow[];
  selectedAccount: DashboardAccount;
  baselineDate: string | null;
  usdKrwRate: number;
}): MovementResult {
  const emptyCoverage = {
    currentCoveragePct: null,
    snapshotCoveragePct: null,
    countCoveragePct: null,
    previousCloseCoveragePct: null,
  };

  if (!baselineDate) {
    return emptyMovement("missing_baseline_snapshot", emptyCoverage);
  }

  const accountRows = positionRows.filter(
    (row) =>
      (selectedAccount === "all" || row.account === selectedAccount) &&
      isInvestmentSnapshot(row),
  );
  const snapshotTotalValue = sumBy(accountRows, snapshotMarketValue);
  const previousTotalValue = sumBy(accountRows, snapshotPreviousMarketValue);
  const currentTotalValue = snapshotTotalValue;

  if (accountRows.length === 0 || snapshotTotalValue <= 0 || currentTotalValue <= 0) {
    return emptyMovement("missing_baseline_snapshot", emptyCoverage);
  }

  const contributions = new Map<string, HoldingDailyContribution>();
  const matchedSnapshotIds = new Set<string>();
  let matchedCurrentValue = 0;
  let matchedSnapshotValue = 0;
  let matchedCount = 0;
  const tradeFlowKrw = 0;
  let fxChangeKrw = 0;

  for (const holding of holdings) {
    const snapshot = findPositionSnapshotForHolding(holding, accountRows);
    if (!snapshot) continue;

    const previousValueKrw = snapshotMarketValue(snapshot);
    if (previousValueKrw <= 0) continue;
    const storedPreviousValueKrw = snapshotPreviousMarketValue(snapshot);
    const changeKrw = snapshotMarketValueChange(snapshot);
    const holdingFxChangeKrw =
      toNumber(snapshot.fxChangeKrw) ??
      calculateSnapshotFxChange(snapshot, holding, usdKrwRate);

    contributions.set(holding.id, {
      holdingId: holding.id,
      previousValueKrw: storedPreviousValueKrw,
      changeKrw,
      returnPct: snapshotMarketValueChangePct(
        snapshot,
        changeKrw,
        storedPreviousValueKrw,
      ),
      tradeFlowKrw: 0,
      fxChangeKrw: holdingFxChangeKrw,
      source: "daily_position_snapshot",
    });
    matchedSnapshotIds.add(snapshot.id);
    matchedCurrentValue += previousValueKrw;
    matchedSnapshotValue += previousValueKrw;
    matchedCount += 1;
    fxChangeKrw += holdingFxChangeKrw;
  }

  const currentCoverage = currentTotalValue > 0 ? matchedCurrentValue / currentTotalValue : 0;
  const snapshotCoverage =
    snapshotTotalValue > 0 ? matchedSnapshotValue / snapshotTotalValue : 0;
  const countCoverage = holdings.length > 0 ? matchedCount / holdings.length : 0;
  const matchedSnapshotCountCoverage =
    accountRows.length > 0 ? matchedSnapshotIds.size / accountRows.length : 0;
  const coverage = {
    currentCoveragePct: currentCoverage * 100,
    snapshotCoveragePct: snapshotCoverage * 100,
    countCoveragePct: Math.min(countCoverage, matchedSnapshotCountCoverage) * 100,
    previousCloseCoveragePct: null,
  };
  const hasEnoughCoverage =
    currentCoverage >= DAILY_MOVEMENT_MIN_VALUE_COVERAGE &&
    snapshotCoverage >= DAILY_MOVEMENT_MIN_VALUE_COVERAGE &&
    countCoverage >= DAILY_MOVEMENT_MIN_COUNT_COVERAGE &&
    matchedSnapshotCountCoverage >= DAILY_MOVEMENT_MIN_COUNT_COVERAGE;

  if (!hasEnoughCoverage) {
    return emptyMovement("incomplete_baseline_snapshot", coverage);
  }

  let changeKrw = sumBy([...contributions.values()], (row) => row.changeKrw);
  for (const row of accountRows) {
    if (matchedSnapshotIds.has(row.id)) continue;
    const previousValueKrw = snapshotPreviousMarketValue(row);
    if (previousValueKrw <= 0) continue;
    changeKrw += snapshotMarketValueChange(row);
  }

  return {
    ready: true,
    source: "daily_position_snapshot",
    reason: null,
    previousTotalKrw: previousTotalValue,
    changeKrw,
    returnPct: percentOrNull(changeKrw, previousTotalValue),
    tradeFlowKrw,
    fxChangeKrw,
    contributions,
    coverage,
  };
}

function buildPreviousCloseMovement({
  holdings,
  priceRows,
  referenceDate,
  usdKrwRate,
}: {
  holdings: DashboardHolding[];
  priceRows: AssetPriceSnapshotRow[];
  referenceDate: string | null;
  usdKrwRate: number;
}): MovementResult {
  const contributions = new Map<string, HoldingDailyContribution>();
  const currentTotalValue = sumBy(holdings, (holding) => holding.valueKrw);
  let matchedCurrentValue = 0;
  let matchedCount = 0;
  let previousTotalKrw = 0;
  let changeKrw = 0;
  let fxChangeKrw = 0;

  for (const holding of holdings) {
    const previous = calculatePreviousCloseContribution(
      holding,
      priceRows,
      referenceDate,
      usdKrwRate,
    );
    if (!previous) continue;

    contributions.set(holding.id, previous);
    matchedCurrentValue += holding.valueKrw;
    matchedCount += 1;
    previousTotalKrw += previous.previousValueKrw;
    changeKrw += previous.changeKrw;
    fxChangeKrw += previous.fxChangeKrw;
  }

  const valueCoverage =
    currentTotalValue > 0 ? matchedCurrentValue / currentTotalValue : 0;
  const countCoverage = holdings.length > 0 ? matchedCount / holdings.length : 0;
  const coverage = {
    currentCoveragePct: null,
    snapshotCoveragePct: null,
    countCoveragePct: countCoverage * 100,
    previousCloseCoveragePct: valueCoverage * 100,
  };
  const ready =
    previousTotalKrw > 0 &&
    valueCoverage >= DAILY_MOVEMENT_MIN_VALUE_COVERAGE &&
    countCoverage >= DAILY_MOVEMENT_MIN_COUNT_COVERAGE;

  if (!ready) {
    return {
      ready: false,
      source: null,
      reason: "missing_previous_close_fallback",
      previousTotalKrw,
      changeKrw: null,
      returnPct: null,
      tradeFlowKrw: 0,
      fxChangeKrw: null,
      contributions,
      coverage,
    };
  }

  return {
    ready: true,
    source: "asset_price_snapshot",
    reason: null,
    previousTotalKrw,
    changeKrw,
    returnPct: percentOrNull(changeKrw, previousTotalKrw),
    tradeFlowKrw: 0,
    fxChangeKrw,
    contributions,
    coverage,
  };
}

function calculatePreviousCloseContribution(
  holding: DashboardHolding,
  priceRows: AssetPriceSnapshotRow[],
  referenceDate: string | null,
  usdKrwRate: number,
) {
  const ticker = normalizeTicker(holding.ticker);
  if (!ticker || !referenceDate) return null;

  const previousRow = findPreviousClosePriceRow(priceRows, ticker, referenceDate);
  if (!previousRow) return null;

  const closePrice =
    toNumber(previousRow.adjustedClosePrice) ?? toNumber(previousRow.closePrice);
  if (closePrice === null || closePrice <= 0) return null;

  const previousFxRate =
    holding.currency === "USD"
      ? toNumber(previousRow.fxRate) ??
        inferFxRateFromClose(previousRow) ??
        usdKrwRate
      : 1;
  const currentFxRate = holding.currency === "USD" ? usdKrwRate : 1;
  const currentBaseValueKrw =
    holding.quantity * holding.currentPrice * currentFxRate;
  const fractionalKrwValue = Math.max(holding.valueKrw - currentBaseValueKrw, 0);
  const previousValueKrw =
    holding.quantity * closePrice * previousFxRate + fractionalKrwValue;
  const changeKrw = holding.valueKrw - previousValueKrw;
  const previousUsdNotional =
    holding.currency === "USD" ? holding.quantity * closePrice : 0;
  const fxChangeKrw =
    holding.currency === "USD"
      ? previousUsdNotional * (currentFxRate - previousFxRate)
      : 0;

  return {
    holdingId: holding.id,
    previousValueKrw,
    changeKrw,
    returnPct: percentOrNull(changeKrw, previousValueKrw),
    tradeFlowKrw: 0,
    fxChangeKrw,
    source: "asset_price_snapshot" as const,
  };
}

function findPreviousClosePriceRow(
  rows: AssetPriceSnapshotRow[],
  ticker: string,
  referenceDate: string,
) {
  return rows
    .filter((row) => normalizeTicker(row.ticker) === ticker)
    .filter((row) => row.priceDate < referenceDate)
    .filter((row) => {
      const ageDays = diffDays(referenceDate, row.priceDate);
      return ageDays >= 1 && ageDays <= PREVIOUS_CLOSE_MAX_AGE_DAYS;
    })
    .sort((a, b) => b.priceDate.localeCompare(a.priceDate))[0];
}

function emptyMovement(reason: string, coverage: MovementCoverage): MovementResult {
  return {
    ready: false,
    source: null,
    reason,
    previousTotalKrw: 0,
    changeKrw: null,
    returnPct: null,
    tradeFlowKrw: 0,
    fxChangeKrw: null,
    contributions: new Map(),
    coverage,
  };
}

function findPositionSnapshotForHolding(
  holding: DashboardHolding,
  rows: PositionSnapshotRow[],
) {
  const holdingTicker = normalizeTicker(holding.ticker);

  return rows.find((row) => {
    if (row.account !== holding.account) return false;
    if (row.assetId && row.assetId === holding.id) return true;
    if (row.legacyAssetId && row.legacyAssetId === holding.legacyBase44Id) {
      return true;
    }
    if (holdingTicker && normalizeTicker(row.ticker) === holdingTicker) return true;
    return row.assetName === holding.name;
  });
}

function calculateSnapshotFxChange(
  snapshot: PositionSnapshotRow,
  holding: DashboardHolding,
  usdKrwRate: number,
) {
  if (holding.currency !== "USD") return 0;

  const previousFxRate = toNumber(snapshot.fxRate) ?? toNumber(snapshot.previousFxRate);
  if (previousFxRate === null || previousFxRate <= 0) return 0;

  const previousUsdNotional =
    toNumber(snapshot.marketValueLocal) ??
    snapshotMarketValue(snapshot) / previousFxRate;
  return previousUsdNotional * (usdKrwRate - previousFxRate);
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
        convertToKrw(toNumber(asset.currentPrice) ?? 0, asset.currency, usdKrwRate) +
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

function snapshotMarketValue(row: PositionSnapshotRow) {
  return toNumber(row.marketValueKrw) ?? 0;
}

function snapshotPreviousMarketValue(row: PositionSnapshotRow) {
  return toNumber(row.previousMarketValueKrw) ?? snapshotMarketValue(row);
}

function snapshotMarketValueChange(row: PositionSnapshotRow) {
  const storedChange = toNumber(row.marketValueChangeKrw);
  if (storedChange !== null) return storedChange;
  return snapshotMarketValue(row) - snapshotPreviousMarketValue(row);
}

function snapshotMarketValueChangePct(
  row: PositionSnapshotRow,
  changeKrw: number,
  previousValueKrw: number,
) {
  return (
    toNumber(row.marketValueChangePct) ??
    percentOrNull(changeKrw, previousValueKrw)
  );
}

function isInvestmentSnapshot(row: PositionSnapshotRow) {
  if (!row.assetType) return true;
  return INVESTMENT_ASSET_TYPES.has(row.assetType);
}

function inferFxRateFromClose(row: AssetPriceSnapshotRow) {
  const closePriceKrw = toNumber(row.closePriceKrw);
  const closePrice = toNumber(row.closePrice);
  if (closePriceKrw === null || closePrice === null || closePrice <= 0) return null;
  return closePriceKrw / closePrice;
}

function deltaOrNull(left: number | null, right: number | null) {
  if (left === null || right === null) return null;
  return left - right;
}
