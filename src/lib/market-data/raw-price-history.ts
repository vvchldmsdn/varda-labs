export const RAW_PRICE_HISTORY_POLICY = Object.freeze({
  version: "raw_price_history_read_model_v1",
  priceBasis: "raw_price_return",
  instrumentIdentity: "market_currency_ticker",
  adjustedCloseFallback: "forbidden",
  interpolation: "none",
  maximumInstrumentCount: 5,
  maximumRangeCalendarDays: 550,
  minimumRowsPerInstrument: 2,
} as const);

export type RawPriceHistoryInstrument = Readonly<{
  market: "korea" | "us";
  currency: "KRW" | "USD";
  ticker: string;
}>;

export type RawPriceHistoryRequest = Readonly<{
  startDate: string;
  endDate: string;
  instruments: readonly RawPriceHistoryInstrument[];
}>;

export type RawPriceHistorySourceRow = Readonly<{
  market: string;
  currency: string;
  ticker: string;
  priceDate: string;
  closePrice: string;
  source: string | null;
  providerSymbol: string | null;
  providerExchange: string | null;
  fetchedAt: Date | null;
}>;

export type RawPriceHistoryReadModel = Readonly<{
  policy: typeof RAW_PRICE_HISTORY_POLICY;
  status: "ready" | "partial" | "unavailable" | "blocked";
  priceBasis: typeof RAW_PRICE_HISTORY_POLICY.priceBasis;
  startDate: string;
  endDate: string;
  rowCount: number;
  invalidRowCount: number;
  duplicateRowCount: number;
  conflictingDuplicateCount: number;
  instruments: readonly Readonly<{
    instrumentKey: string;
    status: "ready" | "partial" | "unavailable" | "blocked";
    rowCount: number;
    firstDate: string | null;
    lastDate: string | null;
    sources: readonly string[];
  }>[];
  rows: readonly RawPriceHistorySourceRow[];
  blockers: readonly string[];
}>;

export class RawPriceHistoryRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RawPriceHistoryRequestError";
  }
}

export function normalizeRawPriceHistoryRequest(
  input: RawPriceHistoryRequest,
): RawPriceHistoryRequest {
  const startDate = normalizeDate(input?.startDate);
  const endDate = normalizeDate(input?.endDate);
  if (!startDate || !endDate || startDate > endDate) {
    throw new RawPriceHistoryRequestError(
      "startDate and endDate must be valid YYYY-MM-DD values",
    );
  }

  const rangeDays = differenceInCalendarDays(startDate, endDate) + 1;
  if (rangeDays > RAW_PRICE_HISTORY_POLICY.maximumRangeCalendarDays) {
    throw new RawPriceHistoryRequestError(
      `raw price history is limited to ${RAW_PRICE_HISTORY_POLICY.maximumRangeCalendarDays} calendar days`,
    );
  }
  if (
    !Array.isArray(input.instruments) ||
    input.instruments.length === 0 ||
    input.instruments.length > RAW_PRICE_HISTORY_POLICY.maximumInstrumentCount
  ) {
    throw new RawPriceHistoryRequestError(
      `instruments must contain between 1 and ${RAW_PRICE_HISTORY_POLICY.maximumInstrumentCount} rows`,
    );
  }

  const seen = new Set<string>();
  const instruments = input.instruments.map((instrument, index) => {
    const normalized = normalizeInstrument(instrument);
    if (!normalized) {
      throw new RawPriceHistoryRequestError(
        `instruments[${index}] must specify korea/KRW or us/USD and a valid ticker`,
      );
    }
    const key = instrumentKey(normalized);
    if (seen.has(key)) {
      throw new RawPriceHistoryRequestError(
        `duplicate instrument identity: ${key}`,
      );
    }
    seen.add(key);
    return normalized;
  });

  return Object.freeze({
    startDate,
    endDate,
    instruments: Object.freeze(instruments),
  });
}

export function buildRawPriceHistoryReadModel(input: {
  request: RawPriceHistoryRequest;
  rows: readonly RawPriceHistorySourceRow[];
}): RawPriceHistoryReadModel {
  const request = normalizeRawPriceHistoryRequest(input.request);
  const requestedKeys = new Set(request.instruments.map(instrumentKey));
  const grouped = new Map<string, RawPriceHistorySourceRow[]>();
  const duplicateKeys = new Set<string>();
  const conflictingKeys = new Set<string>();
  let invalidRowCount = 0;

  for (const sourceRow of input.rows) {
    const row = normalizeSourceRow(sourceRow);
    if (
      !row ||
      row.priceDate < request.startDate ||
      row.priceDate > request.endDate ||
      !requestedKeys.has(instrumentKey(row))
    ) {
      invalidRowCount += 1;
      continue;
    }

    const key = `${instrumentKey(row)}|${row.priceDate}`;
    const existing = grouped.get(key) ?? [];
    if (existing.length > 0) {
      duplicateKeys.add(key);
      if (
        existing.some(
          (candidate) => candidate.closePrice !== row.closePrice,
        )
      ) {
        conflictingKeys.add(key);
      }
    }
    existing.push(row);
    grouped.set(key, existing);
  }

  const rows = Array.from(grouped.entries())
    .filter(([key]) => !conflictingKeys.has(key))
    .map(([, candidates]) => candidates[0])
    .sort(compareRows);
  const instrumentSummaries = request.instruments.map((instrument) => {
    const key = instrumentKey(instrument);
    const instrumentRows = rows.filter(
      (row) => instrumentKey(row) === key,
    );
    const hasConflict = [...conflictingKeys].some((rowKey) =>
      rowKey.startsWith(`${key}|`),
    );
    const status = hasConflict
      ? "blocked"
      : instrumentRows.length >=
          RAW_PRICE_HISTORY_POLICY.minimumRowsPerInstrument
        ? "ready"
        : instrumentRows.length === 1
          ? "partial"
          : "unavailable";

    return Object.freeze({
      instrumentKey: key,
      status,
      rowCount: instrumentRows.length,
      firstDate: instrumentRows[0]?.priceDate ?? null,
      lastDate: instrumentRows.at(-1)?.priceDate ?? null,
      sources: Object.freeze(
        [
          ...new Set(
            instrumentRows
              .map((row) => row.source)
              .filter((source): source is string => source !== null),
          ),
        ].sort(),
      ),
    });
  });
  const status = overallStatus(instrumentSummaries);
  const blockers = [
    ...(conflictingKeys.size > 0
      ? [`conflicting_instrument_date_rows:${conflictingKeys.size}`]
      : []),
    ...(invalidRowCount > 0
      ? [`invalid_or_out_of_scope_rows:${invalidRowCount}`]
      : []),
  ];

  return Object.freeze({
    policy: RAW_PRICE_HISTORY_POLICY,
    status,
    priceBasis: RAW_PRICE_HISTORY_POLICY.priceBasis,
    startDate: request.startDate,
    endDate: request.endDate,
    rowCount: rows.length,
    invalidRowCount,
    duplicateRowCount: duplicateKeys.size,
    conflictingDuplicateCount: conflictingKeys.size,
    instruments: Object.freeze(instrumentSummaries),
    rows: Object.freeze(rows),
    blockers: Object.freeze(blockers),
  });
}

function normalizeInstrument(
  input: Readonly<{ market: string; currency: string; ticker: string }>,
): RawPriceHistoryInstrument | null {
  const market = normalizeText(input?.market)?.toLowerCase();
  const currency = normalizeText(input?.currency)?.toUpperCase();
  const ticker = normalizeText(input?.ticker)?.toUpperCase();
  if (
    !ticker ||
    !/^[A-Z0-9._-]{1,50}$/.test(ticker) ||
    !(
      (market === "korea" && currency === "KRW") ||
      (market === "us" && currency === "USD")
    )
  ) {
    return null;
  }
  return Object.freeze({ market, currency, ticker });
}

function normalizeSourceRow(
  input: RawPriceHistorySourceRow,
): RawPriceHistorySourceRow | null {
  const instrument = normalizeInstrument({
    market: input?.market,
    currency: input?.currency,
    ticker: input?.ticker,
  });
  const priceDate = normalizeDate(input?.priceDate);
  const closePrice = normalizePositiveDecimal(input?.closePrice);
  if (!instrument || !priceDate || !closePrice) return null;

  return Object.freeze({
    ...instrument,
    priceDate,
    closePrice,
    source: normalizeText(input.source),
    providerSymbol: normalizeText(input.providerSymbol)?.toUpperCase() ?? null,
    providerExchange:
      normalizeText(input.providerExchange)?.toUpperCase() ?? null,
    fetchedAt:
      input.fetchedAt instanceof Date &&
      Number.isFinite(input.fetchedAt.getTime())
        ? input.fetchedAt
        : null,
  });
}

function overallStatus(
  instruments: readonly Readonly<{ status: string }>[],
): RawPriceHistoryReadModel["status"] {
  if (instruments.some(({ status }) => status === "blocked")) return "blocked";
  if (instruments.every(({ status }) => status === "ready")) return "ready";
  if (instruments.every(({ status }) => status === "unavailable")) {
    return "unavailable";
  }
  return "partial";
}

function compareRows(
  left: RawPriceHistorySourceRow,
  right: RawPriceHistorySourceRow,
) {
  return (
    left.priceDate.localeCompare(right.priceDate) ||
    instrumentKey(left).localeCompare(instrumentKey(right))
  );
}

function instrumentKey(
  input: Readonly<{ market: string; currency: string; ticker: string }>,
) {
  return `${input.market}|${input.currency}|${input.ticker}`;
}

function normalizeDate(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== normalized
    ? null
    : normalized;
}

function normalizePositiveDecimal(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized || !/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric > 0 ? normalized : null;
}

function differenceInCalendarDays(startDate: string, endDate: string) {
  return Math.round(
    (Date.parse(`${endDate}T00:00:00.000Z`) -
      Date.parse(`${startDate}T00:00:00.000Z`)) /
      86_400_000,
  );
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
