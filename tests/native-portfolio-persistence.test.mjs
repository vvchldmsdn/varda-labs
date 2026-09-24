import assert from 'node:assert/strict';
import { after, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { Decimal } from '../src/lib/money.ts';
import { importWithPorts } from './helpers/import-with-ports.mjs';

const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const account='11111111-1111-4111-8111-111111111111', peer='22222222-2222-4222-8222-222222222222', foreign='33333333-3333-4333-8333-333333333333', asset='44444444-4444-4444-8444-444444444444';
const at='2026-09-01T00:00:00Z', later='2026-09-02T00:00:00Z';
const clocks = new WeakMap();
function setNow(t, at) { let clock = clocks.get(t); if (!clock) { clock = { at }; clocks.set(t, clock); t.mock.method(Date, 'now', () => Date.parse(clock.at)); } clock.at = at; }
let database;
after(async()=>{ await database?.close(); });

const ddl=`
create table app_users(id uuid primary key,status text not null,role text default 'user');
create table accounts(id uuid primary key,canonical_owner_user_id uuid,code text not null,name text not null,is_active boolean default true,updated_at timestamptz default now());
create table assets(id uuid primary key,canonical_owner_user_id uuid,account_id uuid,account text not null,name text,ticker text,market text,currency text,asset_type text,quantity numeric(20,6) not null default 0,current_price numeric(20,4),average_cost numeric(20,4),price_source text,price_status text,archived_at timestamptz,updated_at timestamptz default now());
create table event_ledger_entries(id uuid primary key,canonical_owner_user_id uuid,event_date date not null,event_type text not null,source text,recorded_at timestamptz,rule_version text,account text,account_id uuid,asset_id uuid,legacy_asset_id varchar(24) not null,asset_name text not null,before_value text not null,after_value text not null,is_sample boolean not null default false);
create table daily_portfolio_snapshots(id uuid primary key default gen_random_uuid(),canonical_owner_user_id uuid,snapshot_date date,account text,account_id uuid,source text not null default 'base44_import',rule_version text,is_sample boolean not null default false,captured_at timestamptz);
create unique index snapshot_owner_date_account_source on daily_portfolio_snapshots(canonical_owner_user_id,snapshot_date,account,source) where canonical_owner_user_id is not null;
`;
async function fixture(withApi=false) {
  const pg=database??=new PGlite();
  await pg.exec("drop schema public cascade; create schema public; do $$ begin if not exists(select 1 from pg_roles where rolname='varda_tenant_app') then create role varda_tenant_app; end if; end $$;"+ddl);
  await pg.exec(readFileSync(new URL('../drizzle/0050_native_portfolio_ledger.sql',import.meta.url),'utf8'));
  for (const migration of ['0045_investment_plans','0052_native_legacy_lifecycle_guard','0056_native_tenant_mutation']) await pg.exec(readFileSync(new URL(`../drizzle/${migration}.sql`,import.meta.url),'utf8'));
  await pg.exec('grant usage on schema public to varda_tenant_app');
  for(const table of ['accounts','assets','event_ledger_entries','daily_portfolio_snapshots']) await pg.exec(`alter table ${table} enable row level security; alter table ${table} force row level security; create policy tenant_select on ${table} for select to varda_tenant_app using(canonical_owner_user_id = nullif(current_setting('app.current_user_id',true),'')::uuid); grant select on ${table} to varda_tenant_app;`);
  await pg.query("insert into app_users(id,status) values($1,'active'),($2,'active')",[owner,other]);
  await pg.query("insert into accounts(id,canonical_owner_user_id,code,name) values($1,$4,'one','One'),($2,$4,'two','Two'),($3,$5,'foreign','Foreign')",[account,peer,foreign,owner,other]);
  await pg.query("insert into event_ledger_entries values($1,$2,'2026-08-01','legacy','base44_import',now(),null,'one',$3,null,'legacy-asset','Original','before','after',false,null,null,null)",[randomUUID(),owner,account]);
  const legacy=(await pg.query("select * from event_ledger_entries where source='base44_import'")).rows;
  let beforeWrite=null;
  const batches=[];
  const transport=(tenant)=>({transaction:async(build,options)=>{
    const commands=build({query:(text,params=[])=>({text,params})}); batches.push({tenant,commands,options});
    if(beforeWrite && (!tenant || commands.some(c=>c.text.includes('apply_native_portfolio_tenant_mutation')))) { const effect=beforeWrite; beforeWrite=null; await effect(pg,commands); }
    return pg.transaction(async tx=>{
      if(tenant) await tx.exec('set local role varda_tenant_app');
      const rows=[]; for(const command of commands) rows.push((await tx.query(command.text,command.params)).rows); return rows;
    });
  }});
  let authenticated=true, subject='verified-one';
  const [queries,projection,valuation,snapshots,route]=await importWithPorts(['src/db/queries/native-portfolio-ledger.ts','src/lib/native-portfolio-projection.ts','src/lib/currency-tracked-portfolio.ts','src/db/queries/native-portfolio-snapshots.ts',...(withApi?['src/app/api/portfolio/ledger/route.ts']:[])],{
    '@/db/tenant-client':{getTenantSqlClient:()=>transport(true)}, '@/db/client':{sqlClient:transport(false),db:drizzle(pg)},
    '@/lib/auth/current-session-subject':{readCurrentSessionSubject:async()=>authenticated?{state:'authenticated',provider:'neon',providerSubject:subject}:{state:'unauthenticated'}},
    '@/lib/auth/current-tenant-context':{resolveCurrentTenantContext:async()=>({ok:true,tenantContext:{ownerUserId:owner}})},
    'next/server':{after:()=>{}},
  });
  async function open(accountId=account, cash={KRW:'0',USD:'0'},positions=[]) {
    const input={operationId:randomUUID(),accountId,expectedSequence:null,opening:{at,cash,positions}};
    assert.equal((await queries.writeNativeMutation({ownerUserId:owner},input)).status,'created'); return input;
  }
  async function mutate(operation,accountId=account,extra={}) {
    const ledger=await queries.readNativeLedger({ownerUserId:owner},accountId);
    const input={operationId:randomUUID(),accountId,expectedSequence:ledger.accounts[0].state.sequence,event:{at:later,...operation},...extra};
    return {input,result:await queries.writeNativeMutation({ownerUserId:owner},input)};
  }
  async function evidence(time=at,price='100',reporting='USD',fxRate='1400',accountId=account) {
    const ledger=await queries.readNativeLedger({ownerUserId:owner},accountId);
    const positions=ledger.accounts[0].assets.filter(a=>!a.archived).map(a=>({id:a.id,ownerId:owner,accountId,name:'Actual test stock',observation:{quantity:a.quantity,price,currency:a.currency,at:time,basis:'raw',source:'test raw quote'}}));
    return projection.attachNativeLedgerEvidence({ownerId:owner,reporting,asOf:time,current:{at:time,source:'test raw quote',scopeComplete:false,positions},history:[],trades:null,fx:[{base:'USD',quote:'KRW',rate:fxRate,observedAt:time,fetchedAt:time,kind:'daily_reference',source:'test fixture'}],maxFxAgeMs:0,maxPriceAgeMs:0},ledger,'account');
  }
  return {pg,queries,projection,valuation,snapshots,route,evidence,open,mutate,batches,legacy,setBeforeWrite(fn){beforeWrite=fn;},setIdentity(nextSubject,active=true){subject=nextSubject;authenticated=active;}};
}

it('executes the actual SQL writer, tenant reads, engine and projection against fixed ledger amounts',async()=>{
  const f=await fixture(); await f.open();
  assert.equal((await f.mutate({type:'deposit',amount:'2000',currency:'USD'})).result.status,'created');
  assert.equal((await f.mutate({type:'buy',assetId:asset,quantity:'10',price:'100',currency:'USD',fee:{amount:'2',currency:'USD'}},account,{newAsset:{id:asset,name:'Actual test stock',ticker:'TEST',market:'us',currency:'USD',assetType:'stock'}})).result.status,'created');
  assert.equal((await f.mutate({type:'sell',assetId:asset,quantity:'4',price:'110',currency:'USD',fee:{amount:'1',currency:'USD'}})).result.status,'created');
  assert.equal((await f.mutate({type:'withdraw',amount:'200',currency:'USD'})).result.status,'created');
  const ledger=await f.queries.readNativeLedger({ownerUserId:owner},account),state=ledger.accounts[0].state;
  assert.equal(state.cash.USD,'1237'); assert.equal(state.positions[0].quantity,'6');
  assert.deepEqual(state.positions[0].costLots[0].remaining,{n:'3',d:'5'});
  assert.equal((await f.pg.query('select quantity::text as quantity from assets where id=$1',[asset])).rows[0].quantity,'6.000000');
  const base={ownerId:owner,reporting:'USD',asOf:later,current:{at:later,source:'actual test quote',scopeComplete:false,positions:[{id:asset,ownerId:owner,accountId:account,name:'Actual test stock',observation:{quantity:'6',price:'110',currency:'USD',at:later,basis:'raw',source:'test quote'}}]},history:[],trades:null,fx:[{base:'USD',quote:'KRW',rate:'1400',observedAt:later,fetchedAt:later,kind:'daily_reference',source:'test'}],maxFxAgeMs:0,maxPriceAgeMs:0};
  const projected=f.projection.attachNativeLedgerEvidence(base,ledger,'account');
  const value=f.valuation.buildTrackedCurrencyPortfolio(projected);
  assert.equal(value.current.total,'1897'); assert.equal(value.current.positions.find(row=>row.id===asset).cost,'600');
  assert.equal(value.performanceReturn,null,'an opening is not a fabricated historical valuation');
  assert.equal(projected.cashFlows.filter(leg=>leg.kind==='external').reduce((sum,leg)=>sum+Number(leg.delta),0),1800);
  assert.deepEqual((await f.pg.query("select * from event_ledger_entries where source='base44_import'")).rows,f.legacy);
  assert.ok(f.batches.filter(batch=>!batch.tenant).every(batch=>batch.commands[2].text.includes('pg_advisory_xact_lock')));
});

it('keeps owner/RLS read boundaries and denies direct tenant mutation authority',async()=>{
  const f=await fixture(); await f.open();
  assert.deepEqual((await f.queries.readNativeLedger({ownerUserId:other},account)).accounts,[]);
  assert.deepEqual((await f.queries.readNativeLedger({ownerUserId:other},account)).entries,[]);
  const request={operationId:randomUUID(),accountId:account,expectedSequence:0,event:{type:'deposit',at:later,amount:'100',currency:'USD'}};
  assert.equal((await f.queries.writeNativeMutation({ownerUserId:other},request)).status,'conflict');
  await assert.rejects(f.pg.transaction(async tx=>{await tx.exec('set local role varda_tenant_app'); await tx.query("select apply_native_portfolio_mutation($1,$2,'{}','[]')",[owner,randomUUID()]);}),/permission denied/);
  await assert.rejects(f.pg.transaction(async tx=>{await tx.exec('set local role varda_tenant_app'); await tx.query("update accounts set name='bad' where id=$1",[account]);}),/permission denied/);
});

it('makes identical retries idempotent and stale/colliding requests conflict',async()=>{
  const f=await fixture(); const initial=await f.open();
  assert.equal((await f.queries.writeNativeMutation({ownerUserId:owner},initial)).status,'existing');
  const {input,result}=await f.mutate({type:'deposit',amount:'10',currency:'USD'}); assert.equal(result.status,'created');
  assert.equal((await f.queries.writeNativeMutation({ownerUserId:owner},input)).status,'existing');
  assert.equal((await f.queries.writeNativeMutation({ownerUserId:owner},{...input,event:{...input.event,amount:'11'}})).status,'conflict');
  assert.equal((await f.queries.writeNativeMutation({ownerUserId:owner},{...input,operationId:randomUUID()})).status,'conflict');
  const data=await f.queries.readNativeLedger({ownerUserId:owner},account); assert.equal(data.entries.length,2); assert.equal(data.accounts[0].state.cash.USD,'10');
});

it('fences a committed competing event between tenant read and the SQL lock',async()=>{
  const f=await fixture(); await f.open();
  f.setBeforeWrite(async()=>{ assert.equal((await f.mutate({type:'deposit',amount:'1',currency:'USD'})).result.status,'created'); });
  assert.equal((await f.mutate({type:'deposit',amount:'10',currency:'USD'})).result.status,'conflict');
  const ledger=await f.queries.readNativeLedger({ownerUserId:owner},account);
  assert.equal(ledger.entries.length,2); assert.equal(ledger.accounts[0].state.cash.USD,'1');
});

it('commits both transfer legs together and rolls both back if either insert fails',async()=>{
  const f=await fixture(); await f.open(account,{KRW:'0',USD:'300'}); await f.open(peer);
  let id=randomUUID();
  assert.equal((await f.mutate({type:'transfer',direction:'out',amount:'100',currency:'USD',transferId:id,peerAccountId:peer},account,{operationId:id})).result.status,'created');
  let ledger=await f.queries.readNativeLedger({ownerUserId:owner});
  assert.deepEqual(ledger.accounts.filter(a=>a.state).map(a=>a.state.cash.USD),['200','100']);
  assert.equal(ledger.entries.filter(e=>e.operationId===id).length,2);
  await f.pg.exec(`create function reject_peer_entry() returns trigger language plpgsql as $$ begin if NEW.account_id='${peer}'::uuid and NEW.native_sequence=2 then raise exception 'test_peer_insert_failure'; end if; return NEW; end $$; create trigger reject_peer before insert on event_ledger_entries for each row execute function reject_peer_entry();`);
  id=randomUUID(); await assert.rejects(f.mutate({type:'transfer',direction:'out',amount:'50',currency:'USD',transferId:id,peerAccountId:peer},account,{operationId:id}),/test_peer_insert_failure/);
  ledger=await f.queries.readNativeLedger({ownerUserId:owner});
  assert.deepEqual(ledger.accounts.filter(a=>a.state).map(a=>a.state.cash.USD),['200','100']);
  assert.equal(ledger.entries.filter(e=>e.operationId===id).length,0);
  id=randomUUID(); assert.equal((await f.mutate({type:'transfer',direction:'out',amount:'10',currency:'USD',transferId:id,peerAccountId:foreign},account,{operationId:id})).result.status,'invalid');
});

it('fences both transfer accounts against recorded snapshots without inventing a peer gain',async(t)=>{
  setNow(t,later);
  const f=await fixture();
  const opening=await f.open(account,{KRW:'0',USD:'300'}); await f.open(peer,{KRW:'0',USD:'100'});
  assert.equal((await f.snapshots.saveNativeSnapshots({ownerUserId:owner},await f.evidence(later,'100','USD','1400',peer))).created,1);
  const original=(await f.pg.query('select native_evidence from daily_portfolio_snapshots')).rows[0].native_evidence;
  for(const eventAt of ['2026-09-01T23:00:00Z',later]) {
    const id=randomUUID(), writes=f.batches.filter(batch=>!batch.tenant).length;
    const {result}=await f.mutate({type:'transfer',at:eventAt,direction:'out',amount:'50',currency:'USD',transferId:id,peerAccountId:peer},account,{operationId:id});
    assert.deepEqual(result,{status:'invalid',reason:'event_precedes_recorded_snapshot'});
    assert.equal(f.batches.filter(batch=>!batch.tenant).length,writes,'the loaded peer snapshot blocks the application writer');
    assert.equal((await f.queries.readNativeLedger({ownerUserId:owner})).entries.filter(entry=>entry.operationId===id).length,0);
  }
  setNow(t,'2026-09-02T01:00:00Z');
  let report=f.valuation.buildTrackedCurrencyPortfolio(await f.evidence('2026-09-02T01:00:00Z','100','USD','1400',peer));
  assert.equal(report.current.total,'100'); assert.equal(report.performanceReturn.totalReturn,0);
  const id=randomUUID(), valid=await f.mutate({type:'transfer',at:'2026-09-02T00:30:00Z',direction:'out',amount:'50',currency:'USD',transferId:id,peerAccountId:peer},account,{operationId:id});
  assert.equal(valid.result.status,'created');
  report=f.valuation.buildTrackedCurrencyPortfolio(await f.evidence('2026-09-02T01:00:00Z','100','USD','1400',peer));
  assert.equal(report.current.total,'150'); assert.equal(report.performanceReturn.totalReturn,0,'a later scoped external transfer remains capital, not performance');
  assert.deepEqual((await f.pg.query('select native_evidence from daily_portfolio_snapshots')).rows[0].native_evidence,original);
  setNow(t,'2026-09-03T00:00:00Z');
  assert.equal((await f.snapshots.saveNativeSnapshots({ownerUserId:owner},await f.evidence('2026-09-03T00:00:00Z','100','USD','1400',peer))).created,1);
  assert.equal((await f.queries.writeNativeMutation({ownerUserId:owner},valid.input)).status,'existing','an identical committed transfer remains idempotent after a later snapshot');
  assert.equal((await f.queries.writeNativeMutation({ownerUserId:owner},opening)).status,'existing');
});

it('rechecks every changed account after a snapshot commits between the tenant read and mutation lock',async(t)=>{
  for(const capturedAccount of [account,peer]) {
    setNow(t,later);
    const f=await fixture(); await f.open(account,{KRW:'0',USD:'300'}); await f.open(peer,{KRW:'0',USD:'100'});
    const capture=await f.evidence(later,'100','USD','1400',capturedAccount);
    f.setBeforeWrite(async()=>{
      assert.equal((await f.snapshots.saveNativeSnapshots({ownerUserId:owner},capture)).created,1);
    });
    const id=randomUUID();
    const operation=capturedAccount===account
      ? {type:'deposit',at:'2026-09-01T23:00:00Z',amount:'50',currency:'USD'}
      : {type:'transfer',at:'2026-09-01T23:00:00Z',direction:'out',amount:'50',currency:'USD',transferId:id,peerAccountId:peer};
    const {result}=await f.mutate(operation,account,{operationId:id});
    assert.deepEqual(result,{status:'invalid',reason:'event_precedes_recorded_snapshot'});
    const ledger=await f.queries.readNativeLedger({ownerUserId:owner});
    assert.deepEqual(ledger.accounts.map(row=>row.state.cash.USD),['300','100']);
    assert.equal(ledger.entries.filter(entry=>entry.operationId===id).length,0,'neither transfer leg may commit');
    assert.equal(ledger.snapshots.length,1);
    setNow(t,'2026-09-02T01:00:00Z');
    const report=f.valuation.buildTrackedCurrencyPortfolio(await f.evidence('2026-09-02T01:00:00Z','100','USD','1400',capturedAccount));
    assert.equal(report.current.total,capturedAccount===account?'300':'100');
    assert.equal(report.performanceReturn.totalReturn,0,'the immutable record cannot acquire phantom investment gain');
  }
});

it('accepts later explicit costs without manufacturing earlier transaction history',async()=>{
  const f=await fixture();
  await f.pg.query("insert into assets(id,canonical_owner_user_id,account_id,account,currency,quantity,name,ticker) values($1,$2,$3,'one','USD',10,'Existing','EXIST')",[asset,owner,account]);
  await f.open(account,{KRW:'0',USD:'0'},[{assetId:asset,currency:'USD',quantity:'10',costLots:null}]);
  assert.equal((await f.mutate({type:'cost_basis',assetId:asset,costLots:[{amount:'1000',currency:'USD',at,source:'user_native_ledger',remaining:{n:'1',d:'1'}}]})).result.status,'created');
  const ledger=await f.queries.readNativeLedger({ownerUserId:owner},account);
  assert.equal(ledger.entries[0].data.state.positions[0].costLots,null);
  assert.equal(ledger.accounts[0].state.positions[0].costLots[0].amount,'1000');
  assert.deepEqual(ledger.entries.map(row=>row.data.event.type),['opening','cost_basis']);
  assert.equal((await f.pg.query('select average_cost from assets where id=$1',[asset])).rows[0].average_cost,null);
});

it('rejects legacy archival of a nonzero native holding without changing its ledger',async()=>{
  const f=await fixture();
  await f.pg.query("insert into assets(id,canonical_owner_user_id,account_id,account,currency,quantity,name,ticker) values($1,$2,$3,'one','USD',10,'Existing','EXIST')",[asset,owner,account]);
  await f.open(account,{KRW:'0',USD:'0'},[{assetId:asset,currency:'USD',quantity:'10',costLots:null}]);
  await assert.rejects(f.pg.query('update assets set archived_at=now() where id=$1',[asset]),/native_ledger_required/);
  assert.equal((await f.pg.query('select archived_at from assets where id=$1',[asset])).rows[0].archived_at,null);
  assert.equal((await f.queries.readNativeLedger({ownerUserId:owner},account)).accounts[0].state.cash.USD,'0');
  assert.equal((await f.queries.readNativeLedger({ownerUserId:owner},account)).accounts[0].state.positions[0].quantity,'10');
});

it('keeps native snapshot evidence opt-in, non-sample and tenant-scoped',async()=>{
  const f=await fixture();
  await assert.rejects(f.pg.query("insert into daily_portfolio_snapshots(id,canonical_owner_user_id,account_id,native_evidence) values($1,$2,$3,'{}')",[randomUUID(),owner,account]),/snapshot_native_evidence_check/);
  await f.pg.query("insert into daily_portfolio_snapshots(id,canonical_owner_user_id,account_id,source,native_evidence,captured_at) values($1,$2,$3,'native_ledger_v1','{\"version\":1}',now())",[randomUUID(),owner,account]);
  assert.equal((await f.queries.readNativeLedger({ownerUserId:owner},account)).snapshots.length,1);
  assert.equal((await f.queries.readNativeLedger({ownerUserId:other},account)).snapshots.length,0);
});

it('persists the real first capture once and recalculates USD +10% versus KRW -1% from dated SQL snapshots',async(t)=>{
  setNow(t,later);
  const f=await fixture();
  await f.pg.query("insert into assets(id,canonical_owner_user_id,account_id,account,currency,quantity,name,ticker) values($1,$2,$3,'one','USD',10,'Existing','EXIST')",[asset,owner,account]);
  await f.open(account,{KRW:'0',USD:'0'},[{assetId:asset,currency:'USD',quantity:'10',costLots:null}]);
  setNow(t,at);
  const initial=await f.evidence();
  assert.equal((await f.snapshots.saveNativeSnapshots({ownerUserId:owner},initial)).created,1);
  const original=(await f.pg.query('select native_evidence from daily_portfolio_snapshots')).rows[0].native_evidence;
  assert.equal((await f.snapshots.saveNativeSnapshots({ownerUserId:owner},initial)).created,0);
  const revised=await f.evidence(at,'999');
  assert.equal((await f.snapshots.saveNativeSnapshots({ownerUserId:owner},revised)).created,0);
  assert.deepEqual((await f.pg.query('select native_evidence from daily_portfolio_snapshots')).rows[0].native_evidence,original);
  setNow(t,later);
  for(const [currency,total,change] of [['USD','1100','100'],['KRW','1386000','-14000']]) {
    const next=await f.evidence(later,'110',currency,'1260');
    const result=f.valuation.buildTrackedCurrencyPortfolio(next);
    assert.equal(result.current.total,total); assert.equal(result.movement.attribution.investmentChange,change);
    assert.equal(result.performanceReturn.status,'ready');
    assert.ok(Math.abs(result.performanceReturn.totalReturn-(currency==='USD'?0.1:-0.01))<1e-12);
    assert.equal(Number(result.current.total)/Number(result.history[0].total)-1,currency==='USD'?0.10000000000000009:-0.010000000000000009);
  }
  assert.equal((await f.snapshots.saveNativeSnapshots({ownerUserId:owner},initial)).status,'stale');
  assert.equal((await f.snapshots.saveNativeSnapshots({ownerUserId:other},await f.evidence(later))).created,0);
});

it('does not snapshot a sequence changed after valuation was read',async(t)=>{
  setNow(t,at);
  const f=await fixture(); await f.open(account,{KRW:'0',USD:'1000'});
  const capture=await f.evidence();
  f.setBeforeWrite(async()=>{ assert.equal((await f.mutate({type:'deposit',amount:'1',currency:'USD',at})).result.status,'created'); });
  assert.equal((await f.snapshots.saveNativeSnapshots({ownerUserId:owner},capture)).created,0);
  assert.equal((await f.pg.query('select count(*)::int as n from daily_portfolio_snapshots')).rows[0].n,0);
});

it('rejects legacy quantity divergence before a native snapshot is stored',async(t)=>{
  setNow(t,at);
  const f=await fixture();
  await f.pg.query("insert into assets(id,canonical_owner_user_id,account_id,account,currency,quantity,name) values($1,$2,$3,'one','USD',10,'Existing')",[asset,owner,account]);
  await f.open(account,{KRW:'0',USD:'0'},[{assetId:asset,currency:'USD',quantity:'10',costLots:null}]);
  const capture=await f.evidence();
  await assert.rejects(f.pg.query('update assets set quantity=11 where id=$1',[asset]),/native_ledger_required/);
  assert.equal((await f.snapshots.saveNativeSnapshots({ownerUserId:owner},capture)).created,1);
});

it('includes income and fees in investment gain and excludes withdrawal from SQL-backed movement',async(t)=>{
  setNow(t,at);
  const f=await fixture(); await f.open(account,{KRW:'0',USD:'2000'});
  assert.equal((await f.snapshots.saveNativeSnapshots({ownerUserId:owner},await f.evidence())).created,1);
  setNow(t,later);
  assert.equal((await f.mutate({type:'buy',assetId:asset,quantity:'10',price:'100',currency:'USD',fee:{amount:'2',currency:'USD'}},account,{newAsset:{id:asset,name:'Actual test stock',ticker:'TEST',market:'us',currency:'USD',assetType:'stock'}})).result.status,'created');
  assert.equal((await f.mutate({type:'sell',assetId:asset,quantity:'4',price:'110',currency:'USD',fee:{amount:'1',currency:'USD'}})).result.status,'created');
  assert.equal((await f.mutate({type:'withdraw',amount:'200',currency:'USD'})).result.status,'created');
  assert.equal((await f.mutate({type:'dividend',amount:'5',currency:'USD',assetId:asset})).result.status,'created');
  const result=f.valuation.buildTrackedCurrencyPortfolio(await f.evidence(later,'110'));
  assert.equal(result.current.total,'1902');
  assert.equal(result.movement.reason,null);
  assert.equal(result.movement.attribution.investmentChange,'102');
  assert.equal(result.movement.attribution.valuationChange,'-98');
  assert.equal(result.movement.attribution.assetTradeFlow,'-200');
  const a=result.movement.attribution;
  assert.equal(a.otherCashReturn,'2');
  assert.equal(a.positions.find(row=>row.id===asset).change,'100');
  assert.equal(result.performanceReturn.status,'ready');
  assert.ok(Math.abs(result.performanceReturn.totalReturn-0.051)<1e-12);
  assert.equal(Decimal.from(a.price).add(a.exchange).add(a.assetTradeFlow).add(a.otherCashReturn).compare(a.valuationChange),0);
  assert.equal(Decimal.from(a.price).add(a.exchange).add(a.otherCashReturn).compare(a.investmentChange),0);
});

it('applies an actual split and dividend once using original SQL quantities and raw prices',async(t)=>{
  setNow(t,at);
  const f=await fixture();
  await f.pg.query("insert into assets(id,canonical_owner_user_id,account_id,account,currency,quantity,name) values($1,$2,$3,'one','USD',10,'Existing')",[asset,owner,account]);
  await f.open(account,{KRW:'0',USD:'0'},[{assetId:asset,currency:'USD',quantity:'10',costLots:null}]);
  assert.equal((await f.snapshots.saveNativeSnapshots({ownerUserId:owner},await f.evidence())).created,1);
  setNow(t,later);
  assert.equal((await f.mutate({type:'split',assetId:asset,ratio:{n:'2',d:'1'}})).result.status,'created');
  assert.equal((await f.mutate({type:'dividend',assetId:asset,amount:'10',currency:'USD'})).result.status,'created');
  const evidence=await f.evidence(later,'50');
  const result=f.valuation.buildTrackedCurrencyPortfolio(evidence);
  assert.equal(result.current.total,'1010'); assert.equal(result.history[0].total,'1000');
  assert.equal(result.movement.reason,null);
  assert.equal(result.movement.attribution.price,'0'); assert.equal(result.movement.attribution.otherCashReturn,'10');
  assert.equal(result.movement.attribution.investmentChange,'10');
  assert.equal(Number(evidence.history[0].positions.find(row=>row.id===asset).observation.quantity),10);
  assert.equal(Number(evidence.current.positions.find(row=>row.id===asset).observation.quantity),20);
});

it('captures cash-only owners on the existing daily job without provider calls and retries idempotently',async()=>{
  const f=await fixture(); await f.open(account,{KRW:'0',USD:'2000'});
  const [job]=await importWithPorts(['src/lib/snapshots/native-daily-job.ts'],{
    '@/db/client':{db:drizzle(f.pg)},
    '@/db/queries/currency-tracked-portfolio':{getTrackedCurrencyEvidence:async(tenant,scope,reporting,options)=>{
      assert.equal(tenant.ownerUserId,owner); assert.equal(scope.accountId,account); assert.equal(options.collect,false);
      return f.evidence(options.asOf.toISOString(),'100',reporting);
    }},
    '@/db/queries/native-portfolio-snapshots':f.snapshots,
  });
  let result=await job.runNativeDailySnapshotJob(); assert.equal(result.dryRun,true); assert.equal(result.targetCount,1); assert.equal(result.created,0);
  assert.equal((await f.pg.query('select count(*)::int as n from daily_portfolio_snapshots')).rows[0].n,0);
  result=await job.runNativeDailySnapshotJob({dryRun:false}); assert.equal(result.created,1); assert.equal(result.failedCount,0);
  assert.equal((await job.runNativeDailySnapshotJob({dryRun:false})).created,0);
  await f.pg.query("update app_users set status='disabled' where id=$1",[owner]);
  assert.equal((await job.runNativeDailySnapshotJob()).targetCount,0);
});

it('keeps closed empty account history and rejects further account writes',async(t)=>{
  setNow(t,at); const f=await fixture(); await f.open(account,{KRW:'0',USD:'1000'});
  await f.snapshots.saveNativeSnapshots({ownerUserId:owner},await f.evidence());
  setNow(t,later); await f.mutate({type:'withdraw',amount:'1000',currency:'USD'});
  await f.pg.query('update accounts set is_active=false,updated_at=$2 where id=$1',[account,later]);
  const ledger=await f.queries.readNativeLedger({ownerUserId:owner},account);
  assert.equal(ledger.accounts[0].active,false); assert.equal(ledger.snapshots.length,1);
  const evidence=await f.evidence(later);
  const result=f.valuation.buildTrackedCurrencyPortfolio(evidence);
  assert.equal(result.current.total,'0'); assert.equal(result.movement.attribution.investmentChange,'0');
  assert.equal(result.movement.attribution.assetTradeFlow,'-1000');
  assert.deepEqual(evidence.nativeSequences,{});
  assert.equal((await f.mutate({type:'deposit',amount:'1',currency:'USD'})).result.status,'inactive');
});

it('retains the observed spot FX from an immutable capture without replacing it with today FX',async(t)=>{
  setNow(t,at); const f=await fixture(); await f.open(account,{KRW:'1400000',USD:'1000'});
  const initial=await f.evidence(); initial.fx[0].kind='spot';
  assert.equal((await f.snapshots.saveNativeSnapshots({ownerUserId:owner},initial)).created,1);
  setNow(t,later);
  const result=f.valuation.buildTrackedCurrencyPortfolio(await f.evidence(later,'100','USD','1260'));
  assert.equal(result.history[0].total,'2000');
  assert.ok(Math.abs(Number(result.current.total)-(1000+1400000/1260))<1e-10);
  assert.equal(result.movement.reason,null);
  const saved=(await f.pg.query('select native_evidence from daily_portfolio_snapshots')).rows[0].native_evidence;
  assert.equal(saved.fx[0].rate,'1400'); assert.equal(saved.fx[0].kind,'spot');
});

it('does not let missing or stale evidence occupy the immutable daily snapshot slot',async(t)=>{
  setNow(t,at);
  const f=await fixture();
  await f.pg.query("insert into assets(id,canonical_owner_user_id,account_id,account,currency,quantity,name) values($1,$2,$3,'one','USD',10,'Existing')",[asset,owner,account]);
  await f.open(account,{KRW:'1400000',USD:'0'},[{assetId:asset,currency:'USD',quantity:'10',costLots:null}]);
  const missingFx=await f.evidence(); missingFx.fx=[];
  assert.equal((await f.snapshots.saveNativeSnapshots({ownerUserId:owner},missingFx)).status,'incomplete');
  const stalePrice=await f.evidence(); stalePrice.current.positions[0].observation.priceObservedAt='2026-08-01T00:00:00Z';
  assert.equal((await f.snapshots.saveNativeSnapshots({ownerUserId:owner},stalePrice)).status,'incomplete');
  assert.equal((await f.pg.query('select count(*)::int as n from daily_portfolio_snapshots')).rows[0].n,0);
  assert.equal((await f.snapshots.saveNativeSnapshots({ownerUserId:owner},await f.evidence())).created,1);
});

it('enforces real API authentication, session continuity, origin and body ownership with durable duplicate handling',async(t)=>{
  const oldMode=process.env.NATIVE_LEDGER_ROLLOUT, oldOwners=process.env.NATIVE_LEDGER_QA_OWNERS;
  t.after(()=>{for(const [key,value] of [['NATIVE_LEDGER_ROLLOUT',oldMode],['NATIVE_LEDGER_QA_OWNERS',oldOwners]]) { if(value===undefined) delete process.env[key]; else process.env[key]=value; }});
  delete process.env.NATIVE_LEDGER_ROLLOUT;
  const f=await fixture(true);
  const request=(method,body,origin='https://local.test')=>new Request('https://local.test/api/portfolio/ledger',{method,headers:{origin,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  f.setIdentity('verified-one',false);
  assert.equal((await f.route.GET(request('GET'))).status,401);
  f.setIdentity('verified-one');
  const get=await f.route.GET(request('GET')); assert.equal(get.status,200); assert.equal(get.headers.get('cache-control'),'private, no-store');
  const {sessionKey}=await get.json();
  const mutation={operationId:randomUUID(),accountId:account,expectedSequence:null,opening:{at,cash:{KRW:'0',USD:'0'},positions:[]}};
  assert.equal((await f.route.POST(request('POST',{sessionKey,mutation},'https://foreign.test'))).status,400);
  assert.equal((await f.route.POST(request('POST',{sessionKey,mutation,ownerUserId:other}))).status,400);
  assert.equal((await f.route.POST(request('POST',{sessionKey,mutation:{...mutation,ownerUserId:other}}))).status,400);
  f.setIdentity('verified-two'); assert.equal((await f.route.POST(request('POST',{sessionKey,mutation}))).status,409);
  f.setIdentity('verified-one',false); assert.equal((await f.route.POST(request('POST',{sessionKey,mutation}))).status,401);
  f.setIdentity('verified-one');
  assert.equal((await f.route.POST(request('POST',{sessionKey,mutation}))).status,503);
  assert.equal((await f.queries.readNativeLedger({ownerUserId:owner},account)).entries.length,0);
  process.env.NATIVE_LEDGER_ROLLOUT='qa'; process.env.NATIVE_LEDGER_QA_OWNERS=owner;
  const created=await f.route.POST(request('POST',{sessionKey,mutation})); assert.equal(created.status,201);
  assert.equal((await created.json()).snapshot,'unavailable','missing local quote schema must not invalidate durable ledger success');
  assert.equal((await f.route.POST(request('POST',{sessionKey,mutation}))).status,200);
  assert.equal((await f.queries.readNativeLedger({ownerUserId:owner},account)).entries.length,1);
});

it('keeps current cash, quantity, costs and new writes after the native event window is exceeded',async(t)=>{
  setNow(t,later);
  const f=await fixture();
  await f.pg.query("insert into assets(id,canonical_owner_user_id,account_id,account,currency,quantity,name) values($1,$2,$3,'one','USD',10,'Existing')",[asset,owner,account]);
  const opening=await f.open(account,{KRW:'0',USD:'250'},[{assetId:asset,currency:'USD',quantity:'10',costLots:[{amount:'600',currency:'USD',at:'2026-08-01T00:00:00Z',source:'user_native_ledger',remaining:{n:'1',d:'1'}}]}]);
  // Deterministic historical deposits: independent expected cash = 250 + 10,001.
  // Seed only the isolated database; actual application writer is used below.
  await f.pg.query(`insert into event_ledger_entries(id,canonical_owner_user_id,event_date,event_type,source,recorded_at,account,account_id,asset_name,before_value,after_value,native_sequence,native_operation_id,native_data)
    select gen_random_uuid(),$1::uuid,'2026-09-01','deposit','native_ledger_v1',$3::timestamptz+n*interval '1 second','one',$2::uuid,'','','',n,operation,
      jsonb_build_object('request',jsonb_build_object('operationId',operation),'event',jsonb_build_object('type','deposit','at',$3::timestamptz+n*interval '1 second','amount','1','currency','USD'),
        'state',jsonb_set(jsonb_set(jsonb_set(a.native_state,'{sequence}',to_jsonb(n)),'{at}',to_jsonb(to_char(($3::timestamptz+n*interval '1 second') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))),'{cash,USD}',to_jsonb((250+n)::text)),
        'effect',jsonb_build_object('cashLegs',jsonb_build_array(jsonb_build_object('currency','USD','delta','1','kind','external'))))
    from accounts a cross join generate_series(1,10001) n cross join lateral (select gen_random_uuid() as operation where n>0) op where a.id=$2::uuid`,[owner,account,at]);
  await f.pg.query("update accounts set native_state=(select native_data->'state' from event_ledger_entries where account_id=$1 and native_sequence=10001) where id=$1",[account]);
  let ledger=await f.queries.readNativeLedger({ownerUserId:owner},account);
  assert.equal(ledger.accountsComplete,true); assert.equal(ledger.entriesComplete,false); assert.equal(ledger.historyComplete,false);
  assert.deepEqual(ledger.entries,[]); assert.deepEqual(ledger.snapshots,[]);
  const query=f.batches.at(-1).commands[2];
  const exported=(await f.pg.query(query.text,query.params)).rows;
  assert.deepEqual(exported,[{complete:false,rows:[]}],'over-cap query returns metadata, not 10,001 full-state JSON objects');
  let evidence=await f.evidence(later), report=f.valuation.buildTrackedCurrencyPortfolio(evidence);
  assert.equal(report.current.total,'11251'); assert.equal(report.current.positions.find(p=>p.id===asset).cost,'600');
  assert.equal(evidence.current.positions.find(p=>p.id===asset).observation.quantity,'10.000000');
  assert.equal(evidence.ledgerComplete,true); assert.equal(evidence.cashFlows,undefined); assert.equal(evidence.trades,null);
  assert.equal(evidence.realizedTradesComplete,false); assert.equal(evidence.realizedTrades,null);
  assert.equal(report.performanceReturn,null); assert.equal(report.realizedPnl.total,null); assert.deepEqual(report.history,[]);
  const beforeWrite=f.batches.length;
  const input={operationId:randomUUID(),accountId:account,expectedSequence:10001,event:{type:'deposit',at:later,amount:'5',currency:'USD'}};
  assert.deepEqual(await f.queries.writeNativeMutation({ownerUserId:owner},input),{status:'created'});
  const preflight=f.batches[beforeWrite];
  assert.deepEqual(preflight.commands[1].params[1],[account]);
  assert.ok(preflight.commands[2].text.includes('native_operation_id=$2::uuid'));
  assert.equal((await f.queries.writeNativeMutation({ownerUserId:owner},input)).status,'existing');
  assert.equal((await f.queries.writeNativeMutation({ownerUserId:owner},opening)).status,'existing','old retry remains discoverable beyond the historical window');
  assert.equal((await f.queries.writeNativeMutation({ownerUserId:owner},{...input,event:{...input.event,amount:'6'}})).status,'conflict');
  assert.equal((await f.queries.writeNativeMutation({ownerUserId:other},input)).status,'conflict');
  evidence=await f.evidence(later); report=f.valuation.buildTrackedCurrencyPortfolio(evidence);
  assert.equal(report.current.total,'11256');
  assert.equal((await f.snapshots.saveNativeSnapshots({ownerUserId:owner},evidence)).created,1,'missing history does not prevent a new complete capture');
  ledger=await f.queries.readNativeLedger({ownerUserId:owner},account);
  assert.equal(ledger.accounts[0].state.cash.USD,'10256'); assert.equal(ledger.accounts[0].state.sequence,10002);
});

it('does not let the snapshot window or account-list cap prevent scoped current reads and writes',async(t)=>{
  setNow(t,later);
  const f=await fixture();
  const old='2023-01-01T00:00:00Z';
  const opening={operationId:randomUUID(),accountId:account,expectedSequence:null,opening:{at:old,cash:{KRW:'0',USD:'100'},positions:[]}};
  assert.equal((await f.queries.writeNativeMutation({ownerUserId:owner},opening)).status,'created');
  const base=(await f.evidence(old)).current;
  await f.pg.query(`insert into daily_portfolio_snapshots(canonical_owner_user_id,snapshot_date,account,account_id,source,captured_at,native_evidence)
    select $1::uuid,($3::timestamptz+n*interval '1 day')::date,'one',$2::uuid,'native_ledger_v1',$3::timestamptz+n*interval '1 day',
      jsonb_build_object('version',1,'sequence',0,'fx','[]'::jsonb,'frame',jsonb_set($4::jsonb,'{at}',to_jsonb(($3::timestamptz+n*interval '1 day')::text)))
    from generate_series(1,1001) n`,[owner,account,old,JSON.stringify(base)]);
  let ledger=await f.queries.readNativeLedger({ownerUserId:owner},account);
  assert.equal(ledger.historyComplete,false); assert.equal(ledger.entriesComplete,true); assert.equal(ledger.entries.length,1);
  const query=f.batches.at(-1).commands[3];
  assert.deepEqual((await f.pg.query(query.text,query.params)).rows,[{complete:false,rows:[]}]);
  let evidence=await f.evidence(later),report=f.valuation.buildTrackedCurrencyPortfolio(evidence);
  assert.equal(report.current.total,'100'); assert.equal(report.performanceReturn,null); assert.deepEqual(report.history,[]);
  assert.equal((await f.mutate({type:'deposit',amount:'25',currency:'USD'})).result.status,'created');
  await f.pg.query("insert into accounts(id,canonical_owner_user_id,code,name) select gen_random_uuid(),$1::uuid,'bounded-'||n,'Bounded' from generate_series(1,205) n",[owner]);
  const all=await f.queries.readNativeLedger({ownerUserId:owner});
  assert.equal(all.accountsComplete,false); assert.equal(all.accounts.length,200);
  const incomplete=f.projection.attachNativeLedgerEvidence({ownerId:owner,reporting:'USD',asOf:later,current:{at:later,source:'test',scopeComplete:false,positions:[]},history:[],trades:null,fx:[],maxFxAgeMs:0,maxPriceAgeMs:0},all,'all');
  assert.equal(f.valuation.buildTrackedCurrencyPortfolio(incomplete).current.total,null,'bounded accounts are not presented as the full portfolio');
  assert.equal((await f.mutate({type:'deposit',amount:'10',currency:'USD'})).result.status,'created');
  evidence=await f.evidence(later); report=f.valuation.buildTrackedCurrencyPortfolio(evidence);
  assert.equal(report.current.total,'135'); assert.equal((await f.snapshots.saveNativeSnapshots({ownerUserId:owner},evidence)).created,1);
  ledger=await f.queries.readNativeLedger({ownerUserId:owner},account);
  assert.equal(ledger.accountsComplete,true); assert.equal(ledger.accounts[0].state.cash.USD,'135');
  const rejected=await f.mutate({type:'deposit',amount:'1',currency:'USD',at:'2026-09-01T23:00:00Z'});
  assert.deepEqual(rejected.result,{status:'invalid',reason:'event_precedes_recorded_snapshot'});
});

it('rejects an oversized historical JSON payload before returning it without losing current state',async()=>{
  const f=await fixture(); await f.open(account,{KRW:'0',USD:'250'});
  // Exercise the expanded JSON byte limit independently of the row count. This
  // synthetic historical padding is never part of a browser mutation contract.
  await f.pg.query("update event_ledger_entries set native_data=native_data||jsonb_build_object('synthetic_padding',repeat('x',17*1024*1024)) where account_id=$1 and native_data is not null",[account]);
  const ledger=await f.queries.readNativeLedger({ownerUserId:owner},account);
  assert.equal(ledger.entriesComplete,false); assert.equal(ledger.accounts[0].state.cash.USD,'250');
  const query=f.batches.at(-1).commands[2];
  assert.deepEqual((await f.pg.query(query.text,query.params)).rows,[{complete:false,rows:[]}]);
  assert.equal((await f.mutate({type:'deposit',amount:'1',currency:'USD'})).result.status,'created');
  assert.equal(f.valuation.buildTrackedCurrencyPortfolio(await f.evidence(later)).current.total,'251');
});
