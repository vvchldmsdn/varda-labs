export type DashboardFxTrendPoint = Readonly<{
  date: string;
  rate: number;
  ma60: number | null;
  ma120: number | null;
}>;

const DEFAULT_MAX_POINTS = 180;

export function buildDashboardFxTrend(
  rows: readonly Readonly<{ rateDate: unknown; usdKrw: unknown }>[],
  maxPoints = DEFAULT_MAX_POINTS,
): DashboardFxTrendPoint[] {
  if (!Number.isInteger(maxPoints) || maxPoints <= 0) return [];

  const observationsByDate = new Map<string, number>();
  for (const row of rows) {
    const date = normalizeDate(row.rateDate);
    const rate = positiveNumber(row.usdKrw);
    if (!date || rate === null || observationsByDate.has(date)) continue;
    observationsByDate.set(date, rate);
  }

  const observations = [...observationsByDate]
    .map(([date, rate]) => ({ date, rate }))
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-maxPoints);

  let sum60 = 0;
  let sum120 = 0;

  return observations.map((observation, index) => {
    sum60 += observation.rate;
    sum120 += observation.rate;
    if (index >= 60) sum60 -= observations[index - 60].rate;
    if (index >= 120) sum120 -= observations[index - 120].rate;

    return Object.freeze({
      ...observation,
      ma60: index >= 59 ? sum60 / 60 : null,
      ma120: index >= 119 ? sum120 / 120 : null,
    });
  });
}

function positiveNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeDate(value: unknown) {
  const date = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}
