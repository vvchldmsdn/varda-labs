import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { importWithPorts } from "./helpers/import-with-ports.mjs";
import { INVESTMENT_LAB_MODIFIED_DIETZ_POLICY } from "../src/lib/investment-lab-modified-dietz.ts";

const id = n => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const owner = id(1), other = id(2), account = id(3), native = id(4), foreign = id(5);
const sold = id(10), held = id(11), nativeHolding = id(12);
const day = "2025-06-02";
const range = { start: day, end: day };

async function setup(pg) {
  await pg.exec(`
    create table accounts(id uuid primary key,canonical_owner_user_id uuid,name text,code text,sort_order int,is_active boolean default true,native_state jsonb,unique(id,canonical_owner_user_id));
    create table assets(id uuid primary key,canonical_owner_user_id uuid,account_id uuid,legacy_base44_id text,name text,ticker text,market text,currency text,archived_at timestamptz);
    create table native_ledger_revisions(canonical_owner_user_id uuid,account_id uuid,marker_sequence int,affected_at timestamptz,recorded_at timestamptz,operation_id uuid);
    create table broker_recovery_batches(canonical_owner_user_id uuid,account_id uuid,manifest jsonb,recorded_at timestamptz);
    create table recovered_close_valuations(canonical_owner_user_id uuid,account_id uuid,revision int,valuation_date date,value_krw numeric);
    create table daily_portfolio_snapshots(id uuid default gen_random_uuid(),canonical_owner_user_id uuid,account_id uuid,account text,source text,snapshot_date date,
      cycle_end_at timestamptz,captured_at timestamptz,created_at timestamptz default now(),updated_at timestamptz,description text,is_sample boolean default false,num_assets int,native_evidence jsonb,usdkrw numeric,rule_version text,closing_performance jsonb,total_market_value numeric);
    create table daily_position_snapshots(id uuid default gen_random_uuid(),canonical_owner_user_id uuid,account_id uuid,account text,source text,snapshot_date date,
      cycle_end_at timestamptz,captured_at timestamptz,created_at timestamptz default now(),updated_at timestamptz,description text,is_sample boolean default false,
      asset_id uuid,legacy_asset_id text,asset_name text,ticker text,market text,currency text,quantity numeric,total_quantity numeric,estimated_fractional_quantity numeric,
      price_source text,price_basis text,price_date date,reference_date date,unit_price numeric,current_price numeric,close_price numeric,fx_rate numeric,fractional_krw_value numeric,market_value_krw numeric);
    create table event_ledger_entries(id uuid default gen_random_uuid(),canonical_owner_user_id uuid,account_id uuid,asset_id uuid,asset_name text,ticker text,
      legacy_base44_id text,legacy_asset_id text,corrects_event_id uuid,legacy_corrects_event_id text,broker_recovery_data jsonb,native_data jsonb,
      rule_version text,native_operation_id uuid,native_sequence int,
      recorded_at timestamptz,created_at timestamptz default now(),is_sample boolean default false,event_date date,event_type text,quantity_delta numeric,price numeric,fx_rate numeric,amount_krw numeric);
    create view effective_native_ledger_entries as select * from event_ledger_entries where native_data is not null;
    create role varda_tenant_app;`);
  await pg.exec(readFileSync(new URL("../drizzle/0066_account_history_reviews.sql", import.meta.url), "utf8"));
  await pg.query("insert into accounts(id,canonical_owner_user_id,code,name,sort_order,native_state) values($1,$2,'acct','Desk',1,null),($3,$2,'native','Native',2,$4),($5,$6,'foreign','Other',3,null)",
    [account,owner,native,JSON.stringify({startedAt:"2025-04-01T00:00:00Z"}),foreign,other]);
  await pg.query("insert into assets values($1,$2,$3,null,'Sold ETF','OUT','us','USD',now()),($4,$2,$3,null,'Held ETF','IN','us','USD',null),($5,$2,$6,null,'Native stock','N','korea','KRW',null)",
    [sold,owner,account,held,nativeHolding,native]);
}

function tenantReadPort(pg) {
  return {
    runTenantReadTransaction: (ownerId, queryFactory) => pg.transaction(async tx => {
      await tx.query("select set_config('app.current_user_id',$1,true)", [ownerId]);
      const work = queryFactory({query: (sql,args) => [sql,args]});
      const results = [];
      for (const [sql,args] of work) results.push((await tx.query(sql,args)).rows);
      return results;
    }),
  };
}

function reader(pg, metric="attribution", readPerformanceMarks = async () => { throw new Error("unexpected_current_read"); }) {
  return importWithPorts(["src/lib/cairn-v2/period-attribution-read.ts"], {
    "@/lib/cairn-v2/period-performance-market-read": { readPerformanceMarks },
    "@/db/tenant-transaction-context": tenantReadPort(pg),
  }).then(([module]) => (who, selected, r=range, options={}) => (metric==="return" ? module.readPeriodPerformance : module.readPeriodAttribution)({tenantContext:{ownerUserId:who},
    scope:selected ? {kind:"account",accountId:selected} : {kind:"all"},range:r,...options}));
}

test("stored corrected closes supply inception returns, post-close trades and a consistent shorter window", async () => {
  const pg = new PGlite();
  try {
    await setup(pg);
    const mark = async (cutoff,quantity,price,receipt=null) => {
      const value = quantity*price;
      await pg.query(`insert into daily_portfolio_snapshots(canonical_owner_user_id,account_id,account,snapshot_date,source,
        cycle_end_at,num_assets,total_market_value,description,closing_performance,rule_version)
        values ($1,$2,'acct',$3,'varda_manual_daily_snapshot',($3::date+time '07:00') at time zone 'Asia/Seoul',
        1,$4,'snapshot_status=complete',$5,$6)`,
        [owner,account,cutoff,value,receipt && JSON.stringify(receipt),receipt ? "broker_account_review_close_v1" : null]);
      await pg.query(`insert into daily_position_snapshots(canonical_owner_user_id,account_id,account,asset_id,snapshot_date,source,
        asset_name,ticker,market,currency,quantity,unit_price,fx_rate,market_value_krw)
        values ($1,$2,'acct',$3,$4,'varda_manual_daily_snapshot','Held ETF','IN','us','USD',$5,$6,1,$7)`,
        [owner,account,held,cutoff,quantity,price,value]);
    };
    const approved = {version:1,date:"2026-11-23",basis:"invested_assets_excluding_cash",currency:"KRW",dailyReturnPct:3.5,
      returnPct:14,segment:"2025-11-24",reviewEstimated:true,reviewEvidenceHash:"b".repeat(64),excludedLabels:["Excluded"],excludedTickers:["OUT"],reviewedTrades:[]};
    await mark("2026-11-24",10,100,approved);
    await mark("2026-11-25",10,105);
    await mark("2026-11-26",11,110);
    await pg.query(`insert into event_ledger_entries(canonical_owner_user_id,account_id,asset_id,event_type,event_date,asset_name,ticker,quantity_delta,amount_krw,price,fx_rate)
      values ($1,$2,$3,'buy','2026-11-25','Held ETF','IN',1,110,110,1),($1,$2,$4,'buy','2026-11-24','Excluded','OUT',1,500,500,1)`,
      [owner,account,held,sold]);
    const read = await reader(pg,"return");
    const all = await read(owner,account,{start:"2026-11-22",end:"2026-11-25"},{includeLive:false});
    const [base,next,last] = all.points.slice(1);
    assert.equal(base.returnPct,14); assert.equal(base.dailyReturnPct,3.5);
    assert.equal(base.canonicalClose,true); assert.equal(next.segment,approved.segment);
    assert.ok(Math.abs(next.dailyReturnPct-5)<1e-10);
    assert.ok(Math.abs(next.returnPct-19.7)<1e-10);
    assert.ok(last.dailyReturnPct > 0 && last.dailyReturnPct < 5 && last.reviewEstimated);
    const short=await read(owner,account,{start:"2026-11-25",end:"2026-11-25"},{includeLive:false});
    assert.deepEqual(short.points,[last]);
    const impact=await (await reader(pg))(owner,account,{start:"2026-11-24",end:"2026-11-24"});
    assert.equal(impact.days[0].closingValueKrw,1050);
    assert.equal(impact.days[0].priceKrw,50);
    await pg.query(`update daily_position_snapshots set quantity=quantity+1 where account_id=$1 and snapshot_date='2026-11-25'`,[account]);
    const broken=await read(owner,account,{start:"2026-11-23",end:"2026-11-24"},{includeLive:false});
    assert.equal(broken.points.at(-1).returnPct,null);
  } finally { await pg.close() }
});

test("attribution follows the same owned reviewed points, with a gap if detailed evidence is absent", async () => {
  const pg = new PGlite();
  try {
    await setup(pg);
    const read = await reader(pg);
    const end = "2025-06-03";
    const cutoffs = ["2025-06-02", "2025-06-03", "2025-06-04"];
    const position = (price, fxRate) => ({key:"USD:IN", name:"Held ETF", ticker:"IN", market:"us", currency:"USD",
      quantity:2, price, fxRate, valueKrw: 2 * price * fxRate});
    const points = [position(100,1000), position(101,1200), position(100,1300)].map((mark, i) => ({
      date:cutoffs[i], valueKrw:mark.valueKrw, segment:cutoffs[0], estimated:i>0, returnPct:i,
      dailyReturnPct:i>0?i:null, ...(i<2 ? {positions:[mark],trades:[]} : {}),
    }));
    await pg.query(`insert into account_history_reviews(canonical_owner_user_id,account_id,evidence_hash,captured_revision,start_date,end_date,excluded_labels,points,evidence)
      values($1,$2,$3,0,$4,$5,array[]::text[],$6::jsonb,$7::jsonb)`, [
      owner, account, "a".repeat(64), cutoffs[0], cutoffs[2], JSON.stringify(points),
      JSON.stringify({version:1,basis:"reviewed_holdings_excluding_cash",currency:"KRW"}),
    ]);
    const result = await read(owner, account, {start:day,end});
    assert.equal(result.state,"partial");
    assert.deepEqual(result.days, [
      {date:day, closingValueKrw:242400, priceKrw:2000, fxKrw:40400, complete:true, reviewed:true, estimated:true},
      {date:end, closingValueKrw:260000, priceKrw:null, fxKrw:null, complete:false, reviewed:true, estimated:true},
    ]);
    assert.equal((await read(other, account, {start:day,end})).days[0].closingValueKrw, null);
    assert.equal((await read(owner, native, {start:day,end})).days[0].closingValueKrw, null);
    await pg.query("insert into native_ledger_revisions values($1,$2,1,'2025-06-03T13:00:00Z',now(),null)",[owner,account]);
    const invalidated = await read(owner, account, {start:day,end});
    assert.equal(invalidated.days[1].closingValueKrw,null);
    assert.equal(invalidated.days[1].reviewed,undefined);
  } finally { await pg.close(); }
});

test("investment live marks reuse the home quote and retain proven manual and fixed KRW holdings", async () => {
  const [{homePerformanceMarks},{performanceLiveFrame}] = await importWithPorts([
    "src/lib/cairn-v2/period-performance-market-read.ts","src/lib/cairn-v2/period-performance-live.ts"],{});
  const now=new Date("2025-06-03T08:00:00.000Z"), markTime=new Date("2025-06-03T07:00:00.000Z");
  const old=new Date("2025-05-30T08:00:00Z"), gold=id(150);
  const asset={id:held,canonicalOwnerUserId:owner,accountId:account,assetType:"etf",name:"Fund",ticker:"AAA",market:"us",currency:"USD",
    updatedAt:old,currentPrice:"90",quantity:"0.896567",fractionalKrwValue:"500",
    priceAsOf:old,priceFetchedAt:old,priceSource:"kis",priceStatus:"ok"};
  const manual={...asset,id:gold,assetType:"commodity",name:"Gold",ticker:null,market:"korea",currency:"KRW",quantity:"3",
    currentPrice:"450",fractionalKrwValue:null,priceSource:null,priceAsOf:null,priceFetchedAt:null};
  const sold={...asset,id:id(151),ticker:"SOLD",quantity:"0.00000000",fractionalKrwValue:null,currentPrice:null};
  const sources={assetRows:[asset,manual,sold],accountRows:[{id:account,nativeState:null}],
    recentFxRows:[{usdKrw:"1050",observedAt:null,fetchedAt:now,rateKind:null,source:"kis",status:"ok",isSample:false},
      {usdKrw:"1000",observedAt:markTime,fetchedAt:markTime,rateKind:"daily_reference",source:"er_api",status:"ok",isSample:false}],
    liveQuoteRows:[{market:"us",ticker:"AAA",currency:"USD",status:"ok",source:"kis",price:"110",
      priceAsOf:markTime,fetchedAt:markTime,quoteType:"live"}]};
  const latest=new Map([[account,{at:"2025-06-02T22:00:00Z",observation:{positions:[
    {assetId:gold,currency:"KRW",quantity:3,marketValueKrw:1350,fixedKrw:0}]}}]]);
  const guards=sources.assetRows.map(a=>({account_id:account,asset_id:a.id,asset_type:a.assetType,quantity:a.quantity,
    currency:a.currency,fixed_krw:a.fractionalKrwValue}));
  function run() {
    const marks=homePerformanceMarks(sources,{ownerUserId:owner},now,latest);
    return performanceLiveFrame(marks,owner,guards,true,"2025-06-03",now.toISOString());
  }
  const positions=run().observations[0].positions;
  assert.equal(positions.length,2,"an empty sold holding needs no current quote");
  guards[2].quantity="0.000001";
  assert.equal(run(),null,"a newly observed nonzero holding must reconcile before publishing a live return");
  guards[2].quantity=sold.quantity;
  sold.fractionalKrwValue=guards[2].fixed_krw="500";
  assert.equal(run(),null,"a separate fractional value must not disappear as a full sale");
  sold.fractionalKrwValue=guards[2].fixed_krw=null;
  assert.equal(positions[0].price,110);
  assert.ok(Math.abs(positions[0].marketValueKrw-(0.896567*110*1000+500))<1e-8);
  assert.equal(positions[1].marketValueKrw,1350);
  assert.equal(positions[1].carriedMark,true);
  manual.currentPrice="455";
  assert.equal(run(),null);
  manual.currentPrice="450"; sources.recentFxRows.pop();
  assert.equal(run(),null);
});

test("open KST cycle links a verified live mark, nets a late fill, and yields to its saved close", async () => {
  const pg = new PGlite();
  const now = new Date("2025-06-03T21:30:00.000Z"), asOf=now.toISOString();
  const r = {start:"2025-06-01",end:"2025-06-03"};
  try {
    await setup(pg);
    await pg.exec("alter table assets add account text, add asset_type text, add quantity numeric, add fractional_krw_value numeric");
    await pg.query("update assets set account='acct',quantity=1.5,currency='KRW' where id=$1",[held]);
    async function close(date, quantity, value) {
      await pg.query("insert into daily_portfolio_snapshots(canonical_owner_user_id,account_id,account,source,snapshot_date,num_assets) values($1,$2,'acct','varda_daily_snapshot_v1',$3,1)",[owner,account,date]);
      await pg.query("insert into daily_position_snapshots(canonical_owner_user_id,account_id,account,source,snapshot_date,asset_id,quantity,currency,fx_rate,market_value_krw) values($1,$2,'acct','varda_daily_snapshot_v1',$3,$4,$5,'KRW',1,$6)",[owner,account,date,held,quantity,value]);
    }
    await close(r.start,1,100); await close(day,1,110);
    const evidence={ownerId:owner, reporting:"KRW",asOf,activeAccountIds:[account],history:[],trades:null,fx:[],maxPriceAgeMs:86400000,maxFxAgeMs:86400000,
      current:{at:asOf,source:"owned_investments_current_only",scopeComplete:true,positions:[{id:held,ownerId:owner,name:"Held",cost:null,
        observation:{quantity:"1.5",price:"120",currency:"KRW",at:asOf,priceObservedAt:asOf,basis:"raw",source:"kis"}}]}};
    let calls=0;
    const read=await reader(pg,"return",async (tenant,scope,at,holdings)=>{
      assert.equal(tenant.ownerUserId,owner);assert.equal(scope.accountId,account);assert.equal(at.toISOString(),asOf);assert.equal(holdings,true);
      calls++; return evidence;
    });
    const run = options => read(owner,account,r,{now,...options});
    assert.equal((await run({now:new Date("2025-06-02T22:00:00.000Z")})).points.at(-1).returnPct,null);
    assert.equal(calls,0);
    assert.equal((await run()).points.at(-1).returnPct,null);
    await pg.query("insert into event_ledger_entries(canonical_owner_user_id,account_id,asset_id,event_date,event_type,quantity_delta,amount_krw) values($1,$2,$3,$4,'buy',0.5,60)",[owner,account,held,r.end]);
    const current=await run();
    assert.ok(Math.abs(current.points.at(-1).returnPct-20)<1e-8);
    assert.equal(current.points.at(-1).liveAsOf,asOf);
    assert.equal(current.points.at(-1).segment,r.start);
    evidence.current.positions[0].observation.quantity="2";
    assert.equal((await run()).points.at(-1).returnPct,null);
    evidence.current.positions[0].observation.quantity="1.5";
    assert.equal((await read(other,account,r,{now})).points.at(-1).returnPct,null);
    const before=calls;
    assert.equal((await run({includeLive:false})).points.at(-1).returnPct,null);
    const prior=await read(owner,account,{start:r.start,end:day},{now});
    assert.ok(Math.abs(prior.points.at(-1).returnPct-10)<1e-8);
    await close(r.end,1.5,180);
    let closedEvidence=[];
    const final=await run({onClosedEvidence: rows=>{closedEvidence=rows;}});
    assert.ok(closedEvidence.find(row=>row.date===r.end)?.snapshotId);
    assert.equal(final.points.at(-1).liveAsOf,undefined);
    assert.ok(Math.abs(final.points.at(-1).returnPct-current.points.at(-1).returnPct)<1e-8);
    assert.equal(calls,before);
  } finally { await pg.close(); }
});

test("cash-inclusive live performance nets an evidenced deposit at the valuation instant and requires both currency balances", async () => {
  const pg = new PGlite();
  const now = new Date("2025-06-02T09:00:00.000Z"), at=now.toISOString(), yesterday="2025-06-01T22:00:00.000Z";
  const r={start:"2025-06-01",end:day};
  try {
    await setup(pg);
    await pg.exec("alter table assets add account text, add asset_type text, add quantity numeric, add fractional_krw_value numeric");
    await pg.query("update assets set account='native',quantity=1 where id=$1",[nativeHolding]);
    await pg.query("update accounts set native_state=$1 where id=$2",[JSON.stringify({startedAt:"2025-04-01T00:00:00Z",at,sequence:3}),native]);
    function positions(time,price,cash) {
      const mark = (id,kind,currency,quantity,price,source)=>({id,ownerId:owner,accountId:native,kind,name:id,
        observation:{at:time,priceObservedAt:time,quantity,price,currency,basis:"raw",source} });
      return [mark(nativeHolding,"holding","KRW","1",price,"kis"),mark("cash:"+native+":KRW","cash","KRW",cash,"1","native_ledger_cash"),
        mark("cash:"+native+":USD","cash","USD","0","1","native_ledger_cash")];
    }
    const frame={at:yesterday,boundary:"before",scopeComplete:true,positions:positions(yesterday,"100","0")};
    await pg.query("insert into daily_portfolio_snapshots(canonical_owner_user_id,account_id,account,source,snapshot_date,native_evidence) values($1,$2,'native','native_ledger_cutoff_v2',$3,$4)",
      [owner,native,day,{version:1,frame,availableCurrencies:["KRW"],fx:[]}]);
    const event={type:"deposit",at,currency:"KRW",amount:"100"};
    await pg.query("insert into event_ledger_entries(canonical_owner_user_id,account_id,event_type,native_data) values($1,$2,'native_deposit',$3)",
      [owner,native,{event,effect:{cashLegs:[{kind:"external",currency:"KRW",delta:"100"}]}}]);
    const evidence={ownerId:owner,reporting:"KRW",asOf:at,history:[],trades:null,fx:[],maxPriceAgeMs:86400000,maxFxAgeMs:86400000,
      nativeSequences:{[native]:3},ledgerComplete:true,current:{at,source:"native",scopeComplete:true,positions:positions(at,"110","100")}};
    const read=await reader(pg,"return",async ()=>evidence);
    const run=()=>read(owner,native,r,{now});
    const result=await run();
    assert.equal(result.basis,"portfolio_including_cash");
    assert.equal(result.points.at(-1).liveAsOf,at);
    assert.ok(Math.abs(result.points.at(-1).returnPct-10)<1e-9);
    evidence.current.positions.pop();
    assert.equal((await run()).points.at(-1).returnPct,null);
  } finally { await pg.close(); }
});

test("holdings executions at 07:02 and exactly 07:04 are included in an actual 07:04 valuation, but 07:05 is not", async () => {
  const pg=new PGlite();
  try {
    await setup(pg);
    await pg.query("update assets set currency='KRW' where id=$1",[held]);
    const read=await reader(pg,"return");
    for (const [saved,q,value] of [["2025-06-02",1,100],["2025-06-03",2.5,275],["2025-06-04",3,360]]) {
      await pg.query(`insert into daily_portfolio_snapshots(canonical_owner_user_id,account_id,account,source,snapshot_date,num_assets,cycle_end_at,captured_at,description)
        values($1,$2,'acct','varda_manual_daily_snapshot',$3,1,$4,$5,'snapshot_status=complete; valuation_policy=execution_collection_v1')`,
      [owner,account,saved,saved+"T07:04:00+09:00",saved+"T08:30:00+09:00"]);
      await pg.query(`insert into daily_position_snapshots(canonical_owner_user_id,account_id,account,source,snapshot_date,asset_id,quantity,currency,fx_rate,market_value_krw)
        values($1,$2,'acct','varda_manual_daily_snapshot',$3,$4,$5,'KRW',1,$6)`,[owner,account,saved,held,q,value]);
    }
    for (const [time,q,amount] of [["07:02:00",1,110],["07:04:00",0.5,55],["07:05:00",0.5,60]]) {
      await pg.query(`insert into event_ledger_entries(canonical_owner_user_id,account_id,asset_id,event_date,event_type,quantity_delta,amount_krw,broker_recovery_data)
        values($1,$2,$3,'2025-06-03','buy',$4,$5,$6)`,[owner,account,held,q,amount,{executedAt:"2025-06-03T"+time+"+09:00"}]);
    }
    const run=end=>read(owner,account,{start:"2025-06-01",end},{includeLive:false});
    assert.ok(Math.abs((await run("2025-06-02")).points.at(-1).returnPct-10)<1e-8);
    assert.ok(Math.abs((await run("2025-06-03")).points.at(-1).returnPct-20)<1e-8);
    await pg.query("update daily_portfolio_snapshots set description='snapshot_status=complete' where snapshot_date='2025-06-03' and account_id=$1",[account]);
    assert.equal((await run("2025-06-02")).points.at(-1).returnPct,null);
  } finally { await pg.close(); }
});

test("historical attribution reads archived sales, dated FX and owner-scoped revision-valid endpoints", async () => {
  const pg = new PGlite();
  try {
    await setup(pg);
    const read = await reader(pg);
    const source = "varda_manual_daily_snapshot";
    for (const [date,n,cutoff] of [["2025-06-02",2,"2025-06-01T22:00:00Z"],["2025-06-03",1,"2025-06-02T22:00:00Z"]]) {
      await pg.query("insert into daily_portfolio_snapshots(canonical_owner_user_id,account_id,account,snapshot_date,source,num_assets,cycle_end_at,captured_at,description) values($1,$2,'acct',$3,$4,$5,$6,$6,'snapshot_status=complete')",
        [owner,account,date,source,n,cutoff]);
    }
    for (const [date,asset,ticker,q,price,fx] of [["2025-06-02",sold,"OUT",0.5,100,1000],["2025-06-02",held,"IN",2,100,1000],["2025-06-03",held,"IN",2,110,1200]]) {
      await pg.query("insert into daily_position_snapshots(canonical_owner_user_id,account_id,account,snapshot_date,source,asset_id,asset_name,ticker,market,currency,quantity,unit_price,fx_rate,market_value_krw,captured_at,description) values($1,$2,'acct',$3,$4,$5,$6,$6,'us','USD',$7,$8,$9,$10,$3::date,'snapshot_status=complete')",
        [owner,account,date,source,asset,ticker,q,price,fx,q*price*fx]);
    }
    await pg.query("insert into event_ledger_entries(canonical_owner_user_id,account_id,asset_id,asset_name,ticker,event_date,event_type,quantity_delta,price,fx_rate,amount_krw) values($1,$2,$3,'Sold ETF','OUT',$4,'sell',-0.5,120,1100,66000)",
      [owner,account,sold,day]);
    const beforeRevision = await read(owner,account);
    const performance = await reader(pg,"return");
    const perfRange = {start:"2025-06-01",end:day};
    const perf = await performance(owner,account,perfRange);
    assert.equal(perf.points.length,2); assert.deepEqual(perf.gaps,[]);
    assert.ok(Math.abs(perf.points[1].dailyReturnPct - 32)<1e-8);
    assert.ok((await performance(other,account,perfRange)).points.every(p=>p.returnPct===null));
    // The documented dollar proceeds are still available. When the KRW settlement isn't,
    // only the exact day/account's saved valuation rate can translate the sale.
    await pg.query("update event_ledger_entries set fx_rate=null,amount_krw=null where account_id=$1",[account]);
    const estimated=await performance(owner,account,perfRange);
    assert.equal(estimated.includesClosingFx,true); assert.equal(estimated.points[1].estimatedFx,true);
    assert.ok(Math.abs(estimated.points[1].returnPct-34.4)<1e-9);
    await pg.query("update daily_portfolio_snapshots set usdkrw=1300,description='snapshot_status=complete; fx_source=fx_rates:test' where account_id=$1 and snapshot_date='2025-06-03'",[account]);
    assert.deepEqual((await performance(owner,account,perfRange)).gaps,[{start:day,end:day,reason:"trade"}]);
    await pg.query("update daily_portfolio_snapshots set usdkrw=null where account_id=$1 and snapshot_date='2025-06-03'",[account]);
    await pg.query("update daily_position_snapshots set fx_rate=null where account_id=$1 and snapshot_date='2025-06-03'",[account]);
    assert.deepEqual((await performance(owner,account,perfRange)).gaps,[{start:day,end:day,reason:"trade"}]);
    await pg.query("update daily_position_snapshots set fx_rate=1200 where account_id=$1 and snapshot_date='2025-06-03'",[account]);
    await pg.query("update event_ledger_entries set fx_rate=1100,amount_krw=66000 where account_id=$1",[account]);
    assert.equal(beforeRevision.state,"complete");
    assert.equal(beforeRevision.days[0].closingValueKrw,264000);
    assert.equal(beforeRevision.priceKrw,30000); assert.equal(beforeRevision.fxKrw,50000);
    assert.equal(beforeRevision.holdings.find(p=>p.name==="OUT").totalKrw,16000);
    assert.equal((await read(other,account)).state,"unavailable");
    assert.equal((await read(other,null)).holdings.length,0);
    // Date-valid active account catalog includes a native account without any observation.
    assert.equal((await read(owner,null)).state,"partial");
    await pg.query("insert into native_ledger_revisions values($1,$2,2,'2025-06-02T11:00:00Z','2025-06-05T00:00:00Z')",[owner,account]);
    assert.deepEqual((await read(owner,account)).gaps.map(g=>g.reason),["account_history"]);
    for (const table of ["daily_portfolio_snapshots","daily_position_snapshots"]) {
      await pg.query("update "+table+" set description='snapshot_status=complete; native_revision=2',captured_at='2025-06-06T00:00:00Z' where account_id=$1 and snapshot_date='2025-06-03'",[account]);
    }
    assert.equal((await read(owner,account)).totalKrw,80000);
    // A missing held row doesn't become a zero sale.
    await pg.query("update daily_portfolio_snapshots set num_assets=2 where account_id=$1 and snapshot_date='2025-06-03'",[account]);
    assert.equal((await read(owner,account)).state,"partial");
    assert.equal((await read(owner,account)).totalKrw,64000);
  } finally { await pg.close(); }
});

test("native cutoff evidence excludes cash and private frame identities and applies temporal revisions", async () => {
  const pg = new PGlite();
  try {
    await setup(pg);
    const read = await reader(pg);
    for (const [dbDay,at,price] of [["2025-06-02","2025-06-01T22:00:00Z",100],["2025-06-03","2025-06-02T22:00:00Z",120]]) {
      const hold = {id:nativeHolding,name:"Stock",ownerId:owner,accountId:native,kind:"holding",ticker:"N",market:"korea",
        observation:{at,priceObservedAt:at,quantity:"0.5",price:String(price),currency:"KRW",source:"kis_fixture",basis:"raw"}};
      const evidence = {version:1,revision:0,fx:[],frame:{at,boundary:"before",scopeComplete:true,positions:[hold,{...hold,kind:"cash",id:"cash"}]}};
      await pg.query("insert into daily_portfolio_snapshots(canonical_owner_user_id,account_id,account,source,snapshot_date,captured_at,native_evidence) values($1,$2,'native','native_ledger_cutoff_v2',$3,$4,$5)",
        [owner,native,dbDay,at,JSON.stringify(evidence)]);
    }
    const result = await read(owner,native);
    assert.equal(result.days[0].closingValueKrw,60);
    assert.equal(result.state,"complete"); assert.equal(result.priceKrw,10); assert.equal(result.fxKrw,0);
    await pg.query("update daily_portfolio_snapshots set native_evidence=jsonb_set(native_evidence,'{frame,positions,0,observation,quantity}',to_jsonb('1'::text)) where snapshot_date=$1 and account_id=$2",["2025-06-03",native]);
    await pg.query("insert into event_ledger_entries(canonical_owner_user_id,account_id,event_date,native_data) values($1,$2,$3,$4)",
      [owner,native,day,JSON.stringify({event:{type:"buy",assetId:nativeHolding,at:"2025-06-02T09:00:00Z",quantity:"0.5",currency:"KRW",
        executionTotal:{amount:"55",currency:"KRW"},settlementStatus:"unconfirmed"}})]);
    const executed = await read(owner,native);
    assert.equal(executed.state,"complete"); assert.equal(executed.totalKrw,15);
    await pg.query("update daily_portfolio_snapshots set native_evidence=jsonb_set(native_evidence,'{frame,positions,0,ownerId}',to_jsonb($1::text)) where snapshot_date=$2 and account_id=$3",[other,"2025-06-03",native]);
    const incomplete = await read(owner,native);
    assert.equal(incomplete.days[0].closingValueKrw,null);
    assert.equal(incomplete.state,"unavailable"); assert.ok(incomplete.gaps.some(g=>g.reason==="holding_history"));
    await pg.query("insert into native_ledger_revisions values($1,$2,1,'2025-06-02T18:00Z','2025-06-08T00:00Z')",[owner,native]);
    assert.deepEqual((await read(owner,native)).gaps.map(g=>g.reason),["account_history"]);
  } finally { await pg.close(); }
});

test("a reconstructed zero is outside the positive holding count and a manual total stays unpriced", async () => {
  const pg = new PGlite();
  try {
    await setup(pg);
    const read = await reader(pg);
    const source = "broker_reconstructed_close_v1:fixture";
    for (const [date,price] of [["2025-06-02",110],["2025-06-03",120]]) {
      await pg.query("insert into daily_portfolio_snapshots(canonical_owner_user_id,account_id,account,snapshot_date,source,num_assets) values($1,$2,'acct',$3,$4,1)",
        [owner,account,date,source]);
      await pg.query("insert into daily_position_snapshots(canonical_owner_user_id,account_id,account,snapshot_date,source,asset_id,asset_name,ticker,market,currency,quantity,unit_price,fx_rate,market_value_krw,price_basis) values($1,$2,'acct',$3,$4,$5,'Held','IN','us','USD',2,$7,1000,$8,'reconstructed_dated_close'),($1,$2,'acct',$3,$4,$6,'Sold','OUT','us','USD',0,null,null,0,'confirmed_zero')",
        [owner,account,date,source,held,sold,price,price*2000]);
    }
    const attached = await read(owner,account);
    assert.equal(attached.state,"complete"); assert.equal(attached.holdings.length,1); assert.equal(attached.priceKrw,20000);
    await pg.query("update daily_position_snapshots set price_basis='confirmed_manual_total' where snapshot_date=$1 and asset_id=$2",["2025-06-03",held]);
    const missing = await read(owner,account);
    assert.equal(missing.days[0].closingValueKrw,240000);
    assert.equal(missing.priceKrw,null); assert.equal(missing.fxKrw,null);
    assert.deepEqual(missing.gaps.map(g=>[g.holding,g.reason]),[["IN","price"]]);
  } finally { await pg.close(); }
});

test("selling the last dollar holding can use the saved account FX on its own close", async () => {
  const pg = new PGlite();
  try {
    await setup(pg);
    const read = await reader(pg,"return"), r = {start:"2025-06-01",end:day};
    const source = "varda_manual_daily_snapshot";
    for (const [saved,n,fx] of [["2025-06-02",2,1000],["2025-06-03",1,1150]]) {
      await pg.query(`insert into daily_portfolio_snapshots(canonical_owner_user_id,account_id,account,source,snapshot_date,num_assets,description,usdkrw)
        values($1,$2,'acct',$3,$4,$5,'snapshot_status=complete; fx_source=daily_valuation_fx:synthetic',$6)`,[owner,account,source,saved,n,fx]);
      await pg.query(`insert into daily_position_snapshots(canonical_owner_user_id,account_id,account,source,snapshot_date,asset_id,currency,quantity,fx_rate,market_value_krw)
        values($1,$2,'acct',$3,$4,$5,'KRW',1,1,50000)`,[owner,account,source,saved,held]);
    }
    await pg.query(`insert into daily_position_snapshots(canonical_owner_user_id,account_id,account,source,snapshot_date,asset_id,currency,quantity,fx_rate,market_value_krw)
      values($1,$2,'acct',$3,'2025-06-02',$4,'USD',1,1000,100000)`,[owner,account,source,sold]);
    await pg.query(`insert into event_ledger_entries(canonical_owner_user_id,account_id,asset_id,event_date,event_type,quantity_delta,price)
      values($1,$2,$3,$4,'sell',-1,120)`,[owner,account,sold,day]);
    const result = await read(owner,account,r);
    assert.deepEqual(result.gaps,[]);
    assert.equal(result.points[1].estimatedFx,true);
    assert.ok(Math.abs(result.points[1].returnPct - 38000/150000*100)<1e-9);
    await pg.query("update daily_portfolio_snapshots set usdkrw=null where account_id=$1 and snapshot_date='2025-06-03'",[account]);
    assert.deepEqual((await read(owner,account,r)).gaps,[{start:day,end:day,reason:"trade"}]);
  } finally { await pg.close(); }
});

test("native return includes cash, treats only verified external legs as capital, and requires complete dated cash evidence", async () => {
  const pg = new PGlite();
  try {
    await setup(pg);
    const read=await reader(pg,"return"), r={start:"2025-06-01",end:"2025-06-02"};
    for (const [dbDay,at,quantity,price,krw] of [
      ["2025-06-02","2025-06-01T22:00:00Z",1,100,100],
      ["2025-06-03","2025-06-02T22:00:00Z",2,90,110],
    ]) {
      const base={ownerId:owner,accountId:native};
      const asset={...base,id:nativeHolding,kind:"holding",observation:{at,currency:"KRW",quantity:String(quantity),price:String(price),source:"quote",basis:"raw"}};
      const cash=currency=>({...base,id:"cash:"+native+":"+currency,kind:"cash",observation:{at,currency,
        price:"1",quantity:currency==="KRW"?String(krw):"0",source:"native_ledger_cash",basis:"raw"}});
      const payload={version:1,revision:0,availableCurrencies:["KRW"],fx:[],frame:{at,boundary:"before",scopeComplete:true,positions:[asset,cash("KRW"),cash("USD")]}};
      await pg.query("insert into daily_portfolio_snapshots(canonical_owner_user_id,account_id,account,source,snapshot_date,captured_at,native_evidence) values($1,$2,'native','native_ledger_cutoff_v2',$3,$4,$5)",[owner,native,dbDay,at,JSON.stringify(payload)]);
    }
    for(const data of [
      {event:{type:"deposit",currency:"KRW",amount:"100",at:"2025-06-02T10:00:00Z"},effect:{cashLegs:[{currency:"KRW",delta:"100",kind:"external"}]}},
      {event:{type:"buy",assetId:nativeHolding,quantity:"1",price:"90",currency:"KRW",at:"2025-06-02T12:00:00Z"},effect:{cashLegs:[{currency:"KRW",delta:"-90",kind:"trade"}]}},
    ]) await pg.query("insert into event_ledger_entries(canonical_owner_user_id,account_id,event_date,native_data) values($1,$2,$3,$4)",[owner,native,day,JSON.stringify(data)]);
    const result=await read(owner,native,r);
    assert.equal(result.basis,"portfolio_including_cash"); assert.deepEqual(result.gaps,[]);
    // Opening NAV 200, closing NAV 290 after a midpoint deposit of 100. Buying is an internal exchange.
    assert.ok(Math.abs(result.points[1].dailyReturnPct + 4)<1e-9);
    const cutoff = "2025-06-02T22:00:00Z", fetched = "2025-06-02T22:09:00Z";
    const fixing = {base:"USD",quote:"KRW",rate:"1250",kind:"daily_reference",source:"ecb_eur_cross",fetchedAt:fetched,observedAt:fetched,
      fixing:{id:"fx",serviceDate:"2025-06-03",referenceDate:"2025-06-02",policy:"test",evidenceKind:"closing_reference",cutoffAt:cutoff}};
    await pg.query("update daily_portfolio_snapshots set native_evidence=jsonb_set(native_evidence,'{fx}',$1::jsonb) where snapshot_date='2025-06-03'",[JSON.stringify([fixing])]);
    await pg.query("update event_ledger_entries set native_data=$1::jsonb where native_data->'event'->>'type'='deposit'",[JSON.stringify({
      event:{type:"deposit",currency:"USD",amount:"0.08",at:"2025-06-02T10:00:00Z"},effect:{cashLegs:[{currency:"USD",delta:"0.08",kind:"external"}]}})]);
    const foreign=await read(owner,native,r);
    assert.deepEqual(foreign.gaps,[]);
    assert.ok(Math.abs(foreign.points[1].dailyReturnPct + 4)<1e-9);
    await pg.query("update event_ledger_entries set native_data=native_data-'effect' where native_data->'event'->>'type'='deposit'");
    assert.deepEqual((await read(owner,native,r)).gaps,[{start:r.end,end:r.end,reason:"cash_flow"}]);
    await pg.query("update daily_portfolio_snapshots set native_evidence=native_evidence #- '{frame,positions,2}' where snapshot_date='2025-06-03'");
    assert.deepEqual((await read(owner,native,r)).gaps,[{start:r.end,end:r.end,reason:"valuation"}]);
  } finally {await pg.close();}
});

test("a conflicting broker opening is empty and later holdings returns restart from the next reconciled close", async () => {
  const pg = new PGlite();
  try {
    await setup(pg);
    const read = await reader(pg, "return");
    const range = { start: "2025-06-01", end: "2025-06-05" };
    const days = ["2025-06-01", "2025-06-02", "2025-06-03", "2025-06-04", "2025-06-05"];
    for (const [index, date] of days.entries()) {
      await pg.query(`insert into daily_portfolio_snapshots(canonical_owner_user_id,account_id,account,snapshot_date,source,num_assets)
        values($1,$2,'acct',$3,'base44_import',1)`, [owner,account,date]);
      await pg.query(`insert into daily_position_snapshots(canonical_owner_user_id,account_id,account,snapshot_date,source,
        asset_id,asset_name,ticker,currency,quantity,unit_price,fx_rate,market_value_krw) values
        ($1,$2,'acct',$3,'base44_import',$4,'Held','IN','KRW',1,$5,1,$5)`, [owner,account,date,held,100+index]);
    }
    const opening = { accountId: account, version: 1, revision: 1, basis: "invested_assets_excluding_cash", currency: "KRW",
      baseDate: days[2], points: [{ date: days[2], valueKrw: 125 }] };
    const op = id(42);
    await pg.query("insert into native_ledger_revisions(canonical_owner_user_id,account_id,operation_id,marker_sequence) values($1,$2,$3,1)",
      [owner,account,op]);
    await pg.query(`insert into event_ledger_entries(canonical_owner_user_id,account_id,native_operation_id,native_sequence,
      event_type,rule_version,native_data) values($1,$2,$3,1,'native_revision','broker_evidence_recovery_v1',$4)`,
      [owner,account,op,JSON.stringify({ request: { kind: "broker_evidence_recovery", returnRecovery: opening } })]);
    const gap = await read(owner,account,range);
    assert.deepEqual(gap.gaps,[{start:days[2],end:days[2],reason:"valuation"}]);
    assert.equal(gap.points[2].returnPct,null);
    assert.equal(gap.points[2].segment,null);
    assert.equal(gap.points[3].segment,days[3]);
    assert.ok(Math.abs(gap.points[4].returnPct - 100/103) < 1e-8);
    await pg.query("update event_ledger_entries set native_data=jsonb_set(native_data,'{request,returnRecovery,points,0,valueKrw}','102.01')");
    assert.deepEqual((await read(owner,account,range)).gaps,[]);
  } finally { await pg.close(); }
});

test("only an active account recovery with a matched ending value extends its cumulative return", async () => {
  const pg = new PGlite();
  try {
    await setup(pg);
    // Make all-accounts otherwise comparable: only this one account is active for this owner.
    await pg.query("update accounts set is_active=false where id=$1",[native]);
    const [base, missing, last, next] = ["2025-06-01","2025-06-02","2025-06-03","2025-06-04"];
    for (const [date, value] of [[last,120],[next,132]]) {
      await pg.query(`insert into daily_portfolio_snapshots(canonical_owner_user_id,account_id,account,source,snapshot_date,num_assets)
        values($1,$2,'acct','varda_daily_snapshot_v1',$3,1)`,[owner,account,date]);
      await pg.query(`insert into daily_position_snapshots(canonical_owner_user_id,account_id,account,source,snapshot_date,asset_id,quantity,currency,fx_rate,market_value_krw)
        values($1,$2,'acct','varda_daily_snapshot_v1',$3,$4,1,'KRW',1,$5)`,[owner,account,date,held,value]);
    }
    const operation=id(46), curve={
      accountId:account,version:1,revision:1,basis:"invested_assets_excluding_cash",currency:"KRW",
      baseDate:base,endDate:last,flows:[],policy:INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
      points:[{date:base,valueKrw:100},{date:missing,valueKrw:null},{date:last,valueKrw:120}],
    };
    await pg.query("insert into native_ledger_revisions(canonical_owner_user_id,account_id,operation_id,marker_sequence) values($1,$2,$3,1)",[owner,account,operation]);
    await pg.query(`insert into event_ledger_entries(canonical_owner_user_id,account_id,native_operation_id,native_sequence,event_type,rule_version,native_data)
      values($1,$2,$3,1,'native_revision','broker_evidence_recovery_v1',$4)`,
      [owner,account,operation,JSON.stringify({request:{kind:"broker_evidence_recovery",returnRecovery:curve}})]);
    const read=await reader(pg,"return"), r={start:base,end:next};
    const returns=result=>result.points.map(p=>p.returnPct == null ? null : Math.round(p.returnPct * 1e6) / 1e6);
    const anchored=await read(owner,account,r);
    assert.deepEqual(returns(anchored),[0,null,20,32]);
    assert.ok(Math.abs(anchored.points.at(-1).dailyReturnPct-10)<1e-8);
    const unanchored=[null,null,0,10];
    assert.deepEqual(returns(await read(owner,account,r,{includeLive:false})),unanchored);
    assert.deepEqual(returns(await read(owner,null,r)),unanchored);
    assert.deepEqual(returns(await read(other,account,r)),[null,null,null,null]);
    assert.deepEqual(returns(await read(owner,account,{start:last,end:next})),[0,10]);
    await pg.query("update daily_position_snapshots set market_value_krw=110 where account_id=$1 and snapshot_date=$2",[account,last]);
    const mismatched=await read(owner,account,r);
    assert.notEqual(returns(mismatched).at(-1),32);
    assert.notEqual(mismatched.points.at(-1).segment,anchored.points.find(p=>p.date===base).segment);
    await pg.query("update daily_position_snapshots set market_value_krw=120 where account_id=$1 and snapshot_date=$2",[account,last]);
    await pg.query("insert into native_ledger_revisions(canonical_owner_user_id,account_id,operation_id,marker_sequence) values($1,$2,$3,2)",[owner,account,id(47)]);
    assert.deepEqual(returns(await read(owner,account,r)),unanchored);

    const [{readRecoveredReturnCurve}] = await importWithPorts(["src/db/queries/period-return-recovery.ts"], {
      "@/db/tenant-transaction-context": tenantReadPort(pg),
    });
    const tenant = {ownerUserId:owner};
    const betaMetadata = () => readRecoveredReturnCurve(tenant,account,true);
    assert.equal(await betaMetadata(),null,"an unidentified revision cannot preserve the recovery base date");

    const laterFill = last+"T22:00:00.001Z";
    const cutoff = last+"T22:00:00.000Z";
    const dateEvidence = {precision:"date_only",reportedDate:next,timeZone:"Asia/Seoul",policy:"service_day_midpoint"};
    await pg.query(`insert into event_ledger_entries(canonical_owner_user_id,account_id,native_operation_id,native_sequence,event_type,rule_version)
      values($1,$2,$3,2,'native_revision','native_revision_v1')`,[owner,account,id(47)]);
    for (const [side,at,affectedAt,precision,links] of [
      ["buy",laterFill,laterFill,null,true],
      ["sell",laterFill,laterFill,null,true],
      ["buy",laterFill,cutoff,null,false],
      ["sell",laterFill,last+"T21:59:59.999Z",null,false],
      ["sell",next+"T10:00:00.000Z",laterFill,dateEvidence,false],
      ["buy","2025-06-05T10:00:00.000Z","2025-06-05T10:00:00.000Z",{...dateEvidence,reportedDate:"2025-06-05"},true],
      ["sell","2025-06-05T10:00:00.000Z",cutoff,{...dateEvidence,reportedDate:"2025-06-05"},false],
      ["buy",laterFill,null,null,false],
    ]) {
      // A correction may replace a fill earlier than the new one. The revision's
      // earliest affected instant, rather than the replacement date alone, must win.
      const trade = {type:side,assetId:held,quantity:"1",price:"100",currency:"KRW",at,...(precision ? {dateEvidence:precision} : {})};
      const marker = {event:{type:"revision",at:next+"T12:00:00.000Z"},request:{
        accountId:account,operationId:id(47),event:trade,history:{notInOpening:true,reason:"broker correction"},
      }};
      await pg.query("update native_ledger_revisions set affected_at=$1 where operation_id=$2",[affectedAt,id(47)]);
      await pg.query("update event_ledger_entries set native_data=$1 where native_operation_id=$2",[JSON.stringify(marker),id(47)]);
      const description = [side,at,affectedAt,precision?.precision].join(" ");
      assert.deepEqual(returns(await read(owner,account,r)),links ? [0,null,20,32] : unanchored,description);
      const metadata = await betaMetadata();
      if (links) assert.equal(metadata?.baseDate,base,description);
      else assert.equal(metadata,null,description);
      assert.equal(await readRecoveredReturnCurve(tenant,account),null,"the original strict reader still rejects superseded evidence");
    }
  } finally { await pg.close(); }
});

test("an explicitly recorded manual unit price belongs only to its own completed service day", async () => {
  const pg = new PGlite();
  try {
    await setup(pg);
    const read = await reader(pg);
    for (const [date,cutoff,observed,price] of [
      ["2025-06-02","2025-06-01T22:00:00Z","2025-05-31T23:00:00.000Z",100],
      ["2025-06-03","2025-06-02T22:00:00Z","2025-06-01T23:00:00.000Z",125],
    ]) {
      await pg.query("insert into daily_portfolio_snapshots(canonical_owner_user_id,account_id,account,source,snapshot_date,num_assets,cycle_end_at,captured_at,description) values($1,$2,'acct','varda_manual_daily_snapshot',$3,1,$4,$4,'snapshot_status=complete')",
        [owner,account,date,cutoff]);
      await pg.query(`insert into daily_position_snapshots(canonical_owner_user_id,account_id,account,source,snapshot_date,asset_id,asset_name,market,currency,quantity,unit_price,market_value_krw,price_basis,price_source,reference_date,cycle_end_at,captured_at,description)
        values($1,$2,'acct','varda_manual_daily_snapshot',$3,$4,'금현물','korea','KRW',2,$5,$6,'manual_current','manual_entry',$7,$8,$8,$9)`,
        [owner,account,date,held,price,2*price,observed.slice(0,10),cutoff,"price_observed_at="+observed+"; price_timestamp_basis=manual_input"]);
    }
    assert.equal((await read(owner,account)).priceKrw,50);
    for (const [observed,extra] of [
      ["2025-06-01T21:59:59.000Z",""], // Previous 07:00 KST cycle.
      ["2025-06-02T22:00:00.000Z",""], // Exactly at the exclusive cutoff.
      ["2025-06-01T23:00:00.000Z","; manual_carry_snapshot=previous"],
    ]) {
      await pg.query("update daily_position_snapshots set reference_date=$1,description=$2 where account_id=$3 and snapshot_date='2025-06-03'",
        [observed.slice(0,10),"price_observed_at="+observed+"; price_timestamp_basis=manual_input"+extra,account]);
      const gap = await read(owner,account);
      assert.equal(gap.state,"unavailable"); assert.equal(gap.gaps[0].reason,"price");
    }
  } finally { await pg.close(); }
});
