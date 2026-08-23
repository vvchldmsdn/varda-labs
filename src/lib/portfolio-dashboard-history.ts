import { percentOrNull, sumBy, toNumber } from "./portfolio-math.ts";

export type PortfolioDashboardPositionHistoryRow = Readonly<{
  snapshotDate: string;
  assetId: string | null;
  ticker: string | null;
  assetName: string | null;
  account: string | null;
  unitValueChangePct: unknown;
  marketValueChangePct: unknown;
  marketValueChangeKrw: unknown;
  priceChangeKrw: unknown;
  fxChangeKrw: unknown;
  marketValueKrw: unknown;
  costKrw: unknown;
  pnlKrw: unknown;
  source: string | null;
  capturedAt: Date | string | null;
  createdAt: Date | string | null;
}>;

export type PortfolioDashboardHistoryHolding = Readonly<{
  id: string;
  name: string;
  ticker: string | null;
  account: string;
  currentWeight: number;
}>;

export type PortfolioDashboardHeatmapCell = Readonly<{
  date: string;
  changePct: number | null;
  changeKrw: number | null;
  priceChangeKrw: number | null;
  fxChangeKrw: number | null;
  basis: "unit_value" | "market_value" | "missing";
}>;

export type PortfolioDashboardHeatmapRow = Readonly<{
  holdingId: string;
  name: string;
  ticker: string | null;
  account: string;
  currentWeight: number;
  cells: readonly PortfolioDashboardHeatmapCell[];
}>;

export type PortfolioDashboardHoldingHistory = Readonly<{
  dates: readonly string[];
  rows: readonly PortfolioDashboardHeatmapRow[];
  observedCellCount: number;
  expectedCellCount: number;
  coveragePct: number | null;
}>;

export type PortfolioDashboardPositionTrendPoint = Readonly<{
  date: string;
  totalMarketValue: number;
  totalPnl: number | null;
  totalReturnPct: number | null;
}>;

export function buildPortfolioDashboardHoldingHistory({
  holdings,
  maxDates = 18,
  maxRows = 7,
  rows,
}: {
  holdings: readonly PortfolioDashboardHistoryHolding[];
  maxDates?: number;
  maxRows?: number;
  rows: readonly PortfolioDashboardPositionHistoryRow[];
}): PortfolioDashboardHoldingHistory {
  const selectedHoldings = holdings.slice(0, Math.max(0, maxRows));
  const selectedHoldingIds = new Set(selectedHoldings.map((holding) => holding.id));
  const preferred = preferredPositionRows(rows, selectedHoldingIds);
  const dates = [...new Set([...preferred.values()].map((row) => row.snapshotDate))]
    .sort((left, right) => left.localeCompare(right))
    .slice(-Math.max(0, maxDates));

  let observedCellCount = 0;
  const heatmapRows = selectedHoldings.map((holding) => ({
    holdingId: holding.id,
    name: holding.name,
    ticker: holding.ticker,
    account: holding.account,
    currentWeight: holding.currentWeight,
    cells: dates.map((date) => {
      const row = preferred.get(positionRowKey(date, holding.id));
      const unitValueChangePct = toNumber(row?.unitValueChangePct);
      const marketValueChangePct = toNumber(row?.marketValueChangePct);
      const changePct = unitValueChangePct ?? marketValueChangePct;
      if (changePct !== null) observedCellCount += 1;

      return Object.freeze({
        date,
        changePct,
        changeKrw: toNumber(row?.marketValueChangeKrw),
        priceChangeKrw: toNumber(row?.priceChangeKrw),
        fxChangeKrw: toNumber(row?.fxChangeKrw),
        basis:
          unitValueChangePct !== null
            ? ("unit_value" as const)
            : marketValueChangePct !== null
              ? ("market_value" as const)
              : ("missing" as const),
      });
    }),
  }));
  const expectedCellCount = heatmapRows.length * dates.length;

  return Object.freeze({
    dates: Object.freeze(dates),
    rows: Object.freeze(
      heatmapRows.map((row) => Object.freeze({
        ...row,
        cells: Object.freeze(row.cells),
      })),
    ),
    observedCellCount,
    expectedCellCount,
    coveragePct: percentOrNull(observedCellCount, expectedCellCount),
  });
}

export function buildPortfolioDashboardPositionTrend({
  holdings,
  maxDates = 130,
  rows,
}: {
  holdings: readonly PortfolioDashboardHistoryHolding[];
  maxDates?: number;
  rows: readonly PortfolioDashboardPositionHistoryRow[];
}): PortfolioDashboardPositionTrendPoint[] {
  const holdingIds = new Set(holdings.map((holding) => holding.id));
  const preferred = preferredPositionRows(rows, holdingIds);
  const byDate = new Map<string, PortfolioDashboardPositionHistoryRow[]>();

  for (const row of preferred.values()) {
    const dateRows = byDate.get(row.snapshotDate) ?? [];
    dateRows.push(row);
    byDate.set(row.snapshotDate, dateRows);
  }

  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, dateRows]) => {
      const totalMarketValue = sumBy(
        dateRows,
        (row) => toNumber(row.marketValueKrw) ?? 0,
      );
      const pnlValues = dateRows
        .map((row) => toNumber(row.pnlKrw))
        .filter((value): value is number => value !== null);
      const costValues = dateRows
        .map((row) => toNumber(row.costKrw))
        .filter((value): value is number => value !== null);
      const totalPnl = pnlValues.length > 0 ? sumBy(pnlValues, (value) => value) : null;
      const totalCost = costValues.length > 0 ? sumBy(costValues, (value) => value) : null;

      return Object.freeze({
        date,
        totalMarketValue,
        totalPnl,
        totalReturnPct:
          totalPnl !== null && totalCost !== null
            ? percentOrNull(totalPnl, totalCost)
            : null,
      });
    })
    .slice(-Math.max(0, maxDates));
}

function preferredPositionRows(
  rows: readonly PortfolioDashboardPositionHistoryRow[],
  selectedHoldingIds: ReadonlySet<string>,
) {
  const preferred = new Map<string, PortfolioDashboardPositionHistoryRow>();

  for (const row of rows) {
    if (!row.assetId || !selectedHoldingIds.has(row.assetId)) continue;
    const key = positionRowKey(row.snapshotDate, row.assetId);
    const existing = preferred.get(key);
    if (!existing || compareEvidenceRecency(row, existing) > 0) {
      preferred.set(key, row);
    }
  }

  return preferred;
}

function positionRowKey(date: string, assetId: string) {
  return `${date}:${assetId}`;
}

function compareEvidenceRecency(
  left: PortfolioDashboardPositionHistoryRow,
  right: PortfolioDashboardPositionHistoryRow,
) {
  const capturedDelta = timestamp(left.capturedAt) - timestamp(right.capturedAt);
  if (capturedDelta !== 0) return capturedDelta;
  const createdDelta = timestamp(left.createdAt) - timestamp(right.createdAt);
  if (createdDelta !== 0) return createdDelta;
  return sourcePriority(left.source) - sourcePriority(right.source);
}

function timestamp(value: Date | string | null) {
  if (!value) return 0;
  const result = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(result) ? result : 0;
}

function sourcePriority(value: string | null) {
  if (value === "varda_manual_daily_snapshot") return 2;
  if (value === "base44_import") return 1;
  return 0;
}
