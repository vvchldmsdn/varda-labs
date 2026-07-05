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
  topMovers: DashboardHolding[];
  dataHealth: {
    importedAssetCount: number;
    investmentAssetCount: number;
    nonInvestmentAssetCount: number;
    assetCount: number;
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
  };
};

type ParsedObject = Record<string, unknown>;

type AssetMaps = {
  byId: Map<string, AssetRow>;
  byLegacyId: Map<string, AssetRow>;
  byTickerAccount: Map<string, AssetRow>;
  byNameAccount: Map<string, AssetRow>;
};

type AssetReturnMetrics = {
  assetKey: string;
  account: string;
  costBasisKrw: number;
  realizedCostBasisKrw: number;
  realizedPnlKrw: number;
  missingCost: boolean;
};

type RealizedReturnRow = {
  assetKey: string | null;
  account: string | null;
  realizedPnlKrw: number;
  realizedCostBasisKrw: number;
  missingCost: boolean;
};

type ReturnMetricsSummary = {
  metricsByAssetKey: Map<string, AssetReturnMetrics>;
  realizedRows: RealizedReturnRow[];
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
    eventRows,
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

function buildReturnMetricsSummary(
  events: EventLedgerRow[],
  assetRows: AssetRow[],
  usdKrwRate: number,
): ReturnMetricsSummary {
  const assetMaps = buildAssetMaps(assetRows);
  const metricsByAssetKey = new Map<string, AssetReturnMetrics>();
  const realizedRows: RealizedReturnRow[] = [];
  const runningLedger = new Map<string, { quantity: number; costKrw: number }>();

  for (const asset of assetRows) {
    const key = assetMetricKey(asset);
    metricsByAssetKey.set(key, {
      assetKey: key,
      account: asset.account,
      costBasisKrw: fallbackCostBasisKrw(asset, usdKrwRate),
      realizedCostBasisKrw: 0,
      realizedPnlKrw: 0,
      missingCost: false,
    });
  }

  const tradeEvents = events
    .filter((event) => event.eventType === "buy" || event.eventType === "sell")
    .sort(compareEventsAscending);

  for (const event of tradeEvents) {
    const asset = resolveEventAsset(event, assetMaps);
    const assetKey = asset ? assetMetricKey(asset) : null;
    const ledgerKey = assetKey ?? event.legacyAssetId;
    const account = portfolioEventAccount(event) ?? asset?.account ?? null;
    const quantity = eventTradeQuantity(event);
    const amountKrw = historyTradeAmountKrw(event, asset, usdKrwRate);

    if (event.eventType === "buy") {
      if (!ledgerKey || amountKrw <= 0) continue;
      const row = runningLedger.get(ledgerKey) ?? { quantity: 0, costKrw: 0 };
      row.quantity += quantity;
      row.costKrw += amountKrw;
      runningLedger.set(ledgerKey, row);
      continue;
    }

    if (event.eventType !== "sell") continue;

    const explicitMetrics = readExplicitTradeMetrics(event);
    const ledgerRow = ledgerKey ? runningLedger.get(ledgerKey) : undefined;
    const disposedCostKrw =
      explicitMetrics.disposedCostKrw ??
      estimateDisposedCostFromLedger(ledgerRow, quantity) ??
      estimateDisposedCostFromEvent(event, asset, quantity, usdKrwRate);
    const fallbackRealizedPnlKrw =
      disposedCostKrw !== null && amountKrw > 0
        ? amountKrw - disposedCostKrw
        : parseRealizedPnl(event.memo);
    const realizedPnlKrw =
      explicitMetrics.realizedPnlKrw ?? fallbackRealizedPnlKrw;
    const realizedCostBasisKrw = disposedCostKrw ?? 0;
    const missingCost = disposedCostKrw === null;

    if (ledgerRow && disposedCostKrw !== null) {
      ledgerRow.quantity = Math.max(ledgerRow.quantity - quantity, 0);
      ledgerRow.costKrw = Math.max(ledgerRow.costKrw - disposedCostKrw, 0);
    }

    if (assetKey) {
      const metrics = metricsByAssetKey.get(assetKey);
      if (metrics) {
        metrics.realizedPnlKrw += realizedPnlKrw;
        metrics.realizedCostBasisKrw += realizedCostBasisKrw;
        metrics.missingCost = metrics.missingCost || missingCost;
      }
    }

    realizedRows.push({
      assetKey,
      account,
      realizedPnlKrw,
      realizedCostBasisKrw,
      missingCost,
    });
  }

  return { metricsByAssetKey, realizedRows };
}

function getAssetReturnMetrics(
  summary: ReturnMetricsSummary,
  asset: AssetRow,
  usdKrwRate: number,
) {
  const key = assetMetricKey(asset);
  return (
    summary.metricsByAssetKey.get(key) ?? {
      assetKey: key,
      account: asset.account,
      costBasisKrw: fallbackCostBasisKrw(asset, usdKrwRate),
      realizedCostBasisKrw: 0,
      realizedPnlKrw: 0,
      missingCost: false,
    }
  );
}

function getSelectedRealizedRows(
  summary: ReturnMetricsSummary,
  selectedAccount: DashboardAccount,
  selectedAssetKeys: Set<string>,
) {
  if (selectedAccount === "all") return summary.realizedRows;

  return summary.realizedRows.filter((row) => {
    if (row.account) return row.account === selectedAccount;
    if (row.assetKey) return selectedAssetKeys.has(row.assetKey);
    return selectedAccount === "brokerage";
  });
}

function readExplicitTradeMetrics(event: EventLedgerRow) {
  const before = parseJsonObject(event.beforeValue);
  const after = parseJsonObject(event.afterValue);
  const metricObjects = [
    pickNestedObject(after, "trade_metrics"),
    pickNestedObject(after, "tradeMetrics"),
    pickNestedObject(after, "realized_metrics"),
    pickNestedObject(before, "trade_metrics"),
    pickNestedObject(before, "tradeMetrics"),
  ].filter((value): value is ParsedObject => Boolean(value));
  const metricObject = metricObjects[0] ?? null;

  if (!metricObject) {
    return {
      realizedPnlKrw: null,
      disposedCostKrw: null,
    };
  }

  return {
    realizedPnlKrw: readNumberField(metricObject, [
      "realized_pnl_krw",
      "realizedPnlKrw",
      "realized_pnl",
      "realizedPnl",
    ]),
    disposedCostKrw: readNumberField(metricObject, [
      "disposed_cost_krw",
      "disposedCostKrw",
      "cost_basis_krw",
      "costBasisKrw",
      "realized_cost_krw",
      "realizedCostKrw",
    ]),
  };
}

function historyTradeAmountKrw(
  event: EventLedgerRow,
  asset: AssetRow | null,
  usdKrwRate: number,
) {
  const amount = toNumber(event.amountKrw);
  if (amount !== null && amount !== 0) return Math.abs(amount);

  const quantity = eventTradeQuantity(event);
  const price = toNumber(event.price) ?? 0;
  const fxRate =
    toNumber(event.fxRate) ?? (asset?.currency === "USD" ? usdKrwRate : 1);
  return Math.abs(quantity * price * fxRate);
}

function eventTradeQuantity(event: EventLedgerRow) {
  const quantityDelta = toNumber(event.quantityDelta);
  if (quantityDelta !== null && quantityDelta !== 0) return Math.abs(quantityDelta);

  const before = parseJsonObject(event.beforeValue);
  const after = parseJsonObject(event.afterValue);
  const beforeQuantity = readNumberField(before, ["quantity"]);
  const afterQuantity = readNumberField(after, ["quantity"]);
  if (beforeQuantity !== null && afterQuantity !== null) {
    return Math.abs(beforeQuantity - afterQuantity);
  }
  return 0;
}

function estimateDisposedCostFromLedger(
  ledgerRow: { quantity: number; costKrw: number } | undefined,
  quantity: number,
) {
  if (!ledgerRow || quantity <= 0 || ledgerRow.quantity <= 0 || ledgerRow.costKrw <= 0) {
    return null;
  }
  const ratio = Math.min(quantity / ledgerRow.quantity, 1);
  return ledgerRow.costKrw * ratio;
}

function estimateDisposedCostFromEvent(
  event: EventLedgerRow,
  asset: AssetRow | null,
  quantity: number,
  usdKrwRate: number,
) {
  if (quantity <= 0) return null;

  const before = parseJsonObject(event.beforeValue);
  const averageCost =
    readNumberField(before, ["average_cost", "averageCost", "avg_cost"]) ??
    toNumber(asset?.averageCost);
  if (averageCost === null || averageCost <= 0) return null;

  const fxRate =
    toNumber(event.fxRate) ?? (asset?.currency === "USD" ? usdKrwRate : 1);
  return quantity * averageCost * fxRate;
}

function fallbackCostBasisKrw(asset: AssetRow, usdKrwRate: number) {
  const quantity = toNumber(asset.quantity) ?? 0;
  const averageCost =
    toNumber(asset.averageCost) ?? toNumber(asset.currentPrice) ?? 0;
  const localCostBasis = quantity * averageCost;
  return (
    convertToKrw(localCostBasis, asset.currency, usdKrwRate) +
    (toNumber(asset.fractionalAvgCost) ?? 0)
  );
}

function buildDailyPositionMovement({
  holdings,
  positionRows,
  eventRows,
  selectedAccount,
  baselineDate,
  usdKrwRate,
}: {
  holdings: DashboardHolding[];
  positionRows: PositionSnapshotRow[];
  eventRows: EventLedgerRow[];
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
  const currentTotalValue = sumBy(holdings, (holding) => holding.valueKrw);

  if (accountRows.length === 0 || snapshotTotalValue <= 0 || currentTotalValue <= 0) {
    return emptyMovement("missing_baseline_snapshot", emptyCoverage);
  }

  const contributions = new Map<string, HoldingDailyContribution>();
  const matchedSnapshotIds = new Set<string>();
  let matchedCurrentValue = 0;
  let matchedSnapshotValue = 0;
  let matchedCount = 0;
  let tradeFlowKrw = 0;
  let fxChangeKrw = 0;

  for (const holding of holdings) {
    const snapshot = findPositionSnapshotForHolding(holding, accountRows);
    if (!snapshot) continue;

    const previousValueKrw = snapshotMarketValue(snapshot);
    if (previousValueKrw <= 0) continue;

    const holdingTradeFlowKrw = calculateTradeFlowForHolding(
      eventRows,
      holding,
      selectedAccount,
      baselineDate,
    );
    const holdingFxChangeKrw = calculateSnapshotFxChange(
      snapshot,
      holding,
      usdKrwRate,
    );
    const changeKrw = holding.valueKrw - previousValueKrw - holdingTradeFlowKrw;

    contributions.set(holding.id, {
      holdingId: holding.id,
      previousValueKrw,
      changeKrw,
      returnPct: percentOrNull(changeKrw, previousValueKrw),
      tradeFlowKrw: holdingTradeFlowKrw,
      fxChangeKrw: holdingFxChangeKrw,
      source: "daily_position_snapshot",
    });
    matchedSnapshotIds.add(snapshot.id);
    matchedCurrentValue += holding.valueKrw;
    matchedSnapshotValue += previousValueKrw;
    matchedCount += 1;
    tradeFlowKrw += holdingTradeFlowKrw;
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
    const previousValueKrw = snapshotMarketValue(row);
    if (previousValueKrw <= 0) continue;
    const removedTradeFlowKrw = calculateTradeFlowForSnapshot(
      eventRows,
      row,
      selectedAccount,
      baselineDate,
    );
    changeKrw += -previousValueKrw - removedTradeFlowKrw;
    tradeFlowKrw += removedTradeFlowKrw;
  }

  return {
    ready: true,
    source: "daily_position_snapshot",
    reason: null,
    previousTotalKrw: snapshotTotalValue,
    changeKrw,
    returnPct: percentOrNull(changeKrw, snapshotTotalValue),
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

function calculateTradeFlowForHolding(
  events: EventLedgerRow[],
  holding: DashboardHolding,
  selectedAccount: DashboardAccount,
  baselineDate: string,
) {
  return events
    .filter((event) => event.eventDate > baselineDate)
    .filter((event) => event.eventType === "buy" || event.eventType === "sell")
    .filter((event) => eventMatchesHolding(event, holding, selectedAccount))
    .reduce((sum, event) => {
      const amount = toNumber(event.amountKrw) ?? 0;
      if (event.eventType === "buy") return sum + Math.abs(amount);
      if (event.eventType === "sell") return sum - Math.abs(amount);
      return sum;
    }, 0);
}

function calculateTradeFlowForSnapshot(
  events: EventLedgerRow[],
  snapshot: PositionSnapshotRow,
  selectedAccount: DashboardAccount,
  baselineDate: string,
) {
  return events
    .filter((event) => event.eventDate > baselineDate)
    .filter((event) => event.eventType === "buy" || event.eventType === "sell")
    .filter((event) => eventMatchesSnapshot(event, snapshot, selectedAccount))
    .reduce((sum, event) => {
      const amount = toNumber(event.amountKrw) ?? 0;
      if (event.eventType === "buy") return sum + Math.abs(amount);
      if (event.eventType === "sell") return sum - Math.abs(amount);
      return sum;
    }, 0);
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

function buildAssetMaps(assetRows: AssetRow[]): AssetMaps {
  const maps: AssetMaps = {
    byId: new Map(),
    byLegacyId: new Map(),
    byTickerAccount: new Map(),
    byNameAccount: new Map(),
  };

  for (const asset of assetRows) {
    maps.byId.set(asset.id, asset);
    if (asset.legacyBase44Id) maps.byLegacyId.set(asset.legacyBase44Id, asset);
    const ticker = normalizeTicker(asset.ticker);
    if (ticker) maps.byTickerAccount.set(accountKey(asset.account, ticker), asset);
    maps.byNameAccount.set(accountKey(asset.account, asset.name), asset);
  }

  return maps;
}

function resolveEventAsset(event: EventLedgerRow, maps: AssetMaps) {
  if (event.assetId && maps.byId.has(event.assetId)) {
    return maps.byId.get(event.assetId) ?? null;
  }
  if (event.legacyAssetId && maps.byLegacyId.has(event.legacyAssetId)) {
    return maps.byLegacyId.get(event.legacyAssetId) ?? null;
  }

  const eventAccount = portfolioEventAccount(event);
  const accountsToTry = eventAccount ? [eventAccount] : ASSET_ACCOUNT_CODES;
  const ticker = normalizeTicker(event.ticker);
  for (const account of accountsToTry) {
    if (ticker) {
      const asset = maps.byTickerAccount.get(accountKey(account, ticker));
      if (asset) return asset;
    }
    if (event.assetName) {
      const asset = maps.byNameAccount.get(accountKey(account, event.assetName));
      if (asset) return asset;
    }
  }

  return null;
}

function eventMatchesHolding(
  event: EventLedgerRow,
  holding: DashboardHolding,
  selectedAccount: DashboardAccount,
) {
  if (!eventMatchesSelectedAccount(event, selectedAccount, holding.account)) {
    return false;
  }
  if (event.assetId && event.assetId === holding.id) return true;
  if (event.legacyAssetId && event.legacyAssetId === holding.legacyBase44Id) {
    return true;
  }
  const eventTicker = normalizeTicker(event.ticker);
  const holdingTicker = normalizeTicker(holding.ticker);
  if (eventTicker && holdingTicker && eventTicker === holdingTicker) return true;
  return event.assetName === holding.name;
}

function eventMatchesSnapshot(
  event: EventLedgerRow,
  snapshot: PositionSnapshotRow,
  selectedAccount: DashboardAccount,
) {
  if (!eventMatchesSelectedAccount(event, selectedAccount, snapshot.account)) {
    return false;
  }
  if (event.assetId && snapshot.assetId && event.assetId === snapshot.assetId) {
    return true;
  }
  if (event.legacyAssetId && event.legacyAssetId === snapshot.legacyAssetId) {
    return true;
  }
  const eventTicker = normalizeTicker(event.ticker);
  const snapshotTicker = normalizeTicker(snapshot.ticker);
  if (eventTicker && snapshotTicker && eventTicker === snapshotTicker) return true;
  return event.assetName === snapshot.assetName;
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

function portfolioEventAccount(event: EventLedgerRow) {
  if (event.account) return event.account;
  const before = parseJsonObject(event.beforeValue);
  const after = parseJsonObject(event.afterValue);
  const fromAfter = readStringField(after, ["account"]);
  if (fromAfter) return fromAfter;
  return readStringField(before, ["account"]);
}

function assetMetricKey(asset: AssetRow) {
  return asset.legacyBase44Id ?? asset.id;
}

function accountKey(account: string, value: string) {
  return `${account}:${value}`;
}

function snapshotMarketValue(row: PositionSnapshotRow) {
  return toNumber(row.marketValueKrw) ?? 0;
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

function compareEventsAscending(a: EventLedgerRow, b: EventLedgerRow) {
  const dateCompare = a.eventDate.localeCompare(b.eventDate);
  if (dateCompare !== 0) return dateCompare;
  return timestampMs(a.recordedAt ?? a.createdAt) - timestampMs(b.recordedAt ?? b.createdAt);
}

function parseRealizedPnl(memo: string | null) {
  if (!memo) return 0;
  const match = memo.match(/realized_pnl_krw=([-+]?\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : 0;
}

function parseJsonObject(value: unknown): ParsedObject | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as ParsedObject;
  }
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ParsedObject;
    }
  } catch {
    return null;
  }
  return null;
}

function pickNestedObject(
  source: ParsedObject | null,
  key: string,
): ParsedObject | null {
  if (!source) return null;
  const value = source[key];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as ParsedObject;
  }
  return null;
}

function readNumberField(source: ParsedObject | null, keys: string[]) {
  if (!source) return null;
  for (const key of keys) {
    const value = toNumber(source[key]);
    if (value !== null) return value;
  }
  return null;
}

function readStringField(source: ParsedObject | null, keys: string[]) {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normalizeTicker(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase();
  return normalized || null;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function convertToKrw(value: number, currency: string, usdKrwRate: number) {
  return currency === "USD" ? value * usdKrwRate : value;
}

function percentOrNull(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

function diffDays(laterDate: string, earlierDate: string) {
  const later = Date.parse(`${laterDate}T00:00:00Z`);
  const earlier = Date.parse(`${earlierDate}T00:00:00Z`);
  if (!Number.isFinite(later) || !Number.isFinite(earlier)) return 0;
  return Math.round((later - earlier) / 86_400_000);
}

function timestampMs(value: Date | string | null | undefined) {
  if (!value) return 0;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sumBy<T>(rows: T[], selector: (row: T) => number | null) {
  return rows.reduce((sum, row) => sum + (selector(row) ?? 0), 0);
}

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
