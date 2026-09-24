import assert from 'node:assert/strict';
import { after, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { importWithPorts } from './helpers/import-with-ports.mjs';
import { importUiWithPorts } from './helpers/import-ui-with-ports.mjs';
import { NATIVE_LEDGER_REQUIRED_MESSAGE, NATIVE_ACCOUNT_BALANCE_MESSAGE } from '../src/lib/native-ledger-compatibility.ts';

const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', account='11111111-1111-4111-8111-111111111111', asset='44444444-4444-4444-8444-444444444444';
const at='2026-09-01T00:00:00.000Z', later='2026-09-02T00:00:00.000Z';
let database;
after(async()=>{ await database?.close(); });
const ddl=`
create table app_users(id uuid primary key,status text not null);
create table accounts(id uuid primary key,canonical_owner_user_id uuid,code text not null,name text not null,is_active boolean default true,updated_at timestamptz default now(),created_at timestamptz default now(),sort_order int default 0,account_type text default 'investment',currency text default 'KRW');
create table assets(id uuid primary key,canonical_owner_user_id uuid,account_id uuid,account text,name text,ticker text,market text,currency text,asset_type text,quantity numeric(20,6) not null default 0,current_price numeric(20,4),average_cost numeric(20,4),price_source text,price_status text,archived_at timestamptz,updated_at timestamptz default now(),price_fetched_at timestamptz,price_as_of timestamptz,price_quote_type text,created_at timestamptz);
create table event_ledger_entries(id uuid primary key,canonical_owner_user_id uuid,event_date date not null,event_type text not null,source text,recorded_at timestamptz,rule_version text,account text,account_id uuid,asset_id uuid,legacy_asset_id varchar(24) not null,asset_name text not null,before_value text not null,after_value text not null,is_sample boolean not null default false);
create table daily_portfolio_snapshots(id uuid primary key default gen_random_uuid(),canonical_owner_user_id uuid,snapshot_date date,account text,account_id uuid,source text not null default 'base44_import',rule_version text,is_sample boolean not null default false,captured_at timestamptz);
create table portfolio_groups(id uuid primary key,canonical_owner_user_id uuid,name text,sort_order int,archived_at timestamptz,created_at timestamptz,updated_at timestamptz);
create table portfolio_group_asset_memberships(id uuid primary key,canonical_owner_user_id uuid,portfolio_group_id uuid,asset_id uuid,valid_from date,valid_to date,created_at timestamptz);
create table portfolio_group_account_memberships(id uuid primary key,canonical_owner_user_id uuid,portfolio_group_id uuid,account_id uuid,valid_from date,valid_to date);
create table holding_onboarding_evidence(id uuid primary key,canonical_owner_user_id uuid,asset_id uuid,account_id uuid,quantity numeric,average_cost numeric,current_price numeric,reported_return_pct numeric,currency text,price_source text,price_as_of timestamptz,policy_version text,recorded_at timestamptz,created_at timestamptz);
create table holding_state_corrections(id uuid primary key default gen_random_uuid(),canonical_owner_user_id uuid,asset_id uuid,account_id uuid,previous_quantity numeric,corrected_quantity numeric,previous_average_cost numeric,corrected_average_cost numeric,previous_asset_updated_at timestamptz,corrected_asset_updated_at timestamptz,reason text,policy_version text,corrected_at timestamptz);
create table holding_lifecycle_events(id uuid primary key default gen_random_uuid(),canonical_owner_user_id uuid,asset_id uuid,account_id uuid,event_type text,previous_archived_at timestamptz,resulting_archived_at timestamptz,previous_asset_updated_at timestamptz,resulting_asset_updated_at timestamptz,reason text,policy_version text,occurred_at timestamptz);
`;
function form(values) { const data=new FormData(); for(const [k,v] of Object.entries(values)) data.set(k,v); return data; }
async function fixture() {
  const pg=database??=new PGlite();
  await pg.exec("drop schema public cascade; create schema public; do $$ begin if not exists(select 1 from pg_roles where rolname='varda_tenant_app') then create role varda_tenant_app; end if; end $$;"+ddl);
  for(const file of ['0045_investment_plans.sql','0050_native_portfolio_ledger.sql','0052_native_legacy_lifecycle_guard.sql','0056_native_tenant_mutation.sql']) await pg.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
  await pg.exec('grant usage on schema public to varda_tenant_app');
  for(const table of ['accounts','assets','event_ledger_entries','daily_portfolio_snapshots']) await pg.exec(`alter table ${table} enable row level security; alter table ${table} force row level security; create policy tenant_select on ${table} for select to varda_tenant_app using(canonical_owner_user_id = nullif(current_setting('app.current_user_id',true),'')::uuid); grant select on ${table} to varda_tenant_app;`);
  await pg.query("insert into app_users values($1,'active')",[owner]);
  await pg.query("insert into accounts(id,canonical_owner_user_id,code,name) values($1,$2,'one','One')",[account,owner]);
  await pg.query("insert into assets(id,canonical_owner_user_id,account_id,account,name,ticker,market,currency,asset_type,quantity,average_cost,current_price,updated_at) values($1,$2,$3,'one','Test','TEST','us','USD','stock',10,97,100,$4)",[asset,owner,account,at]);
  let marketCalls=0, beforeWrite=null;
  const transport=(tenant=false)=>({transaction:async(build)=>{
    const commands=build({query:(text,params=[])=>({text,params})});
    if(beforeWrite && commands.some(c=>c.text.includes('prior_holdings'))) { const fn=beforeWrite; beforeWrite=null; await fn(); }
    return pg.transaction(async tx=>{if(tenant) await tx.exec('set local role varda_tenant_app');const results=[]; for(const c of commands) results.push((await tx.query(c.text,c.params)).rows);return results;});
  }});
  const [native, correction, lifecycle, onboarding, accounts]=await importWithPorts([
    'src/db/queries/native-portfolio-ledger.ts','src/lib/holding-state-correction-write.ts','src/lib/holding-lifecycle-write.ts','src/lib/holding-onboarding-write.ts','src/lib/account-management-write.ts',
  ], {
    '@/db/client':{sqlClient:transport(),db:drizzle(pg)}, '@/db/tenant-client':{getTenantSqlClient:()=>transport(true)},
    '@/lib/auth/current-tenant-context':{resolveCurrentTenantContext:async()=>({ok:true,tenantContext:{ownerUserId:owner}})},
    '@/db/queries/onboarding-instrument-search':{resolveOnboardingInstrumentById:async()=>null},
    '@/lib/market-data/providers/kis':{getKisProviderPolicy:()=>{marketCalls++;return{configured:false};}},
    '@/lib/market-data/collection-worker':{scheduleMarketCollection:()=>{marketCalls++;}},
    '@/lib/market-data/collection-queue':{enqueueMarketCollection:async()=>{marketCalls++;}},
  });
  async function open() { return native.writeNativeMutation({ownerUserId:owner},{operationId:randomUUID(),accountId:account,expectedSequence:null,opening:{at,cash:{KRW:'0',USD:'1000'},positions:[{assetId:asset,currency:'USD',quantity:'10',costLots:null}]}}); }
  async function mutate(event,extra={}) { const ledger=await native.readNativeLedger({ownerUserId:owner},account); return native.writeNativeMutation({ownerUserId:owner},{operationId:randomUUID(),accountId:account,expectedSequence:ledger.accounts[0].state.sequence,event:{at:later,...event},...extra}); }
  async function version(table='assets') { return (await pg.query(`select to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as value from ${table} where id=$1`,[table==='assets'?asset:account])).rows[0].value; }
  const onboardingInput=()=>form({accountId:account,market:'us',assetType:'stock',ticker:'OTHER',name:'Other',quantity:'1',currentPrice:'10'});
  return {pg,native,correction,lifecycle,onboarding,accounts,open,mutate,version,onboardingInput,getMarketCalls:()=>marketCalls,setBeforeWrite:fn=>{beforeWrite=fn;}};
}
it('blocks legacy correction, onboarding and archive on native accounts before recording any fake event',async()=>{
  const f=await fixture(); assert.equal((await f.open()).status,'created');
  const version=await f.version();
  for(const result of [await f.correction.writeSessionHoldingStateCorrection(form({assetId:asset,expectedUpdatedAt:version,quantity:'11',averageCost:'110'})),await f.lifecycle.archiveSessionHolding(form({assetId:asset,expectedUpdatedAt:version,archiveConfirmed:'yes'})),await f.onboarding.writeSessionHoldingOnboarding(f.onboardingInput())]) {
    assert.equal(result.status,'conflict'); assert.equal(result.message,NATIVE_LEDGER_REQUIRED_MESSAGE);
  }
  assert.equal(f.getMarketCalls(),0);
  for(const table of ['holding_state_corrections','holding_lifecycle_events','holding_onboarding_evidence']) assert.equal((await f.pg.query(`select count(*)::int n from ${table}`)).rows[0].n,0);
  assert.equal((await f.native.readNativeLedger({ownerUserId:owner},account)).entries.length,1);
});
it('guards direct quantity, cost, archive, identity and deletion writes while allowing provider prices',async()=>{
  const f=await fixture(); await f.open();
  for(const statement of ["update assets set quantity=11", "update assets set average_cost=110", "update assets set archived_at=now()", "update assets set currency='KRW'", "update assets set ticker='SWAPPED'", "delete from assets", "update accounts set native_state=null", "update accounts set native_state=jsonb_set(native_state,'{cash,USD}','\"0\"')", "delete from accounts"]) {
    await assert.rejects(f.pg.exec(statement),error=>['N0001','N0002'].includes(error.code),statement);
  }
  await assert.rejects(f.pg.query("insert into assets(id,canonical_owner_user_id,account_id,account,name,currency,quantity,archived_at) values($1,$2,$3,'one','Hidden','USD',1,now())",[randomUUID(),owner,account]),error=>error.code==='N0001');
  await f.pg.exec("update assets set current_price=120,price_source='provider',price_as_of=now(),price_fetched_at=now(),price_status='ok',updated_at=now()");
  assert.equal(Number((await f.pg.query('select current_price from assets')).rows[0].current_price),120);
  assert.equal((await f.mutate({type:'deposit',currency:'USD',amount:'10'})).status,'created');
});
it('uses only active owned account and asset hints for the ledger form',async()=>{
  const [ui]=await importUiWithPorts(['src/components/native-ledger-view.tsx'],{
    'next/link':{default:()=>null},
    '@/components/app-navigation':{AppNavigation:()=>null}, '@/components/first-visit/money-input':{MoneyInput:()=>null},
    '@/components/i18n/locale-provider':{useI18n:()=>({t:(ko)=>ko,locale:'ko'})},
  });
  const rows=[{id:account,active:true,assets:[{id:asset}]}];
  assert.deepEqual(ui.resolveNativeLedgerSelection(rows,{accountId:account,assetId:asset,action:'sell'}),{accountId:account,assetId:asset,action:'sell'});
  assert.deepEqual(ui.resolveNativeLedgerSelection(rows,{accountId:owner,assetId:asset,action:'sell'}),{accountId:'',assetId:'',action:'deposit'});
  assert.deepEqual(ui.resolveNativeLedgerSelection([{...rows[0],active:false}],{accountId:account,assetId:asset,action:'buy'}),{accountId:'',assetId:'',action:'deposit'});
  assert.deepEqual(ui.resolveNativeLedgerSelection(rows,{accountId:account,assetId:owner,action:'delete'}),{accountId:account,assetId:'',action:'deposit'});
});
it('allows real full sale and rebuy, keeps dated cost lots authoritative, and blocks legacy restore',async()=>{
  const f=await fixture(); await f.open();
  assert.equal((await f.mutate({type:'cost_basis',assetId:asset,costLots:[{amount:'900',currency:'USD',at,source:'user_native_ledger',remaining:{n:'1',d:'1'}}]})).status,'created');
  assert.equal(Number((await f.pg.query('select average_cost from assets')).rows[0].average_cost),97,'legacy average cost is not rewritten from native lots');
  assert.equal((await f.mutate({type:'sell',assetId:asset,currency:'USD',quantity:'10',price:'110'})).status,'created');
  assert.equal((await f.lifecycle.restoreSessionHolding(form({assetId:asset,expectedUpdatedAt:await f.version()}))).message,NATIVE_LEDGER_REQUIRED_MESSAGE);
  assert.equal((await f.mutate({type:'buy',assetId:asset,currency:'USD',quantity:'2',price:'100'})).status,'created');
  const ledger=await f.native.readNativeLedger({ownerUserId:owner},account);
  assert.equal(ledger.accounts[0].state.positions[0].quantity,'2'); assert.equal(ledger.accounts[0].state.cash.USD,'1900');
  assert.equal((await f.pg.query('select archived_at from assets')).rows[0].archived_at,null);
});
it('preserves wealth on account close and retains history after a real empty-account closure',async()=>{
  const f=await fixture(); await f.open(); await f.mutate({type:'sell',assetId:asset,currency:'USD',quantity:'10',price:'110'});
  const input=()=>form({accountId:account,expectedUpdatedAt:'',archiveConfirmed:'yes'});
  let data=input(); data.set('expectedUpdatedAt',await f.version('accounts'));
  const blocked=await f.accounts.archiveSessionAccount(data); assert.equal(blocked.status,'conflict'); assert.equal(blocked.message,NATIVE_ACCOUNT_BALANCE_MESSAGE);
  await assert.rejects(f.pg.exec('update accounts set is_active=false'),error=>error.code==='N0002');
  assert.equal((await f.mutate({type:'withdraw',currency:'USD',amount:'2100'})).status,'created');
  await f.pg.query('update accounts set updated_at=$1 where id=$2',['2026-09-03T01:02:03.123456Z',account]);
  data=input(); data.set('expectedUpdatedAt',await f.version('accounts'));
  const stale=input(); stale.set('expectedUpdatedAt',new Date(data.get('expectedUpdatedAt')).toISOString());
  if(stale.get('expectedUpdatedAt')!==data.get('expectedUpdatedAt')) assert.equal((await f.accounts.archiveSessionAccount(stale)).status,'conflict');
  assert.equal((await f.accounts.archiveSessionAccount(data)).status,'success');
  const history=await f.native.readNativeLedger({ownerUserId:owner},account);
  assert.equal(history.accounts[0].active,false); assert.equal(history.entries.length,3);
  assert.equal((await f.native.writeNativeMutation({ownerUserId:owner},{operationId:randomUUID(),accountId:account,expectedSequence:2,event:{type:'deposit',at:later,currency:'USD',amount:'1'}})).status,'inactive');
});
it('rechecks native activation atomically after onboarding price preparation',async()=>{
  const f=await fixture(); f.setBeforeWrite(async()=>{assert.equal((await f.open()).status,'created');});
  const result=await f.onboarding.writeSessionHoldingOnboarding(f.onboardingInput());
  assert.equal(result.status,'conflict'); assert.equal(result.message,NATIVE_LEDGER_REQUIRED_MESSAGE);
  assert.equal((await f.pg.query('select count(*)::int n from assets')).rows[0].n,1);
  assert.equal((await f.pg.query('select count(*)::int n from portfolio_groups')).rows[0].n,0);
});
it('keeps the existing non-native correction and archive/restore semantics',async()=>{
  const f=await fixture();
  assert.equal((await f.correction.writeSessionHoldingStateCorrection(form({assetId:asset,expectedUpdatedAt:await f.version(),quantity:'11',averageCost:'99'}))).status,'success');
  assert.equal((await f.lifecycle.archiveSessionHolding(form({assetId:asset,expectedUpdatedAt:await f.version(),archiveConfirmed:'yes'}))).status,'success');
  assert.equal((await f.lifecycle.restoreSessionHolding(form({assetId:asset,expectedUpdatedAt:await f.version()}))).status,'success');
  assert.equal((await f.pg.query('select count(*)::int n from event_ledger_entries')).rows[0].n,0);
});
