import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { importWithPorts } from "./helpers/import-with-ports.mjs";
import { latestCloseNeedsRevalidation } from "../src/lib/market-data/latest-close-refresh-policy.ts";
import { closeCalendarReferenceDateForAsset, resolveSnapshotCycle } from "../src/lib/snapshots/market-calendar.ts";

const target = { ticker: "AAPL", market: "us", currency: "USD" };
const lookup = { ...target, key: "us:USD:AAPL", accounts: [], assetIds: [], assetNames: [] };
let database;
async function fixture({ now: fixtureNow = new Date("2026-09-10T04:10:31Z"), useWallClock = false } = {}) {
  const pg = database ??= new PGlite();
  await pg.exec("drop schema public cascade; create schema public;" + DDL);
  const now = useWallClock ? new Date() : fixtureNow;
  let clock = now;
  const date = closeCalendarReferenceDateForAsset(target, resolveSnapshotCycle(now).snapshotDate);
  let concurrentUpdate;
  const client = new Proxy(pg, { get(object, key) {
    if (key === "query") return async (sql, ...args) => {
      if (concurrentUpdate && sql.startsWith('insert into "asset_price_snapshots"')) {
        const run = concurrentUpdate; concurrentUpdate = null; await run();
      }
      return object.query(sql, ...args);
    };
    const value = Reflect.get(object, key);
    return typeof value === "function" ? value.bind(object) : value;
  } });
  const sqlClient = {
    query: async (sql, parameters = []) => {
      // Direct revalidation tests advance an injected clock. Keep completed-at
      // evidence on that clock too; the durable worker retains PostgreSQL time.
      if (!useWallClock && sql.startsWith("update market_data_sync_runs") && sql.includes("clock_timestamp()")) {
        sql = sql.replaceAll("clock_timestamp()", `$${parameters.length + 1}::timestamptz`);
        parameters = [...parameters, clock.toISOString()];
      }
      return (await pg.query(sql, parameters)).rows;
    },
    async transaction(build) {
      const commands = build({ query: (sql, parameters = []) => ({ sql, parameters }) });
      return pg.transaction(async tx => {
        const rows = [];
        for (const command of commands) rows.push((await tx.query(command.sql, command.parameters)).rows);
        return rows;
      });
    },
  };
  const [revalidation, repository] = await importWithPorts([
    "src/lib/market-data/latest-close-revalidation.ts", "src/lib/market-data/asset-price-snapshot-repository.ts",
  ], { "@/db/client": { db: drizzle(client), sqlClient }, "@/lib/market-data/kis-refresh-lease": { withKisCollectionLease: task => task() } });
  const row = (extra = {}) => ({ ...target, priceDate: date, closePrice: "315.34", adjustedClosePrice: null,
    adjustedCloseBasis: null, adjustedCloseProvider: null, adjustedCloseSource: null, adjustedCloseFetchedAt: null,
    closePriceKrw: null, fxRate: null, providerSymbol: "AAPL", providerExchange: "NAS", fetchedAt: now,
    source: "kis_overseas_dailyprice:NAS", quoteType: "close", status: "ok", isSample: false, ...extra });
  let calls = 0, responseRows;
  const provider = { name: "kis", async fetchClosePrices(targets, context) {
    calls++;
    assert.equal(targets.length, 1); assert.deepEqual(targets[0].assetIds, []);
    assert.equal(context.priceDate, date);
    return { provider: "kis", rows: responseRows ?? [row({ fetchedAt: context.requestedAt })] };
  } };
  return { pg, now, date, row, repository, revalidation, provider, sqlClient, calls: () => calls,
    setRows(rows) { responseRows = rows; },
    race(run) { concurrentUpdate = run; },
    run(at = now, selectedProvider = provider) {
      clock = at;
      return revalidation.revalidateLatestClose({ target, provider: selectedProvider, now: at });
    },
    write(rows) { return repository.applyAssetPriceSnapshotRows({ rows, targets: [lookup], dryRun: false, writePolicy: "kis", allowWrite: true }); },
    async seed(extra = {}) { return repository.applyAssetPriceSnapshotRows({ rows: [row({ closePrice: "317.55", fetchedAt: new Date(now.getTime() - 2 * 3600000), ...extra })], targets: [lookup], dryRun: false, writePolicy: "kis", allowWrite: true }); },
    async stored() { return (await pg.query("select close_price,fetched_at,date::text as date from asset_price_snapshots order by date desc")).rows; },
  };
}

describe("latest shared close revalidation", () => {
  after(async () => { await database?.close(); });
  it("bounds revalidation to one hour and rejects invalid or future freshness evidence", () => {
    const now = new Date("2026-09-10T04:10:31Z");
    const due = (closeFetchedAt, completedAt = null) => latestCloseNeedsRevalidation({ now, closeFetchedAt, completedAt });
    assert.equal(due("2026-09-09T22:57:31Z"), true);
    assert.equal(due("2026-09-10T03:10:31Z"), true);
    assert.equal(due("2026-09-10T03:10:32Z"), false);
    assert.equal(due(null, "2026-09-10T04:00:00Z"), false);
    assert.equal(due("bad", "2026-09-11T04:00:00Z"), true);
  });
  it("corrects the provider-revised AAPL close without inventing a zero change", async () => {
    const f = await fixture(); await f.seed();
    assert.ok((315.34 - Number((await f.stored())[0].close_price)) / 317.55 < -0.006);
    assert.equal((await f.run()).state, "revalidated");
    const stored = (await f.stored())[0];
    assert.equal(Number(stored.close_price), 315.34); assert.equal(stored.date, f.date);
    assert.equal(stored.fetched_at.toISOString(), f.now.toISOString());
    assert.equal((await f.run(new Date(f.now.getTime() + 5 * 60000))).state, "fresh");
    assert.equal(f.calls(), 1);
  });
  it("records an identical exact-date provider observation so many users share its freshness", async () => {
    const f = await fixture(); await f.seed({ closePrice: "315.34" });
    await f.run();
    assert.equal((await f.stored())[0].fetched_at.toISOString(), f.now.toISOString());
    await f.run(new Date(f.now.getTime() + 30 * 60000)); assert.equal(f.calls(), 1);
    await f.run(new Date(f.now.getTime() + 61 * 60000)); assert.equal(f.calls(), 2);
  });
  it("requests the new close date across the 07:00 KST cutoff even when the prior date is fresh", async () => {
    const f = await fixture({ now: new Date("2026-09-10T21:59:00Z") });
    const requestedDates = [];
    const provider = { name: "kis", async fetchClosePrices(_targets, context) {
      requestedDates.push(context.priceDate);
      return { provider: "kis", rows: [f.row({ priceDate: context.priceDate, fetchedAt: context.requestedAt })] };
    } };
    assert.equal((await f.run(f.now, provider)).state, "revalidated");
    const afterCutoff = new Date(f.now.getTime() + 2 * 60000);
    assert.equal((await f.run(afterCutoff, provider)).state, "revalidated");
    assert.deepEqual(requestedDates, ["2026-09-09", "2026-09-10"]);
    assert.deepEqual((await f.stored()).map(row => row.date), ["2026-09-10", "2026-09-09"]);
    assert.equal((await f.run(new Date(afterCutoff.getTime() + 5 * 60000), provider)).state, "fresh");
    assert.equal(requestedDates.length, 2);
  });
  it("negative-caches an earlier actual close without relabeling it or refreshing its observation time", async () => {
    const f = await fixture();
    const prior = new Date(`${f.date}T00:00:00Z`); prior.setUTCDate(prior.getUTCDate() - 1);
    const earlierDate = prior.toISOString().slice(0, 10);
    await f.seed({ priceDate: earlierDate });
    const before = await f.stored();
    f.setRows([f.row({ priceDate: earlierDate })]);
    assert.equal((await f.run()).state, "no_exact_close");
    assert.deepEqual(await f.stored(), before);
    assert.equal((await f.run(new Date(f.now.getTime() + 5 * 60000))).state, "fresh");
    assert.equal(f.calls(), 1);
    assert.equal((await f.pg.query("select metadata_json->>'state' as state from market_data_sync_runs")).rows[0].state, "no_exact_close");
  });
  it("does not mark a failed or wrong-instrument response as a successful revalidation", async () => {
    const f = await fixture(); await f.seed(); const before = await f.stored();
    f.setRows([f.row({ ticker: "QQQ" })]);
    await assert.rejects(f.run(), /provider_unavailable/);
    assert.deepEqual(await f.stored(), before);
    assert.equal((await f.pg.query("select status from market_data_sync_runs")).rows[0].status, "failed");
    f.setRows([f.row()]); assert.equal((await f.run()).state, "revalidated"); assert.equal(f.calls(), 2);
  });
  it("negative-caches an earlier day returned by the actual KIS close adapter", async () => {
    const f = await fixture();
    const prior = new Date(`${f.date}T00:00:00Z`); prior.setUTCDate(prior.getUTCDate() - 1);
    const earlierDate = prior.toISOString().slice(0, 10);
    const previousKey = process.env.KIS_APP_KEY, previousSecret = process.env.KIS_APP_SECRET;
    let requests = 0;
    process.env.KIS_APP_KEY = "fixture-only"; process.env.KIS_APP_SECRET = "fixture-only";
    try {
      const [kis] = await importWithPorts(["src/lib/market-data/providers/kis.ts"], {
        "./kis-token-lifecycle": { getReusableKisAccessToken: async () => "fixture-only" },
        "@/lib/market-data/provider-budget": { fetchKisWithBudget: async (_config, url) => {
          requests++; assert.ok(url.includes("/quotations/dailyprice?"));
          return Response.json({ rt_cd: "0", output2: [{ xymd: earlierDate.replaceAll("-", ""), clos: "315.3400" }] });
        } },
      });
      const provider = kis.createKisMarketDataProvider();
      assert.equal((await f.run(f.now, provider)).state, "no_exact_close");
      assert.equal((await f.run(new Date(f.now.getTime() + 5 * 60000), provider)).state, "fresh");
      assert.equal(requests, 1); assert.deepEqual(await f.stored(), []);
    } finally {
      if (previousKey === undefined) delete process.env.KIS_APP_KEY; else process.env.KIS_APP_KEY = previousKey;
      if (previousSecret === undefined) delete process.env.KIS_APP_SECRET; else process.env.KIS_APP_SECRET = previousSecret;
    }
  });
  it("rejects a future close date without negative-caching a successful earlier-day reply", async () => {
    const f = await fixture(); await f.seed(); const before = await f.stored();
    const future = new Date(`${f.date}T00:00:00Z`); future.setUTCDate(future.getUTCDate() + 1);
    f.setRows([f.row({ priceDate: future.toISOString().slice(0, 10) })]);
    await assert.rejects(f.run(), /provider_unavailable/);
    assert.deepEqual(await f.stored(), before);
    assert.equal((await f.pg.query("select status from market_data_sync_runs")).rows[0].status, "failed");
  });
  it("fences an older provider observation before and during the upsert", async () => {
    const f = await fixture(); await f.seed({ closePrice: "315.34", fetchedAt: f.now });
    let result = await f.write([f.row({ closePrice: "317.55", fetchedAt: new Date(f.now.getTime() - 60000) })]);
    assert.equal(result.skippedCount, 1); assert.equal(result.results[0].reason, "older_provider_observation");
    const later = new Date(f.now.getTime() + 2 * 60000);
    f.race(() => f.pg.query("update asset_price_snapshots set close_price=316,fetched_at=$1", [later]));
    result = await f.write([f.row({ closePrice: "314", fetchedAt: new Date(f.now.getTime() + 60000) })]);
    assert.equal(result.skippedCount, 1);
    const stored = (await f.stored())[0]; assert.equal(Number(stored.close_price), 316); assert.equal(stored.fetched_at.toISOString(), later.toISOString());
  });
  it("retains a failed close check in the durable queue and retries it without refetching a fresh live quote", async () => {
    const f = await fixture({ useWallClock: true }); await f.seed();
    await f.pg.exec(readFileSync("drizzle/0043_powerful_living_tribunal.sql", "utf8"));
    await f.pg.exec("create table live_price_quotes(id uuid default gen_random_uuid(),ticker text,market text,currency text,provider text,status text,price numeric,fetched_at timestamptz)");
    let liveCalls = 0;
    const [queue, worker] = await importWithPorts(["src/lib/market-data/collection-queue.ts", "src/lib/market-data/collection-worker.ts"], {
      "next/server": { after: () => assert.fail("This fixture drains the durable worker directly") },
      "@/db/client": { db: drizzle(f.pg), sqlClient: f.sqlClient },
      "@/lib/market-data/latest-close-revalidation": { revalidateLatestClose: f.revalidation.revalidateLatestClose },
      "@/lib/market-data/providers/kis": {
        getKisProviderPolicy: () => ({ configured: true }), createKisProviderRequestSession: () => ({}), createKisMarketDataProvider: () => f.provider,
        fetchKisUsdKrwFxCandidate: () => assert.fail("No FX job was enqueued"),
      },
      "@/lib/market-data/kis-refresh-lease": { KisRefreshLeaseBusyError: class extends Error {}, withKisCollectionLease: task => task() },
      "@/lib/market-data/provider-budget": { withKisCollectionDeadline: task => task() },
      "@/lib/market-data/price-sync": { runMarketPriceSync: async input => {
        liveCalls++; assert.deepEqual(input.explicitTargets, [target]);
        await f.pg.query("insert into live_price_quotes(ticker,market,currency,provider,status,price,fetched_at) values('AAPL','us','USD','kis','ok',315.34,clock_timestamp())");
        return { successCount: 1, failedCount: 0 };
      } },
      "@/lib/market-data/kis-history-cache-sync": { runKisHistoryCacheSync: () => assert.fail("No history job was enqueued") },
      "@/lib/market-data/fx-refresh-job": { runUsdKrwFxCandidateJob: () => assert.fail("No FX job was enqueued") },
    });
    f.setRows([f.row({ status: "error" })]);
    await queue.enqueueMarketCollection([{ ...target, kind: "live" }]);
    let result = await worker.drainMarketCollection();
    assert.equal(result.failed, 1);
    let state = (await f.pg.query("select status,attempts,available_at>clock_timestamp() as backed_off,last_code from market_collection_jobs")).rows[0];
    assert.equal(state.status, "pending"); assert.equal(state.attempts, 1); assert.equal(state.backed_off, true);
    assert.equal(state.last_code, "provider_unavailable"); assert.equal(liveCalls, 1); assert.equal(f.calls(), 1);
    f.setRows([f.row()]);
    await f.pg.exec("update market_collection_jobs set available_at=clock_timestamp()-interval '1 second'");
    result = await worker.drainMarketCollection();
    state = (await f.pg.query("select status from market_collection_jobs")).rows[0];
    assert.equal(result.failed, 0); assert.equal(state.status, "done");
    assert.equal(liveCalls, 1); assert.equal(f.calls(), 2); assert.equal(Number((await f.stored())[0].close_price), 315.34);
  });
});

const DDL = `
create table market_data_sync_runs(id uuid primary key default gen_random_uuid(),job_type text not null,mode text,status text not null,started_at timestamptz not null,finished_at timestamptz,source text,requested_count integer,success_count integer,failed_count integer,skipped_count integer,metadata_json jsonb,error text,created_at timestamptz default now());
create table asset_price_snapshots(id uuid primary key default gen_random_uuid(),legacy_base44_id text,date date not null,ticker text not null,asset_id uuid,market text not null,currency text not null,close_price numeric not null,adjusted_close_price numeric,adjusted_close_basis text,adjusted_close_provider text,adjusted_close_source text,adjusted_close_fetched_at timestamptz,close_price_krw numeric,fx_rate numeric,source text,provider_symbol text,provider_exchange text,fetched_at timestamptz,is_sample boolean not null default false,base44_created_at timestamptz,base44_updated_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(market,currency,ticker,date));
`;
