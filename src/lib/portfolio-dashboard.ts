import "server-only";

import { desc, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  accounts,
  assetGroups,
  assets,
  dailyPortfolioSnapshots,
  dailyPositionSnapshots,
  eventLedgerEntries,
  fxRates,
  settings,
} from "@/db/schema";

const INVESTMENT_ASSET_TYPES = new Set(["etf", "stock", "pension", "commodity"]);
const ASSET_ACCOUNT_CODES = ["brokerage", "isa", "irp"] as const;
const DEFAULT_TRIM_DRIFT_THRESHOLD = 12;

export type AssetAccount = (typeof ASSET_ACCOUNT_CODES)[number];
export type DashboardAccount = "all" | AssetAccount;

type AssetRow = typeof assets.$inferSelect;
type AssetGroupRow = typeof assetGroups.$inferSelect;
type PositionSnapshotRow = typeof dailyPositionSnapshots.$inferSelect;
type PortfolioSnapshotRow = typeof dailyPortfolioSnapshots.$inferSelect;
type EventLedgerRow = typeof eventLedgerEntries.$inferSelect;

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
  unrealizedPnlKrw: number;
  holdingReturnPct: number | null;
  currentWeight: number;
  targetWeight: number;
  effectiveTargetWeight: number;
  driftPct: number;
  needsTrim: boolean;
  dailyChangeKrw: number | null;
  dailyReturnPct: number | null;
  groupName: string | null;
};

export type AccountSummary = {
  code: AssetAccount;
  label: string;
  totalValueKrw: number;
  costBasisKrw: number;
  unrealizedPnlKrw: number;
  holdingReturnPct: number | null;
  holdingCount: number;
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
  unrealizedPnlKrw: number;
  realizedPnlKrw: number;
  totalPnlKrw: number;
  holdingReturnPct: number | null;
  totalReturnPct: number | null;
  todayChangeKrw: number | null;
  todayReturnPct: number | null;
  tradeFlowKrw: number;
  trimDriftThreshold: number;
  useTrendFilter: boolean;
  accountSummaries: AccountSummary[];
  holdings: DashboardHolding[];
  recentSnapshots: RecentPortfolioPoint[];
  topMovers: DashboardHolding[];
  dataHealth: {
    importedAssetCount: number;
    investmentAssetCount: number;
    assetCount: number;
    latestSnapshotPositions: number;
    unmatchedSnapshotRows: number;
    unmatchedSnapshotRowsAllTime: number;
    movementReady: boolean;
    movementReason: string | null;
  };
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

  const activeAssetRows = assetRows.filter((asset) =>
    INVESTMENT_ASSET_TYPES.has(asset.assetType ?? "etf"),
  );
  const setting = settingsRows[0] ?? null;
  const usdKrwRate =
    toNumber(latestFxRows[0]?.usdKrw) ?? toNumber(setting?.usdKrwRate) ?? 0;
  const trimDriftThreshold =
    toNumber(setting?.trimDriftThreshold) ?? DEFAULT_TRIM_DRIFT_THRESHOLD;
  const useTrendFilter = setting?.useTrendFilter ?? false;
  const accountLabels = buildAccountLabels(accountRows);
  const assetGroupNames = buildAssetGroupNames(assetGroupRows);
  const snapshotsByLegacyAsset = buildSnapshotMap(latestPositionRows);
  const allHoldings = activeAssetRows.map((asset) =>
    buildHolding({
      asset,
      accountTotalValueKrw: 0,
      groupName: asset.groupId ? assetGroupNames.get(asset.groupId) : null,
      snapshot: asset.legacyBase44Id
        ? snapshotsByLegacyAsset.get(asset.legacyBase44Id)
        : undefined,
      usdKrwRate,
      trimDriftThreshold,
      useTrendFilter,
    }),
  );
  const accountTotals = new Map<DashboardAccount, number>();

  for (const code of ASSET_ACCOUNT_CODES) {
    accountTotals.set(
      code,
      allHoldings
        .filter((holding) => holding.account === code)
        .reduce((sum, holding) => sum + holding.valueKrw, 0),
    );
  }
  accountTotals.set(
    "all",
    allHoldings.reduce((sum, holding) => sum + holding.valueKrw, 0),
  );

  const selectedAssetRows = activeAssetRows.filter(
    (asset) => selectedAccount === "all" || asset.account === selectedAccount,
  );
  const holdings = selectedAssetRows
    .map((asset) =>
      buildHolding({
        asset,
        accountTotalValueKrw: accountTotals.get(selectedAccount) ?? 0,
        groupName: asset.groupId ? assetGroupNames.get(asset.groupId) : null,
        snapshot: asset.legacyBase44Id
          ? snapshotsByLegacyAsset.get(asset.legacyBase44Id)
          : undefined,
        usdKrwRate,
        trimDriftThreshold,
        useTrendFilter,
      }),
    )
    .sort((a, b) => b.valueKrw - a.valueKrw);

  const totalValueKrw = sumBy(holdings, (holding) => holding.valueKrw);
  const costBasisKrw = sumBy(holdings, (holding) => holding.costBasisKrw);
  const unrealizedPnlKrw = sumBy(holdings, (holding) => holding.unrealizedPnlKrw);
  const selectedLegacyAssetIds = new Set(
    holdings
      .map((holding) => holding.legacyBase44Id)
      .filter((id): id is string => Boolean(id)),
  );
  const realizedPnlKrw = calculateRealizedPnl(
    eventRows,
    selectedAccount,
    selectedLegacyAssetIds,
  );
  const totalPnlKrw = unrealizedPnlKrw + realizedPnlKrw;
  const holdingReturnPct = percentOrNull(unrealizedPnlKrw, costBasisKrw);
  const totalReturnPct = percentOrNull(totalPnlKrw, costBasisKrw);
  const latestAccountPositions = latestPositionRows.filter(
    (position) => selectedAccount === "all" || position.account === selectedAccount,
  );
  const prevTotal = sumBy(latestAccountPositions, (position) =>
    toNumber(position.marketValueKrw),
  );
  const tradeFlowKrw = latestSnapshotDate
    ? calculateTradeFlow(
        eventRows,
        selectedAccount,
        latestSnapshotDate,
        selectedLegacyAssetIds,
      )
    : 0;
  const todayChangeKrw =
    prevTotal > 0 ? totalValueKrw - prevTotal - tradeFlowKrw : null;
  const todayReturnPct =
    todayChangeKrw !== null && prevTotal > 0
      ? (todayChangeKrw / prevTotal) * 100
      : null;
  const unmatchedSnapshotRows = latestAccountPositions.filter(
    (position) => position.assetId === null,
  ).length;

  return {
    selectedAccount,
    generatedAt: new Date().toISOString(),
    usdKrwRate,
    latestSnapshotDate,
    totalValueKrw,
    costBasisKrw,
    unrealizedPnlKrw,
    realizedPnlKrw,
    totalPnlKrw,
    holdingReturnPct,
    totalReturnPct,
    todayChangeKrw,
    todayReturnPct,
    tradeFlowKrw,
    trimDriftThreshold,
    useTrendFilter,
    accountSummaries: buildAccountSummaries(
      ASSET_ACCOUNT_CODES,
      allHoldings,
      accountLabels,
    ),
    holdings,
    recentSnapshots: buildRecentSnapshots(recentPortfolioRows),
    topMovers: [...holdings]
      .filter((holding) => holding.dailyChangeKrw !== null)
      .sort(
        (a, b) => Math.abs(b.dailyChangeKrw ?? 0) - Math.abs(a.dailyChangeKrw ?? 0),
      )
      .slice(0, 5),
    dataHealth: {
      importedAssetCount: assetRows.length,
      investmentAssetCount: activeAssetRows.length,
      assetCount: holdings.length,
      latestSnapshotPositions: latestAccountPositions.length,
      unmatchedSnapshotRows,
      unmatchedSnapshotRowsAllTime: Number(unmatchedSnapshotCountRows[0]?.count ?? 0),
      movementReady: prevTotal > 0 && latestAccountPositions.length > 0,
      movementReason:
        prevTotal > 0 && latestAccountPositions.length > 0
          ? null
          : "missing_baseline_snapshot",
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
  snapshot,
  usdKrwRate,
  trimDriftThreshold,
  useTrendFilter,
}: {
  asset: AssetRow;
  accountTotalValueKrw: number;
  groupName: string | null | undefined;
  snapshot: PositionSnapshotRow | undefined;
  usdKrwRate: number;
  trimDriftThreshold: number;
  useTrendFilter: boolean;
}): DashboardHolding {
  const quantity = toNumber(asset.quantity) ?? 0;
  const currentPrice = toNumber(asset.currentPrice) ?? 0;
  const averageCost = toNumber(asset.averageCost) ?? currentPrice;
  const targetWeight = toNumber(asset.targetWeight) ?? 0;
  const ma120 = toNumber(asset.ma120);
  const localValue = quantity * currentPrice;
  const localCostBasis = quantity * averageCost;
  const valueKrw =
    convertToKrw(localValue, asset.currency, usdKrwRate) +
    (toNumber(asset.fractionalKrwValue) ?? 0);
  const costBasisKrw =
    convertToKrw(localCostBasis, asset.currency, usdKrwRate) +
    (toNumber(asset.fractionalAvgCost) ?? 0);
  const unrealizedPnlKrw = valueKrw - costBasisKrw;
  const currentWeight =
    accountTotalValueKrw > 0 ? (valueKrw / accountTotalValueKrw) * 100 : 0;
  const belowMa =
    useTrendFilter && ma120 !== null && ma120 > 0 && currentPrice <= ma120;
  const effectiveTargetWeight = belowMa ? targetWeight / 2 : targetWeight;
  const driftPct =
    effectiveTargetWeight > 0
      ? (currentWeight / effectiveTargetWeight - 1) * 100
      : 0;
  const previousValue = toNumber(snapshot?.marketValueKrw);
  const dailyChangeKrw =
    previousValue !== null ? valueKrw - previousValue : null;
  const dailyReturnPct =
    dailyChangeKrw !== null && previousValue !== null && previousValue > 0
      ? (dailyChangeKrw / previousValue) * 100
      : null;

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
    unrealizedPnlKrw,
    holdingReturnPct: percentOrNull(unrealizedPnlKrw, costBasisKrw),
    currentWeight,
    targetWeight,
    effectiveTargetWeight,
    driftPct,
    needsTrim: driftPct > trimDriftThreshold,
    dailyChangeKrw,
    dailyReturnPct,
    groupName: snapshot?.groupName ?? groupName ?? null,
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
    const unrealizedPnlKrw = sumBy(
      accountHoldings,
      (holding) => holding.unrealizedPnlKrw,
    );
    return {
      code,
      label: accountLabels.get(code) ?? code,
      totalValueKrw,
      costBasisKrw,
      unrealizedPnlKrw,
      holdingReturnPct: percentOrNull(unrealizedPnlKrw, costBasisKrw),
      holdingCount: accountHoldings.length,
    };
  });
}

function buildSnapshotMap(rows: PositionSnapshotRow[]) {
  const map = new Map<string, PositionSnapshotRow>();
  for (const row of rows) {
    if (row.legacyAssetId) {
      map.set(row.legacyAssetId, row);
    }
  }
  return map;
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

function calculateRealizedPnl(
  events: EventLedgerRow[],
  selectedAccount: DashboardAccount,
  selectedLegacyAssetIds: Set<string>,
) {
  return events
    .filter((event) => event.eventType === "sell")
    .filter((event) => eventMatchesAccount(event, selectedAccount, selectedLegacyAssetIds))
    .reduce((sum, event) => sum + parseRealizedPnl(event.memo), 0);
}

function calculateTradeFlow(
  events: EventLedgerRow[],
  selectedAccount: DashboardAccount,
  baselineDate: string,
  selectedLegacyAssetIds: Set<string>,
) {
  return events
    .filter((event) => event.eventDate > baselineDate)
    .filter((event) =>
      eventMatchesAccount(event, selectedAccount, selectedLegacyAssetIds),
    )
    .reduce((sum, event) => {
      const amount = toNumber(event.amountKrw) ?? 0;
      if (event.eventType === "buy") return sum + amount;
      if (event.eventType === "sell") return sum - amount;
      return sum;
    }, 0);
}

function eventMatchesAccount(
  event: EventLedgerRow,
  selectedAccount: DashboardAccount,
  selectedLegacyAssetIds: Set<string>,
) {
  if (selectedAccount === "all") return true;
  if (event.account) return event.account === selectedAccount;
  if (selectedAccount === "brokerage") return true;
  return selectedLegacyAssetIds.has(event.legacyAssetId);
}

function parseRealizedPnl(memo: string | null) {
  if (!memo) return 0;
  const match = memo.match(/realized_pnl_krw=([-+]?\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

function convertToKrw(value: number, currency: string, usdKrwRate: number) {
  return currency === "USD" ? value * usdKrwRate : value;
}

function percentOrNull(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

function sumBy<T>(rows: T[], selector: (row: T) => number | null) {
  return rows.reduce((sum, row) => sum + (selector(row) ?? 0), 0);
}

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
