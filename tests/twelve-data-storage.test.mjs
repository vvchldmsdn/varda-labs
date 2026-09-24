import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

const listing = { instrumentKey: "us:ARCX:VOO", ticker: "VOO", symbol: "VOO", micCode: "ARCX", exchange: "NYSE", type: "ETF", currency: "USD", exchangeTimezone: "America/New_York" };
const target = { key: listing.instrumentKey, ticker: "VOO", market: "us", currency: "USD", accounts: [], assetIds: [], assetNames: [] };
const asOf = () => new Date().toISOString();
const query = kind => ({ kind, target, asOf: asOf(), ...(kind === "history" ? { startDate: "2026-08-10", endDate: "2026-08-12" } : {}) });
let pg;
async function fixture() {
  pg ??= new PGlite();
  await pg.exec("drop schema public cascade; create schema public; DO $$ BEGIN CREATE ROLE varda_tenant_app; EXCEPTION WHEN duplicate_object THEN NULL; END $$;" +
    ["0043_powerful_living_tribunal.sql", "0049_twelve_data_collection.sql", "0051_market_provider_observations.sql"].map(file => readFileSync(`drizzle/${file}`, "utf8")).join("\n"));
  const state = { queries: 0, calls: [], scheduled: [], price: "500.123456789123456789", actions: false, error: false, timestamp: Math.floor(Date.now() / 1000) - 10 };
  const sqlClient = {
    query: async (sql, parameters = []) => { state.queries++; return (await pg.query(sql, parameters)).rows; },
    async transaction(build) { const commands = build({ query: (sql, parameters = []) => ({ sql, parameters }) });
      return pg.transaction(async tx => { const rows = []; for (const command of commands) { state.queries++; try { rows.push((await tx.query(command.sql, command.parameters)).rows); } catch (error) { state.sqlError = error.message; throw error; } } return rows; }); },
  };
  // Only SQL transport is bound to isolated PostgreSQL and vendor HTTP is replaced.
  // Queue, adapter parsing, budget, provenance writer, queries, service and persistence are unchanged code.
  const http = async (endpoint, parameters) => {
    state.calls.push({ endpoint, parameters });
    if (state.error) throw new Error("twelve_data_transport_failed");
    const meta = { symbol: "VOO", currency: "USD", exchange: "NYSE", mic_code: "ARCX", exchange_timezone: "America/New_York", type: "ETF", interval: "1day" };
    if (endpoint === "/quote") return { ...meta, close: state.price, last_quote_at: state.timestamp };
    if (endpoint === "/exchange_rate") return { symbol: state.fxSymbol ?? "USD/KRW", rate: "1398.000000000000000001", timestamp: parameters.date ? Math.floor(Date.parse(`${parameters.date}Z`) / 1000) + (state.fxOffsetSeconds ?? 0) : state.timestamp };
    if (endpoint === "/time_series") return { meta, values: [{ datetime: "2026-08-10", close: "100.01" }, { datetime: "2026-08-11", close: "101.05" }, { datetime: "2026-08-12", close: "102.34" }] };
    if (endpoint === "/splits") return { meta, splits: state.actions ? [{ date: "2026-08-11", ratio: 0.25, from_factor: 4, to_factor: 1 }] : [] };
    if (endpoint === "/dividends") return { meta, dividends: state.actions ? [{ ex_date: "2026-08-12", amount: "0.55" }] : [] };
    throw new Error("unexpected_transport");
  };
  const [service, store, queue, collector, adapter, configuration] = await importWithPorts([
    "src/lib/market-data/twelve-data-service.ts", "src/lib/market-data/twelve-data-store.ts", "src/lib/market-data/collection-queue.ts",
    "src/lib/market-data/twelve-data-collection.ts", "src/lib/market-data/providers/twelve-data.ts", "src/lib/market-data/twelve-data-config.ts",
  ], { "@/db/client": { sqlClient }, "./twelve-data-http": { fetchTwelveDataPayload: http }, "next/server": { after: callback => state.scheduled.push(callback) } });
  const config = { provider: { mode: "live", apiKey: "isolated-test-credential", listings: [listing], audience: "internal_validation",
    license: { status: "confirmed", reference: "isolated-test-license", cacheScope: "isolated-test-scope", expiresAt: new Date(Date.now() + 86_400_000),
      datasets: ["us_quote", "us_daily_raw", "usd_krw", "us_splits", "us_dividends"], audiences: ["internal_validation"], quoteDelay: "delayed" },
    release: { approved: true, reference: "isolated-test-release" } }, budget: { httpRequestsPerMinute: 100, apiCreditsPerMinute: 200, minimumIntervalMs: 0 },
    storage: { retentionSeconds: 86400, quoteFreshSeconds: 600, fxFreshSeconds: 600, historyFreshSeconds: 3600 } };
  return { pg, service, store, queue, collector, adapter, configuration, config, state };
}
after(async () => { await pg?.close(); });
describe("Twelve Data actual SQL persistence and demand pipeline", () => {
  it("is disabled without server configuration and validates private config without database reads", async () => {
    const { service, configuration, state, config } = await fixture();
    assert.equal((await service.readTwelveDataEvidence(query("live"))).status, "disabled");
    assert.equal((await service.requestTwelveDataEvidence(query("live"))).queuedCount, 0);
    assert.equal((await service.drainTwelveDataService()).status, "disabled");
    for (const env of [{}, { CAIRN_TWELVE_DATA_ENABLED: "true" }, { CAIRN_TWELVE_DATA_ENABLED: "true", TWELVE_DATA_API_KEY: "test", CAIRN_TWELVE_DATA_SERVER_CONFIG: "bad" }]) assert.equal(configuration.getTwelveDataServerConfig(env), undefined);
    const env = { CAIRN_TWELVE_DATA_ENABLED: "true", TWELVE_DATA_API_KEY: "test", CAIRN_TWELVE_DATA_SERVER_CONFIG: JSON.stringify(config) };
    assert.equal(configuration.getTwelveDataServerConfig(env).provider.mode, "live");
    assert.equal(state.queries, 0); assert.equal(state.calls.length, 0); assert.equal(state.scheduled.length, 0);
  });
  it("demands once, persists exact decimal quote provenance and reuses admitted SQL cache", async () => {
    const { service, state, config, pg } = await fixture();
    await Promise.all([service.requestTwelveDataEvidence(query("live"), config), service.requestTwelveDataEvidence(query("live"), config)]);
    assert.equal(state.calls.length, 0);
    assert.ok(state.scheduled.length > 0);
    await state.scheduled[0]();
    assert.equal(state.calls.length, 1);
    const result = await service.readTwelveDataEvidence(query("live"), config);
    assert.equal(result.status, "admitted"); assert.equal(result.prices[0].value, state.price); assert.equal(result.prices[0].basis, "raw");
    assert.equal(result.prices[0].observedAt, new Date(state.timestamp * 1000).toISOString());
    assert.equal((await service.requestTwelveDataEvidence(query("live"), config)).queuedCount, 0);
    assert.equal(state.calls.length, 1);
    const row = (await pg.query("select source,synthetic,price_basis,adjustment,count(*) over() as n from market_provider_observations")).rows[0];
    assert.equal(Number(row.n), 1); assert.equal(row.source, "twelve_data"); assert.equal(row.synthetic, false); assert.equal(row.adjustment, "not_applicable");
  });
  it("fetches raw history and both corporate-action endpoints with 3 HTTP and 41 credits", async () => {
    const { service, config, state, pg } = await fixture();
    await service.requestTwelveDataEvidence(query("history"), config);
    const drained = await service.drainTwelveDataService(config);
    assert.equal(drained.failed, 0, JSON.stringify({ calls: state.calls, sqlError: state.sqlError, jobs: (await pg.query("select kind,start_date,end_date,last_code from market_collection_jobs")).rows }));
    const result = await service.readTwelveDataEvidence(query("history"), config);
    assert.equal(result.prices.length, 3); assert.equal(result.corporateActionCoverage, "complete"); assert.equal(result.analysisEligible, true);
    assert.ok(result.prices.every(row => row.observedAt === null && row.exchangeDate && row.basis === "raw"));
    assert.deepEqual(state.calls.map(call => call.endpoint), ["/time_series", "/splits", "/dividends"]);
    assert.equal(state.calls[0].parameters.adjust, "none"); assert.equal(state.calls[2].parameters.adjust, "false"); assert.equal(state.calls[2].parameters.range, undefined);
    const row = (await pg.query("select request_count,credit_count from market_provider_budgets")).rows[0];
    assert.equal(row.request_count, 3); assert.equal(Number(row.credit_count), 41);
  });
  it("returns exact provider split factors and cash dividends and blocks unadjusted research", async () => {
    const { service, config, state } = await fixture(); state.actions = true;
    await service.requestTwelveDataEvidence(query("history"), config); await service.drainTwelveDataService(config);
    const result = await service.readTwelveDataEvidence(query("history"), config);
    assert.equal(result.corporateActions.length, 2); assert.equal(Number(result.corporateActions[0].fromFactor), 4); assert.equal(Number(result.corporateActions[0].toFactor), 1);
    assert.equal(Number(result.corporateActions[1].cashAmount), 0.55); assert.equal(result.analysisEligible, false); assert.equal(result.analysisReason, "corporate_action_adjustment_required");
  });
  it("does not equate missing corporate-action rights with no events", async () => {
    const { service, config, state } = await fixture(); config.provider.license.datasets = ["us_daily_raw"];
    await service.requestTwelveDataEvidence(query("history"), config); await service.drainTwelveDataService(config);
    const result = await service.readTwelveDataEvidence(query("history"), config);
    assert.equal(result.prices.length, 3); assert.equal(result.corporateActionCoverage, "unknown"); assert.equal(result.analysisEligible, false); assert.equal(state.calls.length, 1);
  });
  it("scopes known split risk by reviewed listing, license and knowledge and rejects null action facts in SQL", async () => {
    const { service, config, state, pg } = await fixture(); state.actions = true;
    await service.requestTwelveDataEvidence(query("history"), config); await service.drainTwelveDataService(config);
    const request = { target, startDate: "2026-08-10", endDate: "2026-08-12", asOf: asOf() };
    const risk = await service.readTwelveDataSplitRisk(request, config);
    assert.equal(risk.status, "admitted"); assert.equal(risk.actions.length, 1); assert.equal(risk.actions[0].type, "split");
    assert.equal((await service.readTwelveDataSplitRisk({ ...request, asOf: "2026-08-13T00:00:00Z" }, config)).status, "unknown");
    const scoped = { ...config, provider: { ...config.provider, license: { ...config.provider.license, cacheScope: "other-confirmed-scope" } } };
    assert.equal((await service.readTwelveDataSplitRisk(request, scoped)).actions.length, 0);
    await assert.rejects(service.readTwelveDataSplitRisk({ ...request, target: { ...target, key: "us:XNAS:VOO" } }, config), /listing_unresolved/);
    await assert.rejects(pg.exec("update market_provider_corporate_actions set from_factor=null where action_type='split'"), /values_check/);
    await assert.rejects(pg.exec("update market_provider_corporate_actions set cash_amount=null where action_type='dividend'"), /values_check/);
    await pg.exec("update market_provider_action_coverage set status='conflict' where action_type='split'");
    assert.equal((await service.readTwelveDataSplitRisk(request, config)).status, "conflict");
  });
  it("collects missing split coverage even when raw prices are already fresh and dividend rights are absent", async () => {
    const { service, config, state, pg } = await fixture(); config.provider.license.datasets = ["us_daily_raw"];
    await service.requestTwelveDataEvidence(query("history"), config); await service.drainTwelveDataService(config);
    config.provider.license.datasets.push("us_splits");
    const request = { target, startDate: "2026-08-10", endDate: "2026-08-12", asOf: asOf() };
    assert.equal((await service.readTwelveDataSplitRisk(request, config)).status, "unknown");
    await pg.exec("update market_collection_jobs set completed_at=now()-interval '6 minutes'");
    await service.requestTwelveDataSplitRisk(request, config);
    assert.equal((await service.drainTwelveDataService(config)).failed, 0);
    assert.equal((await service.readTwelveDataSplitRisk({ ...request, asOf: asOf() }, config)).status, "admitted");
    assert.deepEqual(state.calls.map(call => call.endpoint), ["/time_series", "/time_series", "/splits"]);
    assert.equal((await service.readTwelveDataEvidence(query("history"), config)).corporateActionCoverage, "unknown", "missing dividend rights still block return-history admission");
  });
  it("stores dated FX observations and does not backfill observations into an earlier instant", async () => {
    const { service, config, state } = await fixture();
    await service.requestTwelveDataEvidence(query("fx"), config); await service.drainTwelveDataService(config);
    const result = await service.readTwelveDataEvidence(query("fx"), config);
    assert.equal(result.fx[0].rate, "1398.000000000000000001"); assert.equal(result.fx[0].kind, "spot");
    assert.equal((await service.readTwelveDataEvidence({ kind: "fx", asOf: new Date(state.timestamp * 1000 - 1).toISOString() }, config)).status, "missing");
  });
  it("quarantines same-observation price conflicts without overwriting the first value", async () => {
    const { service, config, state, pg } = await fixture();
    await service.requestTwelveDataEvidence(query("live"), config); await service.drainTwelveDataService(config);
    const original = state.price; state.price = "501.01";
    await pg.exec("update market_provider_observations set fetched_at=fetched_at-interval '20 minutes',last_fetched_at=last_fetched_at-interval '20 minutes',observed_at=observed_at-interval '20 minutes'; update market_collection_jobs set completed_at=now()-interval '20 minutes'");
    // Restore only the original observation time, so a new price targets the same natural key.
    await pg.query("update market_provider_observations set observed_at=$1::timestamptz,fetched_at=$1::timestamptz,last_fetched_at=$1::timestamptz", [new Date(state.timestamp * 1000).toISOString()]);
    config.storage.quoteFreshSeconds = 1;
    await service.requestTwelveDataEvidence(query("live"), config); assert.equal((await service.drainTwelveDataService(config)).failed, 1);
    assert.equal((await service.readTwelveDataEvidence(query("live"), config)).status, "conflict");
    assert.equal((await pg.query("select value from market_provider_observations")).rows[0].value, original);
  });
  it("checks rights, knowledge time, exact listing and retention again when reading", async () => {
    const { service, config, pg } = await fixture();
    await service.requestTwelveDataEvidence(query("live"), config); await service.drainTwelveDataService(config);
    assert.equal((await service.readTwelveDataEvidence({ ...query("live"), knownAt: "2026-01-01T00:00:00Z" }, config)).status, "missing");
    await assert.rejects(service.readTwelveDataEvidence({ ...query("live"), target: { ...target, key: "us:XNAS:VOO" } }, config), /listing_unresolved/);
    assert.equal((await service.readTwelveDataEvidence(query("live"), { ...config, provider: { ...config.provider, audience: "member_display" } })).status, "disabled");
    await pg.exec("update market_provider_observations set observed_at=observed_at-interval '2 days',fetched_at=fetched_at-interval '2 days',last_fetched_at=last_fetched_at-interval '2 days',expires_at=now()-interval '1 day'");
    assert.equal((await service.readTwelveDataEvidence(query("live"), config)).status, "missing");
    config.provider.license.expiresAt = new Date(0);
    assert.equal((await service.readTwelveDataEvidence(query("live"), config)).status, "disabled");
  });
  it("rejects synthetic provenance and stale claim persistence even when called directly", async () => {
    const { service, collector, store, queue, config, adapter, state, pg } = await fixture();
    await service.requestTwelveDataEvidence(query("live"), config);
    const worker = { ...config, isFresh: async () => false, persist: async () => "written" };
    const [job] = collector.getTwelveDataCollectionJobs([{ kind: "live", target }], worker);
    const partition = { provider: "twelve_data", scopeHash: job.key.split(":")[1] };
    const claim = await queue.claimMarketCollection(partition);
    const provider = adapter.createTwelveDataMarketDataProvider({ ...config.provider, reserve: async () => true });
    const quote = await provider.fetchLiveQuotes([target], { requestedAt: new Date(), dryRun: false });
    const payload = { dataset: "us_quote", target, listing, rows: quote.rows };
    assert.equal(await store.persistTwelveDataEvidence({ ...claim, claimToken: randomUUID() }, payload, config), "stale_claim");
    assert.equal((await pg.query("select count(*)::integer as n from market_provider_observations")).rows[0].n, 0);
    payload.rows[0].provenance.synthetic = true;
    await assert.rejects(store.persistTwelveDataEvidence(claim, payload, config), /provenance_invalid/);
    assert.equal(state.calls.length, 1);
  });
  it("keeps provider data tables unavailable to tenant SQL and retains forced RLS", async () => {
    const { pg } = await fixture();
    for (const table of ["market_provider_observations", "market_provider_action_coverage", "market_provider_corporate_actions"]) {
      const row = (await pg.query("select relrowsecurity,relforcerowsecurity,has_table_privilege('varda_tenant_app',oid,'SELECT') as allowed from pg_class where relname=$1", [table])).rows[0];
      assert.deepEqual(row, { relrowsecurity: true, relforcerowsecurity: true, allowed: false });
    }
  });

  it("resolves the reviewed listing from the owned tuple and isolates unavailable instruments", async () => {
    const { service, config, state } = await fixture();
    assert.deepEqual(service.resolveTwelveDataTarget({ ticker: "VOO", market: "us", currency: "USD" }), { status: "disabled" });
    const found = service.resolveTwelveDataTarget({ ticker: " voo ", market: "US", currency: "USD", key: "untrusted:key" }, config);
    assert.equal(found.status, "resolved"); assert.equal(found.target.key, "us:ARCX:VOO");
    assert.deepEqual(service.resolveTwelveDataTarget({ ticker: "MISSING", market: "us", currency: "USD" }, config), { status: "unsupported" });
    assert.deepEqual(service.resolveTwelveDataTarget({ ticker: "VOO", market: "korea", currency: "KRW" }, config), { status: "unsupported" });
    assert.deepEqual(service.resolveTwelveDataTarget({ ticker: "VOO", market: "us", currency: "USD" }, { ...config, provider: { ...config.provider, listings: [listing, { ...listing, instrumentKey: "other:listing" }] } }), { status: "ambiguous" });
    assert.equal(state.queries, 0); assert.equal(state.calls.length, 0);
    await service.requestTwelveDataEvidence({ ...query("live"), target: found.target }, config);
    assert.equal((await service.drainTwelveDataService(config)).failed, 0);
  });

  it("uses New York completed dates at the UTC date boundary in summer and winter", async () => {
    const { service } = await fixture();
    assert.equal(service.getTwelveDataCompletedHistoryWindow("2026-09-14T01:00:00Z").endDate, "2026-09-12");
    assert.equal(service.getTwelveDataCompletedHistoryWindow("2026-01-14T04:00:00Z").endDate, "2026-01-12");
    assert.equal(service.getTwelveDataCompletedHistoryWindow("2026-01-14T05:00:00Z").endDate, "2026-01-13");
  });

  it("requires separate historical FX rights before any SQL or HTTP activity", async () => {
    const { service, config, state } = await fixture();
    const result = await service.requestTwelveDataHistoricalFx({ requestedAt: ["2026-08-12T22:00:00Z"], asOf: asOf() }, config);
    assert.equal(result.status, "disabled"); assert.equal(result.queuedCount, 0);
    assert.equal(state.queries, 0); assert.equal(state.calls.length, 0);
  });

  it("persists actual historical FX request and observation times and reuses exact cache across callers", async () => {
    const { service, config, state, pg } = await fixture(); config.provider.license.datasets.push("usd_krw_history"); state.fxOffsetSeconds = -300;
    const historical = { requestedAt: ["2026-08-12T22:00:00.000Z", "2026-08-13T22:00:00.000Z"], asOf: asOf() };
    await Promise.all([service.requestTwelveDataHistoricalFx(historical, config), service.requestTwelveDataHistoricalFx(historical, config)]);
    assert.equal(state.calls.length, 0);
    assert.equal((await service.resumeConfiguredTwelveDataService(config)).processed, 2);
    const result = await service.readTwelveDataHistoricalFx(historical, config);
    assert.equal(result.status, "admitted"); assert.equal(result.fx.length, 2);
    assert.equal(result.fx[0].kind, "historical_spot"); assert.equal(result.fx[0].observedAt, "2026-08-12T21:55:00.000Z");
    assert.equal(result.fx[0].requestedAt, historical.requestedAt[0]); assert.ok(result.fx[0].fetchedAt > historical.requestedAt[0]);
    assert.equal((await service.requestTwelveDataHistoricalFx(historical, config)).queuedCount, 0);
    assert.equal(state.calls.length, 2); assert.ok(state.calls.every(call => call.parameters.timezone === "UTC" && call.parameters.date));
    const [budget] = (await pg.query("select request_count,credit_count from market_provider_budgets")).rows;
    assert.equal(Number(budget.request_count), 2); assert.equal(Number(budget.credit_count), 2);
    const earlierKnowledge = await service.readTwelveDataHistoricalFx({ ...historical, knownAt: "2026-08-14T00:00:00Z" }, config);
    assert.equal(earlierKnowledge.status, "missing"); assert.equal(earlierKnowledge.fx.length, 0);
    const wrongScope = { ...config, provider: { ...config.provider, license: { ...config.provider.license, cacheScope: "other-confirmed-scope" } } };
    assert.equal((await service.readTwelveDataHistoricalFx(historical, wrongScope)).fx.length, 0);
  });

  it("rejects wrong FX direction and future historical observations before SQL persistence", async () => {
    for (const changes of [{ fxSymbol: "KRW/USD" }, { fxOffsetSeconds: 1 }]) {
      const { service, config, state, pg } = await fixture(); config.provider.license.datasets.push("usd_krw_history"); Object.assign(state, changes);
      await service.requestTwelveDataHistoricalFx({ requestedAt: ["2026-08-12T22:00:00Z"], asOf: asOf() }, config);
      assert.equal((await service.drainTwelveDataService(config)).failed, 1);
      assert.equal((await pg.query("select count(*)::int as count from market_provider_observations")).rows[0].count, 0);
    }
  });

  it("resumes a deferred and interrupted historical FX job with fresh reservations", async () => {
    const { service, config, state, pg, collector, queue } = await fixture(); config.provider.license.datasets.push("usd_krw_history");
    const requestedAt = "2026-08-12T22:00:00.000Z", historical = { requestedAt: [requestedAt], asOf: asOf() };
    await service.requestTwelveDataHistoricalFx(historical, config);
    const worker = { ...config, isFresh: async () => false, persist: async () => "written" };
    const [job] = collector.getTwelveDataCollectionJobs([{ kind: "fx", requestedAt }], worker);
    const claim = await queue.claimMarketCollection({ provider: "twelve_data", scopeHash: job.key.split(":")[1] });
    assert.ok(claim);
    await pg.exec("update market_collection_jobs set leased_until=now()-interval '1 second'");
    state.error = true;
    assert.equal((await service.resumeConfiguredTwelveDataService(config)).failed, 1);
    assert.equal(state.calls.length, 1);
    assert.equal((await service.resumeConfiguredTwelveDataService(config)).status, "idle");
    state.error = false;
    await pg.exec("update market_collection_jobs set available_at=now()-interval '1 second'; update market_provider_budgets set blocked_until=now()-interval '1 second',next_allowed_at=now()-interval '1 second'");
    assert.equal((await service.resumeConfiguredTwelveDataService(config)).failed, 0);
    assert.equal((await service.readTwelveDataHistoricalFx(historical, config)).status, "admitted");
    const [budget] = (await pg.query("select request_count,credit_count from market_provider_budgets")).rows;
    assert.equal(Number(budget.request_count), 2); assert.equal(Number(budget.credit_count), 2);
  });

  it("rejects a different source or listing at the real fenced SQL writer", async () => {
    const { service, config, pg, collector, queue, adapter, store } = await fixture();
    await service.requestTwelveDataEvidence(query("live"), config);
    const [job] = collector.getTwelveDataCollectionJobs([{ kind: "live", target }], { ...config, isFresh: async () => false, persist: async () => "written" });
    const claim = await queue.claimMarketCollection({ provider: "twelve_data", scopeHash: job.key.split(":")[1] });
    const provider = adapter.createTwelveDataMarketDataProvider({ ...config.provider, reserve: async () => true });
    const quotes = await provider.fetchLiveQuotes([target], { requestedAt: new Date(), dryRun: false });
    for (const payload of [
      { dataset: "us_quote", target, listing, rows: quotes.rows.map(row => ({ ...row, source: "kis" })) },
      { dataset: "us_quote", target, listing, rows: quotes.rows.map(row => ({ ...row, provenance: { ...row.provenance, source: "kis" } })) },
      { dataset: "us_quote", target, listing: { ...listing, micCode: "XNAS" }, rows: quotes.rows },
    ]) await assert.rejects(store.persistTwelveDataEvidence(claim, payload, config), /identity_invalid|provenance_invalid/);
    assert.equal((await pg.query("select count(*)::int as count from market_provider_observations")).rows[0].count, 0);
  });
});

it("admits cutoff-fresh stored prices during a delayed worker without extending retention", async () => {
  const {service,config,pg,state}=await fixture();
  await service.requestTwelveDataEvidence(query("live"),config);await service.drainTwelveDataService(config);
  const cutoff=new Date(Date.now()-30*60000).toISOString();
  await pg.query("update market_provider_observations set observed_at=$1::timestamptz-interval '1 minute', fetched_at=$1::timestamptz-interval '1 minute',last_fetched_at=$1::timestamptz-interval '1 minute'",[cutoff]);
  const calls=state.calls.length;
  assert.equal((await service.readTwelveDataEvidence({kind:"live",target,asOf:cutoff,knownAt:cutoff},config)).status,"stale");
  assert.equal((await service.readTwelveDataEvidence({kind:"live",target,asOf:cutoff,knownAt:cutoff,freshnessBasis:"cutoff"},config)).status,"admitted");
  await pg.exec("update market_provider_observations set expires_at=now()-interval '1 second'");
  assert.equal((await service.readTwelveDataEvidence({kind:"live",target,asOf:cutoff,knownAt:cutoff,freshnessBasis:"cutoff"},config)).status,"missing");
  assert.equal(state.calls.length,calls);
});
