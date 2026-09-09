import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableName } from "drizzle-orm";
import { importWithPorts } from "./helpers/import-with-ports.mjs";
import { normalizeCollectionJobs } from "../src/lib/market-data/collection-policy.ts";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const target = { ticker: "QQQ", market: "us", currency: "USD" };
const quote = () => ({ ...target, provider: "kis", source: "kis", status: "ok", price: "100", fetchedAt: new Date() });
const fx = () => ({ usdKrw: "1400", status: "ok", fetchedAt: new Date() });

async function fixture(options = {}) {
  const config = { targets: [target], quotes: [], fx: fx(), authorized: true, configured: true, ...options };
  const events = [], queued = [], callbacks = [], outcomes = [];
  const pending = new Map();
  const tenantContext = { ownerUserId: owner };
  const db = { select() {
    let table;
    const builder = { from(value) { table = getTableName(value); return builder; }, where() { return builder; },
      orderBy() { return builder; }, limit() { return builder; }, then(resolve, reject) {
        events.push(`read:${table}`);
        return Promise.resolve(table === "fx_rates" ? config.fx ? [config.fx] : [] : config.quotes).then(resolve, reject);
      } };
    return builder;
  } };
  const [route] = await importWithPorts(["src/app/api/portfolio/live-prices/sync/route.ts"], {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) }, after: callback => callbacks.push(callback) },
    "@/db/client": { db },
    "@/lib/auth/current-tenant-context": { resolveCurrentTenantContext: async () => { events.push("auth"); return config.authorized ? { ok: true, tenantContext } : { ok: false, failure: { httpStatus: 401 } }; } },
    "@/db/queries/tenant-live-price-targets": { getTenantLivePriceTargets: async context => { assert.equal(context, tenantContext); events.push("owner_targets"); return config.targets; } },
    "@/lib/market-data/providers/kis": {
      getKisProviderPolicy: () => ({ configured: config.configured }), createKisProviderRequestSession: () => ({}), createKisMarketDataProvider: () => ({}),
      fetchKisUsdKrwFxCandidate: async input => { events.push("provider_fx"); assert.equal(input.target.ticker, "QQQ"); return {}; },
    },
    "@/lib/market-data/collection-queue": {
      enqueueMarketCollection: async jobs => { events.push("enqueue"); if (config.queueFailure) throw new Error(`private ${owner}`); queued.push(jobs); for (const job of normalizeCollectionJobs(jobs)) pending.set(job.key, { ...job, attempts: 1, claimToken: "test" }); return { queuedCount: jobs.length, retryAfterSeconds: 10 }; },
      maintainMarketCollection: async () => events.push("maintain"),
      hasReadyMarketCollection: async () => pending.size > 0,
      claimMarketCollection: async () => { const job = pending.values().next().value; if (job) pending.delete(job.key); return job ?? null; },
      finishMarketCollection: async (job, outcome) => outcomes.push({ job, outcome }),
      getMarketCollectionSummary: async () => ({ pending: pending.size }),
    },
    "@/lib/market-data/kis-refresh-lease": { KisRefreshLeaseBusyError: class extends Error {}, withKisCollectionLease: async task => { events.push("lease"); return task(); } },
    "@/lib/market-data/provider-budget": { withKisCollectionDeadline: async task => { events.push("deadline"); return task(); } },
    "@/lib/market-data/price-sync": { runMarketPriceSync: async input => { events.push("provider_live"); assert.equal(input.targetLimit, 1); assert.deepEqual(input.explicitTargets, [config.targets.find(owned => owned.ticker === input.explicitTargets[0]?.ticker)]); return { successCount: config.providerFailure ? 0 : 1, failedCount: config.providerFailure ? 1 : 0 }; } },
    "@/lib/market-data/kis-history-cache-sync": { runKisHistoryCacheSync: async () => { throw new Error("history is not authorized by this route"); } },
    "@/lib/market-data/fx-refresh-job": { runUsdKrwFxCandidateJob: async () => ({ ok: true }) },
  });
  return { route, events, queued, callbacks, outcomes, config, pending,
    async drain() { for (const callback of callbacks.splice(0)) await callback(); } };
}

function request({ url = "http://localhost/api/portfolio/live-prices/sync", headers = {}, body = { reason: "manual" } } = {}) {
  return new Request(url, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
}

describe("tenant live-price enqueue and after boundary", () => {
  it("authorizes exact tenant holdings, returns 202 first, then consumes only shared instrument work", async () => {
    const f = await fixture({ fx: null });
    const response = await f.route.POST(request());
    assert.equal(response.status, 202);
    assert.equal(response.headers.get("Retry-After"), "10");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const body = await response.json();
    assert.equal(body.state, "queued");
    assert.equal(body.queuedTargetCount, 2);
    assert.deepEqual(f.events.filter(event => event.startsWith("provider") || event === "lease"), []);
    const jobs = f.queued.flat();
    assert.equal(jobs.length, 2);
    assert.ok(jobs.every(job => Object.keys(job).sort().join() === "currency,kind,market,ticker"));
    assert.ok(jobs.every(job => job.ticker === "QQQ"));
    assert.doesNotMatch(JSON.stringify([body, jobs]), /owner|account|quantity|credential|aaaaaaaa/i);
    await f.drain();
    assert.deepEqual(f.events.filter(event => event.startsWith("provider") || event === "lease"), ["lease", "provider_live", "provider_fx"]);
    assert.equal(f.outcomes.length, 2);
    assert.ok(f.outcomes.every(result => result.outcome.ok));
  });

  it("does not let manual clicks force provider work for fresh shared quotes and FX", async () => {
    const f = await fixture({ quotes: [quote()] });
    for (let i = 0; i < 2; i++) {
      const response = await f.route.POST(request());
      assert.equal(response.status, 200);
      assert.equal((await response.json()).state, "fresh");
    }
    assert.equal(f.queued.length, 0);
    await f.drain();
    assert.equal(f.events.filter(event => event.startsWith("provider")).length, 0);
  });

  it("rechecks the shared cache after enqueue and skips a provider call filled by another worker", async () => {
    const f = await fixture();
    assert.equal((await f.route.POST(request())).status, 202);
    f.config.quotes = [quote()];
    await f.drain();
    assert.equal(f.outcomes[0].outcome.code, "cache_fresh");
    assert.equal(f.events.includes("provider_live"), false);
  });

  it("polls an authorized owner's cached state without admitting another job or consuming an idle lease", async () => {
    const f = await fixture();
    const response = await f.route.POST(request({ body: { reason: "poll" } }));
    assert.equal(response.status, 202);
    assert.equal((await response.json()).state, "queued");
    assert.equal(f.queued.length, 0);
    assert.equal(f.callbacks.length, 1);
    await f.drain();
    assert.ok(f.events.includes("owner_targets"));
    assert.equal(f.events.includes("lease"), false);
    assert.equal(f.events.filter(event => event.startsWith("provider")).length, 0);
  });

  it("caps one after worker at five jobs and leaves the remaining shared job pending", async () => {
    const f = await fixture({ targets: Array.from({ length: 6 }, (_, index) => ({ ...target, ticker: `Q${index}` })) });
    const response = await f.route.POST(request());
    assert.equal(response.status, 202);
    assert.equal((await response.json()).queuedTargetCount, 6);
    await f.drain();
    assert.equal(f.events.filter(event => event === "provider_live").length, 5);
    assert.equal(f.events.filter(event => event === "deadline").length, 1);
    assert.equal(f.pending.size, 1);
    assert.equal(f.outcomes.length, 5);
  });

  it("yields after one failed provider operation, leaving the FX lane for a later worker", async () => {
    const f = await fixture({ fx: null, providerFailure: true });
    assert.equal((await f.route.POST(request())).status, 202);
    await f.drain();
    assert.deepEqual(f.events.filter(event => event.startsWith("provider")), ["provider_live"]);
    assert.equal(f.outcomes[0].outcome.ok, false);
    assert.ok(f.outcomes[0].outcome.retryAfterSeconds >= 15);
    assert.equal(f.pending.size, 1);
  });

  it("does not read holdings, enqueue or schedule after work without a session", async () => {
    const f = await fixture({ authorized: false });
    const response = await f.route.POST(request());
    assert.equal(response.status, 401);
    assert.deepEqual(f.events, ["auth"]);
    assert.equal(f.callbacks.length, 0);
  });

  for (const [label, input] of [
    ["cross-origin", { headers: { origin: "https://foreign.example" } }],
    ["cross-site", { headers: { "sec-fetch-site": "cross-site" } }],
    ["query instrument injection", { url: "http://localhost/api/portfolio/live-prices/sync?ticker=FOREIGN" }],
    ["owner injection", { body: { reason: "manual", ownerUserId: "foreign" } }],
    ["ticker injection", { body: { reason: "manual", ticker: "FOREIGN" } }],
    ["non-json body", { headers: { "content-type": "text/plain" } }],
    ["oversized body", { headers: { "content-length": "65" } }],
    ["invalid JSON", { body: "{" }],
    ["invalid reason", { body: { reason: "force_all" } }],
  ]) it(`rejects ${label} before any authorization or queue work`, async () => {
    const f = await fixture();
    assert.equal((await f.route.POST(request(input))).status, 400);
    assert.deepEqual(f.events, []);
    assert.equal(f.callbacks.length, 0);
  });

  it("keeps the owner target cap ahead of cache queries or queue admission", async () => {
    const f = await fixture({ targets: Array.from({ length: 41 }, (_, i) => ({ ...target, ticker: `A${i}` })) });
    const response = await f.route.POST(request());
    assert.equal(response.status, 409);
    assert.equal((await response.json()).state, "target_limit_exceeded");
    assert.deepEqual(f.events, ["auth", "owner_targets"]);
    assert.equal(f.callbacks.length, 0);
  });

  it("returns an empty state without inventing a default benchmark holding", async () => {
    const f = await fixture({ targets: [] });
    const response = await f.route.POST(request());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).state, "empty");
    assert.equal(f.queued.length, 0);
    await f.drain();
    assert.equal(f.events.filter(event => event.startsWith("provider")).length, 0);
  });

  for (const options of [{ configured: false }, { queueFailure: true }]) it("returns a safe 503 without claiming that failed admission was queued", async () => {
    const f = await fixture(options);
    const response = await f.route.POST(request());
    assert.equal(response.status, 503);
    assert.notEqual((await response.json()).state, "queued");
    assert.equal(f.callbacks.length, 0);
    assert.equal(f.events.includes("lease"), false);
  });
});
