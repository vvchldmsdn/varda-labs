import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

const [adapter, contract] = await importWithPorts([
  "src/lib/market-data/providers/twelve-data.ts",
  "src/lib/market-data/providers/twelve-data-contract.ts",
], {});
const now = new Date("2026-09-14T12:00:00Z");
const target = { key: "us:USD:AAPL", ticker: "AAPL", market: "us", currency: "USD", accounts: [], assetIds: [], assetNames: [] };
const listing = { instrumentKey: target.key, ticker: "AAPL", symbol: "AAPL", micCode: "XNAS", exchange: "NASDAQ", type: "Common Stock", currency: "USD", exchangeTimezone: "America/New_York" };
const context = { fetchedAt: now, synthetic: true, licenseScope: "synthetic_fixture_only", quoteDelay: "delayed", maximumAgeMs: 900_000 };
const requestContext = { requestedAt: now, dryRun: false, fixture: true, mode: "live", priceDate: "2026-09-11" };
const identity = { symbol: "AAPL", mic_code: "XNAS", exchange: "NASDAQ", currency: "USD" };
const quote = { ...identity, close: "100.123456789012", timestamp: now.getTime() / 1000 - 3600, last_quote_at: now.getTime() / 1000 - 20, extended_price: "999.00", extended_timestamp: now.getTime() / 1000 };
const history = { meta: { ...identity, type: "Common Stock", interval: "1day", exchange_timezone: "America/New_York" }, values: [{ datetime: "2026-09-11", close: "100.123456789012" }, { datetime: "2026-09-10", close: "101.00" }], status: "ok" };

function fixture(payload = quote) {
  const calls = [];
  const provider = adapter.createTwelveDataMarketDataProvider({ mode: "fixture", listings: [listing], fixtureTransport: async (request) => {
    calls.push(request); return typeof payload === "function" ? payload(request) : structuredClone(payload);
  } });
  return { provider, calls };
}

describe("Twelve Data contract: synthetic responses, no network or DB", () => {
  it("accepts bounded same-day action responses, canonicalizes duplicates and rejects partial or contradictory coverage", async () => {
    const meta = { ...identity, exchange_timezone: "America/New_York" };
    const split = { date: "2026-09-14", from_factor: "2", to_factor: "1" };
    const parsed = contract.parseTwelveDataActions({ meta, splits: [split, { ...split, from_factor: "2.00", to_factor: "1.0" }] }, listing, "split", "2026-09-14", "2026-09-14", context);
    assert.equal(parsed.events.length, 1); assert.equal(parsed.events[0].fromFactor, "2"); assert.equal(parsed.events[0].toFactor, "1");
    assert.throws(() => contract.parseTwelveDataActions({ meta, splits: [split, { ...split, from_factor: "3" }] }, listing, "split", "2026-09-14", "2026-09-14", context), /action_date_invalid/);
    assert.throws(() => contract.parseTwelveDataActions({ meta, status: "partial", splits: [] }, listing, "split", "2026-09-14", "2026-09-14", context), /partial_response/);
    assert.throws(() => contract.parseTwelveDataActions({ meta }, listing, "split", "2026-09-14", "2026-09-14", context), /action_values_invalid/);
    assert.throws(() => contract.parseTwelveDataActions({ meta, splits: [] }, listing, "split", "2026-09-15", "2026-09-15", context), /action_window_invalid/);
    const f = fixture({ meta, splits: [split] });
    assert.equal((await f.provider.fetchCorporateActions(target, "split", "2026-09-14", "2026-09-14", now)).coverage.events.length, 1);
    assert.deepEqual(f.calls.map(call => call.endpoint), ["/splits"]);
  });
  it("defaults to disabled and URL/fixture flags cannot authorize a real adapter", async () => {
    const provider = adapter.createTwelveDataMarketDataProvider();
    const result = await provider.fetchLiveQuotes([target], { ...requestContext, preview: "design", provider: "twelve_data", license: true });
    assert.equal(result.rows[0].status, "skipped");
    assert.equal(result.rows[0].price, null);
    assert.deepEqual(result.usage, { httpAttempts: 0, reservedApiCredits: 0, fixtureRequests: 0 });
    assert.equal((await provider.fetchUsdKrwRate(now)).error, "twelve_data_disabled");
  });

  it("an API key alone, missing release, or an expired license never reaches reservation", async () => {
    let reservations = 0;
    const config = { mode: "live", apiKey: "synthetic_not_a_real_key", listings: [listing], audience: "member_display",
      license: { status: "confirmed", reference: "fixture_license", cacheScope: "fixture_members", expiresAt: new Date("2099-01-01"), datasets: ["us_quote"], audiences: ["member_display"], quoteDelay: "delayed" },
      release: { approved: true, reference: "fixture_release" }, reserve: async () => { reservations += 1; return false; } };
    for (const options of [{ mode: "live", apiKey: "synthetic_not_a_real_key" }, { ...config, release: null },
      { ...config, license: { ...config.license, expiresAt: new Date("2000-01-01") } },
      { ...config, audience: "public_demo" }, { ...config, audience: "unknown", license: { ...config.license, audiences: ["unknown"] } },
      { ...config, license: { ...config.license, datasets: [] } }]) {
      const result = await adapter.createTwelveDataMarketDataProvider(options).fetchLiveQuotes([target], requestContext);
      assert.equal(result.rows[0].status, "skipped");
    }
    assert.equal(reservations, 0);
    const denied = await adapter.createTwelveDataMarketDataProvider(config).fetchLiveQuotes([target], requestContext);
    assert.equal(reservations, 1);
    assert.equal(denied.rows[0].error, "twelve_data_budget_limited");
    assert.equal(denied.usage.httpAttempts, 0);
    const malformedAdmission = await adapter.createTwelveDataMarketDataProvider({ ...config, reserve: async () => "approved" }).fetchLiveQuotes([target], requestContext);
    assert.equal(malformedAdmission.rows[0].error, "twelve_data_budget_limited");
    assert.equal(malformedAdmission.usage.httpAttempts, 0);
  });

  it("keeps fixture transport out of live options and no environment keys are auto-read", () => {
    const source = readFileSync(new URL("../src/lib/market-data/providers/twelve-data.ts", import.meta.url), "utf8");
    assert.ok(source.startsWith('import "server-only"'));
    assert.doesNotMatch(source, /process\.env|NEXT_PUBLIC_|searchParams\.get/);
    const transportSource = readFileSync("src/lib/market-data/providers/twelve-data-http.ts", "utf8");
    assert.match(transportSource, /redirect: "error"/);
    assert.match(transportSource, /cache: "no-store"/);
  });

  it("selects last_quote_at rather than candle-open or collected time", () => {
    const row = contract.parseTwelveDataQuote(quote, target, listing, context);
    assert.equal(row.price, quote.close);
    assert.equal(row.priceAsOf.getTime(), quote.last_quote_at * 1000);
    assert.equal(row.provenance.session, "regular");
    assert.equal(row.provenance.synthetic, true);
    assert.equal(row.source, "twelve_data_fixture");
    assert.equal(row.provenance.freshness, "fresh");
  });

  it("does not replace missing, future, or stale quote evidence", () => {
    for (const last_quote_at of [undefined, null, "123", now.getTime() / 1000 + 1]) {
      assert.throws(() => contract.parseTwelveDataQuote({ ...quote, last_quote_at }, target, listing, context), /timestamp_invalid/);
    }
    const stale = contract.parseTwelveDataQuote({ ...quote, last_quote_at: now.getTime() / 1000 - 7200 }, target, listing, context);
    assert.equal(stale.provenance.freshness, "stale");
    assert.equal(stale.price, quote.close);
  });

  it("rejects same ticker on a different exchange or currency", () => {
    for (const replacement of [{ mic_code: "XNYS" }, { currency: "KRW" }, { symbol: "MSFT" }, { exchange: "NYSE" }]) {
      assert.throws(() => contract.parseTwelveDataQuote({ ...quote, ...replacement }, target, listing, context), /listing_response_mismatch/);
    }
    assert.throws(() => contract.resolveTwelveDataListing(target, []), /unresolved/);
    assert.throws(() => contract.resolveTwelveDataListing(target, [listing, listing]), /unresolved/);
    assert.throws(() => contract.resolveTwelveDataListing({ ...target, market: "korea" }, [listing]), /unsupported/);
  });

  it("uses reviewed listing parameters and coalesces duplicate targets", async () => {
    const { provider, calls } = fixture();
    const result = await provider.fetchLiveQuotes([target, { ...target, accounts: ["private_account"] }], requestContext);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].endpoint, "/quote");
    assert.equal(calls[0].parameters.mic_code, "XNAS");
    assert.equal(calls[0].parameters.prepost, "false");
    assert.doesNotMatch(JSON.stringify(calls), /apikey|private_account/);
    assert.equal(result.usage.fixtureRequests, 1);
    assert.equal(result.usage.httpAttempts, 0);
    assert.equal(result.usage.reservedApiCredits, 0);
  });

  it("dry-run does not invoke even fixture transport", async () => {
    const { provider, calls } = fixture();
    await provider.fetchLiveQuotes([target], { ...requestContext, dryRun: true });
    await provider.fetchUsdKrwRate(now, true);
    assert.equal(calls.length, 0);
  });

  it("requests raw daily prices explicitly and does not invent adjusted or FX columns", async () => {
    const { provider, calls } = fixture(history);
    const result = await provider.fetchHistoricalClosePrices([target], { requestedAt: now, dryRun: false, startDate: "2026-09-10", endDate: "2026-09-11" });
    assert.equal(calls[0].parameters.adjust, "none");
    assert.equal(calls[0].parameters.interval, "1day");
    assert.equal(result.rows.length, 2);
    assert.deepEqual(result.rows.map((row) => row.priceDate), ["2026-09-10", "2026-09-11"]);
    assert.equal(result.rows[0].adjustedClosePrice, null);
    assert.equal(result.rows[0].adjustedCloseBasis, null);
    assert.equal(result.rows[0].closePriceKrw, null);
    assert.equal(result.rows[0].fxRate, null);
    assert.equal(result.rows[0].provenance.observedAt, null);
    assert.equal(result.rows[0].provenance.exchangeDate, "2026-09-10");
    assert.equal(result.rows[0].isSample, true);
    assert.equal(result.requestCount, 0);
  });

  it("rejects invalid metadata, duplicate dates, out-of-range dates and present-day partial bars", () => {
    const parse = (payload, endDate = "2026-09-11") => contract.parseTwelveDataDaily(payload, target, listing, "2026-09-10", endDate, context);
    assert.throws(() => parse({ ...history, meta: { ...history.meta, interval: "1week" } }), /metadata_mismatch/);
    assert.throws(() => parse({ ...history, meta: { ...history.meta, type: "ETF" } }), /metadata_mismatch/);
    assert.throws(() => parse({ ...history, values: [history.values[0], history.values[0]] }), /date_invalid/);
    assert.throws(() => parse({ ...history, values: [{ datetime: "2026-09-15", close: "100" }] }), /date_invalid/);
    assert.throws(() => parse(history, "2026-09-14"), /window_invalid/);
    assert.throws(() => contract.assertDateWindow("2024-01-01", "2026-01-01", now), /window_invalid/);
  });

  it("uses exchange-local dates across DST without inventing close instants", () => {
    contract.assertDateWindow("2026-03-06", "2026-03-06", new Date("2026-03-09T00:00:00Z"));
    assert.throws(() => contract.assertDateWindow("2026-03-08", "2026-03-08", new Date("2026-03-09T00:00:00Z")), /window_invalid/);
  });

  it("keeps split discontinuities raw rather than synthesizing an adjusted series", () => {
    const rows = contract.parseTwelveDataDaily({ ...history, values: [{ datetime: "2026-09-10", close: "400" }, { datetime: "2026-09-11", close: "100" }] }, target, listing, "2026-09-10", "2026-09-11", context);
    assert.equal(rows[0].closePrice, "400");
    assert.equal(rows[1].closePrice, "100");
    assert.ok(rows.every((row) => row.adjustedCloseBasis === null));
  });

  it("validates FX direction, observation and decimal value without defaulting to one", async () => {
    const { provider, calls } = fixture({ symbol: "USD/KRW", rate: 1400.125, timestamp: now.getTime() / 1000 - 10 });
    const result = await provider.fetchUsdKrwRate(now);
    assert.equal(calls[0].endpoint, "/exchange_rate");
    assert.equal(result.rate.baseCurrency, "USD");
    assert.equal(result.rate.quoteCurrency, "KRW");
    assert.equal(result.rate.rate, "1400.125");
    for (const payload of [{ symbol: "KRW/USD", rate: 0.001, timestamp: 1 }, { symbol: "USD/KRW", rate: 0, timestamp: 1 }, { symbol: "USD/KRW", rate: 1400 }]) {
      assert.throws(() => contract.parseTwelveDataFx(payload, context), /twelve_data_/);
    }
  });

  it("counts HTTP and credits independently, including another attempt", () => {
    assert.deepEqual(contract.estimateTwelveDataCost("/time_series", 3, true), { httpRequests: 1, apiCredits: 3 });
    assert.deepEqual(contract.estimateTwelveDataCost("/quote", 3), { httpRequests: 3, apiCredits: 3 });
    assert.equal(contract.estimateTwelveDataCost("/quote", 3, true).apiCredits * 2, 6);
    assert.deepEqual(contract.estimateTwelveDataCost("/splits", 3), { httpRequests: 3, apiCredits: 60 });
  });

  it("stops after provider throttling and never returns provider error text", async () => {
    const { provider, calls } = fixture({ status: "error", code: 429, message: "sensitive_key=should_never_escape" });
    const second = { ...target, key: "us:USD:MSFT", ticker: "MSFT" };
    const result = await provider.fetchLiveQuotes([target, second], requestContext);
    assert.equal(calls.length, 1);
    assert.equal(result.rows[0].error, "twelve_data_rate_limited");
    assert.doesNotMatch(JSON.stringify(result), /sensitive_key|should_never_escape/);
  });

  it("bounds targets and sanitizes fixture transport failures", async () => {
    const { provider } = fixture(() => { throw new Error("https://api.twelvedata.com/quote?apikey=secret"); });
    assert.equal((await provider.fetchLiveQuotes([target], requestContext)).rows[0].error, "twelve_data_transport_failed");
    await assert.rejects(provider.fetchLiveQuotes(Array(101).fill(target), requestContext), /target_limit/);
  });
});
