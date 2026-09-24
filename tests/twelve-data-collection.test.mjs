import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

const listing = { instrumentKey: "us:ARCX:VOO", ticker: "VOO", symbol: "VOO", micCode: "ARCX", exchange: "NYSE", type: "ETF", currency: "USD", exchangeTimezone: "America/New_York" };
const target = { key: listing.instrumentKey, ticker: "VOO", market: "us", currency: "USD", accounts: [], assetIds: [], assetNames: [] };
const policy = { httpRequestsPerMinute: 60, apiCreditsPerMinute: 60, minimumIntervalMs: 0 };
const scope = "a".repeat(64);
let pg;
async function fixture() {
  pg ??= new PGlite();
  await pg.exec("drop schema public cascade; create schema public; DO $$ BEGIN CREATE ROLE varda_tenant_app; EXCEPTION WHEN duplicate_object THEN NULL; END $$;" +
    readFileSync("drizzle/0043_powerful_living_tribunal.sql", "utf8") + readFileSync("drizzle/0049_twelve_data_collection.sql", "utf8"));
  const state = { queries: 0, transports: 0, written: 0, error: null, synthetic: false, fresh: false };
  const sqlClient = {
    query: async (sql, parameters = []) => { state.queries++; return (await pg.query(sql, parameters)).rows; },
    async transaction(build) {
      const commands = build({ query: (sql, parameters = []) => ({ sql, parameters }) });
      return pg.transaction(async (tx) => {
        const results = [];
        for (const command of commands) { state.queries++; results.push((await tx.query(command.sql, command.parameters)).rows); }
        return results;
      });
    },
  };
  const [actualAdapter] = await importWithPorts(["src/lib/market-data/providers/twelve-data.ts"], {});
  // Only the provider boundary is replaced; queue, budget, claim and worker below are the real modules.
  // These synthetic contract responses never make HTTP requests or write production market caches.
  const createProvider = (options) => ({
    async fetchLiveQuotes(targets, context) {
      const reserved = await options.reserve({ provider: "twelve_data", dataset: "us_quote", httpRequests: 1, apiCredits: 1 });
      if (!reserved) return { rows: [{ status: "error", error: "twelve_data_budget_limited" }] };
      state.transports++;
      if (state.error) return { rows: [{ status: "error", error: state.error }] };
      const provenance = { contractVersion: "twelve_data_us_fx_v1", dataset: "us_quote", source: "twelve_data", licenseScope: options.license.cacheScope,
        priceBasis: "provider_quote_close", adjustment: "not_applicable", session: "regular", observedAt: context.requestedAt, fetchedAt: context.requestedAt,
        exchangeDate: null, freshness: "fresh", synthetic: state.synthetic };
      return { rows: [{ ...targets[0], status: "ok", price: "500.01", priceAsOf: context.requestedAt, fetchedAt: context.requestedAt,
        source: "twelve_data", quoteType: "delayed", provenance }] };
    },
  });
  const [queue, budget, collector, kisBudget] = await importWithPorts([
    "src/lib/market-data/collection-queue.ts", "src/lib/market-data/twelve-data-budget.ts", "src/lib/market-data/twelve-data-collection.ts", "src/lib/market-data/provider-budget.ts",
  ], { "@/db/client": { sqlClient }, "@/lib/market-data/providers/twelve-data": {
    createTwelveDataMarketDataProvider: createProvider, twelveDataAccessError: actualAdapter.twelveDataAccessError,
  } });
  const config = {
    provider: { mode: "live", apiKey: "synthetic-test-credential", listings: [listing], audience: "internal_validation",
      license: { status: "confirmed", reference: "synthetic-test-license", cacheScope: "synthetic-test-scope", expiresAt: new Date(Date.now() + 86_400_000),
        datasets: ["us_quote", "us_daily_raw", "usd_krw"], audiences: ["internal_validation"], quoteDelay: "delayed" },
      release: { approved: true, reference: "synthetic-test-release" } }, budget: policy,
    isFresh: async () => state.fresh,
    persist: async (job, payload) => {
      assert.equal(payload.dataset, "us_quote");
      // The real integration must perform this fencing check in the same transaction as its upsert.
      if (!await queue.isMarketCollectionClaimCurrent(job)) return "stale_claim";
      state.written++; return "written";
    },
  };
  const id = () => budget.twelveDataReservationId(randomUUID(), 0, new Date(Date.now() - 1000));
  return { pg, queue, budget, collector, kisBudget, config, state, id };
}

describe("Twelve Data uses the existing durable queue and separate HTTP/credit budgets", () => {
  after(async () => { await pg?.close(); });
  it("does no database or transport work without an explicit complete release configuration", async () => {
    const { collector, config, state } = await fixture();
    assert.equal((await collector.enqueueTwelveDataCollection([{ kind: "live", target }])).status, "disabled");
    assert.equal((await collector.drainTwelveDataCollection()).status, "disabled");
    const denied = { ...config, provider: { ...config.provider, release: { approved: false, reference: "" } } };
    assert.equal((await collector.enqueueTwelveDataCollection([{ kind: "live", target }], denied)).status, "disabled");
    assert.equal((await collector.drainTwelveDataCollection(denied)).status, "disabled");
    assert.equal(state.queries, 0); assert.equal(state.transports, 0);
  });
  it("coalesces approved identity work and prevents the unchanged KIS worker claiming it", async () => {
    const { collector, config, queue, pg, state } = await fixture();
    await collector.enqueueTwelveDataCollection([{ kind: "live", target }, { kind: "live", target }], config);
    await collector.enqueueTwelveDataCollection([{ kind: "live", target }], config);
    assert.equal(await queue.claimMarketCollection(), null);
    assert.equal(await queue.hasReadyMarketCollection(), false);
    assert.equal((await pg.query("select count(*)::integer as n from market_collection_jobs")).rows[0].n, 1);
    assert.equal((await collector.drainTwelveDataCollection(config)).processed, 1);
    assert.equal(state.transports, 1); assert.equal(state.written, 1);
    const keys = (await pg.query("select key from market_collection_jobs")).rows.map((row) => row.key);
    assert.ok(keys.every((key) => key.startsWith("twelve_data:") && !key.includes(config.provider.apiKey)));
    await queue.enqueueMarketCollection([{ kind: "live", ticker: "VOO", market: "us", currency: "USD" }]);
    assert.equal((await queue.claimMarketCollection()).key.startsWith("kis:"), true);
  });
  it("refuses unsupported datasets and ambiguous/unreviewed listings before enqueue", async () => {
    const { collector, config, state } = await fixture();
    await assert.rejects(collector.enqueueTwelveDataCollection([{ kind: "live", target: { ...target, key: "us:XNAS:VOO" } }], config), /listing_unresolved/);
    await assert.rejects(collector.enqueueTwelveDataCollection([{ kind: "fx" }], {
      ...config, provider: { ...config.provider, license: { ...config.provider.license, datasets: ["us_quote"] } },
    }), /capability_unavailable/);
    assert.equal(state.queries, 0);
  });
  it("lets concurrent workers claim a shared job only once", async () => {
    const { collector, config, state, pg } = await fixture();
    await collector.enqueueTwelveDataCollection([{ kind: "live", target }], config);
    const results = await Promise.all([collector.drainTwelveDataCollection(config), collector.drainTwelveDataCollection(config)]);
    assert.equal(results.reduce((sum, result) => sum + result.processed, 0), 1);
    assert.equal(state.transports, 1); assert.equal(state.written, 1);
    assert.equal((await pg.query("select status from market_collection_jobs")).rows[0].status, "done");
  });
  it("reserves HTTP and credits atomically under concurrent different requests", async () => {
    const { budget, id, pg } = await fixture();
    const results = await Promise.all(Array.from({ length: 8 }, () => budget.reserveTwelveDataRequest(scope, id(), { httpRequests: 1, apiCredits: 3 },
      { ...policy, httpRequestsPerMinute: 10, apiCreditsPerMinute: 5 })));
    assert.equal(results.filter((r) => r.status === "granted").length, 1);
    assert.equal(results.filter((r) => r.status === "limited").length, 7);
    const row = (await pg.query("select request_count,credit_count,window_requests,window_credits from market_provider_budgets")).rows[0];
    assert.equal(row.request_count, 1); assert.equal(Number(row.credit_count), 3);
    assert.equal(row.window_requests, 1); assert.equal(row.window_credits, 3);
    assert.deepEqual(await budget.getTwelveDataBudgetSummary(), { reservedHttpRequests: 1, reservedApiCredits: 3, limited: 7, blockedScopes: 0 });
  });
  it("admits exactly once for concurrent identical reservation IDs and never charges replay", async () => {
    const { budget, id, pg } = await fixture();
    const reservationId = id();
    const results = await Promise.all(Array.from({ length: 6 }, () => budget.reserveTwelveDataRequest(scope, reservationId, { httpRequests: 1, apiCredits: 3 }, policy)));
    assert.equal(results.filter((r) => r.status === "granted").length, 1);
    assert.equal(results.filter((r) => r.status === "duplicate").length, 5);
    assert.equal(Number((await pg.query("select credit_count from market_provider_budgets")).rows[0].credit_count), 3);
    assert.equal((await pg.query("select count(*)::integer as n from market_provider_reservations")).rows[0].n, 1);
  });
  it("keeps KIS metrics separate and checks the HTTP cap independently of credits", async () => {
    const { budget, kisBudget, id, pg } = await fixture();
    const oneHttp = { ...policy, httpRequestsPerMinute: 1, apiCreditsPerMinute: 100 };
    assert.equal((await budget.reserveTwelveDataRequest(scope, id(), { httpRequests: 1, apiCredits: 3 }, oneHttp)).status, "granted");
    assert.equal((await budget.reserveTwelveDataRequest(scope, id(), { httpRequests: 1, apiCredits: 1 }, oneHttp)).status, "limited");
    await pg.query("insert into market_provider_budgets(scope_hash,provider,request_count) values($1,'kis',7)", ["b".repeat(64)]);
    assert.equal((await kisBudget.getKisRequestBudgetSummary()).requests, 7);
    assert.equal((await budget.getTwelveDataBudgetSummary()).reservedHttpRequests, 1);
  });
  it("keeps replay denied across minute resets, after expiry and after bounded pruning", async () => {
    const { budget, id, pg } = await fixture();
    const reservationId = id();
    assert.equal((await budget.reserveTwelveDataRequest(scope, reservationId, { httpRequests: 1, apiCredits: 1 }, policy)).status, "granted");
    await pg.exec("update market_provider_budgets set window_started_at=now()-interval '2 minutes'");
    assert.equal((await budget.reserveTwelveDataRequest(scope, reservationId, { httpRequests: 1, apiCredits: 1 }, policy)).status, "duplicate");
    const expired = budget.twelveDataReservationId(randomUUID(), 0, new Date(Date.now() - 4 * 60_000));
    assert.equal((await budget.reserveTwelveDataRequest(scope, expired, { httpRequests: 1, apiCredits: 1 }, policy)).status, "expired");
    await pg.query("insert into market_provider_reservations(scope_hash,reservation_id,http_requests,api_credits,reserved_at) values($1,$2,1,1,now()-interval '2 days')", [scope, expired]);
    assert.equal((await budget.reserveTwelveDataRequest(scope, expired, { httpRequests: 1, apiCredits: 1 }, policy)).status, "expired");
    assert.equal((await pg.query("select count(*)::integer as n from market_provider_reservations where reservation_id=$1", [expired])).rows[0].n, 0);
    assert.equal(Number((await pg.query("select credit_count from market_provider_budgets")).rows[0].credit_count), 1);
  });
  it("treats shared budget wait as deferred without consuming instrument retries", async () => {
    const { collector, config, budget, state, pg, id } = await fixture();
    const limited = { ...config, budget: { ...policy, apiCreditsPerMinute: 1 } };
    await budget.reserveTwelveDataRequest(budget.twelveDataBudgetScope(config.provider.apiKey), id(), { httpRequests: 1, apiCredits: 1 }, limited.budget);
    await collector.enqueueTwelveDataCollection([{ kind: "live", target }], limited);
    assert.equal((await collector.drainTwelveDataCollection(limited)).failed, 1);
    const row = (await pg.query("select attempts,status,last_code,available_at>now() as waiting from market_collection_jobs")).rows[0];
    assert.deepEqual(row, { attempts: 0, status: "pending", last_code: "provider_budget_wait", waiting: true });
    assert.equal(state.transports, 0); assert.equal(state.written, 0);
  });
  it("bounds transport retries at the existing six attempts and reserves each actual retry", async () => {
    const { collector, config, state, pg, budget } = await fixture();
    state.error = "twelve_data_transport_failed";
    await collector.enqueueTwelveDataCollection([{ kind: "live", target }], config);
    for (let attempt = 1; attempt <= 6; attempt++) {
      assert.equal((await collector.drainTwelveDataCollection(config)).failed, 1);
      const row = (await pg.query("select attempts,status,available_at>now() as waiting from market_collection_jobs")).rows[0];
      assert.equal(row.attempts, attempt); assert.equal(row.waiting, true);
      assert.equal(row.status, attempt === 6 ? "failed" : "pending");
      assert.equal((await collector.drainTwelveDataCollection(config)).processed, 0);
      await pg.exec("update market_collection_jobs set available_at=now()-interval '1 second'; update market_provider_budgets set blocked_until=now()-interval '1 second'");
    }
    assert.equal((await collector.drainTwelveDataCollection(config)).processed, 0);
    assert.equal(state.transports, 6); assert.equal(state.written, 0);
    assert.equal((await budget.getTwelveDataBudgetSummary()).reservedApiCredits, 6);
    assert.equal((await pg.query("select count(*)::integer as n from market_provider_reservations")).rows[0].n, 6);
  });
  it("shares provider cooldown across scopes of work while retaining typed cache boundaries", async () => {
    const { collector, config, state, budget, pg } = await fixture();
    state.error = "twelve_data_rate_limited";
    await collector.enqueueTwelveDataCollection([{ kind: "live", target }], config);
    await collector.drainTwelveDataCollection(config);
    assert.equal((await budget.getTwelveDataBudgetSummary()).blockedScopes, 1);
    assert.equal((await pg.query("select last_code from market_collection_jobs")).rows[0].last_code, "rate_limited");
    assert.equal(state.transports, 1);
    await pg.exec("update market_collection_jobs set available_at=now()-interval '1 second'");
    await collector.drainTwelveDataCollection(config);
    assert.equal(state.transports, 1); // No request is emitted during a shared cooldown.
  });
  it("uses an admitted cache hit without a request and rejects synthetic data at persistence", async () => {
    const { collector, config, state, pg } = await fixture();
    state.fresh = true;
    await collector.enqueueTwelveDataCollection([{ kind: "live", target }], config);
    assert.equal((await collector.drainTwelveDataCollection(config)).cacheHits, 1);
    assert.equal(state.transports, 0);
    state.fresh = false; state.synthetic = true;
    await collector.enqueueTwelveDataCollection([{ kind: "live", target }], config);
    assert.equal((await collector.drainTwelveDataCollection(config)).failed, 1);
    assert.equal(state.written, 0);
    assert.equal((await pg.query("select last_code from market_collection_jobs")).rows[0].last_code, "capability_unavailable");
  });
  it("keeps the reservation ledger inaccessible to tenant roles and stores no credentials", async () => {
    const { pg } = await fixture();
    const row = (await pg.query("select relrowsecurity,relforcerowsecurity from pg_class where relname='market_provider_reservations'")).rows[0];
    assert.deepEqual(row, { relrowsecurity: true, relforcerowsecurity: true });
    assert.equal((await pg.query("select count(*)::integer as n from pg_policies where tablename='market_provider_reservations'")).rows[0].n, 0);
    assert.equal((await pg.query("select has_table_privilege('varda_tenant_app','market_provider_reservations','SELECT') as allowed")).rows[0].allowed, false);
  });
});
