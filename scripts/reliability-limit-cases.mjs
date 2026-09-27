import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {importWithPorts} from '../tests/helpers/import-with-ports.mjs';
import {sqlTransport} from './krw-usd-rc-rehearsal.mjs';

export async function runReliabilityLimitCases({admin,tenant,report}) {
 const [ledger]=await importWithPorts(['src/db/queries/native-portfolio-ledger.ts'],{'@/db/tenant-client':{getTenantSqlClient:()=>sqlTransport(tenant,new Set())}});
 const owner=randomUUID(),context={ownerUserId:owner,role:'user'},accountIds=Array.from({length:9},()=>randomUUID()),asset=randomUUID();
 // Synthetic fixture writes are explicitly stamped; the mutation under test
 // goes through the real tenant writer, RLS reader and shared replay engine.
 const seed=await admin.connect();
 try {
  await seed.query('BEGIN');await seed.query("select set_config('app.trade_reliability_version','0059',true)");
  await seed.query("insert into app_users(id,status,role) values($1,'active','user')",[owner]);
  for(const [i,id] of accountIds.entries()) await seed.query("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency) values($1,$2,$3,'Synthetic limit account','brokerage','USD')",[id,owner,`limit-${i}`]);
  await seed.query("insert into assets(id,canonical_owner_user_id,account_id,account,name,ticker,market,currency,asset_type,quantity,current_price) values($1,$2,$3,'limit-0','Synthetic limit unit','LIMIT','us','USD','stock',10,100)",[asset,owner,accountIds[0]]);
  await seed.query('COMMIT');
 } catch(e){await seed.query('ROLLBACK');throw e;} finally{seed.release();}
 for(const id of accountIds) assert.equal((await ledger.writeNativeMutation(context,{operationId:randomUUID(),accountId:id,expectedSequence:null,opening:{at:'2001-01-01T00:00:00Z',cash:{KRW:'0',USD:'1000'},positions:id===accountIds[0]?[{assetId:asset,currency:'USD',quantity:'10',costLots:null}]:[]}})).status,'created');
 for(let i=0;i<8;i++) {
  const operationId=randomUUID(),state=(await ledger.readNativeLedger(context,accountIds[i])).accounts[0].state;
  assert.equal((await ledger.writeNativeMutation(context,{operationId,accountId:accountIds[i],expectedSequence:state.sequence,event:{type:'transfer',transferId:operationId,direction:'out',peerAccountId:accountIds[i+1],at:`2001-01-${String(i+3).padStart(2,'0')}T00:00:00Z`,currency:'USD',amount:'10'}})).status,'created');
 }
 const input=state=>({operationId:randomUUID(),accountId:accountIds[0],expectedSequence:state.sequence,event:{type:'buy',at:'2001-01-02T00:00:00Z',assetId:asset,currency:'USD',quantity:'1',settlement:{currency:'USD',amount:'100'},fee:{currency:'USD',amount:'0'},tax:{currency:'USD',amount:'0'}},history:{notInOpening:true,reason:'Synthetic bounds verification'}});
 const before=await ledger.readNativeLedger(context);
 const result=await ledger.writeNativeMutation(context,input(before.accounts.find(a=>a.id===accountIds[0]).state));
 assert.equal(result.reason,'historical_scope_too_large');assert.deepEqual(await ledger.readNativeLedger(context),before);
 report.cases.push({name:'nine-connected-accounts-rejected-before-any-mutation',status:'PASS'});

 // Add immutable synthetic records only for the bounded-reader test. The rows
 // exceed the replay cap independently of their amounts; none may be replayed.
 const isolatedAccount=randomUUID(),isolatedAsset=randomUUID(),c=await admin.connect();
 try {
  await c.query('BEGIN');await c.query("select set_config('app.trade_reliability_version','0059',true)");
  await c.query("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency) values($1,$2,'limit-records','Synthetic record limit','brokerage','USD')",[isolatedAccount,owner]);
  await c.query("insert into assets(id,canonical_owner_user_id,account_id,account,name,ticker,market,currency,asset_type,quantity,current_price) values($1,$2,$3,'limit-records','Synthetic record unit','LIMIT2','us','USD','stock',10,100)",[isolatedAsset,owner,isolatedAccount]);
  await c.query('COMMIT');
 } catch(e){await c.query('ROLLBACK');throw e;} finally{c.release();}
 assert.equal((await ledger.writeNativeMutation(context,{operationId:randomUUID(),accountId:isolatedAccount,expectedSequence:null,opening:{at:'2001-01-01T00:00:00Z',cash:{KRW:'0',USD:'1000'},positions:[{assetId:isolatedAsset,currency:'USD',quantity:'10',costLots:null}]}})).status,'created');
 const state=(await ledger.readNativeLedger(context,isolatedAccount)).accounts[0].state,bulk=await admin.connect();
 try {
  await bulk.query('BEGIN');await bulk.query("select set_config('app.trade_reliability_version','0059',true)");
  for(let i=0;i<500;i++) await bulk.query("insert into event_ledger_entries(canonical_owner_user_id,account_id,account,event_date,event_type,source,native_operation_id,native_sequence,native_data) values($1,$2,'limit-records','2001-01-12','native_deposit','native_ledger_v1',$3,$4,$5)",[owner,isolatedAccount,randomUUID(),i+1,{event:{type:'deposit',at:'2001-01-12T00:00:00Z',currency:'USD',amount:'1'},state:{...state,sequence:i+1},effect:{cashLegs:[{currency:'USD',delta:'1',kind:'external'}]},request:{synthetic:true}}]);
  await bulk.query('COMMIT');
 } catch(e){await bulk.query('ROLLBACK');throw e;} finally{bulk.release();}
 const oversized=await ledger.readNativeLedger(context);
 const request=input(state);request.accountId=isolatedAccount;request.event.assetId=isolatedAsset;
 const rejected=await ledger.writeNativeMutation(context,request);
 assert.equal(rejected.reason,'historical_scope_too_large');assert.deepEqual(await ledger.readNativeLedger(context),oversized);
 report.cases.push({name:'over-500-records-preserved-with-no-truncated-replay',status:'PASS'});
}
