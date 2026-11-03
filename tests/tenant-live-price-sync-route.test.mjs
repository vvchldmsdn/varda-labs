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
  const config = { targets: [target], quotes: [], fx: fx(), authorized: true, configured: true, closeFetchedAt: new Date(), ...options };
  const events = [], queued = [], callbacks = [], outcomes = [];
  const pending = new Map();
  const closeChecks = new Map();
  let leaseActive = false;
  let activeJob = null;
  const tenantContext = { ownerUserId: owner };
  const db = { select(fields) {
    let table;
    const builder = { from(value) { table = getTableName(value); return builder; }, where() { return builder; },
      orderBy() { return builder; }, limit() { return builder; }, then(resolve, reject) {
        events.push(`read:${table}`);
        return Promise.resolve(table === "fx_rates" ? config.fx ? [config.fx] : [] : fields?.id ? config.quotes.filter(row=>row.ticker===activeJob?.ticker) : config.quotes).then(resolve, reject);
      } };
    return builder;
  } };
  const [route] = await importWithPorts(["src/app/api/portfolio/live-prices/sync/route.ts"], {
    "@/lib/market-data/close-gap-sync": { syncMissingRawCloses: async () => { throw new Error("historical gap collection is outside live quote fixture"); } },
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) }, after: callback => callbacks.push(callback) },
    "@/db/client": { db, sqlClient: { query: async (sql, parameters) => {
      if (sql.startsWith("select")) {
        events.push("close_evidence");
        assert.ok(config.targets.some(owned => owned.market === parameters[0] && owned.currency === parameters[1] && owned.ticker === parameters[2]));
        const check = [...closeChecks.values()].find(value => value.instrumentKey === parameters[5] && value.priceDate === parameters[3] && value.status === "completed");
        return [{ close_fetched_at: config.closeFetchedAt, completed_at: check?.finishedAt ?? null }];
      }
      if (sql.startsWith("insert")) {
        closeChecks.set(parameters[0], { ...JSON.parse(parameters[3]), status: "running" });
        return [];
      }
      assert.ok(sql.startsWith("update market_data_sync_runs"));
      const check = closeChecks.get(parameters[0]); assert.ok(check);
      check.status = sql.includes("status='completed'") ? "completed" : "failed"; check.finishedAt = new Date();
      return [];
    } } },
    "@/lib/auth/current-tenant-context": { resolveCurrentTenantContext: async () => { events.push("auth"); return config.authorized ? { ok: true, tenantContext } : { ok: false, failure: { httpStatus: 401 } }; } },
    "@/db/queries/tenant-live-price-targets": { getTenantLivePriceTargets: async context => { assert.equal(context, tenantContext); events.push("owner_targets"); return config.targets; } },
    "@/lib/market-data/providers/kis": {
      getKisProviderPolicy: () => ({ configured: config.configured }), createKisProviderRequestSession: () => ({}),
      createKisMarketDataProvider: () => ({ name: "kis", fetchClosePrices: async (targets, context) => {
        events.push("provider_close");
        assert.equal(targets.length, 1); assert.deepEqual(targets[0].assetIds, []);
        assert.ok(config.targets.some(owned => owned.ticker === targets[0].ticker && owned.market === targets[0].market && owned.currency === targets[0].currency));
        return { provider: "kis", rows: [{ ...targets[0], priceDate: context.priceDate, closePrice: "100", fetchedAt: context.requestedAt, status: config.closeFailure ? "error" : "ok" }] };
      } }),
      fetchKisUsdKrwFxCandidate: async input => { events.push("provider_fx"); assert.equal(input.target.ticker, "QQQ"); return {}; },
    },
    "@/lib/market-data/collection-queue": {
      readCollectionProgress: async keys => keys.flatMap(key => config.queueStates?.filter(row=>row.key===key) ??
        (pending.has(key) ? [{key,status:'pending',attempts:1,availableAt:null,completedAt:null,code:null}] :
        outcomes.filter(row=>row.job.key===key).slice(-1).map(row=>({key,status:row.outcome.ok?'done':'failed',completedAt:row.completedAt,availableAt:null,attempts:1,code:null})))),
      enqueueMarketCollection: async jobs => { events.push("enqueue"); if (config.queueFailure) throw new Error(`private ${owner}`); queued.push(jobs); for (const job of normalizeCollectionJobs(jobs)) pending.set(job.key, { ...job, attempts: 1, claimToken: "test" }); return { queuedCount: jobs.length, retryAfterSeconds: 10 }; },
      maintainMarketCollection: async () => events.push("maintain"),
      hasReadyMarketCollection: async () => pending.size > 0,
      claimMarketCollection: async () => { const job = pending.values().next().value; if (job) pending.delete(job.key); activeJob=job; return job ?? null; },
      finishMarketCollection: async (job, outcome) => outcomes.push({ job, outcome, completedAt:new Date(Date.now()-1).toISOString() }),
      getMarketCollectionSummary: async () => ({ pending: pending.size }),
    },
    "@/lib/market-data/manual-native-quotes": { manualNativeQuotes:async(targets,collect)=>{assert.deepEqual(targets,config.targets);events.push(collect?'native_manual':'native_read');return config.native?{...config.native,items:[{id:'native:QQQ',label:'QQQ',provider:'Twelve Data',state:config.native.pending?'pending':config.native.failed?'failed':'ready',priceAsOf:null,checkedAt:null,retryAt:null}]}:{available:false,pending:false,failed:false,version:'disabled',items:[]};} },
    "@/lib/market-data/twelve-data-service": { resumeConfiguredTwelveDataService: async () => ({ status: "disabled", processed: 0, failed: 0 }) },
    "@/lib/market-data/kis-refresh-lease": { KisRefreshLeaseBusyError: class extends Error {}, withKisCollectionLease: async task => {
      if (leaseActive) return task();
      events.push("lease"); leaseActive = true;
      try { return await task(); } finally { leaseActive = false; }
    } },
    "@/lib/market-data/provider-budget": { withKisCollectionDeadline: async task => { events.push("deadline"); return task(); } },
    "@/lib/market-data/price-sync": { runMarketPriceSync: async input => { events.push("provider_live"); assert.equal(input.targetLimit, 1); assert.deepEqual(input.explicitTargets, [config.targets.find(owned => owned.ticker === input.explicitTargets[0]?.ticker)]); if(!config.providerFailure) config.quotes.push({...quote(),...input.explicitTargets[0]}); return { successCount: config.providerFailure ? 0 : 1, failedCount: config.providerFailure ? 1 : 0 }; } },
    "@/lib/market-data/kis-history-cache-sync": { runKisHistoryCacheSync: async () => { throw new Error("history is not authorized by this route"); } },
    "@/lib/market-data/asset-price-snapshot-repository": { applyAssetPriceSnapshotRows: async input => {
      events.push("write_close"); assert.equal(input.rows.length, 1); assert.equal(input.allowWrite, true); assert.equal(input.dryRun, false);
      config.closeFetchedAt = input.rows[0].fetchedAt;
      return { failedCount: 0, conflictCount: 0, updatedCount: 1 };
    } },
    "@/lib/market-data/fx-refresh-job": { runUsdKrwFxCandidateJob: async () => ({ ok: true }) },
  });
  return { route, events, queued, callbacks, outcomes, config, pending,
    async drain() { for (const callback of callbacks.splice(0)) await callback(); } };
}

function request({ url = "http://localhost/api/portfolio/live-prices/sync", headers = {}, body = { reason: "manual" } } = {}) {
  return new Request(url, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
}

describe("tenant live-price enqueue and after boundary", () => {
  it('keeps a configured native provider usable without KIS',async()=>{
    const f=await fixture({configured:false,native:{available:true,pending:true,failed:false,version:'waiting'}});
    const first=await f.route.POST(request());assert.equal(first.status,202);assert.equal((await first.json()).state,'queued');
    assert.ok(f.events.includes('native_manual'));assert.equal(f.queued.length,0);
    f.config.native={available:true,pending:false,failed:false,version:'ready'};
    const second=await f.route.POST(request({body:{reason:'poll'}}));assert.equal((await second.json()).state,'fresh');
    assert.ok(f.events.includes('native_read'));
  });
  it('keeps successful native work visible when KIS admission fails',async()=>{
    const f=await fixture({queueFailure:true,native:{available:true,pending:true,failed:false,version:'pending'}});
    const result=await f.route.POST(request());
    assert.equal(result.status,202);assert.equal((await result.json()).state,'queued');
  });
  it('continues KIS collection when the independent native provider failed',async()=>{
    const f=await fixture({native:{available:false,pending:false,failed:true,version:'failed'}});
    assert.equal((await f.route.POST(request())).status,202);assert.equal(f.queued.flat().length,1);
  });
  it('legacy page_view cannot create new collection demand',async()=>{
    const f=await fixture();await f.route.POST(request({body:{reason:'page_view'}}));
    assert.equal(f.queued.length,0);assert.ok(f.events.includes('native_read'));assert.ok(!f.events.includes('native_manual'));
  });
  it("returns a stable owned-evidence receipt that changes for prices and FX, not unrelated instruments", async () => {
    const f = await fixture({ targets:[{...target,currency:'usd'}], quotes: [quote()] });
    const read = async () => (await (await f.route.POST(request({body:{reason:'poll'}}))).json()).readVersion;
    const first = await read();
    assert.match(first, /^[a-f0-9]{64}$/);
    assert.equal(await read(), first);
    f.config.quotes.push({...quote(),ticker:'UNOWNED',price:'999'});
    assert.equal(await read(), first);
    f.config.quotes[0].price='101';
    const priceChanged=await read(); assert.notEqual(priceChanged,first);
    f.config.fx.usdKrw='1401';
    assert.notEqual(await read(),priceChanged);
  });
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

  it("revalidates a stale shared close only after the queued live update and before marking work complete", async () => {
    const f = await fixture({ closeFetchedAt: null });
    assert.equal((await f.route.POST(request())).status, 202);
    assert.equal(f.events.includes("provider_close"), false);
    await f.drain();
    assert.deepEqual(f.events.filter(event => event.startsWith("provider")), ["provider_live", "provider_close"]);
    assert.ok(f.events.indexOf("write_close") > f.events.indexOf("provider_close"));
    assert.equal(f.outcomes[0].outcome.ok, true);
    assert.equal(f.events.filter(event => event === "lease").length, 1);
  });

  it("does not mark a successful live refresh complete when close revalidation failed", async () => {
    const f = await fixture({ closeFetchedAt: null, closeFailure: true, fx: null });
    await f.route.POST(request()); await f.drain();
    assert.deepEqual(f.events.filter(event => event.startsWith("provider")), ["provider_live", "provider_close"]);
    assert.equal(f.outcomes.length, 1); assert.equal(f.outcomes[0].outcome.ok, false);
    assert.ok(f.outcomes[0].outcome.retryAfterSeconds >= 15);
    assert.equal(f.events.includes("write_close"), false);
    assert.equal(f.pending.size, 1);
      const next = await f.route.POST(request({body:{reason:'poll'}}));
      assert.equal((await next.json()).state, 'queued', 'fresh live write cannot hide pending close revalidation');
  });

  it("polls an authorized owner's cached state without admitting another job or consuming an idle lease", async () => {
    const f = await fixture();
    const response = await f.route.POST(request({ body: { reason: "poll" } }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).state, "partial", "missing evidence without admitted work is not a queued operation");
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

  it("one manual admission completes eight owned instruments across bounded worker wakes",async()=>{
    const f=await fixture({targets:Array.from({length:8},(_,index)=>({...target,ticker:`Q${index}`}))});
    const first=await (await f.route.POST(request())).json();assert.equal(first.state,'queued');
    await f.drain();assert.equal(f.pending.size,3);
    const middle=await (await f.route.POST(request({body:{reason:'poll',startedAt:first.startedAt}}))).json();
    assert.equal(middle.state,'queued');assert.equal(middle.progress.items.filter(row=>row.state==='ready'&&row.label!=='USD/KRW').length,5);
    await f.drain();const last=await (await f.route.POST(request({body:{reason:'poll',startedAt:first.startedAt}}))).json();
    assert.equal(last.state,'fresh');assert.equal(last.progress.pending,0);assert.equal(last.progress.failed,0);
    assert.equal(f.queued.length,1);assert.equal(f.events.filter(event=>event==='provider_live').length,8);
  });

  it("does not report completion while any authorized job is delayed or has exhausted retries",async()=>{
    const key=normalizeCollectionJobs([{...target,kind:'live'}])[0].key;
    const f=await fixture({queueStates:[{key,status:'pending',availableAt:new Date(Date.now()+60_000).toISOString(),attempts:2}]});
    let data=await (await f.route.POST(request({body:{reason:'poll'}}))).json();
    assert.equal(data.state,'queued');assert.equal(data.progress.items[0].state,'delayed');
    f.config.queueStates[0].status='failed';data=await (await f.route.POST(request({body:{reason:'poll'}}))).json();
    assert.equal(data.state,'partial');assert.equal(data.progress.failed,1);assert.equal(f.queued.length,0);
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
    ["oversized body", { headers: { "content-length": "129" } }],
    ["invalid JSON", { body: "{" }],
    ["invalid reason", { body: { reason: "force_all" } }],
    ["backdated operation", { body: { reason: "poll", startedAt:"2020-01-01T00:00:00.000Z" } }],
    ["manual cutoff override", { body: { reason: "manual", startedAt:new Date().toISOString() } }],
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

  for (const options of [{ configured: false }, { queueFailure: true }]) it("returns per-target failure without claiming that failed admission was queued", async () => {
    const f = await fixture(options);
    const response = await f.route.POST(request());
    assert.equal(response.status, 200);
    const data=await response.json();assert.equal(data.state, "partial");assert.ok(data.progress.failed>0);
    assert.equal(f.events.includes("lease"), false);
  });
});
