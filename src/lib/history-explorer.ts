import type { HistoryOverviewPoint } from "./history-overview.ts";

export type HistoryExplorerMode = "value" | "return";
export type HistoryExplorerRange = "30D" | "90D" | "1Y" | "ALL";

const RANGE_DAYS: Readonly<Record<Exclude<HistoryExplorerRange, "ALL">, number>> =
  Object.freeze({
    "30D": 30,
    "90D": 90,
    "1Y": 365,
  });

export type HistoryRangeSummary = Readonly<{
  startDate: string | null;
  endDate: string | null;
  startValueKrw: number | null;
  endValueKrw: number | null;
  changeKrw: number | null;
  changePct: number | null;
  peakValueKrw: number | null;
  peakDate: string | null;
  maxDrawdownPct: number | null;
  maxDrawdownDate: string | null;
  pointCount: number;
}>;

export function selectHistoryRange(
  points: readonly HistoryOverviewPoint[],
  range: HistoryExplorerRange,
) {
  if (range === "ALL" || points.length === 0) return points;

  const latest = Date.parse(`${points.at(-1)!.date}T00:00:00Z`);
  const cutoff = latest - RANGE_DAYS[range] * 86_400_000;
  return points.filter(
    (point) => Date.parse(`${point.date}T00:00:00Z`) >= cutoff,
  );
}

export function historyPointMetric(
  point: HistoryOverviewPoint,
  mode: HistoryExplorerMode,
) {
  return mode === "value" ? point.valueKrw : point.totalReturnPct;
}

export function historyPointsWithMetric(
  points: readonly HistoryOverviewPoint[],
  mode: HistoryExplorerMode,
) {
  return points.filter((point) => {
    const value = historyPointMetric(point, mode);
    return value !== null && Number.isFinite(value);
  });
}

export function summarizeHistoryRange(
  points: readonly HistoryOverviewPoint[],
): HistoryRangeSummary {
  if (points.length === 0) {
    return Object.freeze({
      startDate: null,
      endDate: null,
      startValueKrw: null,
      endValueKrw: null,
      changeKrw: null,
      changePct: null,
      peakValueKrw: null,
      peakDate: null,
      maxDrawdownPct: null,
      maxDrawdownDate: null,
      pointCount: 0,
    });
  }

  const first = points[0]!;
  const last = points.at(-1)!;
  let runningPeak = Number.NEGATIVE_INFINITY;
  let peak = first;
  let maxDrawdownPct = 0;
  let maxDrawdownDate = first.date;

  for (const point of points) {
    if (point.valueKrw > runningPeak) {
      runningPeak = point.valueKrw;
      peak = point;
    }
    const drawdownPct =
      runningPeak === 0 ? 0 : ((point.valueKrw - runningPeak) / runningPeak) * 100;
    if (drawdownPct < maxDrawdownPct) {
      maxDrawdownPct = drawdownPct;
      maxDrawdownDate = point.date;
    }
  }

  const changeKrw = last.valueKrw - first.valueKrw;
  return Object.freeze({
    startDate: first.date,
    endDate: last.date,
    startValueKrw: first.valueKrw,
    endValueKrw: last.valueKrw,
    changeKrw,
    changePct:
      first.valueKrw === 0 ? null : (changeKrw / first.valueKrw) * 100,
    peakValueKrw: peak.valueKrw,
    peakDate: peak.date,
    maxDrawdownPct,
    maxDrawdownDate,
    pointCount: points.length,
  });
}
