import type { ClosePrice, PriceLookupTarget } from "./types";

export const KIS_RAW_HISTORY_POLICY = Object.freeze({
  version: "kis_raw_close_history_v1",
  priceBasis: "raw_price_return",
  instrumentIdentity: "market_currency_ticker",
  requestOrder: "newest_first",
  windowCalendarDays: 90,
  maximumRangeCalendarDays: 550,
  maximumInstrumentCount: 5,
  requestDelayMilliseconds: 180,
  automaticRetryCount: 0,
  adjustedCloseClaim: "forbidden",
} as const);

export type KisHistoryMarket = "korea" | "us";

export type KisHistoryWindow = Readonly<{
  index: number;
  startDate: string;
  endDate: string;
}>;

export type KisHistoryRequest = Readonly<{
  instrumentKey: string;
  ticker: string;
  market: KisHistoryMarket;
  currency: "KRW" | "USD";
  window: KisHistoryWindow;
  endpoint:
    | "domestic_inquire_daily_itemchartprice"
    | "overseas_dailyprice";
  maximumTransportRequests: number;
}>;

export type KisRawHistoryPlan = Readonly<{
  policy: typeof KIS_RAW_HISTORY_POLICY;
  startDate: string;
  endDate: string;
  rangeCalendarDays: number;
  instruments: readonly Readonly<{
    key: string;
    ticker: string;
    market: KisHistoryMarket;
    currency: "KRW" | "USD";
  }>[];
  windows: readonly KisHistoryWindow[];
  requests: readonly KisHistoryRequest[];
  maximumTransportRequestCount: number;
}>;

export type KisRawHistoryNormalization = Readonly<{
  instrumentKey: string;
  rows: readonly ClosePrice[];
  invalidRowCount: number;
  outsideWindowRowCount: number;
  duplicateRowCount: number;
}>;

export class KisRawHistoryInputError extends Error {
  readonly code:
    | "invalid_date_range"
    | "range_too_large"
    | "invalid_target"
    | "duplicate_instrument"
    | "conflicting_duplicate_date"
    | "invalid_normalized_row";

  constructor(
    code: KisRawHistoryInputError["code"],
    message: string,
  ) {
    super(message);
    this.name = "KisRawHistoryInputError";
    this.code = code;
  }
}

export function planKisRawHistoryRequests(input: {
  targets: readonly PriceLookupTarget[];
  startDate: string;
  endDate: string;
}): KisRawHistoryPlan {
  const startDate = parseDateKey(input.startDate);
  const endDate = parseDateKey(input.endDate);

  if (!startDate || !endDate || startDate > endDate) {
    throw new KisRawHistoryInputError(
      "invalid_date_range",
      "KIS history range must use valid YYYY-MM-DD dates with startDate <= endDate",
    );
  }

  const rangeCalendarDays = differenceInCalendarDays(startDate, endDate) + 1;
  if (rangeCalendarDays > KIS_RAW_HISTORY_POLICY.maximumRangeCalendarDays) {
    throw new KisRawHistoryInputError(
      "range_too_large",
      `KIS history range exceeds ${KIS_RAW_HISTORY_POLICY.maximumRangeCalendarDays} calendar days`,
    );
  }

  if (
    input.targets.length === 0 ||
    input.targets.length > KIS_RAW_HISTORY_POLICY.maximumInstrumentCount
  ) {
    throw new KisRawHistoryInputError(
      "invalid_target",
      `KIS history requires between 1 and ${KIS_RAW_HISTORY_POLICY.maximumInstrumentCount} instruments`,
    );
  }

  const instruments = input.targets.map(normalizeTarget);
  const instrumentKeys = new Set<string>();
  for (const instrument of instruments) {
    if (instrumentKeys.has(instrument.key)) {
      throw new KisRawHistoryInputError(
        "duplicate_instrument",
        `duplicate KIS history instrument: ${instrument.key}`,
      );
    }
    instrumentKeys.add(instrument.key);
  }

  const windows = buildNewestFirstWindows(startDate, endDate);
  const requests = instruments.flatMap((instrument) =>
    windows.map((window) =>
      Object.freeze({
        instrumentKey: instrument.key,
        ticker: instrument.ticker,
        market: instrument.market,
        currency: instrument.currency,
        window,
        endpoint:
          instrument.market === "korea"
            ? "domestic_inquire_daily_itemchartprice"
            : "overseas_dailyprice",
        maximumTransportRequests: instrument.market === "korea" ? 1 : 3,
      } satisfies KisHistoryRequest),
    ),
  );

  return Object.freeze({
    policy: KIS_RAW_HISTORY_POLICY,
    startDate,
    endDate,
    rangeCalendarDays,
    instruments: Object.freeze(instruments),
    windows: Object.freeze(windows),
    requests: Object.freeze(requests),
    maximumTransportRequestCount: requests.reduce(
      (sum, request) => sum + request.maximumTransportRequests,
      0,
    ),
  });
}

export function normalizeKisRawHistoryPayload(input: {
  target: PriceLookupTarget;
  window: KisHistoryWindow;
  rawRows: unknown;
  fetchedAt: Date;
  exchange?: string | null;
}): KisRawHistoryNormalization {
  const instrument = normalizeTarget(input.target);
  const dateKey =
    instrument.market === "korea" ? "stck_bsop_date" : "xymd";
  const closeKey = instrument.market === "korea" ? "stck_clpr" : "clos";
  const rowsByDate = new Map<string, ClosePrice>();
  let invalidRowCount = 0;
  let outsideWindowRowCount = 0;
  let duplicateRowCount = 0;

  for (const rawRow of Array.isArray(input.rawRows) ? input.rawRows : []) {
    if (!rawRow || typeof rawRow !== "object") {
      invalidRowCount += 1;
      continue;
    }

    const record = rawRow as Record<string, unknown>;
    const priceDate = normalizeProviderDate(record[dateKey]);
    const closePrice = normalizePositiveDecimal(record[closeKey]);

    if (!priceDate || !closePrice) {
      invalidRowCount += 1;
      continue;
    }
    if (
      priceDate < input.window.startDate ||
      priceDate > input.window.endDate
    ) {
      outsideWindowRowCount += 1;
      continue;
    }

    const row = toRawClosePrice({
      instrument,
      priceDate,
      closePrice,
      fetchedAt: input.fetchedAt,
      exchange: input.exchange,
    });
    const existing = rowsByDate.get(priceDate);

    if (!existing) {
      rowsByDate.set(priceDate, row);
      continue;
    }

    if (!equalDecimal(existing.closePrice, closePrice)) {
      throw new KisRawHistoryInputError(
        "conflicting_duplicate_date",
        `conflicting KIS closes for ${instrument.key} on ${priceDate}`,
      );
    }
    duplicateRowCount += 1;
  }

  return Object.freeze({
    instrumentKey: instrument.key,
    rows: Object.freeze(
      Array.from(rowsByDate.values()).sort((left, right) =>
        left.priceDate.localeCompare(right.priceDate),
      ),
    ),
    invalidRowCount,
    outsideWindowRowCount,
    duplicateRowCount,
  });
}

export function mergeKisRawHistoryRows(
  series: readonly (readonly ClosePrice[])[],
): readonly ClosePrice[] {
  const rowsByIdentity = new Map<string, ClosePrice>();

  for (const rows of series) {
    for (const row of rows) {
      validateNormalizedRow(row);
      const identity = [
        row.market.toLowerCase(),
        row.currency.toUpperCase(),
        row.ticker.toUpperCase(),
        row.priceDate,
      ].join("|");
      const existing = rowsByIdentity.get(identity);

      if (!existing) {
        rowsByIdentity.set(identity, row);
        continue;
      }

      if (!equalDecimal(existing.closePrice, row.closePrice)) {
        throw new KisRawHistoryInputError(
          "conflicting_duplicate_date",
          `conflicting KIS closes for ${identity}`,
        );
      }
    }
  }

  return Object.freeze(
    Array.from(rowsByIdentity.values()).sort((left, right) => {
      const leftKey = `${left.market}|${left.currency}|${left.ticker}`;
      const rightKey = `${right.market}|${right.currency}|${right.ticker}`;
      return leftKey.localeCompare(rightKey) ||
        left.priceDate.localeCompare(right.priceDate);
    }),
  );
}

function buildNewestFirstWindows(startDate: string, endDate: string) {
  const windows: KisHistoryWindow[] = [];
  let cursorEnd = endDate;

  while (cursorEnd >= startDate) {
    const candidateStart = shiftDate(
      cursorEnd,
      -(KIS_RAW_HISTORY_POLICY.windowCalendarDays - 1),
    );
    const windowStart = candidateStart < startDate ? startDate : candidateStart;
    windows.push(
      Object.freeze({
        index: windows.length,
        startDate: windowStart,
        endDate: cursorEnd,
      }),
    );
    cursorEnd = shiftDate(windowStart, -1);
  }

  return windows;
}

function normalizeTarget(target: PriceLookupTarget) {
  const ticker = String(target?.ticker ?? "").trim().toUpperCase();
  const market = String(target?.market ?? "").trim().toLowerCase();
  const currency = String(target?.currency ?? "").trim().toUpperCase();

  if (
    !/^[A-Z0-9._-]{1,50}$/.test(ticker) ||
    !(
      (market === "korea" && currency === "KRW") ||
      (market === "us" && currency === "USD")
    )
  ) {
    throw new KisRawHistoryInputError(
      "invalid_target",
      "KIS history target must be korea/KRW or us/USD with a valid ticker",
    );
  }

  return Object.freeze({
    key: `${market}|${currency}|${ticker}`,
    ticker,
    market: market as KisHistoryMarket,
    currency: currency as "KRW" | "USD",
  });
}

function toRawClosePrice(input: {
  instrument: ReturnType<typeof normalizeTarget>;
  priceDate: string;
  closePrice: string;
  fetchedAt: Date;
  exchange?: string | null;
}): ClosePrice {
  const isKorea = input.instrument.market === "korea";
  const exchange = String(input.exchange ?? "").trim().toUpperCase() || null;

  return {
    ticker: input.instrument.ticker,
    market: input.instrument.market,
    currency: input.instrument.currency,
    priceDate: input.priceDate,
    closePrice: input.closePrice,
    adjustedClosePrice: null,
    adjustedCloseBasis: null,
    adjustedCloseProvider: null,
    adjustedCloseSource: null,
    adjustedCloseFetchedAt: null,
    closePriceKrw: isKorea ? input.closePrice : null,
    fxRate: null,
    providerSymbol: input.instrument.ticker,
    providerExchange: isKorea ? "KRX" : exchange,
    fetchedAt: input.fetchedAt,
    source: isKorea
      ? "kis_domestic_itemchartprice"
      : `kis_overseas_dailyprice:${exchange ?? "UNKNOWN"}`,
    quoteType: "close",
    status: "ok",
    isSample: false,
  };
}

function validateNormalizedRow(row: ClosePrice) {
  const hasAdjustedClaim =
    row.adjustedClosePrice !== null ||
    row.adjustedCloseBasis !== null ||
    row.adjustedCloseProvider !== null ||
    row.adjustedCloseSource !== null ||
    row.adjustedCloseFetchedAt !== null;

  if (
    row.status !== "ok" ||
    !row.closePrice ||
    hasAdjustedClaim ||
    !/^kis_(?:domestic_itemchartprice|overseas_dailyprice:)/.test(
      row.source,
    )
  ) {
    throw new KisRawHistoryInputError(
      "invalid_normalized_row",
      "KIS raw history rows must contain raw close evidence without adjusted-close claims",
    );
  }
}

function parseDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? null
    : value;
}

function normalizeProviderDate(value: unknown) {
  const digits = String(value ?? "").replace(/[^0-9]/g, "");
  if (digits.length !== 8) return null;
  return parseDateKey(
    `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`,
  );
}

function normalizePositiveDecimal(value: unknown) {
  const normalized = String(value ?? "").trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric > 0 ? normalized : null;
}

function equalDecimal(left: string | null, right: string | null) {
  if (left === null || right === null) return left === right;
  return Number(left) === Number(right);
}

function differenceInCalendarDays(startDate: string, endDate: string) {
  return Math.round(
    (Date.parse(`${endDate}T00:00:00.000Z`) -
      Date.parse(`${startDate}T00:00:00.000Z`)) /
      86_400_000,
  );
}

function shiftDate(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
