import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
let database;
async function fixture() {
  const pg = database ??= new PGlite();
  await pg.exec("drop schema public cascade; create schema public;" + DDL);
  const batches = [];
  const sqlClient = {
    async query(text, params = []) { return (await pg.query(text, params)).rows; },
    async transaction(build, options) {
      assert.equal(options.isolationLevel, "ReadCommitted");
      const commands = build({ query: (text, params = []) => ({ text, params }) });
      batches.push(commands);
      return pg.transaction(async tx => {
        const rows = [];
        for (const command of commands) rows.push((await tx.query(command.text, command.params)).rows);
        return rows;
      });
    },
  };
  let providerCalls = 0, providerGate;
  const started = deferred();
  const provider = { name: "kis", supportedMarkets: ["us"], async fetchLiveQuotes() {
    providerCalls++;
    started.resolve();
    if (providerGate) await providerGate.promise;
    return { provider: "kis", fetchedAt: new Date(), rows: [], warnings: [] };
  } };
  const [lease, sync] = await importWithPorts([
    "src/lib/market-data/kis-refresh-lease.ts", "src/lib/market-data/price-sync.ts",
  ], { "@/db/client": { db: drizzle(pg), sqlClient } });
  return { pg, batches, lease, started,
    pauseProvider() { providerGate = deferred(); return providerGate; },
    providerCalls() { return providerCalls; },
    run(dryRun = false) { return sync.runMarketPriceSync({ mode: "live", dryRun, fixture: false, provider, explicitTargets: [{ ticker: "QQQ", market: "us", currency: "USD" }] }); },
  };
}

describe("KIS refresh and queued-worker lease integration", () => {
  after(async () => { await database?.close(); });

  it("claims before provider work and rejects a second overlapping actual sync", async () => {
    const f = await fixture();
    const gate = f.pauseProvider();
    const first = f.run();
    try {
      await f.started.promise;
      await assert.rejects(f.run(), error => error.statusCode === 429 && error.code === "provider_cooldown");
      assert.equal(f.providerCalls(), 1);
      gate.resolve();
      assert.equal((await first).status, "completed");
      const rows = (await f.pg.query("select job_type,status from market_data_sync_runs order by started_at")).rows;
      assert.equal(rows.filter(row => row.job_type === "kis_provider_lease").length, 1);
      assert.equal(rows.filter(row => row.job_type === "asset_price_sync").length, 1);
      assert.ok(rows.every(row => row.status === "completed"));
      assert.ok(f.batches.every(commands => commands[2].text === "select pg_advisory_xact_lock(hashtextextended($1, 0))"));
    } finally { gate.resolve(); await first; }
  });

  it("shares the private capability across a multi-step legacy job without reacquiring", async () => {
    const f = await fixture();
    await f.lease.withKisRefreshLease(async () => { await f.run(); await f.run(); });
    assert.equal(f.providerCalls(), 2);
    assert.equal(f.batches.length, 1);
    await assert.rejects(f.run(), error => error.statusCode === 429);
    assert.equal(f.providerCalls(), 2);
  });

  it("releases failed work in finally and recovers an abandoned expired lease", async () => {
    const f = await fixture();
    await f.pg.exec("insert into market_data_sync_runs(id,job_type,status,started_at,source) values(gen_random_uuid(),'kis_provider_lease','running',now()-interval '11 minutes','kis')");
    await assert.rejects(f.lease.withKisRefreshLease(async () => { throw new Error("fixture timeout"); }), /fixture timeout/);
    const rows = (await f.pg.query("select status,finished_at from market_data_sync_runs order by started_at desc")).rows;
    assert.equal(rows[0].status, "failed");
    assert.ok(rows[0].finished_at);
    assert.equal(rows[1].status, "running");
    await assert.rejects(f.run(), error => error.statusCode === 429);
    assert.equal(f.providerCalls(), 0);
  });

  it("does not claim for dry-run and does not let dry-run logs consume a lease", async () => {
    const f = await fixture();
    await f.run(true);
    assert.equal(f.batches.length, 0);
    assert.equal(f.providerCalls(), 0);
    await f.run();
    assert.equal(f.batches.length, 1);
    assert.equal(f.providerCalls(), 1);
  });

  it("lets queued workers continue after completed work without imposing legacy whole-job idle time", async () => {
    const f = await fixture();
    await f.run();
    await assert.rejects(f.run(), error => error.statusCode === 429);
    await f.lease.withKisCollectionLease(async () => { await f.run(); await f.run(); });
    assert.equal(f.providerCalls(), 3);
    const claimed = (await f.pg.query("select count(*)::int as n from market_data_sync_runs where job_type='kis_provider_lease'")).rows[0].n;
    assert.equal(claimed, 2);
    await f.lease.withKisCollectionLease(async () => { await f.run(); });
    assert.equal(f.providerCalls(), 4);
    // Individual HTTP request pacing is independently tested at provider-budget;
    // this test establishes that the worker holds the same mutual exclusion.
  });

  it("retains mutual exclusion while a queued worker is waiting on a provider", async () => {
    const f = await fixture();
    const gate = f.pauseProvider();
    const first = f.lease.withKisCollectionLease(() => f.run());
    try {
      await f.started.promise;
      await assert.rejects(f.lease.withKisCollectionLease(() => f.run()), error => error instanceof f.lease.KisRefreshLeaseBusyError && error.retryAfterSeconds > 0);
      await assert.rejects(f.run(), error => error.statusCode === 429);
      assert.equal(f.providerCalls(), 1);
      const row = (await f.pg.query("select status from market_data_sync_runs where job_type='kis_provider_lease'")).rows[0];
      assert.equal(row.status, "running");
    } finally { gate.resolve(); await first; }
    const row = (await f.pg.query("select status,finished_at from market_data_sync_runs where job_type='kis_provider_lease'")).rows[0];
    assert.equal(row.status, "completed");
    assert.ok(row.finished_at);
  });

  it("cannot reuse a descendant capability after its owning worker finishes", async () => {
    const f = await fixture();
    const gate = deferred();
    let orphan;
    await f.lease.withKisCollectionLease(async () => {
      orphan = (async () => { await gate.promise; return f.run(); })();
    });
    gate.resolve();
    await assert.rejects(orphan, error => error.statusCode === 429);
    assert.equal(f.providerCalls(), 0);
  });
});

const DDL = `
create table market_data_sync_runs(id uuid primary key default gen_random_uuid(),job_type text not null,mode text,status text not null,started_at timestamptz not null,finished_at timestamptz,source text,requested_count integer,success_count integer,failed_count integer,skipped_count integer,metadata_json jsonb,error text,created_at timestamptz default now());
create table live_price_quotes(ticker text,market text,currency text,provider text,source text,status text,price numeric,fetched_at timestamptz);
`;
