"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../../visualizations/2026/10/02/01a0fe5d-fc42-7fd3-9a8f-d2a64aea9075/history-close-gap-repair-20261027/original/tests/cairn-close-gaps/worker.test.ts
var import_strict = __toESM(require("node:assert/strict"));

// ../../../visualizations/2026/10/02/01a0fe5d-fc42-7fd3-9a8f-d2a64aea9075/history-close-gap-repair-20261027/original/src/db/client.ts
var sqlClient = { query: async () => [...globalThis.gapTest.dates].map((date) => ({ date })) };

// ../../../visualizations/2026/10/02/01a0fe5d-fc42-7fd3-9a8f-d2a64aea9075/history-close-gap-repair-20261027/original/src/lib/market-data/kis-history-cache-sync.ts
async function runKisHistoryCacheSync({ prefetchedResult }) {
  for (const row of prefetchedResult.rows) {
    globalThis.gapTest.dates.add(row.priceDate);
    globalThis.gapTest.writes.push(row.priceDate);
  }
  return { insertedCount: prefetchedResult.rows.length };
}

// ../../../visualizations/2026/10/02/01a0fe5d-fc42-7fd3-9a8f-d2a64aea9075/history-close-gap-repair-20261027/original/src/lib/market-data/collection-queue.ts
var isMarketCollectionClaimCurrent = async () => globalThis.gapTest.claimed;

// ../../../visualizations/2026/10/02/01a0fe5d-fc42-7fd3-9a8f-d2a64aea9075/history-close-gap-repair-20261027/original/src/lib/snapshots/market-calendar.ts
function closeCalendarReferenceDateForAsset(asset, snapshotDate) {
  const candidate = shiftDate(snapshotDate, -1);
  if (isUsdListedAsset(asset)) return previousUsTradingDayOnOrBefore(candidate);
  if (asset.market === "korea") return previousKoreaTradingDayOnOrBefore(candidate);
  return previousWeekdayOnOrBefore(candidate);
}
function isUsdListedAsset(asset) {
  return asset.market === "us";
}
function previousWeekdayOnOrBefore(date) {
  let current = date;
  while (isWeekend(current)) current = shiftDate(current, -1);
  return current;
}
function previousKoreaTradingDayOnOrBefore(date) {
  let current = date;
  while (!isKoreaTradingDay(current)) current = shiftDate(current, -1);
  return current;
}
function previousUsTradingDayOnOrBefore(date) {
  let current = date;
  while (!isUsTradingDay(current)) current = shiftDate(current, -1);
  return current;
}
function isKoreaTradingDay(date) {
  return Boolean(date) && !isWeekend(date) && !koreaMarketHolidays(Number(date.slice(0, 4))).has(date);
}
function isUsTradingDay(date) {
  return Boolean(date) && !isWeekend(date) && !usMarketHolidays(Number(date.slice(0, 4))).has(date);
}
function koreaMarketHolidays(year) {
  const holidays = /* @__PURE__ */ new Set([
    ...koreaFixedHolidayDates(year, 1, 1),
    ...koreaFixedHolidayDates(year, 3, 1, true),
    `${year}-05-01`,
    ...koreaFixedHolidayDates(year, 5, 5, true),
    `${year}-06-06`,
    ...year >= 2026 ? koreaFixedHolidayDates(year, 7, 17, true) : [],
    ...koreaFixedHolidayDates(year, 8, 15, true),
    ...koreaFixedHolidayDates(year, 10, 3, true),
    ...koreaFixedHolidayDates(year, 10, 9, true),
    ...koreaFixedHolidayDates(year, 12, 25, true),
    koreaYearEndMarketHoliday(year),
    ...KOREA_LUNAR_AND_ELECTION_MARKET_HOLIDAYS_BY_YEAR[year] ?? []
  ]);
  return holidays;
}
function koreaFixedHolidayDates(year, month, day, hasWeekendSubstitute = false) {
  const actual = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!hasWeekendSubstitute || !isWeekend(actual)) return [actual];
  let substitute = shiftDate(actual, 1);
  while (isWeekend(substitute)) substitute = shiftDate(substitute, 1);
  return [actual, substitute];
}
var KOREA_LUNAR_AND_ELECTION_MARKET_HOLIDAYS_BY_YEAR = {
  2024: ["2024-09-16", "2024-09-17", "2024-09-18"],
  2025: [
    "2025-01-28",
    "2025-01-29",
    "2025-01-30",
    "2025-05-05",
    "2025-05-06",
    "2025-10-06",
    "2025-10-07",
    "2025-10-08"
  ],
  2026: [
    "2026-02-16",
    "2026-02-17",
    "2026-02-18",
    "2026-05-25",
    "2026-06-03",
    "2026-09-24",
    "2026-09-25",
    "2026-09-26"
  ]
};
function koreaYearEndMarketHoliday(year) {
  return previousWeekdayOnOrBefore(`${year}-12-31`);
}
function usMarketHolidays(year) {
  return /* @__PURE__ */ new Set([
    observedFixedHoliday(year, 1, 1),
    nthWeekdayOfMonth(year, 1, 1, 3),
    nthWeekdayOfMonth(year, 2, 1, 3),
    shiftDate(easterSunday(year), -2),
    lastWeekdayOfMonth(year, 5, 1),
    observedFixedHoliday(year, 6, 19),
    observedFixedHoliday(year, 7, 4),
    nthWeekdayOfMonth(year, 9, 1, 1),
    nthWeekdayOfMonth(year, 11, 4, 4),
    observedFixedHoliday(year, 12, 25)
  ]);
}
function observedFixedHoliday(year, month, day) {
  const actual = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const weekday = weekdayUtc(actual);
  if (weekday === 6) return shiftDate(actual, -1);
  if (weekday === 0) return shiftDate(actual, 1);
  return actual;
}
function nthWeekdayOfMonth(year, month, weekday, nth) {
  let current = `${year}-${String(month).padStart(2, "0")}-01`;
  while (weekdayUtc(current) !== weekday) current = shiftDate(current, 1);
  return shiftDate(current, (nth - 1) * 7);
}
function lastWeekdayOfMonth(year, month, weekday) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let current = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  while (weekdayUtc(current) !== weekday) current = shiftDate(current, -1);
  return current;
}
function easterSunday(year) {
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
  const day = (h + l - 7 * m + 114) % 31 + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function shiftDate(date, deltaDays) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + deltaDays);
  return value.toISOString().slice(0, 10);
}
function weekdayUtc(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
function isWeekend(date) {
  const weekday = weekdayUtc(date);
  return weekday === 0 || weekday === 6;
}

// ../../../visualizations/2026/10/02/01a0fe5d-fc42-7fd3-9a8f-d2a64aea9075/history-close-gap-repair-20261027/original/src/lib/market-data/close-gap-sync.ts
async function syncMissingRawCloses(job, provider) {
  if (!job.key.startsWith("kis:history:raw_close_v1:") || !job.startDate || !job.endDate) throw Error("raw_close_job_invalid");
  const dates = [];
  for (let ms = Date.parse(job.startDate + "T00:00:00Z"); ms <= Date.parse(job.endDate + "T00:00:00Z"); ms += 864e5) {
    const date = new Date(ms).toISOString().slice(0, 10), next = new Date(ms + 864e5).toISOString().slice(0, 10);
    if (closeCalendarReferenceDateForAsset(job, next) === date) dates.push(date);
  }
  const read = () => sqlClient.query("select date::text from asset_price_snapshots where market=$1 and currency=$2 and ticker=$3 and date=any($4::date[])", [job.market, job.currency, job.ticker, dates]);
  const present = new Set((await read()).map((p) => String(p.date))), missing = dates.filter((d) => !present.has(d));
  if (!missing.length) return { complete: true, insertedCount: 0 };
  const target = { ...job, key: job.key, accounts: [], assetIds: [], assetNames: [] };
  const result = await provider.fetchHistoricalClosePrices([target], { dryRun: false, includeAdjusted: false, requestedAt: /* @__PURE__ */ new Date(), startDate: missing[0], endDate: missing.at(-1) });
  if (!await isMarketCollectionClaimCurrent(job)) throw Error("raw_close_claim_expired");
  const freshPresent = new Set((await read()).map((p) => String(p.date)));
  result.rows = result.rows.filter((p) => p.ticker === job.ticker && p.market === job.market && p.currency === job.currency && missing.includes(p.priceDate) && !freshPresent.has(p.priceDate));
  const write = result.rows.length ? await runKisHistoryCacheSync({ targets: [target], provider, startDate: missing[0], endDate: missing.at(-1), prefetchedResult: result }) : null;
  const final = new Set((await read()).map((p) => String(p.date)));
  return { complete: dates.every((d) => final.has(d)), insertedCount: write?.insertedCount ?? 0 };
}

// ../../../visualizations/2026/10/02/01a0fe5d-fc42-7fd3-9a8f-d2a64aea9075/history-close-gap-repair-20261027/original/tests/cairn-close-gaps/worker.test.ts
async function main() {
  globalThis.gapTest = { dates: /* @__PURE__ */ new Set(["2026-10-08"]), writes: [], claimed: true };
  const job = { key: "kis:history:raw_close_v1:us:USD:VOO:2026-10-08:2026-10-12", kind: "history", market: "us", currency: "USD", ticker: "VOO", startDate: "2026-10-08", endDate: "2026-10-12", attempts: 1, claimToken: "test" };
  const row = (date, ticker = "VOO") => ({ ticker, market: "us", currency: "USD", priceDate: date, closePrice: "100", status: "ok" });
  let response = [row("2026-10-08"), row("2026-10-09"), row("2026-10-11"), row("2026-10-12", "MSFT")], requests = 0;
  const provider = { name: "kis", async fetchHistoricalClosePrices() {
    requests++;
    return { provider: "kis", priceBasis: "raw_price_return", rows: response, failures: [], warnings: [], requestCount: 1, fetchedAt: /* @__PURE__ */ new Date() };
  } };
  import_strict.default.equal((await syncMissingRawCloses(job, provider)).complete, false);
  import_strict.default.deepEqual(gapTest.writes, ["2026-10-09"]);
  response = [row("2026-10-12")];
  import_strict.default.equal((await syncMissingRawCloses(job, provider)).complete, true);
  import_strict.default.equal((await syncMissingRawCloses(job, provider)).insertedCount, 0);
  import_strict.default.equal(requests, 2);
  gapTest.dates.delete("2026-10-12");
  gapTest.claimed = false;
  await import_strict.default.rejects(syncMissingRawCloses(job, provider), /claim_expired/);
  import_strict.default.equal(gapTest.writes.length, 2);
  console.log("PASS: partial provider result retries, exact identity/date, idempotency, expired lease prevents write");
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
