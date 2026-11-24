// Holding-history projection from the original frontend, using the shared Beta valuation dates.
import { percentOrNull, toNumber } from "../portfolio-math.ts";
import type { HoldingPriceReturn } from "./heatmap-contract.ts";
import { betaHistoryValuationDate as portfolioDashboardHistoryDisplayDate } from "./history-date.ts";
export { portfolioDashboardHistoryDisplayDate };

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
  cycleEndAt?: Date | string | null;
  capturedAt: Date | string | null;
  createdAt: Date | string | null;
}>;

export type PortfolioDashboardHistoryHolding = Readonly<{
  id: string;
  name: string;
  market?: string | null;
  ticker: string | null;
  account: string;
  currentWeight: number;
  valueKrw?: number;
  dailyChangeKrw?: number | null;
  dailyReturnPct?: number | null;
  dailyPriceReturn?: HoldingPriceReturn;
  priceDailyChangeKrw?: number | null;
  fxDailyChangeKrw?: number | null;
}>;

export type PortfolioDashboardHeatmapCell = Readonly<{
  date: string;
  changePct: number | null;
  marketValueKrw: number | null;
  changeKrw: number | null;
  priceChangeKrw: number | null;
  fxChangeKrw: number | null;
  basis: "live_price" | "live_movement" | "unit_value" | "market_value" | "missing";
  priceReturnEvidence?: HoldingPriceReturn;
}>;

export type PortfolioDashboardHeatmapRow = Readonly<{
  holdingId: string;
  name: string;
  market?: string | null;
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

export function buildPortfolioDashboardHoldingHistory({
  currentDate,
  holdings,
  maxDates = 31,
  maxRows,
  rows,
}: {
  currentDate?: string;
  holdings: readonly PortfolioDashboardHistoryHolding[];
  maxDates?: number;
  maxRows?: number;
  rows: readonly PortfolioDashboardPositionHistoryRow[];
}): PortfolioDashboardHoldingHistory {
  const selectedHoldings = maxRows === undefined
    ? [...holdings]
    : holdings.slice(0, Math.max(0, maxRows));
  const selectedHoldingIds = new Set(selectedHoldings.map((holding) => holding.id));
  const preferred = preferredPositionRows(rows, selectedHoldingIds, portfolioDashboardHistoryDisplayDate);
  const observedDates = [...new Set([
    ...[...preferred.values()].map(portfolioDashboardHistoryDisplayDate),
    ...(isIsoDate(currentDate) ? [currentDate] : []),
  ])]
    .sort((left, right) => left.localeCompare(right));
  const dates = continuousDateWindow(observedDates, maxDates);

  let observedCellCount = 0;
  const heatmapRows = selectedHoldings.map((holding) => ({
    holdingId: holding.id,
    name: holding.name,
    market: holding.market,
    ticker: holding.ticker,
    account: holding.account,
    currentWeight: holding.currentWeight,
    cells: dates.map((date) => {
      if (date === currentDate) {
        const liveCell = currentMovementCell(date, holding);
        if (liveCell.basis !== "missing") observedCellCount += 1;
        return liveCell;
      }

      const row = preferred.get(positionRowKey(date, holding.id));
      const unitValueChangePct = toNumber(row?.unitValueChangePct);
      const marketValueChangePct = toNumber(row?.marketValueChangePct);
      const changePct = unitValueChangePct ?? marketValueChangePct;
      if (changePct !== null) observedCellCount += 1;

      return Object.freeze({
        date,
        changePct,
        marketValueKrw: toNumber(row?.marketValueKrw),
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

function currentMovementCell(
  date: string,
  holding: PortfolioDashboardHistoryHolding,
): PortfolioDashboardHeatmapCell {
  // Reuse Today's valuation return. The trading-currency price return is
  // independent evidence for the detail view, never a fallback for this metric.
  const changePct = toNumber(holding.dailyReturnPct);
  const changeKrw = toNumber(holding.dailyChangeKrw);
  const marketValueKrw = toNumber(holding.valueKrw);

  if (changePct === null) {
    return Object.freeze({
      date,
      changePct: null,
      marketValueKrw,
      changeKrw,
      priceChangeKrw: toNumber(holding.priceDailyChangeKrw),
      fxChangeKrw: toNumber(holding.fxDailyChangeKrw),
      basis: "missing" as const,
      ...(holding.dailyPriceReturn ? { priceReturnEvidence: holding.dailyPriceReturn } : {}),
    });
  }

  return Object.freeze({
    date,
    changePct,
    marketValueKrw,
    changeKrw,
    priceChangeKrw: toNumber(holding.priceDailyChangeKrw),
    fxChangeKrw: toNumber(holding.fxDailyChangeKrw),
    basis: "live_movement" as const,
    priceReturnEvidence: holding.dailyPriceReturn,
  });
}

function continuousDateWindow(observedDates: readonly string[], maxDates: number) {
  const latest = observedDates.at(-1);
  const earliest = observedDates[0];
  const boundedCount = Math.max(0, Math.floor(maxDates));
  if (!latest || !earliest || boundedCount === 0) return [];

  const candidateStart = shiftIsoDate(latest, -(boundedCount - 1));
  const start = candidateStart.localeCompare(earliest) > 0 ? candidateStart : earliest;
  const dates: string[] = [];
  for (let date = start; date.localeCompare(latest) <= 0; date = shiftIsoDate(date, 1)) {
    dates.push(date);
  }
  return dates;
}

function shiftIsoDate(value: string, dayDelta: number) {
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return new Date(timestamp + dayDelta * 86_400_000).toISOString().slice(0, 10);
}

function isIsoDate(value: string | undefined): value is string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "");
}

function preferredPositionRows(
  rows: readonly PortfolioDashboardPositionHistoryRow[],
  selectedHoldingIds: ReadonlySet<string>,
  displayDate: (row: PortfolioDashboardPositionHistoryRow) => string = (row) => row.snapshotDate,
) {
  const preferred = new Map<string, PortfolioDashboardPositionHistoryRow>();

  for (const row of rows) {
    if (!row.assetId || !selectedHoldingIds.has(row.assetId)) continue;
    const key = positionRowKey(displayDate(row), row.assetId);
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
