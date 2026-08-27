import type { PortfolioHistoryDisplayRow } from "./history-balance.ts";

export const HISTORY_OVERVIEW_POLICY = Object.freeze({
  version: "stored_history_time_explorer_v1",
  dateAuthority: "stored_snapshot_date",
  rowAuthority:
    "stored_before_derived_before_partial_then_varda_before_base44",
  missingDates: "not_interpolated_or_carried",
  movementMeaning: "point_to_point_valuation_change_not_cashflow_adjusted_return",
  eventMeaning: "same_calendar_date_context_not_causal_attribution",
  riskMeaning: "stored_portfolio_snapshot_fields_only",
} as const);

export type HistoryOverviewEventInput = Readonly<{
  eventDate: string;
  eventType: string;
  assetName: string;
  accountName: string | null;
  amountKrw: number | null;
  quantityDelta: number | null;
}>;

export type HistoryOverviewEvent = HistoryOverviewEventInput;

export type HistoryOverviewRisk = Readonly<{
  avgCorrelation: number | null;
  enb: number | null;
  portfolioVolatility: number | null;
  regimeLabel: string | null;
  regimeScore: number | null;
}>;

export type HistoryOverviewPoint = Readonly<{
  date: string;
  valueKrw: number;
  cashValueKrw: number | null;
  investedAmountKrw: number | null;
  totalPnlKrw: number | null;
  totalReturnPct: number | null;
  movementKrw: number | null;
  movementPct: number | null;
  gapDays: number | null;
  drawdownKrw: number;
  drawdownPct: number;
  source: string;
  rowKind: PortfolioHistoryDisplayRow["rowKind"];
  risk: HistoryOverviewRisk | null;
  events: readonly HistoryOverviewEvent[];
}>;

export type HistoryOverviewModel = Readonly<{
  status: "ready" | "no_data";
  policy: typeof HISTORY_OVERVIEW_POLICY;
  points: readonly HistoryOverviewPoint[];
  pointCount: number;
  sourceCount: number;
  eventCount: number;
  riskPointCount: number;
  excludedAlternativeRowCount: number;
  excludedInvalidRowCount: number;
  ambiguousDateCount: number;
  startDate: string | null;
  endDate: string | null;
  startValueKrw: number | null;
  latestValueKrw: number | null;
  valuationChangeKrw: number | null;
  valuationChangePct: number | null;
  peakValueKrw: number | null;
  peakDate: string | null;
  lowestValueKrw: number | null;
  lowestDate: string | null;
  maxDrawdownKrw: number | null;
  maxDrawdownPct: number | null;
  maxDrawdownDate: string | null;
  bestMovement: HistoryMovementSummary | null;
  worstMovement: HistoryMovementSummary | null;
  longestGainStreak: number;
  longestLossStreak: number;
}>;

export type HistoryMovementSummary = Readonly<{
  date: string;
  amountKrw: number;
  percent: number | null;
  gapDays: number;
}>;

export function buildHistoryOverview({
  rows,
  events = [],
}: {
  rows: readonly PortfolioHistoryDisplayRow[];
  events?: readonly HistoryOverviewEventInput[];
}): HistoryOverviewModel {
  const selection = selectCanonicalRows(rows);
  const eventsByDate = groupEventsByDate(events);
  let runningPeak = Number.NEGATIVE_INFINITY;
  const points: HistoryOverviewPoint[] = [];

  for (const row of selection.rows) {
    const previous = points.at(-1) ?? null;
    const valueKrw = row.totalMarketValue!;
    runningPeak = Math.max(runningPeak, valueKrw);
    const movementKrw = previous ? valueKrw - previous.valueKrw : null;
    const gapDays = previous ? dateDifference(previous.date, row.snapshotDate) : null;
    const drawdownKrw = valueKrw - runningPeak;

    points.push(
      Object.freeze({
        date: row.snapshotDate,
        valueKrw,
        cashValueKrw: finiteOrNull(row.cashValue),
        investedAmountKrw: finiteOrNull(row.investedAmount),
        totalPnlKrw: finiteOrNull(row.totalPnl),
        totalReturnPct: finiteOrNull(row.totalReturnPct),
        movementKrw,
        movementPct:
          previous && previous.valueKrw !== 0
            ? (movementKrw! / previous.valueKrw) * 100
            : null,
        gapDays,
        drawdownKrw,
        drawdownPct:
          runningPeak !== 0 ? (drawdownKrw / runningPeak) * 100 : 0,
        source: row.source,
        rowKind: row.rowKind,
        risk: riskEvidence(row),
        events: Object.freeze([...(eventsByDate.get(row.snapshotDate) ?? [])]),
      }),
    );
  }

  if (points.length === 0) {
    return emptyModel(selection, events);
  }

  const first = points[0]!;
  const latest = points.at(-1)!;
  const peak = extremePoint(points, "max");
  const lowest = extremePoint(points, "min");
  const drawdown = points.reduce((worst, point) =>
    point.drawdownPct < worst.drawdownPct ? point : worst,
  );
  const movements = points.filter(
    (point): point is HistoryOverviewPoint & { movementKrw: number; gapDays: number } =>
      point.movementKrw !== null && point.gapDays !== null,
  );
  const best = movements.length
    ? movements.reduce((winner, point) =>
        point.movementKrw > winner.movementKrw ? point : winner,
      )
    : null;
  const worst = movements.length
    ? movements.reduce((loser, point) =>
        point.movementKrw < loser.movementKrw ? point : loser,
      )
    : null;
  const valuationChangeKrw = latest.valueKrw - first.valueKrw;

  return Object.freeze({
    status: "ready",
    policy: HISTORY_OVERVIEW_POLICY,
    points: Object.freeze(points),
    pointCount: points.length,
    sourceCount: new Set(points.map((point) => point.source)).size,
    eventCount: events.length,
    riskPointCount: points.filter((point) => point.risk !== null).length,
    excludedAlternativeRowCount: selection.excludedAlternativeRowCount,
    excludedInvalidRowCount: selection.excludedInvalidRowCount,
    ambiguousDateCount: selection.ambiguousDateCount,
    startDate: first.date,
    endDate: latest.date,
    startValueKrw: first.valueKrw,
    latestValueKrw: latest.valueKrw,
    valuationChangeKrw,
    valuationChangePct:
      first.valueKrw !== 0 ? (valuationChangeKrw / first.valueKrw) * 100 : null,
    peakValueKrw: peak.valueKrw,
    peakDate: peak.date,
    lowestValueKrw: lowest.valueKrw,
    lowestDate: lowest.date,
    maxDrawdownKrw: drawdown.drawdownKrw,
    maxDrawdownPct: drawdown.drawdownPct,
    maxDrawdownDate: drawdown.date,
    bestMovement: movementSummary(best),
    worstMovement: movementSummary(worst),
    longestGainStreak: longestStreak(points, 1),
    longestLossStreak: longestStreak(points, -1),
  });
}

type CanonicalSelection = Readonly<{
  rows: readonly PortfolioHistoryDisplayRow[];
  excludedAlternativeRowCount: number;
  excludedInvalidRowCount: number;
  ambiguousDateCount: number;
}>;

function selectCanonicalRows(
  rows: readonly PortfolioHistoryDisplayRow[],
): CanonicalSelection {
  const rowsByDate = new Map<string, PortfolioHistoryDisplayRow[]>();
  let excludedInvalidRowCount = 0;

  for (const row of rows) {
    if (!isIsoDate(row.snapshotDate) || finiteOrNull(row.totalMarketValue) === null) {
      excludedInvalidRowCount += 1;
      continue;
    }
    const sameDate = rowsByDate.get(row.snapshotDate) ?? [];
    sameDate.push(row);
    rowsByDate.set(row.snapshotDate, sameDate);
  }

  const selected: PortfolioHistoryDisplayRow[] = [];
  let excludedAlternativeRowCount = 0;
  let ambiguousDateCount = 0;

  for (const candidates of rowsByDate.values()) {
    const ordered = [...candidates].sort(compareAuthority);
    const preferred = ordered[0]!;
    const tied = ordered.filter(
      (candidate) => authorityIdentity(candidate) === authorityIdentity(preferred),
    );
    if (tied.length > 1 && !sameFinancialEvidence(tied)) {
      ambiguousDateCount += 1;
      excludedInvalidRowCount += candidates.length;
      continue;
    }
    selected.push(preferred);
    excludedAlternativeRowCount += candidates.length - 1;
  }

  selected.sort((left, right) => left.snapshotDate.localeCompare(right.snapshotDate));

  return Object.freeze({
    rows: Object.freeze(selected),
    excludedAlternativeRowCount,
    excludedInvalidRowCount,
    ambiguousDateCount,
  });
}

function compareAuthority(
  left: PortfolioHistoryDisplayRow,
  right: PortfolioHistoryDisplayRow,
) {
  return (
    rowKindRank(right.rowKind) - rowKindRank(left.rowKind) ||
    sourceRank(right.source) - sourceRank(left.source) ||
    left.source.localeCompare(right.source)
  );
}

function authorityIdentity(row: PortfolioHistoryDisplayRow) {
  return `${row.rowKind}|${sourceRank(row.source)}|${row.source}`;
}

function sameFinancialEvidence(rows: readonly PortfolioHistoryDisplayRow[]) {
  const first = rows[0]!;
  return rows.every(
    (row) =>
      row.totalMarketValue === first.totalMarketValue &&
      row.totalPnl === first.totalPnl &&
      row.totalReturnPct === first.totalReturnPct &&
      row.cashValue === first.cashValue,
  );
}

function rowKindRank(rowKind: PortfolioHistoryDisplayRow["rowKind"]) {
  if (rowKind === "stored") return 3;
  if (rowKind === "derived") return 2;
  return 1;
}

function sourceRank(source: string) {
  if (source === "varda_manual_daily_snapshot") return 3;
  if (source === "varda_daily_snapshot_v1") return 2;
  if (source === "base44_import") return 1;
  return 0;
}

function riskEvidence(
  row: PortfolioHistoryDisplayRow,
): HistoryOverviewRisk | null {
  const risk = {
    avgCorrelation: finiteOrNull(row.avgCorrelation),
    enb: finiteOrNull(row.enb),
    portfolioVolatility: finiteOrNull(row.portfolioVolatility),
    regimeLabel: row.regimeLabel?.trim() || null,
    regimeScore: finiteOrNull(row.regimeScore),
  };
  return Object.values(risk).every((value) => value === null)
    ? null
    : Object.freeze(risk);
}

function groupEventsByDate(events: readonly HistoryOverviewEventInput[]) {
  const grouped = new Map<string, HistoryOverviewEvent[]>();
  for (const event of events) {
    if (!isIsoDate(event.eventDate)) continue;
    const sameDate = grouped.get(event.eventDate) ?? [];
    sameDate.push(Object.freeze({ ...event }));
    grouped.set(event.eventDate, sameDate);
  }
  return grouped;
}

function movementSummary(
  point:
    | (HistoryOverviewPoint & { movementKrw: number; gapDays: number })
    | null,
): HistoryMovementSummary | null {
  if (!point) return null;
  return Object.freeze({
    date: point.date,
    amountKrw: point.movementKrw,
    percent: point.movementPct,
    gapDays: point.gapDays,
  });
}

function extremePoint(
  points: readonly HistoryOverviewPoint[],
  direction: "min" | "max",
) {
  return points.reduce((selected, point) => {
    if (direction === "max") {
      return point.valueKrw > selected.valueKrw ? point : selected;
    }
    return point.valueKrw < selected.valueKrw ? point : selected;
  });
}

function longestStreak(points: readonly HistoryOverviewPoint[], direction: 1 | -1) {
  let longest = 0;
  let current = 0;
  for (const point of points) {
    const movement = point.movementKrw;
    if (movement !== null && Math.sign(movement) === direction) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function dateDifference(left: string, right: string) {
  const milliseconds = Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`);
  return Math.round(milliseconds / 86_400_000);
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function finiteOrNull(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function emptyModel(
  selection: CanonicalSelection,
  events: readonly HistoryOverviewEventInput[],
): HistoryOverviewModel {
  return Object.freeze({
    status: "no_data",
    policy: HISTORY_OVERVIEW_POLICY,
    points: Object.freeze([]),
    pointCount: 0,
    sourceCount: 0,
    eventCount: events.length,
    riskPointCount: 0,
    excludedAlternativeRowCount: selection.excludedAlternativeRowCount,
    excludedInvalidRowCount: selection.excludedInvalidRowCount,
    ambiguousDateCount: selection.ambiguousDateCount,
    startDate: null,
    endDate: null,
    startValueKrw: null,
    latestValueKrw: null,
    valuationChangeKrw: null,
    valuationChangePct: null,
    peakValueKrw: null,
    peakDate: null,
    lowestValueKrw: null,
    lowestDate: null,
    maxDrawdownKrw: null,
    maxDrawdownPct: null,
    maxDrawdownDate: null,
    bestMovement: null,
    worstMovement: null,
    longestGainStreak: 0,
    longestLossStreak: 0,
  });
}
