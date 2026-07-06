export type InternalCycle = {
  snapshotDate: string;
  capturedAt: Date;
  cycleStartAt: Date;
  cycleEndAt: Date;
};

type MarketAsset = {
  market: string;
  currency: string;
};

export function resolveSnapshotCycle(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const date = kst.toISOString().slice(0, 10);
  const hour = kst.getUTCHours();
  return {
    snapshotDate: hour >= 7 ? date : shiftDate(date, -1),
  };
}

export function buildCycleForSnapshotDate(
  snapshotDate: string,
  now: Date,
): InternalCycle {
  const [year, month, day] = snapshotDate.split("-").map(Number);
  const cycleEndAt = new Date(Date.UTC(year, month - 1, day - 1, 22, 0, 0));
  const cycleStartAt = new Date(cycleEndAt.getTime() - 24 * 60 * 60 * 1000);

  return {
    snapshotDate,
    capturedAt: now,
    cycleStartAt,
    cycleEndAt,
  };
}

export function closeMarketKeyForAsset(asset: MarketAsset) {
  if (isUsdListedAsset(asset)) return "us";
  return asset.market || "unknown";
}

export function closeCalendarReferenceDateForAsset(
  asset: MarketAsset,
  snapshotDate: string,
) {
  const candidate = shiftDate(snapshotDate, -1);
  if (isUsdListedAsset(asset)) return previousUsTradingDayOnOrBefore(candidate);
  if (asset.market === "korea") return previousKoreaTradingDayOnOrBefore(candidate);
  return previousWeekdayOnOrBefore(candidate);
}

export function isUsdListedAsset(asset: MarketAsset) {
  return asset.market === "us" || asset.currency === "USD";
}

function previousWeekdayOnOrBefore(date: string) {
  let current = date;
  while (isWeekend(current)) current = shiftDate(current, -1);
  return current;
}

function previousKoreaTradingDayOnOrBefore(date: string) {
  let current = date;
  while (!isKoreaTradingDay(current)) current = shiftDate(current, -1);
  return current;
}

function previousUsTradingDayOnOrBefore(date: string) {
  let current = date;
  while (!isUsTradingDay(current)) current = shiftDate(current, -1);
  return current;
}

function isKoreaTradingDay(date: string) {
  return (
    Boolean(date) &&
    !isWeekend(date) &&
    !koreaMarketHolidays(Number(date.slice(0, 4))).has(date)
  );
}

function isUsTradingDay(date: string) {
  return (
    Boolean(date) &&
    !isWeekend(date) &&
    !usMarketHolidays(Number(date.slice(0, 4))).has(date)
  );
}

function koreaMarketHolidays(year: number) {
  const holidays = new Set([
    observedFixedHoliday(year, 1, 1),
    observedFixedHoliday(year, 3, 1),
    `${year}-05-01`,
    observedFixedHoliday(year, 5, 5),
    `${year}-06-06`,
    observedFixedHoliday(year, 8, 15),
    observedFixedHoliday(year, 10, 3),
    `${year}-10-09`,
    observedFixedHoliday(year, 12, 25),
    koreaYearEndMarketHoliday(year),
    ...(KOREA_LUNAR_AND_ELECTION_MARKET_HOLIDAYS_BY_YEAR[year] ?? []),
  ]);

  return holidays;
}

// Lunar and election holidays cannot be derived from Gregorian fixed-date rules.
// Review this list before enabling Cron beyond the covered migration window.
const KOREA_LUNAR_AND_ELECTION_MARKET_HOLIDAYS_BY_YEAR: Record<
  number,
  string[]
> = {
  2024: ["2024-09-16", "2024-09-17", "2024-09-18"],
  2025: [
    "2025-01-28",
    "2025-01-29",
    "2025-01-30",
    "2025-05-05",
    "2025-05-06",
    "2025-10-06",
    "2025-10-07",
    "2025-10-08",
  ],
  2026: [
    "2026-02-16",
    "2026-02-17",
    "2026-02-18",
    "2026-05-25",
    "2026-06-03",
    "2026-09-24",
    "2026-09-25",
    "2026-09-28",
  ],
};

function koreaYearEndMarketHoliday(year: number) {
  return previousWeekdayOnOrBefore(`${year}-12-31`);
}

function usMarketHolidays(year: number) {
  return new Set([
    observedFixedHoliday(year, 1, 1),
    nthWeekdayOfMonth(year, 1, 1, 3),
    nthWeekdayOfMonth(year, 2, 1, 3),
    shiftDate(easterSunday(year), -2),
    lastWeekdayOfMonth(year, 5, 1),
    observedFixedHoliday(year, 6, 19),
    observedFixedHoliday(year, 7, 4),
    nthWeekdayOfMonth(year, 9, 1, 1),
    nthWeekdayOfMonth(year, 11, 4, 4),
    observedFixedHoliday(year, 12, 25),
  ]);
}

function observedFixedHoliday(year: number, month: number, day: number) {
  const actual = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const weekday = weekdayUtc(actual);
  if (weekday === 6) return shiftDate(actual, -1);
  if (weekday === 0) return shiftDate(actual, 1);
  return actual;
}

function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  nth: number,
) {
  let current = `${year}-${String(month).padStart(2, "0")}-01`;
  while (weekdayUtc(current) !== weekday) current = shiftDate(current, 1);
  return shiftDate(current, (nth - 1) * 7);
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let current = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  while (weekdayUtc(current) !== weekday) current = shiftDate(current, -1);
  return current;
}

function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function shiftDate(date: string, deltaDays: number) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + deltaDays);
  return value.toISOString().slice(0, 10);
}

function weekdayUtc(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function isWeekend(date: string) {
  const weekday = weekdayUtc(date);
  return weekday === 0 || weekday === 6;
}
