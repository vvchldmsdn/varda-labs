import assert from 'node:assert/strict';
import { it } from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PGlite } from '@electric-sql/pglite';
import { importWithPorts } from './helpers/import-with-ports.mjs';
import { importUiWithPorts } from './helpers/import-ui-with-ports.mjs';
import { projectNativeLedgerRecord, nativeRecordNumber, nativeLedgerRecordsHref } from '../src/lib/native-ledger-records.ts';

const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const account='11111111-1111-4111-8111-111111111111', peer='22222222-2222-4222-8222-222222222222', foreign='33333333-3333-4333-8333-333333333333', asset='44444444-4444-4444-8444-444444444444';
const recordId='55555555-5555-4555-8555-555555555555', sid='a'.repeat(64), at='2026-10-30T07:00:00.123Z';
const tenant={ownerUserId:owner};
const event={type:'buy',at,assetId:asset,currency:'USD',quantity:'0.010709',executionUnitPrice:{amount:'701.263896',currency:'USD'},settlementStatus:'unconfirmed',memo:'Retain exact execution'};
const row=(value=event,id=recordId)=>({id,accountId:account,event:value,assetName:'VOO',ticker:'VOO'});
const ready=()=>({state:'ready',account:{id:account,name:'A'},records:[projectNativeLedgerRecord(row(),account)],hasMore:false,complete:true,limit:100});

it('projects exact fractional execution without inventing cash settlement, costs, or profit',()=>{
  const record=projectNativeLedgerRecord(row(),account);
  assert.equal(record.quantity,'0.010709'); assert.equal(record.unitPrice.amount,'701.263896');
  assert.deepEqual(record.amounts,[{kind:'execution',amount:'7.509835062264',currency:'USD'}]);
  assert.equal(record.settlementUnconfirmed,true); assert.equal(record.costLotCount,null);
  assert.equal(nativeRecordNumber('12345678901234.123456'),'12,345,678,901,234.123456');
  assert.equal('event' in record,false);assert.equal('state' in record,false);assert.equal('request' in record,false);
  const settled=projectNativeLedgerRecord(row({...event,settlementStatus:undefined,executionUnitPrice:undefined,settlement:{amount:'10012',currency:'KRW'}}),account);
  assert.equal(settled.unitPrice,null);assert.deepEqual(settled.amounts,[{kind:'settlement',amount:'10012',currency:'KRW'}]);
});

it('preserves date-only evidence and rejects unrelated or invalid rows without zero substitution',()=>{
  const record=projectNativeLedgerRecord(row({...event,at:'2026-10-30T10:00:00.000Z',dateEvidence:{precision:'date_only',reportedDate:'2026-10-30',timeZone:'Asia/Seoul',policy:'service_day_midpoint'}}),account);
  assert.equal(record.reportedDate,'2026-10-30');
  assert.throws(()=>projectNativeLedgerRecord({...row(),accountId:foreign},account));
  assert.throws(()=>projectNativeLedgerRecord(row({...event,quantity:'0'}),account));
  assert.throws(()=>projectNativeLedgerRecord(row({type:'unknown',at}),account));
  assert.deepEqual(projectNativeLedgerRecord(row({type:'opening',at}),account).amounts,[]);
  assert.equal(new URL(nativeLedgerRecordsHref(account,'USD',true),'https://test.invalid').searchParams.get('accountId'),account);
});

it('reads effective corrections under owner RLS and filters the account before the recent-record cap',async()=>{
  const pg=new PGlite();
  try {
    await pg.exec(`create role varda_tenant_app; create function investment_plan_tenant_active() returns boolean language sql as 'select true';
      create table app_users(id uuid primary key); create table accounts(id uuid primary key,canonical_owner_user_id uuid,name text);
      create table assets(id uuid primary key,canonical_owner_user_id uuid,account_id uuid,name text,ticker text);
      create table event_ledger_entries(id uuid primary key,canonical_owner_user_id uuid,account_id uuid,native_operation_id uuid,native_sequence integer,native_data jsonb,recorded_at timestamptz default now());
      grant usage on schema public to varda_tenant_app;`);
    for(const name of ['accounts','assets','event_ledger_entries'])await pg.exec(`alter table ${name} enable row level security;alter table ${name} force row level security;create policy owner_read on ${name} for select to varda_tenant_app using(canonical_owner_user_id=nullif(current_setting('app.current_user_id',true),'')::uuid);grant select on ${name} to varda_tenant_app;`);
    const reliability=readFileSync(new URL('../drizzle/0059_trade_daily_reliability.sql',import.meta.url),'utf8');
    await pg.exec(reliability.slice(0,reliability.indexOf('-- An uncertain request')));
    await pg.query('insert into app_users values($1),($2)',[owner,other]);
    await pg.query("insert into accounts values($1,$4,'A'),($2,$4,'B'),($3,$5,'Other')",[account,peer,foreign,owner,other]);
    await pg.query("insert into assets values($1,$2,$3,'VOO','VOO')",[asset,owner,account]);
    await pg.query('insert into event_ledger_entries(id,canonical_owner_user_id,account_id,native_operation_id,native_sequence,native_data) values($1,$2,$3,$1,1,$4)',[recordId,owner,account,JSON.stringify({event:{...event,quantity:'1'},request:{secret:'never public'},state:{sequence:1}})]);
    const openingId='66666666-6666-4666-8666-666666666666';
    await pg.query('insert into native_ledger_revisions(canonical_owner_user_id,account_id,operation_id,marker_sequence,affected_at,reason,effective_entries) values($1,$2,$3,2,$4,$5,$6)',[owner,account,'77777777-7777-4777-8777-777777777777',at,'correct exact quantity',JSON.stringify([{id:openingId,operationId:openingId,data:{event:{type:'opening',at:'2026-10-01T07:00:00Z'},state:{sequence:0}}},{id:recordId,operationId:recordId,data:{event,state:{sequence:1},request:{secret:'never public'}}}])]);
    for(let i=0;i<110;i++){const id=`99999999-9999-4999-8999-${String(i).padStart(12,'0')}`;await pg.query('insert into event_ledger_entries(id,canonical_owner_user_id,account_id,native_operation_id,native_sequence,native_data) values($1,$2,$3,$1,$4,$5)',[id,owner,peer,i+1,JSON.stringify({event:{type:'deposit',at,amount:'1',currency:'USD'}})]);}
    await pg.query('insert into event_ledger_entries(id,canonical_owner_user_id,account_id,native_operation_id,native_sequence,native_data) values($1,$2,$3,$1,1,$4)',['88888888-8888-4888-8888-888888888888',other,foreign,JSON.stringify({event:{type:'deposit',at,amount:'999',currency:'USD'}})]);
    await pg.query('insert into event_ledger_entries(id,canonical_owner_user_id,account_id,native_sequence,native_data) values($1,$2,$3,999,null)',['abababab-abab-4bab-8bab-abababababab',owner,account]);
    const calls=[];
    const sql={transaction:async(build,options)=>{assert.equal(options.readOnly,true);const commands=build({query:(text,params=[])=>({text,params})});return pg.transaction(async tx=>{await tx.exec('set local role varda_tenant_app');const results=[];for(const command of commands){calls.push(command);results.push((await tx.query(command.text,command.params)).rows);}return results;});}};
    const [query]=await importWithPorts(['src/db/queries/native-ledger-records.ts'],{'@/db/tenant-client':{getTenantSqlClient:()=>sql}});
    const a=await query.readNativeLedgerRecords(tenant,account);
    assert.equal(a.state,'ready');assert.equal(a.records.length,2);assert.equal(a.records[0].quantity,'0.010709');assert.equal(a.complete,true);
    assert.equal(JSON.stringify(a).includes('never public'),false);
    const b=await query.readNativeLedgerRecords(tenant,peer);assert.equal(b.records.length,100);assert.equal(b.hasMore,true);assert.equal(b.complete,false);
    assert.deepEqual(await query.readNativeLedgerRecords(tenant,foreign),{state:'not_found',records:[],complete:false});
    assert.equal(calls.every(call=>call.params[0]===owner),true);
  } finally {await pg.close();}
});

it('fails closed on incomplete, malformed or cross-account query evidence',async()=>{
  let result={account:{id:account,name:'A'},bounded:false,rows:[row()]};
  const [query]=await importWithPorts(['src/db/queries/native-ledger-records.ts'],{'@/db/tenant-client':{getTenantSqlClient:()=>({transaction:async()=>[[],[result]]})}});
  for(const value of [result,{...result,bounded:true,rows:[{...row(),accountId:foreign}]},{...result,bounded:true,rows:[row(),row()]}]){
    result=value;const read=await query.readNativeLedgerRecords(tenant,account);assert.notEqual(read.state,'ready');assert.equal(read.complete,false);assert.deepEqual(read.records,[]);
  }
});

it('keeps the records route read-only, private and bound to the resolved session owner',async()=>{
  let authenticated=true,allowed=true;const calls=[];
  const [route]=await importWithPorts(['src/app/api/portfolio/ledger/records/route.ts'],{
    '@/lib/auth/current-session-subject':{readCurrentSessionSubject:async()=>authenticated?{state:'authenticated',provider:'credentials',providerSubject:'synthetic'}:{state:'unauthenticated'}},
    '@/lib/auth/current-tenant-context':{resolveCurrentTenantContext:async()=>({ok:true,tenantContext:tenant})},
    '@/db/queries/native-ledger-records':{readNativeLedgerRecords:async(context,id)=>{calls.push({context,id});return allowed?ready():{state:'not_found',records:[],complete:false};}},
  });
  const get=query=>route.GET(new Request('https://test.invalid/api/portfolio/ledger/records'+query));
  for(const query of ['',`?accountId=${account}&accountId=${peer}`,`?accountId=${account}&owner=${other}`,'?accountId=invalid'])assert.equal((await get(query)).status,400);
  assert.equal(calls.length,0);authenticated=false;assert.equal((await get(`?accountId=${account}`)).status,401);assert.equal(calls.length,0);
  authenticated=true;const response=await get(`?accountId=${account}`);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.match((await response.json()).sessionKey,/^[a-f0-9]{64}$/);
  assert.deepEqual(calls,[{context:tenant,id:account}]);assert.equal(route.POST,undefined);
  allowed=false;assert.equal((await get(`?accountId=${foreign}`)).status,404);
});

it('renders transaction types in both languages and retains decimal display without raw diagnostics',async()=>{
  const [view]=await importUiWithPorts(['src/components/native-ledger-records.tsx'],{});
  const record=projectNativeLedgerRecord(row(),account);
  const ko=renderToStaticMarkup(createElement(view.NativeRecordItem,{record,locale:'ko'}));
  const en=renderToStaticMarkup(createElement(view.NativeRecordItem,{record,locale:'en'}));
  assert.match(ko,/매수/);assert.match(en,/Buy/);assert.match(en,/0\.010709/);assert.match(en,/701\.263896/);assert.match(en,/7\.509835062264/);
  assert.doesNotMatch(en,/native_ledger|request|realized|profit/i);
});

it('hides stale account responses immediately and rejects session changes without leaking old rows',async t=>{
  const original=globalThis.fetch,requests=[];globalThis.fetch=(_url,options)=>new Promise(resolve=>requests.push({resolve,options}));t.after(()=>{globalThis.fetch=original;});
  const values=[];let cursor=0,effect;
  const [view]=await importUiWithPorts(['src/components/native-ledger-records.tsx'],{react:{useState:initial=>{const i=cursor++;values[i]??=initial;return[values[i],next=>{values[i]=typeof next==='function'?next(values[i]):next;}];},useEffect:callback=>{effect=callback;}}});
  let props={accountId:account,sessionKey:sid,locale:'en'};
  const render=()=>{cursor=0;return renderToStaticMarkup(view.NativeLedgerRecords(props));};
  render();const cleanup=effect();props={...props,accountId:peer};assert.doesNotMatch(render(),/VOO/);cleanup();const cleanupNext=effect();
  requests[0].resolve(Response.json({...ready(),sessionKey:sid}));await new Promise(r=>setImmediate(r));assert.doesNotMatch(render(),/VOO/);
  requests[1].resolve(Response.json({...ready(),account:{id:peer,name:'B'},sessionKey:'b'.repeat(64)}));await new Promise(r=>setImmediate(r));assert.match(render(),/Records could not be loaded/);assert.doesNotMatch(render(),/VOO/);cleanupNext();
});

it('completes the records anchor after account data mounts without scrolling ordinary entry',async t=>{
  const priorWindow=globalThis.window,priorDocument=globalThis.document,effects=[],scrolls=[];
  globalThis.window={location:{hash:'#native-records'}};
  globalThis.document={getElementById:id=>{assert.equal(id,'native-records');return{scrollIntoView:options=>scrolls.push(options)};}};
  t.after(()=>{if(priorWindow===undefined)delete globalThis.window;else globalThis.window=priorWindow;if(priorDocument===undefined)delete globalThis.document;else globalThis.document=priorDocument;});
  const [view]=await importUiWithPorts(['src/components/native-ledger-records.tsx'],{react:{useState:initial=>[initial,()=>{}],useEffect:callback=>{effects.push(callback);}}});
  view.NativeLedgerRecords({accountId:account,sessionKey:sid});effects[0]();assert.deepEqual(scrolls,[{block:'start'}]);
  globalThis.window.location.hash='';effects[0]();assert.equal(scrolls.length,1);
});
