import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
let database;
async function fixture() {
  const pg = database ??= new PGlite();
  await pg.exec("drop schema public cascade; create schema public;" + DDL);
  const batches = [];
  let leaseReleaseCount = 0;
  const sqlClient = {
    async query(text, params = []) {
      if (/^update market_data_sync_runs/.test(text)) leaseReleaseCount++;
      return (await pg.query(text, params)).rows;
    },
    async transaction(build, options) {
      assert.equal(options.isolationLevel, "ReadCommitted");
      const commands = build({ query: (text, params = []) => ({ text, params }) });
      batches.push(commands);
      return pg.transaction(async (tx) => {
        const rows = [];
        for (const command of commands) rows.push((await tx.query(command.text, command.params)).rows);
        return rows;
      });
    },
  };
  let providerCalls = 0;
  let fxCalls = 0;
  let providerGate;
  let fxGate;
  let failPriceLog = false;
  const started = deferred();
  const fxStarted = deferred();
  const priceLogFailed = deferred();
  const realDb = drizzle(pg);
  const db = new Proxy(realDb, {
    get(target, key) {
      if (key === "insert") return (table) => {
        const builder = target.insert(table);
        return { values(values) {
          if (failPriceLog && values.jobType === "asset_price_sync") {
            priceLogFailed.resolve();
            throw new Error("fixture price log DB failure");
          }
          return builder.values(values);
        } };
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const provider = {
    name: "kis", supportedMarkets: ["us"],
    async fetchLiveQuotes() {
      providerCalls++;
      started.resolve();
      if (providerGate) await providerGate.promise;
      return { provider: "kis", fetchedAt: new Date(), rows: [], warnings: [] };
    },
  };
  const [lease, sync, route] = await importWithPorts([
    "src/lib/market-data/kis-refresh-lease.ts", "src/lib/market-data/price-sync.ts", "src/app/api/portfolio/live-prices/sync/route.ts",
  ], {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/db/client": { db, sqlClient },
    "@/lib/auth/current-tenant-context": { resolveCurrentTenantContext: async () => ({ ok: true, tenantContext: { ownerUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } }) },
    "@/db/queries/tenant-live-price-targets": { getTenantLivePriceTargets: async () => [{ ticker: "QQQ", market: "us", currency: "USD" }] },
    "@/lib/market-data/providers/kis": {
      createKisProviderRequestSession: () => ({}),
      createKisMarketDataProvider: () => provider,
      getKisProviderPolicy: () => ({ configured: true }),
      fetchKisUsdKrwFxCandidate: async () => {
        fxCalls++;
        fxStarted.resolve();
        if (fxGate) await fxGate.promise;
        return {};
      },
    },
    "@/lib/market-data/fx-refresh-job": { runUsdKrwFxCandidateJob: async () => ({ ok: true, status: "written" }) },
  });
  return {
    pg, batches, lease, sync, route, started, fxStarted, priceLogFailed,
    pauseProvider() { providerGate = deferred(); return providerGate; },
    pauseFx() { fxGate = deferred(); return fxGate; },
    failPriceLog() { failPriceLog = true; },
    leaseReleases() { return leaseReleaseCount; },
    counts() { return { providerCalls, fxCalls }; },
    run(dryRun = false) {
      return sync.runMarketPriceSync({ mode: "live", dryRun, fixture: false, provider, explicitTargets: [{ ticker: "QQQ", market: "us", currency: "USD" }] });
    },
  };
}
const manualRequest = () => new Request("http://localhost/api/portfolio/live-prices/sync", {
  method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
  body: JSON.stringify({ reason: "manual" }),
});

describe("KIS refresh lease integration", () => {
  after(async () => { await database?.close(); });
  it("claims before provider work and rejects a second overlapping actual sync", async () => {
    const f = await fixture();
    try {
      const gate = f.pauseProvider();
      const first = f.run();
      await f.started.promise;
      await assert.rejects(f.run(), (error) => error.statusCode === 429 && error.code === "provider_cooldown");
      assert.equal(f.counts().providerCalls, 1);
      gate.resolve();
      assert.equal((await first).status, "completed");
      const rows = (await f.pg.query("select job_type,status from market_data_sync_runs order by started_at")).rows;
      assert.equal(rows.filter((row) => row.job_type === "kis_provider_lease").length, 1);
      assert.equal(rows.filter((row) => row.job_type === "asset_price_sync").length, 1);
      assert.ok(rows.every((row) => row.status === "completed"));
      assert.ok(f.batches.every((commands) => commands[2].text === "select pg_advisory_xact_lock(hashtextextended($1, 0))"));
    } finally { await f.pg.exec("discard all"); }
  });

  it("shares the internal capability across a multi-step job without reacquiring", async () => {
    const f = await fixture();
    try {
      await f.lease.withKisRefreshLease(async () => { await f.run(); await f.run(); });
      assert.equal(f.counts().providerCalls, 2);
      assert.equal(f.batches.length, 1);
      await assert.rejects(f.run(), (error) => error.statusCode === 429);
      assert.equal(f.counts().providerCalls, 2);
    } finally { await f.pg.exec("discard all"); }
  });

  it("releases failed work in finally and recovers an abandoned expired lease", async () => {
    const f = await fixture();
    try {
      await f.pg.exec("insert into market_data_sync_runs(id,job_type,status,started_at,source) values(gen_random_uuid(),'kis_provider_lease','running',now()-interval '11 minutes','kis')");
      await assert.rejects(f.lease.withKisRefreshLease(async () => { throw new Error("fixture timeout"); }), /fixture timeout/);
      const rows = (await f.pg.query("select status,finished_at from market_data_sync_runs order by started_at desc")).rows;
      assert.equal(rows[0].status, "failed");
      assert.ok(rows[0].finished_at);
      assert.equal(rows[1].status, "running");
      await assert.rejects(f.run(), (error) => error.statusCode === 429);
      assert.equal(f.counts().providerCalls, 0);
    } finally { await f.pg.exec("discard all"); }
  });

  it("blocks the FX branch during cooldown before any provider call", async () => {
    const f = await fixture();
    try {
      await f.pg.exec("insert into market_data_sync_runs(id,job_type,mode,status,started_at,finished_at,source) values(gen_random_uuid(),'asset_price_sync','live','completed',now(),now(),'kis')");
      for (let count = 0; count < 2; count++) {
        const response = await f.route.POST(manualRequest());
        assert.equal(response.status, 429);
        assert.equal((await response.json()).state, "cooldown");
        assert.ok(Number(response.headers.get("Retry-After")) > 0);
      }
      assert.deepEqual(f.counts(), { providerCalls: 0, fxCalls: 0 });
    } finally { await f.pg.exec("discard all"); }
  });

  it("covers both price and manual FX with one lease, then throttles repetition", async () => {
    const f = await fixture();
    try {
      const first = await f.route.POST(manualRequest());
      assert.equal(first.status, 200);
      assert.equal((await first.json()).fxState, "synced");
      assert.deepEqual(f.counts(), { providerCalls: 1, fxCalls: 1 });
      const second = await f.route.POST(manualRequest());
      assert.equal(second.status, 429);
      assert.deepEqual(f.counts(), { providerCalls: 1, fxCalls: 1 });
      const leases = (await f.pg.query("select count(*)::int as n from market_data_sync_runs where job_type='kis_provider_lease'")).rows[0].n;
      assert.equal(leases, 1);
    } finally { await f.pg.exec("discard all"); }
  });

  it("does not claim for dry-run and does not let dry-run logs consume a lease", async () => {
    const f = await fixture();
    try {
      await f.run(true);
      assert.equal(f.batches.length, 0);
      assert.equal(f.counts().providerCalls, 0);
      await f.run();
      assert.equal(f.batches.length, 1);
      assert.equal(f.counts().providerCalls, 1);
    } finally { await f.pg.exec("discard all"); }
  });

  it("keeps the lease while FX is pending after the price branch fails", async () => {
    const f = await fixture();
    const fxGate = f.pauseFx();
    f.failPriceLog();
    const first = f.route.POST(manualRequest());
    try {
      await Promise.all([f.fxStarted.promise, f.priceLogFailed.promise]);
      // Flush rejection handling; the delayed FX I/O remains explicitly gated.
      await new Promise(setImmediate);
      assert.equal(f.leaseReleases(), 0);
      const lease = (await f.pg.query("select status from market_data_sync_runs where job_type='kis_provider_lease'")).rows[0];
      assert.equal(lease.status, "running");
      await assert.rejects(f.run(), (error) => error.statusCode === 429);
      assert.deepEqual(f.counts(), { providerCalls: 0, fxCalls: 1 });
      fxGate.resolve();
      assert.equal((await first).status, 503);
      assert.equal(f.leaseReleases(), 1);
      const finished = (await f.pg.query("select status,finished_at from market_data_sync_runs where job_type='kis_provider_lease'")).rows[0];
      assert.equal(finished.status, "failed");
      assert.ok(finished.finished_at);
    } finally {
      fxGate.resolve();
      await first;
      await f.pg.exec("discard all");
    }
  });
});

const DDL = `
create table market_data_sync_runs(id uuid primary key default gen_random_uuid(),job_type text not null,mode text,status text not null,started_at timestamptz not null,finished_at timestamptz,source text,requested_count integer,success_count integer,failed_count integer,skipped_count integer,metadata_json jsonb,error text,created_at timestamptz default now());
create table live_price_quotes(ticker text,market text,currency text,provider text,source text,status text,price numeric,fetched_at timestamptz);
create table fx_rates(usdkrw numeric,status text,fetched_at timestamptz,is_sample boolean,date date,created_at timestamptz);
insert into fx_rates values(1400,'ok',now(),false,current_date,now());
`;
