import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

const id = n => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const owner = id(1), other = id(2), account = id(3), native = id(4), foreign = id(5);
const sold = id(10), held = id(11), nativeHolding = id(12);
const day = "2025-06-02";
const range = { start: day, end: day };

async function setup(pg) {
  await pg.exec(`
    create table accounts(id uuid primary key,canonical_owner_user_id uuid,name text,code text,sort_order int,is_active boolean default true,native_state jsonb);
    create table assets(id uuid primary key,canonical_owner_user_id uuid,account_id uuid,legacy_base44_id text,name text,ticker text,market text,currency text,archived_at timestamptz);
    create table native_ledger_revisions(canonical_owner_user_id uuid,account_id uuid,marker_sequence int,affected_at timestamptz,recorded_at timestamptz);
    create table broker_recovery_batches(canonical_owner_user_id uuid,account_id uuid,manifest jsonb,recorded_at timestamptz);
    create table daily_portfolio_snapshots(id uuid default gen_random_uuid(),canonical_owner_user_id uuid,account_id uuid,account text,source text,snapshot_date date,
      cycle_end_at timestamptz,captured_at timestamptz,created_at timestamptz default now(),updated_at timestamptz,description text,is_sample boolean default false,num_assets int,native_evidence jsonb);
    create table daily_position_snapshots(id uuid default gen_random_uuid(),canonical_owner_user_id uuid,account_id uuid,account text,source text,snapshot_date date,
      cycle_end_at timestamptz,captured_at timestamptz,created_at timestamptz default now(),updated_at timestamptz,description text,is_sample boolean default false,
      asset_id uuid,legacy_asset_id text,asset_name text,ticker text,market text,currency text,quantity numeric,total_quantity numeric,estimated_fractional_quantity numeric,
      price_source text,price_basis text,unit_price numeric,current_price numeric,close_price numeric,fx_rate numeric,fractional_krw_value numeric,market_value_krw numeric);
    create table event_ledger_entries(id uuid default gen_random_uuid(),canonical_owner_user_id uuid,account_id uuid,asset_id uuid,asset_name text,ticker text,
      legacy_base44_id text,legacy_asset_id text,corrects_event_id uuid,legacy_corrects_event_id text,broker_recovery_data jsonb,native_data jsonb,
      recorded_at timestamptz,created_at timestamptz default now(),is_sample boolean default false,event_date date,event_type text,quantity_delta numeric,price numeric,fx_rate numeric,amount_krw numeric);
    create view effective_native_ledger_entries as select * from event_ledger_entries where native_data is not null;`);
  await pg.query("insert into accounts(id,canonical_owner_user_id,code,name,sort_order,native_state) values($1,$2,'acct','Desk',1,null),($3,$2,'native','Native',2,$4),($5,$6,'foreign','Other',3,null)",
    [account,owner,native,JSON.stringify({startedAt:"2025-04-01T00:00:00Z"}),foreign,other]);
  await pg.query("insert into assets values($1,$2,$3,null,'Sold ETF','OUT','us','USD',now()),($4,$2,$3,null,'Held ETF','IN','us','USD',null),($5,$2,$6,null,'Native stock','N','korea','KRW',null)",
    [sold,owner,account,held,nativeHolding,native]);
}

function reader(pg) {
  return importWithPorts(["src/lib/cairn-v2/period-attribution-read.ts"], {
    "@/db/tenant-transaction-context": {
      runTenantReadTransaction: (ownerId, queryFactory) => pg.transaction(async tx => {
        await tx.query("select set_config('app.current_user_id',$1,true)", [ownerId]);
        const work = queryFactory({query: (sql,args) => [sql,args]});
        const results = [];
        for (const [sql,args] of work) results.push((await tx.query(sql,args)).rows);
        return results;
      }),
    },
  }).then(([module]) => (who, selected, r=range) => module.readPeriodAttribution({tenantContext:{ownerUserId:who},
    scope:selected ? {kind:"account",accountId:selected} : {kind:"all"},range:r}));
}

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
    assert.equal(beforeRevision.state,"complete");
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
    assert.equal(result.state,"complete"); assert.equal(result.priceKrw,10); assert.equal(result.fxKrw,0);
    await pg.query("update daily_portfolio_snapshots set native_evidence=jsonb_set(native_evidence,'{frame,positions,0,ownerId}',to_jsonb($1::text)) where snapshot_date=$2 and account_id=$3",[other,"2025-06-03",native]);
    const incomplete = await read(owner,native);
    assert.equal(incomplete.state,"unavailable"); assert.ok(incomplete.gaps.some(g=>g.reason==="holding_history"));
    await pg.query("insert into native_ledger_revisions values($1,$2,1,'2025-06-02T18:00Z','2025-06-08T00:00Z')",[owner,native]);
    assert.deepEqual((await read(owner,native)).gaps.map(g=>g.reason),["account_history"]);
  } finally { await pg.close(); }
});
