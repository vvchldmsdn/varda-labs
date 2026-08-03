const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const FRANKFURTER_HISTORY_POLICY = Object.freeze({
  version: "frankfurter_v2_usdkrw_history_v1",
  endpoint: "https://api.frankfurter.dev/v2/rates",
  base: "USD",
  quote: "KRW",
  source: "frankfurter_v2_blended",
  writeMode: "insert_missing_only",
} as const);

export type FrankfurterHistoryRow = Readonly<{
  rateDate: string;
  usdKrw: string;
  source: typeof FRANKFURTER_HISTORY_POLICY.source;
}>;

export function buildFrankfurterHistoryUrl(fromDate: string, toDate: string) {
  if (!isDateKey(fromDate) || !isDateKey(toDate) || fromDate > toDate) {
    throw new Error("Frankfurter history dates must be an ordered YYYY-MM-DD range");
  }
  const url = new URL(FRANKFURTER_HISTORY_POLICY.endpoint);
  url.searchParams.set("base", FRANKFURTER_HISTORY_POLICY.base);
  url.searchParams.set("quotes", FRANKFURTER_HISTORY_POLICY.quote);
  url.searchParams.set("from", fromDate);
  url.searchParams.set("to", toDate);
  return url.toString();
}

export function parseFrankfurterV2UsdKrwHistory(
  payload: unknown,
): readonly FrankfurterHistoryRow[] {
  if (!Array.isArray(payload)) {
    throw new Error("Frankfurter v2 history response must be an array");
  }

  const rows = payload.map((value, index) => {
    const record = asRecord(value);
    const rateDate = typeof record?.date === "string" ? record.date : "";
    const base = typeof record?.base === "string" ? record.base : "";
    const quote = typeof record?.quote === "string" ? record.quote : "";
    const rate = toPositiveNumber(record?.rate);
    if (
      !isDateKey(rateDate) ||
      base !== FRANKFURTER_HISTORY_POLICY.base ||
      quote !== FRANKFURTER_HISTORY_POLICY.quote ||
      rate === null
    ) {
      throw new Error(`Frankfurter v2 history row ${index} is invalid`);
    }
    return Object.freeze({
      rateDate,
      usdKrw: String(rate),
      source: FRANKFURTER_HISTORY_POLICY.source,
    });
  });

  const ordered = [...rows].sort((left, right) =>
    left.rateDate.localeCompare(right.rateDate),
  );
  if (new Set(ordered.map((row) => row.rateDate)).size !== ordered.length) {
    throw new Error("Frankfurter v2 history contains duplicate dates");
  }
  return Object.freeze(ordered);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toPositiveNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function isDateKey(value: string) {
  if (!DATE_KEY_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
