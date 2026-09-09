import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { importWithPorts } from "./helpers/import-with-ports.mjs";
import { normalizeCollectionJobs, collectionRetrySeconds } from "../src/lib/market-data/collection-policy.ts";

let pg;
async function fixture() {
  pg ??= new PGlite();
  await pg.exec("drop schema public cascade; create schema public;" + readFileSync("drizzle/0043_powerful_living_tribunal.sql", "utf8"));
  const sqlClient = {
    query: async (sql, parameters=[]) => (await pg.query(sql, parameters)).rows,
    async transaction(build) {
      const commands=build({query:(sql,parameters=[])=>({sql,parameters})});
      return pg.transaction(async tx=>{
        const results=[];
        for (const command of commands) results.push((await tx.query(command.sql,command.parameters)).rows);
        return results;
      });
    },
  };
  const [queue,budget]=await importWithPorts(["src/lib/market-data/collection-queue.ts","src/lib/market-data/provider-budget.ts"], {"@/db/client":{sqlClient}});
  return {queue,budget,pg};
}
const target=(ticker="VOO",kind="live")=>({ticker,kind,market:"us",currency:"USD"});

describe("durable market collection and distributed provider budgets",()=>{
  after(async()=>{await pg?.close();});
  it("normalizes exact identity and bounds history work without synthetic prices",()=>{
    assert.equal(normalizeCollectionJobs([target(),{...target(),ticker:"voo",currency:"usd"}]).length,1);
    assert.throws(()=>normalizeCollectionJobs([{...target(),currency:"KRW"}]),/identity/);
    assert.throws(()=>normalizeCollectionJobs(Array.from({length:41},()=>target())),/target_limit/);
    const jobs=normalizeCollectionJobs([{...target("VOO","history"),startDate:"2025-08-01",endDate:"2026-09-08"}]);
    assert.ok(jobs.length>=4 && jobs.length<=6);
    assert.ok(jobs.every(job=>(Date.parse(job.endDate)-Date.parse(job.startDate))/86400000<90));
    assert.equal(collectionRetrySeconds(1,0),15);
    assert.ok(collectionRetrySeconds(6,0)>collectionRetrySeconds(1,0));
  });
  it("coalesces many users into one instrument job without moving its FIFO position",async()=>{
    const {queue,pg}=await fixture();
    await queue.enqueueMarketCollection([target()]);
    const before=(await pg.query("select enqueued_at from market_collection_jobs")).rows[0].enqueued_at;
    await Promise.all(Array.from({length:10},()=>queue.enqueueMarketCollection([target()])));
    const rows=(await pg.query("select * from market_collection_jobs")).rows;
    assert.equal(rows.length,1); assert.equal(rows[0].request_count,11); assert.deepEqual(rows[0].enqueued_at,before);
    assert.equal((await queue.getMarketCollectionSummary()).mergedRequests,10);
  });
  it("claims once, recovers expired workers, and fences a stale completion",async()=>{
    const {queue,pg}=await fixture();
    await queue.enqueueMarketCollection([target()]);
    const first=await queue.claimMarketCollection(); assert.ok(first);
    assert.equal(await queue.claimMarketCollection(),null);
    await pg.exec("update market_collection_jobs set leased_until=now()-interval '1 second'");
    const replacement=await queue.claimMarketCollection(); assert.ok(replacement); assert.notEqual(first.claimToken,replacement.claimToken);
    await queue.finishMarketCollection(first,{ok:true,code:"collected"});
    assert.equal((await pg.query("select status from market_collection_jobs")).rows[0].status,"running");
    await queue.finishMarketCollection(replacement,{ok:true,code:"collected"});
    assert.equal((await pg.query("select status from market_collection_jobs")).rows[0].status,"done");
  });
  it("lets aged history precede newer live work and moves failed work into backoff",async()=>{
    const {queue,pg}=await fixture();
    await queue.enqueueMarketCollection([{...target("QQQ","history"),startDate:"2026-09-08",endDate:"2026-09-08"}]);
    await pg.exec("update market_collection_jobs set enqueued_at=now()-interval '2 minutes'");
    await queue.enqueueMarketCollection([target()]);
    const history=await queue.claimMarketCollection(); assert.equal(history.kind,"history");
    await queue.finishMarketCollection(history,{ok:false,code:"provider_unavailable",retryAfterSeconds:60});
    assert.equal((await queue.claimMarketCollection()).kind,"live");
    assert.equal(await queue.claimMarketCollection(),null);
  });
  it("terminates abandoned final attempts and bounds retained terminal jobs",async()=>{
    const {queue,pg}=await fixture();
    await queue.enqueueMarketCollection([target()]);
    await pg.exec("update market_collection_jobs set status='running',attempts=6,leased_until=now()-interval '1 minute'");
    await queue.maintainMarketCollection();
    assert.equal((await pg.query("select status from market_collection_jobs")).rows[0].status,"failed");
    await pg.exec("update market_collection_jobs set updated_at=now()-interval '8 days'");
    await queue.maintainMarketCollection();
    assert.equal((await pg.query("select count(*)::integer as count from market_collection_jobs")).rows[0].count,0);
  });
  it("does not reset pending backoff and lets actual cache freshness govern completed live re-entry",async()=>{
    const {queue,pg}=await fixture();
    await queue.enqueueMarketCollection([target()]);
    const claim=await queue.claimMarketCollection();
    await queue.finishMarketCollection(claim,{ok:false,code:"provider_unavailable",retryAfterSeconds:60});
    await queue.enqueueMarketCollection([target()]); assert.equal(await queue.claimMarketCollection(),null);
    await pg.exec("update market_collection_jobs set available_at=now()-interval '1 second'");
    await queue.finishMarketCollection(await queue.claimMarketCollection(),{ok:true,code:"collected"});
    await queue.enqueueMarketCollection([target()]); assert.ok(await queue.claimMarketCollection());
  });
  it("does not exhaust instrument attempts while the provider budget is cooling down",async()=>{
    const {queue,pg}=await fixture();
    await queue.enqueueMarketCollection([target()]);
    for(let index=0;index<8;index++) {
      const claim=await queue.claimMarketCollection(); assert.ok(claim);
      await queue.finishMarketCollection(claim,{ok:false,code:"provider_budget_wait",deferred:true,retryAfterSeconds:3600});
      const row=(await pg.query("select attempts,status from market_collection_jobs")).rows[0];
      assert.equal(row.attempts,0); assert.equal(row.status,"pending");
      assert.equal(await queue.claimMarketCollection(),null);
      await pg.exec("update market_collection_jobs set available_at=now()-interval '1 second'");
    }
  });
  it("replaces a failed shared FX candidate without modifying an in-flight claim",async()=>{
    const {queue,pg}=await fixture();
    await queue.enqueueMarketCollection([target("BAD","fx")]);
    const first=await queue.claimMarketCollection();
    await queue.enqueueMarketCollection([target("VOO","fx")]);
    assert.equal((await pg.query("select ticker from market_collection_jobs")).rows[0].ticker,"BAD");
    await queue.finishMarketCollection(first,{ok:false,code:"provider_unavailable",retryAfterSeconds:60});
    await queue.enqueueMarketCollection([target("VOO","fx")]);
    assert.equal((await pg.query("select ticker from market_collection_jobs")).rows[0].ticker,"VOO");
    assert.equal(await queue.claimMarketCollection(),null);
  });
  it("reserves a credential budget atomically before request count can exceed its cap",async()=>{
    const {budget,pg}=await fixture();
    const scope="a".repeat(64), policy={requestsPerMinute:1,minimumIntervalMs:100,tokenMinimumIntervalSeconds:60};
    const results=await Promise.all([budget.reserveKisRequest(scope,"price",policy),budget.reserveKisRequest(scope,"price",policy)]);
    assert.equal(results.filter(value=>value===0).length,1); assert.ok(results.some(value=>value>0));
    assert.equal((await pg.query("select request_count from market_provider_budgets")).rows[0].request_count,1);
    assert.equal(await budget.reserveKisRequest("b".repeat(64),"price",policy),0);
  });
  it("applies a separate token issuance cooldown without storing any token",async()=>{
    const {budget,pg}=await fixture();
    const scope="c".repeat(64),policy={requestsPerMinute:60,minimumIntervalMs:100,tokenMinimumIntervalSeconds:60};
    assert.equal(await budget.reserveKisRequest(scope,"token",policy),0);
    await pg.exec("update market_provider_budgets set next_allowed_at=now()-interval '1 second'");
    assert.equal(await budget.reserveKisRequest(scope,"price",policy),0);
    assert.ok(await budget.reserveKisRequest(scope,"token",policy)>0);
    const columns=(await pg.query("select column_name from information_schema.columns where table_name='market_provider_budgets'")).rows.map(row=>row.column_name);
    assert.ok(!columns.some(name=>/access_token|app_key|app_secret|owner|account/.test(name)));
  });
  it("backs off after actual provider throttling and blocks subsequent transport",async()=>{
    const {budget}=await fixture();
    const originalFetch=globalThis.fetch; let calls=0;
    globalThis.fetch=async()=>{calls++;return Response.json({msg_cd:"EGW00201"});};
    try {
      const config={baseUrl:"https://fixture.invalid",appKey:"fixture-only"};
      await assert.rejects(budget.fetchKisWithBudget(config,"https://fixture.invalid/quote",{}),error=>error.code==="provider_budget_limited"&&error.retryAfterSeconds>=15);
      await assert.rejects(budget.fetchKisWithBudget(config,"https://fixture.invalid/quote",{}),error=>error.code==="provider_budget_limited");
      assert.equal(calls,1);
      const summary=await budget.getKisRequestBudgetSummary(); assert.equal(summary.requests,1); assert.ok(summary.limited>=1);
    } finally { globalThis.fetch=originalFetch; }
  });
  it("enables deny-by-default RLS on both operational tables",async()=>{
    const {pg}=await fixture();
    const rows=(await pg.query("select relname,relrowsecurity from pg_class where relname in ('market_collection_jobs','market_provider_budgets')")).rows;
    assert.equal(rows.length,2); assert.ok(rows.every(row=>row.relrowsecurity));
    assert.equal((await pg.query("select count(*)::integer as count from pg_policies where tablename in ('market_collection_jobs','market_provider_budgets')")).rows[0].count,0);
  });
  it("stops before another HTTP request when a background worker has reached its deadline",async()=>{
    const {budget}=await fixture(); const originalNow=Date.now;
    let now=originalNow(); Date.now=()=>now;
    try {
      await budget.withKisCollectionDeadline(async()=>{
        now+=46000;
        await assert.rejects(budget.fetchKisWithBudget({baseUrl:"https://fixture.invalid",appKey:"fixture-only"},"https://fixture.invalid/quote",{}),error=>error.code==="provider_budget_limited");
      });
    } finally { Date.now=originalNow; }
  });
});
