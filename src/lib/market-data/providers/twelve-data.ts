import "server-only";

import type { ClosePrice, HistoricalPriceResult, LiveQuote, MarketDataProvider, PriceLookupTarget, ProviderRequestContext, ProviderResult } from "./types";
import { fetchTwelveDataPayload } from "./twelve-data-http";
import {
  assertDateWindow, assertActionDateWindow, estimateTwelveDataCost, parseTwelveDataDaily, parseTwelveDataFx,
  parseTwelveDataQuote, parseTwelveDataActions, parseTwelveDataHistoricalFx, resolveTwelveDataListing,
  type TwelveDataDataset, type TwelveDataEndpoint, type TwelveDataFxRate,
  type TwelveDataListing, type TwelveDataParseContext, type TwelveDataActionCoverage, type TwelveDataHistoricalFxRate,
} from "./twelve-data-contract";

type Audience = "internal_validation" | "member_display" | "public_demo";
type CostReservation = { provider: "twelve_data"; dataset: TwelveDataDataset; httpRequests: number; apiCredits: number };
type FixtureRequest = { endpoint: TwelveDataEndpoint; parameters: Readonly<Record<string, string>> };
export type TwelveDataOptions = {
  mode: "fixture";
  listings: readonly TwelveDataListing[];
  /** Synthetic responses only. Receives no credentials and must not perform I/O. */
  fixtureTransport: (request: FixtureRequest) => Promise<unknown>;
} | {
  mode: "live";
  apiKey: string;
  listings: readonly TwelveDataListing[];
  audience: Audience;
  license: {
    status: "confirmed";
    reference: string;
    cacheScope: string;
    expiresAt: Date;
    datasets: readonly TwelveDataDataset[];
    audiences: readonly Audience[];
    quoteDelay: "delayed" | "realtime";
  };
  release: { approved: true; reference: string };
  /** Must atomically reserve shared HTTP AND credit budgets before each real attempt. */
  reserve: (cost: CostReservation) => Promise<boolean>;
};

type Usage = { httpAttempts: number; reservedApiCredits: number; fixtureRequests: number };
type Metered<T> = T & { usage: Usage };
export type TwelveDataProvider = MarketDataProvider & {
  fetchUsdKrwRate(requestedAt: Date, dryRun?: boolean): Promise<Metered<{ rate: TwelveDataFxRate | null; error?: string }>>;
  fetchHistoricalUsdKrwRate(at: Date, requestedAt: Date, dryRun?: boolean): Promise<Metered<{ rate: TwelveDataHistoricalFxRate | null; error?: string }>>;
  fetchCorporateActions(target: PriceLookupTarget, type: "split" | "dividend", startDate: string, endDate: string, requestedAt: Date, dryRun?: boolean): Promise<Metered<{ coverage: TwelveDataActionCoverage | null; error?: string }>>;
};

/** Shared by the queue admission and adapter; never inferred from a public request or environment defaults. */
export function twelveDataAccessError(options: TwelveDataOptions | undefined, dataset: TwelveDataDataset, requestedAt: Date, dryRun = false): string | null {
  if (!Number.isFinite(requestedAt.getTime())) return "twelve_data_request_time_invalid";
  if (!options || dryRun) return "twelve_data_disabled";
  if (options.mode === "fixture") return null;
  if (options.mode !== "live" || !options.apiKey?.trim() || options.license?.status !== "confirmed" ||
      !["internal_validation", "member_display", "public_demo"].includes(options.audience) ||
      !options.license.reference?.trim() || !options.license.cacheScope?.trim() ||
      !(options.license.expiresAt instanceof Date) || !Number.isFinite(options.license.expiresAt.getTime()) ||
      options.license.expiresAt.getTime() <= Math.max(requestedAt.getTime(), Date.now()) || !options.license.datasets?.includes(dataset) ||
      !options.license.audiences?.includes(options.audience) ||
      !["delayed", "realtime"].includes(options.license.quoteDelay) ||
      options.release?.approved !== true || !options.release.reference?.trim() || typeof options.reserve !== "function") {
    return "twelve_data_release_not_authorized";
  }
  return null;
}

/** Unwired by default: no env discovery, no router fallback, no query-string release flag. */
export function createTwelveDataMarketDataProvider(options?: TwelveDataOptions): TwelveDataProvider {
  function parseContext(requestedAt: Date): TwelveDataParseContext {
    return {
      fetchedAt: options?.mode === "live" ? new Date() : requestedAt, synthetic: options?.mode === "fixture",
      licenseScope: options?.mode === "live" ? options.license.cacheScope : "synthetic_fixture_only",
      quoteDelay: options?.mode === "live" ? options.license.quoteDelay : "delayed",
      maximumAgeMs: 15 * 60_000,
    };
  }

  function authorize(dataset: TwelveDataDataset, requestedAt: Date, dryRun: boolean) {
    const error = twelveDataAccessError(options, dataset, requestedAt, dryRun);
    if (error) throw new Error(error);
  }

  async function request(endpoint: TwelveDataEndpoint, dataset: TwelveDataDataset, parameters: Record<string, string>, requestedAt: Date, usage: Usage) {
    authorize(dataset, requestedAt, false);
    if (options?.mode === "fixture") {
      usage.fixtureRequests += 1;
      try { return await options.fixtureTransport({ endpoint, parameters: Object.freeze({ ...parameters }) }); }
      catch { throw new Error("twelve_data_transport_failed"); }
    }
    if (options?.mode !== "live") throw new Error("twelve_data_disabled");
    const cost = estimateTwelveDataCost(endpoint, 1);
    let reserved = false;
    try { reserved = await options.reserve({ provider: "twelve_data", dataset, ...cost }); }
    catch { throw new Error("twelve_data_budget_unavailable"); }
    if (reserved !== true) throw new Error("twelve_data_budget_limited");
    usage.reservedApiCredits += cost.apiCredits;
    usage.httpAttempts += 1;
    return fetchTwelveDataPayload(endpoint, parameters, options.apiKey);
  }

  async function daily(targets: PriceLookupTarget[], startDate: string, endDate: string, requestedAt: Date, dryRun: boolean): Promise<Metered<HistoricalPriceResult>> {
    const result: Metered<HistoricalPriceResult> = {
      provider: "twelve_data", fetchedAt: requestedAt, priceBasis: "raw_price_return", rows: [], failures: [], requestCount: 0,
      warnings: ["raw daily history only; no adjusted/total-return or exact close timestamp admission"], usage: emptyUsage(),
    };
    for (const target of boundedTargets(targets)) {
      try {
        authorize("us_daily_raw", requestedAt, dryRun);
        assertDateWindow(startDate, endDate, requestedAt);
        const listing = resolveTwelveDataListing(target, options!.listings);
        const payload = await request("/time_series", "us_daily_raw", {
          symbol: listing.symbol, mic_code: listing.micCode, exchange: listing.exchange,
          type: listing.type, interval: "1day", start_date: startDate, end_date: endDate,
          adjust: "none", prepost: "false", order: "asc", outputsize: "5000", format: "JSON",
        }, requestedAt, result.usage);
        const rows = parseTwelveDataDaily(payload, target, listing, startDate, endDate, parseContext(requestedAt));
        if (!rows.length) throw new Error("twelve_data_empty_window");
        result.rows.push(...rows);
      } catch (error) {
        const message = safeError(error);
        result.failures.push({
          instrumentKey: target.key, ticker: target.ticker, market: target.market, currency: target.currency,
          startDate, endDate,
          code: message === "twelve_data_empty_window" ? "empty_window" :
            message === "twelve_data_auth_failed" ? "provider_auth_error" :
            /disabled|authorized/.test(message) ? "provider_not_configured" : "transport_error",
          error: message,
        });
        // A shared throttle/budget outage is not a reason to try every next symbol.
        if (/limited|unavailable|auth_failed/.test(message)) break;
      }
    }
    result.requestCount = result.usage.httpAttempts;
    if (options?.mode === "live") result.fetchedAt = new Date();
    return result;
  }

  return {
    name: "twelve_data", supportedMarkets: ["us"],
    async fetchCorporateActions(target, type, startDate, endDate, requestedAt, dryRun = false) {
      const usage = emptyUsage(), dataset = type === "split" ? "us_splits" : "us_dividends", endpoint = type === "split" ? "/splits" : "/dividends";
      try {
        authorize(dataset, requestedAt, dryRun);
        assertActionDateWindow(startDate, endDate, requestedAt);
        const listing = resolveTwelveDataListing(target, options!.listings);
        const parameters: Record<string, string> = { symbol: listing.symbol, mic_code: listing.micCode, exchange: listing.exchange, start_date: startDate, end_date: endDate,
          ...(type === "dividend" ? { adjust: "false" } : {}), format: "JSON" };
        const response = await request(endpoint, dataset, parameters, requestedAt, usage);
        return { coverage: parseTwelveDataActions(response, listing, type, startDate, endDate, parseContext(requestedAt)), usage };
      } catch (error) { return { coverage: null, error: safeError(error), usage }; }
    },
    async fetchLiveQuotes(targets, context): Promise<Metered<ProviderResult<LiveQuote>>> {
      const usage = emptyUsage();
      const rows: LiveQuote[] = [];
      for (const target of boundedTargets(targets)) {
        try {
          authorize("us_quote", context.requestedAt, context.dryRun);
          const listing = resolveTwelveDataListing(target, options!.listings);
          const payload = await request("/quote", "us_quote", {
            symbol: listing.symbol, mic_code: listing.micCode, exchange: listing.exchange,
            type: listing.type, prepost: "false", format: "JSON",
          }, context.requestedAt, usage);
          rows.push(parseTwelveDataQuote(payload, target, listing, parseContext(context.requestedAt)));
        } catch (error) {
          const message = safeError(error);
          rows.push({ ticker: target.ticker, market: target.market, currency: target.currency,
            price: null, priceAsOf: null, fetchedAt: context.requestedAt, source: "twelve_data",
            quoteType: "delayed", status: /disabled|authorized/.test(message) ? "skipped" : "error", error: message });
          if (/limited|unavailable|auth_failed/.test(message)) break;
        }
      }
      return { provider: "twelve_data", fetchedAt: options?.mode === "live" ? new Date() : context.requestedAt, rows, warnings: [], usage };
    },
    async fetchClosePrices(targets: PriceLookupTarget[], context: ProviderRequestContext): Promise<Metered<ProviderResult<ClosePrice>>> {
      const result = await daily(targets, context.priceDate, context.priceDate, context.requestedAt, context.dryRun);
      return { provider: result.provider, fetchedAt: result.fetchedAt, rows: result.rows,
        warnings: [...result.warnings, ...result.failures.map((failure) => failure.error)], usage: result.usage };
    },
    fetchHistoricalClosePrices(targets, context) {
      return daily(targets, context.startDate, context.endDate, context.requestedAt, context.dryRun);
    },
    async fetchUsdKrwRate(requestedAt, dryRun = false) {
      const usage = emptyUsage();
      try {
        authorize("usd_krw", requestedAt, dryRun);
        const payload = await request("/exchange_rate", "usd_krw", { symbol: "USD/KRW", timezone: "UTC", format: "JSON" }, requestedAt, usage);
        return { rate: parseTwelveDataFx(payload, parseContext(requestedAt)), usage };
      } catch (error) { return { rate: null, error: safeError(error), usage }; }
    },
    async fetchHistoricalUsdKrwRate(at, requestedAt, dryRun = false) {
      const usage = emptyUsage();
      try {
        authorize("usd_krw_history", requestedAt, dryRun);
        if (!Number.isFinite(at.getTime()) || at > requestedAt) throw new Error("twelve_data_fx_request_time_invalid");
        const payload = await request("/exchange_rate", "usd_krw_history", { symbol: "USD/KRW", date: at.toISOString().slice(0, 19), timezone: "UTC", format: "JSON", dp: "11" }, requestedAt, usage);
        return { rate: parseTwelveDataHistoricalFx(payload, at, parseContext(requestedAt)), usage };
      } catch (error) { return { rate: null, error: safeError(error), usage }; }
    },
  };
}

function emptyUsage(): Usage { return { httpAttempts: 0, reservedApiCredits: 0, fixtureRequests: 0 }; }
function boundedTargets(targets: readonly PriceLookupTarget[]) {
  if (targets.length > 100) throw new Error("twelve_data_target_limit");
  const unique = new Map<string, PriceLookupTarget>();
  for (const target of targets) unique.set(`${target.key}:${target.market}:${target.currency}:${target.ticker}`, target);
  return [...unique.values()];
}
function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /^twelve_data_[a-z_]+$/.test(message) ? message : "twelve_data_transport_failed";
}
