import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { drizzle as queryTransport } from "drizzle-orm/pg-proxy";
import { importWithPorts } from "./helpers/import-with-ports.mjs";
import { projectLabNativeEvents } from "../src/lib/investment-lab-native-events.ts";
import { buildInvestmentLabAnalysisScopeEvidence } from "../src/lib/investment-lab-analysis-scope.ts";
import { resolveInvestmentLabBoundaryFlows } from "../src/lib/investment-lab-counterfactual-read-model.ts";

const accountId = randomUUID(), assetId = randomUUID(), owner = randomUUID(), other = randomUUID();
const at = "2026-01-05T10:00:00.000Z";
const trade = { type: "buy", assetId, at, quantity: "0.123", currency: "USD",
  executionUnitPrice: {currency:"USD",amount:"127.5"}, settlementStatus:"unconfirmed", fee:{currency:"USD",amount:"99.99"} };
const rate = {base:"USD",quote:"KRW",kind:"daily_reference",source:"fixture",rate:"1234",observedAt:"2026-01-04T09:00:00Z",fetchedAt:"2026-01-04T10:00:00Z"};
const row = (event, overrides = {}) => ({ accountId, account:"brokerage", sequence:1, linkedAssetId:assetId,
  assetName:"Synthetic Alpha",legacyAssetId:null,market:"us",assetType:"stock",event,...overrides });
const scope = {kind:"account", accountId, accountCode:"brokerage"};
const evidence = (events, options = {}) => buildInvestmentLabAnalysisScopeEvidence({
  scope, accounts:[{id:accountId,code:"brokerage",isActive:true}], events, positions:[], provenanceRows:[], ...options,
});

it("keeps recorded KRW, unconfirmed execution and trade-time FX separate from bank fees or present-day rates", () => {
  const usd = row(trade);
  const settled = row({...trade,type:"sell",settlementStatus:undefined,executionUnitPrice:undefined,settlement:{currency:"KRW",amount:"7000"}});
  const executionKrw = row({...trade,currency:"KRW",executionUnitPrice:{currency:"KRW",amount:"1234"}});
  const result = projectLabNativeEvents([usd, settled, executionKrw], [rate]);
  assert.deepEqual(result.map(r=>r.amountKrw), ["19352.205","7000","151.782"]);
  assert.deepEqual(result.map(r=>r.nativeTrace.basis), ["historical_fx","recorded_krw","reported_execution_krw"]);
  const flows = resolveInvestmentLabBoundaryFlows(evidence(result).eventRows,"brokerage");
  assert.equal(flows.status,"ready");
  assert.deepEqual(flows.flows.map(f=>f.direction),["inflow","outflow","inflow"]);
  for (const rates of [[],[{...rate,kind:"spot"}],[{...rate,observedAt:"2025-12-31T00:00:00Z"}],
    [{...rate,observedAt:"2026-01-06T00:00:00Z",fetchedAt:"2026-01-06T01:00:00Z"}],[rate,{...rate,rate:"9999"}]]) {
    const blocked = evidence(projectLabNativeEvents([usd],rates));
    assert.deepEqual(blocked.nativeTradeEvidence.blocked,[{date:"2026-01-05",reason:"fx_missing",label:"Synthetic Alpha"}]);
    assert.equal(blocked.eventRows[0].amountKrw,null);
    assert.equal(resolveInvestmentLabBoundaryFlows(blocked.eventRows,"brokerage").status,"blocked");
  }
});

it("preserves the reported day, opening boundary, scoped identity, and missing linked instrument", () => {
  const dateEvidence = {precision:"date_only",reportedDate:"2026-01-05",timeZone:"Asia/Seoul",policy:"service_day_midpoint"};
  const rows = projectLabNativeEvents([
    row({type:"opening",at:"2026-01-01T00:00:00Z"},{linkedAssetId:null,assetName:null}),
    row({...trade,dateEvidence}), row({...trade,assetId:randomUUID()},{linkedAssetId:null}), row({type:"fee",at}),
  ],[rate]);
  assert.equal(rows.length,3);
  assert.equal(rows[1].eventDate,"2026-01-05");
  assert.equal(evidence(rows).eventRows[0].eventType,"opening");
  assert.deepEqual(evidence(rows).nativeTradeEvidence.blocked.map(r=>r.reason),["opening_boundary","unsupported"]);
  assert.throws(()=>projectLabNativeEvents([row({...trade,dateEvidence:{...dateEvidence,reportedDate:"2026-01-04"}})],[]));
  const bothLedgers = evidence([rows[1],{...rows[1],nativeTrace:undefined}]);
  assert.equal(bothLedgers.nativeTradeEvidence.blocked[0].reason,"unsupported");
});

it("reads the effective scoped ledger through owner RLS and prices the corrected trade using the shared stored FX query", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`create role varda_tenant_app;create function investment_plan_tenant_active() returns boolean language sql as 'select true';
      create table app_users(id uuid primary key);create table accounts(id uuid primary key,canonical_owner_user_id uuid,code text,is_active boolean);
      create table assets(id uuid primary key,canonical_owner_user_id uuid,account_id uuid,name text,market text,asset_type text,legacy_base44_id text);
      create table event_ledger_entries(id uuid primary key,canonical_owner_user_id uuid,account_id uuid,native_operation_id uuid,native_sequence int,native_data jsonb,recorded_at timestamptz default now());
      create table fx_rates(usdkrw numeric, observed_at timestamptz,fetched_at timestamptz,source text,rate_kind text,status text,is_sample boolean);
      grant usage on schema public to varda_tenant_app;`);
    for (const table of ["accounts","assets","event_ledger_entries"]) {
      await pg.exec(`alter table ${table} enable row level security; alter table ${table} force row level security;
        create policy owner_read on ${table} for select to varda_tenant_app using(canonical_owner_user_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
        grant select on ${table} to varda_tenant_app;`);
    }
    const migration = readFileSync(new URL("../drizzle/0059_trade_daily_reliability.sql",import.meta.url),"utf8");
    await pg.exec(migration.slice(0,migration.indexOf("-- An uncertain request")));
    await pg.query("insert into app_users values($1),($2)",[owner,other]);
    await pg.query("insert into accounts values($1,$2,'brokerage',true)",[accountId,owner]);
    await pg.query("insert into assets values($1,$2,$3,'Synthetic Alpha','us','stock',null)",[assetId,owner,accountId]);
    await pg.query("insert into fx_rates values($1,$2,$3,'fixture','daily_reference','ok',false)",[rate.rate,rate.observedAt,rate.fetchedAt]);
    const tradeId=randomUUID(), openingId=randomUUID(), removedId=randomUUID();
    for (const [sequence,id] of [[1,tradeId],[2,removedId]]) {
      await pg.query("insert into event_ledger_entries(id,canonical_owner_user_id,account_id,native_operation_id,native_sequence,native_data) values($1,$2,$3,$1,$4,$5)",
        [id,owner,accountId,sequence,JSON.stringify({event:{...trade,quantity:"99"},state:{sequence}})]);
    }
    const revised = [{id:openingId,operationId:openingId,data:{event:{type:"opening",at:"2026-01-01T00:00:00Z"},state:{sequence:0,positions:[{assetId}]}}},
      {id:tradeId,operationId:tradeId,data:{event:trade,state:{sequence:1}}}];
    await pg.query("insert into native_ledger_revisions(canonical_owner_user_id,account_id,operation_id,marker_sequence,affected_at,reason,effective_entries) values($1,$2,$3,3,$4,'fixture',$5)",
      [owner,accountId,randomUUID(),at,JSON.stringify(revised)]);
    const tenantSql = {transaction:async(make,opts)=>{
      assert.equal(opts.readOnly,true);
      return pg.transaction(async tx=>{
        await tx.exec("set local role varda_tenant_app");
        const results=[];
        for(const [query,params] of make({query:(query,params)=>[query,params]})) results.push((await tx.query(query,params)).rows);
        return results;
      });
    }};
    const [query] = await importWithPorts(["src/db/queries/investment-lab-native-events.ts"],{
      "@/db/tenant-client":{getTenantSqlClient:()=>tenantSql}, "@/db/client":{db:drizzle(pg)},
    });
    const events = await query.loadLabNativeEvents({ownerUserId:owner},accountId);
    assert.deepEqual(events.map(e=>e.eventType),["opening","buy"]);
    assert.equal(events[1].amountKrw,"19352.205");
    await assert.rejects(()=>query.loadLabNativeEvents({ownerUserId:other},accountId),/opening_missing/);
  } finally {await pg.close();}
});

it("opts in only at the beta server entrance and leaves the original page and performance query on their existing inputs", async () => {
  const queries = [];
  const db = queryTransport(async (query, params) => {
    queries.push({query,params});
    if (query.includes('from "accounts"')) {
      return {rows:[query.includes('"native_state"') ? [accountId,"brokerage",true,true] : [accountId,"brokerage",true]]};
    }
    return {rows:[]};
  });
  let nativeCalls=0;
  const args={scope,tenantContext:{ownerUserId:owner}};
  const [original,beta]=await importWithPorts(["src/db/queries/investment-lab-scope-evidence.ts","src/lib/cairn-v2/server-lab.ts"],{
    "@/db/client":{db},
    "@/db/queries/tenant-group-reads":{loadTenantPortfolioGroupMemberships:()=>({accountMemberships:[],assetMemberships:[]})},
    "@/db/queries/investment-lab-native-events":{loadLabNativeEvents(_tenant,id){
      nativeCalls++; assert.equal(id,accountId);return projectLabNativeEvents([row(trade)],[]);
    }},
    "@/lib/auth/current-tenant-context":{resolveCurrentTenantContext:()=>{}},
    "@/db/queries/portfolio-analysis-scopes":{getReadOnlyTenantPortfolioAnalysisScopeContext:()=>{}},
    "@/db/queries/investment-lab":{getReadOnlyTenantInvestmentLabCounterfactualForScope:()=>{}},
    "@/lib/cairn-v2/lab-service":{readBetaLab:(_p,ports)=>ports.evidence(args)},
  });
  const previous=await original.getReadOnlyTenantInvestmentLabAnalysisScopeEvidence(args);
  assert.equal(previous.nativeTradeEvidence,undefined);
  assert.equal(nativeCalls,0);
  const rawEvents=()=>queries.find(({query})=>query.includes('from "event_ledger_entries"'));
  assert.doesNotMatch(rawEvents().query,/"native_data" is null/);
  assert.ok(rawEvents().params.includes(owner));
  for (const scoped of [{kind:"all"},{kind:"portfolio_group",portfolioGroupId:randomUUID()}]) {
    queries.length=0;
    await original.getReadOnlyTenantInvestmentLabAnalysisScopeEvidence({...args,scope:scoped,includeEffectiveNativeTrades:true});
    assert.equal(nativeCalls,0);
    assert.doesNotMatch(rawEvents().query,/"native_data" is null/);
  }
  queries.length=0;
  const next=await beta.getBetaLabRead({});
  assert.equal(nativeCalls,1);
  assert.match(rawEvents().query,/"native_data" is null/);
  assert.deepEqual(next.nativeTradeEvidence.blocked,[{date:"2026-01-05",reason:"fx_missing",label:"Synthetic Alpha"}]);
});
