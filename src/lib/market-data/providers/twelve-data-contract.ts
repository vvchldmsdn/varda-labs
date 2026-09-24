import type { ClosePrice, LiveQuote, PriceLookupTarget } from "./types";

export const TWELVE_DATA_CONTRACT_VERSION = "twelve_data_us_fx_v1";
export type TwelveDataDataset = "us_quote" | "us_daily_raw" | "usd_krw" | "usd_krw_history" | "us_splits" | "us_dividends";
export type TwelveDataEndpoint = "/quote" | "/time_series" | "/exchange_rate" | "/splits" | "/dividends";
export type TwelveDataAction = { type: "split"; date: string; fromFactor: string; toFactor: string } |
  { type: "dividend"; date: string; cashAmount: string; currency: "USD" };
export type TwelveDataActionCoverage = {
  type: "split" | "dividend"; startDate: string; endDate: string;
  status: "complete"; endpoint: "/splits" | "/dividends";
  sourceMeaning: "provider_split_factors" | "unadjusted_cash_per_share";
  source: "twelve_data" | "twelve_data_fixture"; synthetic: boolean;
  licenseScope: string; fetchedAt: Date; events: TwelveDataAction[];
};

/** A reviewed listing mapping, never a name/ticker similarity match. */
export type TwelveDataListing = {
  instrumentKey: string;
  ticker: string;
  symbol: string;
  micCode: string;
  exchange: string;
  type: "Common Stock" | "ETF";
  currency: "USD";
  exchangeTimezone: "America/New_York";
};

export type TwelveDataProvenance = {
  contractVersion: typeof TWELVE_DATA_CONTRACT_VERSION;
  dataset: TwelveDataDataset;
  source: "twelve_data" | "twelve_data_fixture";
  licenseScope: string;
  priceBasis: "provider_quote_close" | "raw_close" | "fx_rate";
  adjustment: "none" | "not_applicable";
  session: "regular" | "not_applicable";
  observedAt: Date | null;
  fetchedAt: Date;
  exchangeDate: string | null;
  freshness: "fresh" | "stale" | "daily_date_only";
  synthetic: boolean;
};

export type TwelveDataFxRate = {
  baseCurrency: "USD";
  quoteCurrency: "KRW";
  /** KRW per one USD. Inverting this is a calculation, not another observation. */
  rate: string;
  observedAt: Date;
  fetchedAt: Date;
  provenance: TwelveDataProvenance;
};
export type TwelveDataHistoricalFxRate = TwelveDataFxRate & { requestedAt: Date };

export type TwelveDataParseContext = {
  fetchedAt: Date;
  synthetic: boolean;
  licenseScope: string;
  quoteDelay: "delayed" | "realtime";
  maximumAgeMs: number;
};

/** HTTP transport and billed units differ: batching N symbols still costs N credits. */
export function estimateTwelveDataCost(endpoint: TwelveDataEndpoint, symbols: number, batch = false) {
  if (!["/quote", "/time_series", "/exchange_rate", "/splits", "/dividends"].includes(endpoint) ||
      !Number.isSafeInteger(symbols) || symbols < 1 || symbols > 100) {
    throw new Error("twelve_data_cost_input_invalid");
  }
  return { httpRequests: batch ? 1 : symbols, apiCredits: symbols * (["/splits", "/dividends"].includes(endpoint) ? 20 : 1) };
}

/** Endpoint date ranges prove only the queried period. Empty arrays are evidence; missing arrays are not. */
export function parseTwelveDataActions(payload: unknown, listing: TwelveDataListing, type: "split" | "dividend", startDate: string, endDate: string, context: TwelveDataParseContext): TwelveDataActionCoverage {
  assertActionDateWindow(startDate, endDate, context.fetchedAt);
  const response = record(payload), meta = record(response.meta);
  assertIdentity(meta, listing);
  if (meta.exchange_timezone !== listing.exchangeTimezone) throw new Error("twelve_data_action_identity_invalid");
  const values = response[type === "split" ? "splits" : "dividends"];
  if (!Array.isArray(values) || values.length > 1000) throw new Error("twelve_data_action_values_invalid");
  const dates = new Map<string, string>();
  const events = values.map((value): TwelveDataAction => {
    const row = record(value), date = dateKey(type === "split" ? row.date : row.ex_date);
    if (date < startDate || date > endDate) throw new Error("twelve_data_action_date_invalid");
    const canonical = (value: unknown) => positiveDecimal(value).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "").replace(/^0+(?=\d)/, "");
    const event: TwelveDataAction = type === "split" ? { type, date, fromFactor: canonical(row.from_factor), toFactor: canonical(row.to_factor) }
      : { type, date, cashAmount: canonical(row.amount), currency: "USD" };
    const key = JSON.stringify(event), previous = dates.get(date);
    if (previous && previous !== key) throw new Error("twelve_data_action_date_invalid");
    dates.set(date, key);
    return event;
  }).filter((event, index, rows) => rows.findIndex(other => JSON.stringify(other) === JSON.stringify(event)) === index).sort((a, b) => a.date.localeCompare(b.date));
  return { type, startDate, endDate, status: "complete", endpoint: type === "split" ? "/splits" : "/dividends",
    sourceMeaning: type === "split" ? "provider_split_factors" : "unadjusted_cash_per_share", source: context.synthetic ? "twelve_data_fixture" : "twelve_data",
    synthetic: context.synthetic, licenseScope: context.licenseScope, fetchedAt: context.fetchedAt, events };
}

export function resolveTwelveDataListing(target: PriceLookupTarget, listings: readonly TwelveDataListing[]) {
  if (target.market !== "us" || target.currency !== "USD") throw new Error("twelve_data_listing_unsupported");
  const matches = listings.filter((row) => row.instrumentKey === target.key && row.ticker === target.ticker);
  if (matches.length !== 1) throw new Error("twelve_data_listing_unresolved");
  const listing = matches[0];
  if (listing.currency !== "USD" || !/^[A-Z0-9.\-]{1,20}$/.test(listing.symbol) ||
      !/^[A-Z0-9]{4}$/.test(listing.micCode) || !listing.exchange ||
      !["Common Stock", "ETF"].includes(listing.type) || listing.exchangeTimezone !== "America/New_York") {
    throw new Error("twelve_data_listing_invalid");
  }
  return listing;
}

export function parseTwelveDataQuote(payload: unknown, target: PriceLookupTarget, listing: TwelveDataListing, context: TwelveDataParseContext): LiveQuote & { provenance: TwelveDataProvenance } {
  const row = record(payload);
  assertIdentity(row, listing);
  // `timestamp` is the opening timestamp of the quote interval, NOT the price time.
  const observedAt = timestamp(row.last_quote_at, context.fetchedAt);
  const price = positiveDecimal(row.close);
  return {
    ticker: target.ticker, market: target.market, currency: target.currency,
    price, priceAsOf: observedAt, fetchedAt: context.fetchedAt,
    source: context.synthetic ? "twelve_data_fixture" : "twelve_data",
    quoteType: context.quoteDelay, status: "ok",
    provenance: provenance("us_quote", "provider_quote_close", context, observedAt),
  };
}

export function parseTwelveDataDaily(payload: unknown, target: PriceLookupTarget, listing: TwelveDataListing, startDate: string, endDate: string, context: TwelveDataParseContext): Array<ClosePrice & { provenance: TwelveDataProvenance }> {
  const response = record(payload);
  const meta = record(response.meta);
  assertIdentity(meta, listing);
  if (meta.interval !== "1day" || meta.exchange_timezone !== listing.exchangeTimezone || meta.type !== listing.type) {
    throw new Error("twelve_data_history_metadata_mismatch");
  }
  assertDateWindow(startDate, endDate, context.fetchedAt);
  if (!Array.isArray(response.values) || response.values.length > 5000) throw new Error("twelve_data_history_values_invalid");
  const dates = new Set<string>();
  const rows = response.values.map((value) => {
    const row = record(value);
    const date = dateKey(row.datetime);
    if (date < startDate || date > endDate || dates.has(date)) throw new Error("twelve_data_history_date_invalid");
    dates.add(date);
    return {
      ticker: target.ticker, market: target.market, currency: target.currency,
      priceDate: date, closePrice: positiveDecimal(row.close),
      // Requested adjust=none. A raw series must never satisfy adjusted-price admission.
      adjustedClosePrice: null, adjustedCloseBasis: null, adjustedCloseProvider: null,
      adjustedCloseSource: null, adjustedCloseFetchedAt: null, closePriceKrw: null, fxRate: null,
      providerSymbol: listing.symbol, providerExchange: listing.micCode,
      fetchedAt: context.fetchedAt, source: context.synthetic ? "twelve_data_fixture" : "twelve_data",
      quoteType: "close" as const, status: "ok" as const, isSample: context.synthetic,
      // A daily bar supplies a date, not an exact close observation timestamp.
      provenance: { ...provenance("us_daily_raw", "raw_close", context, null), exchangeDate: date },
    };
  });
  return rows.sort((left, right) => left.priceDate.localeCompare(right.priceDate));
}

export function parseTwelveDataFx(payload: unknown, context: TwelveDataParseContext): TwelveDataFxRate {
  const row = record(payload);
  if (row.symbol !== "USD/KRW") throw new Error("twelve_data_fx_direction_mismatch");
  const observedAt = timestamp(row.timestamp, context.fetchedAt);
  return {
    baseCurrency: "USD", quoteCurrency: "KRW", rate: positiveDecimal(row.rate),
    observedAt, fetchedAt: context.fetchedAt,
    provenance: provenance("usd_krw", "fx_rate", context, observedAt),
  };
}

/** /exchange_rate?date=... returns a historical spot observation, not a daily fixing. */
export function parseTwelveDataHistoricalFx(payload: unknown, requestedAt: Date, context: TwelveDataParseContext): TwelveDataHistoricalFxRate {
  if (!Number.isFinite(requestedAt.getTime()) || requestedAt > context.fetchedAt) throw new Error("twelve_data_fx_request_time_invalid");
  const rate = parseTwelveDataFx(payload, context);
  if (rate.observedAt > requestedAt) throw new Error("twelve_data_fx_future_observation");
  return { ...rate, requestedAt, provenance: { ...rate.provenance, dataset: "usd_krw_history" } };
}

export function assertDateWindow(startDate: string, endDate: string, fetchedAt: Date) {
  dateKey(startDate); dateKey(endDate);
  if (!Number.isFinite(fetchedAt.getTime())) throw new Error("twelve_data_fetched_at_invalid");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(fetchedAt);
  if (startDate > endDate || endDate >= today || Date.parse(endDate) - Date.parse(startDate) > 366 * 86_400_000) {
    throw new Error("twelve_data_history_window_invalid");
  }
}

/** Action endpoints may inspect today; the reader keeps that response provisional. */
export function assertActionDateWindow(startDate: string, endDate: string, fetchedAt: Date) {
  dateKey(startDate); dateKey(endDate);
  if (!Number.isFinite(fetchedAt.getTime())) throw new Error("twelve_data_fetched_at_invalid");
  if (startDate > endDate || endDate > twelveDataExchangeDate(fetchedAt) || Date.parse(endDate) - Date.parse(startDate) > 366 * 86_400_000) throw new Error("twelve_data_action_window_invalid");
}

export function twelveDataExchangeDate(at: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function assertIdentity(row: Record<string, unknown>, listing: TwelveDataListing) {
  if (row.symbol !== listing.symbol || row.mic_code !== listing.micCode || row.currency !== listing.currency || row.exchange !== listing.exchange) {
    throw new Error("twelve_data_listing_response_mismatch");
  }
}

function provenance(dataset: TwelveDataDataset, priceBasis: TwelveDataProvenance["priceBasis"], context: TwelveDataParseContext, observedAt: Date | null): TwelveDataProvenance {
  if (!Number.isFinite(context.maximumAgeMs) || context.maximumAgeMs < 0) throw new Error("twelve_data_freshness_policy_invalid");
  return {
    contractVersion: TWELVE_DATA_CONTRACT_VERSION, dataset, priceBasis,
    source: context.synthetic ? "twelve_data_fixture" : "twelve_data", licenseScope: context.licenseScope,
    adjustment: dataset === "us_daily_raw" ? "none" : "not_applicable",
    session: dataset === "usd_krw" || dataset === "usd_krw_history" ? "not_applicable" : "regular",
    observedAt, fetchedAt: context.fetchedAt, exchangeDate: null,
    freshness: observedAt === null ? "daily_date_only" : context.fetchedAt.getTime() - observedAt.getTime() > context.maximumAgeMs ? "stale" : "fresh",
    synthetic: context.synthetic,
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("twelve_data_payload_invalid");
  const result = value as Record<string, unknown>;
  if (result.status === "error") {
    if (result.code === 429) throw new Error("twelve_data_rate_limited");
    if (result.code === 401 || result.code === 403) throw new Error("twelve_data_auth_failed");
    // Provider messages may echo query strings or keys. Return only a fixed code.
    throw new Error("twelve_data_provider_error");
  }
  if (result.status !== undefined && result.status !== "ok") throw new Error("twelve_data_partial_response");
  return result;
}

function positiveDecimal(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") throw new Error("twelve_data_price_invalid");
  const text = String(value);
  if (!/^\d{1,18}(?:\.\d{1,18})?$/.test(text) || !Number.isFinite(Number(text)) || Number(text) <= 0) throw new Error("twelve_data_price_invalid");
  return text;
}

function timestamp(value: unknown, fetchedAt: Date) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 ||
      !Number.isFinite(fetchedAt.getTime()) || value * 1000 > fetchedAt.getTime()) throw new Error("twelve_data_timestamp_invalid");
  return new Date(value * 1000);
}

function dateKey(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("twelve_data_date_invalid");
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error("twelve_data_date_invalid");
  return value;
}
