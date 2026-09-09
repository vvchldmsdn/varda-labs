export type ContributionFxObservation = Readonly<{
  rateDate: string;
  usdKrw: number | string | null;
  source: string | null;
  fetchedAt?: Date | string | null;
}>;

export type ContributionMarketContext = Readonly<{
  fx: Readonly<{
    status: "ready" | "stale" | "unavailable";
    rate: number | null;
    date: string | null;
    fetchedAt: string | null;
    source: string | null;
    observationCount: number;
    rangeLow: number | null;
    rangeHigh: number | null;
    rangePositionPct: number | null;
  }>;
}>;

const DAY_MS = 86_400_000;
const MAX_FX_AGE_DAYS = 3;
const RANGE_DAYS = 90;
const MIN_RANGE_OBSERVATIONS = 20;

/** Observed USD/KRW only. No forecasts, exposure inference or external calls. */
export function buildContributionMarketContext(
  rows: readonly ContributionFxObservation[],
  now: Date,
): ContributionMarketContext {
  const unavailable: ContributionMarketContext = { fx: {
    status: "unavailable", rate: null, date: null, fetchedAt: null, source: null,
    observationCount: 0, rangeLow: null, rangeHigh: null, rangePositionPct: null,
  } };
  if (!Number.isFinite(now.getTime())) return unavailable;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const usable = rows.flatMap((row) => {
    const rate = row.usdKrw === null || row.usdKrw === "" ? NaN : Number(row.usdKrw);
    const dateMs = Date.parse(`${row.rateDate}T00:00:00Z`);
    const fetchedMs = row.fetchedAt ? new Date(row.fetchedAt).getTime() : NaN;
    if (!Number.isFinite(rate) || rate <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(row.rateDate) ||
      !Number.isFinite(dateMs) || new Date(dateMs).toISOString().slice(0, 10) !== row.rateDate ||
      dateMs > todayMs || !Number.isFinite(fetchedMs) || fetchedMs > now.getTime() ||
      !row.source?.trim()) return [];
    return [{ rate, dateMs, fetchedMs, date: row.rateDate, source: row.source.trim() }];
  }).sort((a, b) => b.dateMs - a.dateMs || b.fetchedMs - a.fetchedMs);
  const latest = usable[0];
  if (!latest) return unavailable;
  const dates = new Set<string>();
  const observations = usable.filter((row) => {
    if (row.source !== latest.source || todayMs - row.dateMs >= RANGE_DAYS * DAY_MS || dates.has(row.date)) return false;
    dates.add(row.date);
    return true;
  });
  const hasRange = observations.length >= MIN_RANGE_OBSERVATIONS;
  const low = hasRange ? Math.min(...observations.map((row) => row.rate)) : null;
  const high = hasRange ? Math.max(...observations.map((row) => row.rate)) : null;
  return { fx: {
    status: todayMs - latest.dateMs > MAX_FX_AGE_DAYS * DAY_MS || now.getTime() - latest.fetchedMs > MAX_FX_AGE_DAYS * DAY_MS ? "stale" : "ready",
    rate: latest.rate, date: latest.date, fetchedAt: new Date(latest.fetchedMs).toISOString(), source: latest.source,
    observationCount: observations.length, rangeLow: low, rangeHigh: high,
    rangePositionPct: low !== null && high !== null && high > low ? (latest.rate - low) / (high - low) * 100 : null,
  } };
}

/** A mechanical translation scenario for USD-priced holdings, not total FX risk. */
export function compareContributionFxAssumption(
  rows: readonly Readonly<{ currency: string | null; currentValueKrw: number }>[],
  changeBps: number,
) {
  if (!Number.isInteger(changeBps) || Math.abs(changeBps) > 2_000 || rows.some((row) => !Number.isFinite(row.currentValueKrw) || row.currentValueKrw < 0)) return null;
  const total = rows.reduce((sum, row) => sum + row.currentValueKrw, 0);
  const usd = rows.filter((row) => row.currency?.trim().toUpperCase() === "USD").reduce((sum, row) => sum + row.currentValueKrw, 0);
  if (!Number.isFinite(total) || total > Number.MAX_SAFE_INTEGER) return null;
  const differenceKrw = Math.round(usd * changeBps / 10_000);
  return {
    currentValueKrw: total,
    usdListedValueKrw: usd,
    usdListedWeightPct: total > 0 ? usd / total * 100 : null,
    differenceKrw,
    scenarioValueKrw: total + differenceKrw,
  };
}
