import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {importWithPorts} from '../tests/helpers/import-with-ports.mjs';
import {sqlTransport,migrationManifest} from './krw-usd-rc-rehearsal.mjs';
import {drizzle} from 'drizzle-orm/node-postgres';

export async function runReliabilityCases({admin,worker,tenant,report,connection}) {
 // A pool can select a different connection for every statement. Stamp each
 // fixture transaction rather than leaving compatibility on one pooled session.
 // Worker/tenant pools remain unstamped until the actual writer admits itself.
 async function fixtureWrite(query,parameters=[]) {
  const client=await admin.connect();
  try {
   await client.query('BEGIN');
   await client.query("select set_config('app.trade_reliability_version','0059',true)");
   const result=await client.query(query,parameters);await client.query('COMMIT');return result;
  } catch(error){await client.query('ROLLBACK');throw error;} finally{client.release();}
 }
 const sessions=new Set(), sql=sqlTransport(worker,sessions), tenantSql=sqlTransport(tenant,sessions);
 const [ledger,snapshots,cutoff,work,mutation,projection,legacyJob,runRepository]=await importWithPorts([
  'src/db/queries/native-portfolio-ledger.ts','src/db/queries/native-portfolio-snapshots.ts','src/lib/snapshots/native-cutoff-evidence.ts','src/lib/snapshots/durable-work.ts','src/lib/portfolio-mutation-transaction.ts','src/lib/native-portfolio-projection.ts',
  'src/lib/snapshots/daily-job.ts','src/lib/cron-market-cycle-run-repository.ts',
 ],{'@/db/client':{sqlClient:sql,db:drizzle(worker)},'@/db/tenant-client':{getTenantSqlClient:()=>tenantSql}});
 const owner=randomUUID(),other=randomUUID(),account=randomUUID(),asset=randomUUID();
 const context={ownerUserId:owner,role:'user'};
 const read=()=>ledger.readNativeLedger(context,account), write=input=>ledger.writeNativeMutation(context,input);
 async function check(name,fn){const result={name,status:'FAIL'};report.cases.push(result);await fn();result.status='PASS';}
 await check('empty-database-all-migrations',async()=>{
  await admin.query('CREATE DATABASE reliability_empty');
  const {Pool}=await import('pg');const empty=new Pool({...connection,user:'rc_admin',database:'reliability_empty'});
  try {await empty.query('BEGIN');for(const row of await migrationManifest()) await empty.query(row.sql);await empty.query('COMMIT');}
  finally {await empty.end();}
 });
 await fixtureWrite("insert into app_users(id,status,role) values($1,'active','user'),($2,'active','user')",[owner,other]);
 await fixtureWrite("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency) values($1,$2,'reliability','Synthetic reliability','brokerage','USD')",[account,owner]);
 await fixtureWrite("insert into assets(id,canonical_owner_user_id,account_id,account,name,ticker,market,currency,asset_type,quantity,current_price) values($1,$2,$3,'reliability','Synthetic unit','UNIT','us','USD','stock',10,100)",[asset,owner,account]);
 let seq=0;
 await check('trusted-opening-and-existing-sell',async()=>{
  assert.equal((await write({operationId:randomUUID(),accountId:account,expectedSequence:null,opening:{at:'2026-08-01T00:00:00Z',cash:{KRW:'0',USD:'1000'},positions:[{assetId:asset,currency:'USD',quantity:'10',costLots:null}]}})).status,'created');
  assert.equal((await write({operationId:randomUUID(),accountId:account,expectedSequence:0,event:{type:'sell',at:'2026-08-03T00:00:00Z',assetId:asset,currency:'USD',quantity:'3',settlement:{currency:'USD',amount:'330'},fee:{currency:'USD',amount:'0'},tax:{currency:'USD',amount:'0'}}})).status,'created');seq=1;
  assert.equal((await read()).accounts[0].state.cash.USD,'1330');
 });
 const originalSnapshot={version:1,sequence:1,frame:{at:'2026-08-03T22:00:00.000Z',boundary:'before',positions:[{id:asset,ownerId:owner,accountId:account,kind:'holding',name:'Synthetic unit',ticker:'UNIT',market:'us',observation:{quantity:'7',price:'100',currency:'USD',at:'2026-08-03T22:00:00.000Z',priceObservedAt:'2026-08-03T20:00:00.000Z',priceFetchedAt:'2026-08-03T20:00:00.000Z',basis:'raw',source:'kis'}}],scopeComplete:true,source:'native_ledger_cutoff_v2'},fx:[]};
 await fixtureWrite("insert into daily_portfolio_snapshots(canonical_owner_user_id,account_id,account,snapshot_date,source,native_evidence) values($1,$2,'reliability','2026-08-04','native_ledger_cutoff_v2',$3)",[owner,account,originalSnapshot]);
 const missing={operationId:randomUUID(),accountId:account,expectedSequence:seq,event:{type:'buy',at:'2026-08-02T00:00:00Z',assetId:asset,currency:'USD',quantity:'2',settlement:{currency:'USD',amount:'200'},fee:{currency:'USD',amount:'0'},tax:{currency:'USD',amount:'0'}},history:{reason:'Missing synthetic trade',notInOpening:true}};
 await admin.query("select set_trade_reliability_mode('compatible','Synthetic reliability rehearsal')");
 await check('missing-buy-replay-9-shares-1130-dollars-idempotent',async()=>{
  const results=await Promise.all([write(missing),write(missing)]);
  assert.deepEqual(results.map(r=>r.status).sort(),['created','existing']);
  const value=await read();seq=value.accounts[0].state.sequence;
  assert.equal(value.accounts[0].state.positions[0].quantity,'9');assert.equal(value.accounts[0].state.cash.USD,'1130');
  assert.equal(value.accounts[0].state.positions[0].costLots,null);
  assert.equal(value.entries.length,3);assert.equal(value.snapshots.length,0,'invalid revision must not leak to History');
  assert.equal((await write(missing)).status,'existing');
  assert.equal((await write({...missing,event:{...missing.event,quantity:'4'}})).status,'conflict');
  assert.equal((await admin.query('select count(*)::int n from daily_portfolio_snapshots where account_id=$1',[account])).rows[0].n,1,'original snapshot retained');
 });
 await check('operation-owner-boundary-and-committed-lookup',async()=>{
  assert.equal(await ledger.readNativeOperation(context,missing.operationId),'committed');
  assert.equal(await ledger.readNativeOperation({ownerUserId:other,role:'user'},missing.operationId),'unconfirmed');
  assert.equal((await ledger.readNativeLedger({ownerUserId:other,role:'user'},account)).entries.length,0);
  await assert.rejects(tenant.query('select * from daily_snapshot_work'),e=>e.code==='42501');
  await assert.rejects(tenant.query('delete from native_ledger_revisions'),e=>e.code==='42501');
 });
 await check('expired-request-retirement-fences-late-writer-without-deleting-commit',async()=>{
  const neverSent={...missing,operationId:randomUUID(),expectedSequence:seq};
  assert.equal(await ledger.cancelNativeOperation(context,neverSent.operationId),'cancelled');
  assert.equal(await ledger.readNativeOperation(context,neverSent.operationId),'cancelled');
  assert.equal((await write(neverSent)).reason,'operation_cancelled');
  assert.equal(await ledger.cancelNativeOperation(context,missing.operationId),'committed');
  assert.equal(await ledger.readNativeOperation({ownerUserId:other,role:'user'},neverSent.operationId),'unconfirmed');
  const future={operationId:randomUUID(),accountId:account,expectedSequence:seq,event:{type:'deposit',amount:'1',currency:'USD',at:'2026-08-04T00:00:00Z'}};
  await ledger.cancelNativeOperation(context,future.operationId);
  assert.equal((await write(future)).reason,'operation_cancelled');
  const [,late]=await tenantSql.transaction(tx=>[
   tx.query("select set_config('app.current_user_id',$1,true)",[owner]),
   tx.query("select apply_native_portfolio_tenant_mutation($1::uuid,$2::uuid,'{}','[]') as status",[owner,future.operationId]),
  ]);
  assert.equal(late[0].status,'operation_cancelled','SQL fence also rejects a request whose preflight happened before cancellation');
  assert.equal((await read()).accounts[0].state.cash.USD,'1130');
 });
 await check('invalidated-valuation-retains-private-price-evidence-and-rebuild-queue',async()=>{
  const state=await read(), observations=await ledger.readNativeSnapshotObservations(context,account);
  assert.equal(state.snapshots.length,0);assert.equal(observations.length,1);
  const missingPrice={ownerId:owner,reporting:'USD',asOf:'2026-08-04T01:00:00Z',current:{at:'2026-08-04T01:00:00Z',scopeComplete:false,source:'synthetic',positions:[]},history:[],trades:null,fx:[],maxPriceAgeMs:86400000,maxFxAgeMs:86400000};
  const rebuilt=cutoff.buildNativeCutoffEvidence(missingPrice,{...state,observations},'2026-08-04','2026-08-04T01:00:00Z');
  assert.equal(rebuilt.current.positions.find(p=>p.id===asset).observation.quantity,'9');
  assert.equal(rebuilt.current.positions.find(p=>p.id===asset).observation.price,'100');
  assert.equal((await admin.query("select count(*)::int n from daily_snapshot_work where account_id=$1 and snapshot_date='2026-08-04' and stage='native' and status='pending'",[account])).rows[0].n,1);
  assert.equal((await snapshots.saveNativeCutoffSnapshots(context,rebuilt,'2026-08-04','2026-08-04T01:00:00Z')).created,1);
 });
 await check('before-opening-and-invalid-replay-preserve-current',async()=>{
  const before=(await read()).accounts[0].state;
  assert.equal((await write({...missing,operationId:randomUUID(),expectedSequence:seq,event:{...missing.event,at:'2026-07-31T00:00:00Z'}})).reason,'trade_not_after_opening');
  assert.equal((await write({...missing,operationId:randomUUID(),expectedSequence:seq,event:{...missing.event,quantity:'200',settlement:{currency:'USD',amount:'20000'}},history:{...missing.history,afterEventId:missing.operationId}})).reason,'historical_replay_invalid');
  assert.deepEqual((await read()).accounts[0].state,before);
 });
 await check('genuinely-separate-identical-trade-allowed',async()=>{
  assert.equal((await write({...missing,operationId:randomUUID(),expectedSequence:seq,event:{...missing.event,at:'2026-08-04T12:00:00Z'},history:undefined})).status,'created');seq++;
  assert.equal((await read()).accounts[0].state.positions[0].quantity,'11');assert.equal((await read()).accounts[0].state.cash.USD,'930');
 });
 await check('correction-original-retained-and-new-writer-cas',async()=>{
  const original=(await read()).entries.find(e=>e.data.event.type==='sell');
  const correction={...missing,operationId:randomUUID(),expectedSequence:seq,event:{...original.data.event,quantity:'2',settlement:{currency:'USD',amount:'220'}},history:{reason:'Correct synthetic quantity',notInOpening:true,replaces:original.id}};
  delete correction.event.id;delete correction.event.sequence;delete correction.event.source;
  const race={operationId:randomUUID(),accountId:account,expectedSequence:seq,event:{type:'deposit',currency:'USD',amount:'1',at:'2026-08-05T00:00:00Z'}};
  const results=await Promise.all([write(correction),write(race)]);
  assert.equal(results.filter(r=>r.status==='created').length,1);assert.equal(results.filter(r=>r.status==='conflict'||r.reason==='conflict').length,1);
  seq=(await read()).accounts[0].state.sequence;
 });
 const base=(at)=>({ownerId:owner,reporting:'USD',asOf:at,current:{at,source:'synthetic_observation',scopeComplete:true,positions:[{id:asset,ownerId:owner,accountId:account,kind:'holding',name:'Synthetic unit',ticker:'UNIT',market:'us',observation:{quantity:'999',price:'100',currency:'USD',at:'2026-08-02T20:00:00.000Z',priceObservedAt:'2026-08-02T20:00:00.000Z',priceFetchedAt:'2026-08-02T20:00:00.000Z',basis:'raw',source:'synthetic'}}]},history:[],trades:null,fx:[],maxFxAgeMs:86400000,maxPriceAgeMs:86400000});
 await check('cutoff-delay-independent-and-no-current-quantity-backdate',async()=>{
  const state=await read();
  const early=cutoff.buildNativeCutoffEvidence(base('2026-08-02T22:00:00.000Z'),state,'2026-08-03','2026-08-02T22:00:00.000Z');
  const late=cutoff.buildNativeCutoffEvidence(base('2026-08-02T22:30:00.000Z'),state,'2026-08-03','2026-08-02T22:30:00.000Z');
  assert.deepEqual(early.current,late.current);assert.equal(early.current.positions.find(p=>p.id===asset).observation.quantity,'12');
  assert.equal((await snapshots.saveNativeCutoffSnapshots(context,early,'2026-08-03','2026-08-02T22:00:00.000Z')).status,'ready');
  assert.equal((await snapshots.saveNativeCutoffSnapshots(context,late,'2026-08-03','2026-08-02T22:30:00.000Z')).created,0);
 });
 await check('worker-takeover-fences-financial-write-and-finalization',async()=>{
  await work.discoverSnapshotWork('native','2026-08-05');
  const a=await work.claimSnapshotWork('native','2026-08-05');assert.ok(a);
  await fixtureWrite("update daily_snapshot_work set lease_until=clock_timestamp()-interval '1 second' where id=$1",[a.id]);
  const b=await work.claimSnapshotWork('native','2026-08-05');assert.equal(b.id,a.id);assert.equal(b.generation,a.generation+1);
  await assert.rejects(work.snapshotFence.run(a,()=>mutation.runPortfolioMutation(owner,'select 1',[])),/snapshot_worker_expired/);
  const evidence=cutoff.buildNativeCutoffEvidence({...base('2026-08-05T01:00:00Z'),maxPriceAgeMs:10*86400000},await ledger.readNativeLedger(context,a.accountId),a.snapshotDate,'2026-08-05T01:00:00Z');
  const count=(await admin.query('select count(*)::int n from daily_portfolio_snapshots')).rows[0].n;
  await assert.rejects(work.snapshotFence.run(a,()=>snapshots.saveNativeCutoffSnapshots(context,evidence,a.snapshotDate,'2026-08-05T01:00:00Z')),/snapshot_worker_expired/);
  assert.equal((await admin.query('select count(*)::int n from daily_portfolio_snapshots')).rows[0].n,count);

  assert.equal(await work.finishSnapshotWork(a,'completed',null),false);
  assert.equal(await work.finishSnapshotWork(b,'completed',null),true);
  const c=await work.claimSnapshotWork('native','2026-08-05');assert.notEqual(c?.id,b.id);
 });
 await check('missing-quotes-preserve-ledger-and-current-projection',async()=>{
  const state=await read(), currentBase=base('2026-08-06T12:00:00.000Z');currentBase.current.positions[0].observation=null;
  const value=projection.attachNativeLedgerEvidence(currentBase,state,'account');
  assert.equal(value.current.positions.find(p=>p.id===asset).observation,null);
  assert.equal(state.accounts[0].state.sequence,seq);
  assert.equal(value.history.some(h=>h.at===originalSnapshot.frame.at && h.positions.find(p=>p.id===asset)?.observation.quantity==='7'),false,'invalid original quantity never returns');
 });
 await check('exclusive-millisecond-boundary-in-real-database',async()=>{
  const a=randomUUID();await fixtureWrite("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency) values($1,$2,'boundary','Synthetic boundary','brokerage','USD')",[a,owner]);
  await write({operationId:randomUUID(),accountId:a,expectedSequence:null,opening:{at:'2026-08-01T00:00:00Z',cash:{KRW:'0',USD:'1000'},positions:[]}});
  for(const [sequence,at,amount] of [[0,'2026-08-02T21:59:59.999Z','1'],[1,'2026-08-02T22:00:00.000Z','2']]) assert.equal((await write({operationId:randomUUID(),accountId:a,expectedSequence:sequence,event:{type:'deposit',currency:'USD',amount,at}})).status,'created');
  const data=await ledger.readNativeLedger(context,a);
  const early=cutoff.buildNativeCutoffEvidence({...base('2026-08-02T22:00:00Z'),current:{positions:[],at:'2026-08-02T22:00:00Z',scopeComplete:true,source:'synthetic'}},data,'2026-08-03','2026-08-02T22:00:00Z');
  const late=cutoff.buildNativeCutoffEvidence({...base('2026-08-02T22:30:00Z'),current:{positions:[],at:'2026-08-02T22:30:00Z',scopeComplete:true,source:'synthetic'}},data,'2026-08-03','2026-08-02T22:30:00Z');
  assert.deepEqual(early.current,late.current);assert.equal(early.current.positions.find(p=>p.id===`cash:${a}:USD`).observation.quantity,'1001');
  assert.equal(data.accounts[0].state.cash.USD,'1003');
 });
 await check('retry-drains-only-unfinished-cutoffs-and-keeps-complete-records',async()=>{
  await fixtureWrite("update daily_snapshot_work set lease_until=clock_timestamp()-interval '1 second' where status='running'");
  let first=true,failedId;const calls=[];
  const execute=async item=>{
   calls.push(item.id);if(first){first=false;failedId=item.id;throw new Error('synthetic transient transport error');}
   const data=await ledger.readNativeLedger(context,item.accountId);
   const evidence=cutoff.buildNativeCutoffEvidence({...base('2026-08-05T01:00:00Z'),maxPriceAgeMs:10*86400000},data,item.snapshotDate,'2026-08-05T01:00:00Z');
   const saved=await snapshots.saveNativeCutoffSnapshots(context,evidence,item.snapshotDate,'2026-08-05T01:00:00Z');
   assert.equal(saved.status,'ready');return {status:'completed'};
  };
  const before=await work.runSnapshotWork('native','2026-08-05',execute);assert.equal(before.failedCount,1);assert.ok(before.writtenCount>0);
  const completed=(await admin.query("select id from daily_snapshot_work where status='completed'")).rows.map(r=>r.id);
  const priorCalls=calls.length;
  await fixtureWrite("update daily_snapshot_work set next_attempt_at=clock_timestamp()-interval '1 second' where id=$1",[failedId]);
  const after=await work.runSnapshotWork('native','2026-08-05',execute);assert.equal(after.failedCount,0);assert.equal(after.blockedCount,0);
  assert.deepEqual(calls.slice(priorCalls),[failedId]);assert.ok(!completed.includes(failedId));
  const count=(await admin.query('select count(*)::int n from daily_portfolio_snapshots')).rows[0].n;
  await work.runSnapshotWork('native','2026-08-05',execute);
  assert.equal(calls.length,priorCalls+1);assert.equal((await admin.query('select count(*)::int n from daily_portfolio_snapshots')).rows[0].n,count);
 });
 await check('legacy-cutoff-real-reader-writer-and-completed-skip',async()=>{
  const a=randomUUID(),h=randomUUID();
  await fixtureWrite("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency,created_at,updated_at) values($1,$2,'legacy-test','Synthetic legacy','brokerage','KRW','2026-08-01','2026-08-01')",[a,owner]);
  await fixtureWrite("insert into assets(id,canonical_owner_user_id,account_id,account,name,ticker,market,currency,asset_type,quantity,current_price,created_at,updated_at) values($1,$2,$3,'legacy-test','Synthetic legacy unit','999999','korea','KRW','stock',10,100,'2026-08-01','2026-08-01')",[h,owner,a]);
  await fixtureWrite("insert into asset_price_snapshots(ticker,market,currency,date,close_price,source,fetched_at) values('999999','korea','KRW','2026-08-04',100,'kis','2026-08-04T21:00:00Z')");
  await fixtureWrite("insert into live_price_quotes(ticker,market,currency,price,source,provider,quote_type,status,price_as_of,fetched_at) values('999999','korea','KRW',110,'kis','kis','live','ok','2026-08-04T21:59:59Z','2026-08-04T21:59:59Z')");
  await fixtureWrite("insert into fx_rates(date,usdkrw,source,status,observed_at,fetched_at,rate_kind) values('2026-08-04',1400,'synthetic','ok','2026-08-04T21:00:00Z','2026-08-04T21:00:00Z','spot')");
  const result=await legacyJob.runDailySnapshotJob({durable:true,dryRun:false,snapshotDate:'2026-08-05'});
  assert.equal(result.failedCount,0);assert.equal(result.writtenCount,1);assert.equal(result.blockedCount,2,'older days lack contemporaneous quotes');
  const stored=(await admin.query('select id,total_market_value::text,updated_at from daily_portfolio_snapshots where account_id=$1',[a])).rows;
  assert.equal(stored.length,1);assert.equal(Number(stored[0].total_market_value),1100);
  // Simulate a worker commit followed by loss of only its completion acknowledgement.
  await fixtureWrite("update daily_snapshot_work set status='failed',next_attempt_at=clock_timestamp()-interval '1 second' where account_id=$1 and status='completed'",[a]);
  await legacyJob.runDailySnapshotJob({durable:true,dryRun:false,snapshotDate:'2026-08-05'});
  assert.deepEqual((await admin.query('select id,total_market_value::text,updated_at from daily_portfolio_snapshots where account_id=$1',[a])).rows,stored);
 });
 await check('parent-run-failure-backoff-and-stale-finalization',async()=>{
  const claim=()=>runRepository.claimCronMarketCycleRun({snapshotDate:'2026-08-05',startedAt:new Date(),cronScheduleUtc:null});
  const first=await claim();assert.equal(first.outcome,'claimed');
  const done={runId:first.runId,status:'failed',finishedAt:new Date(),requestedCount:2,successCount:1,failedCount:1,skippedCount:0,metadata:{snapshotDate:'2026-08-05'}};
  await runRepository.finishCronMarketCycleRun(done);assert.equal((await claim()).outcome,'already_attempted');
  await fixtureWrite("update market_data_sync_runs set started_at=clock_timestamp()-interval '6 minutes' where id=$1",[first.runId]);
  const second=await claim();assert.equal(second.outcome,'claimed');
  await assert.rejects(runRepository.finishCronMarketCycleRun({...done,status:'completed'}),/cron_run_lease_lost/);
  await runRepository.finishCronMarketCycleRun({...done,runId:second.runId,status:'completed',successCount:2,failedCount:0});
  assert.equal((await admin.query('select status from market_data_sync_runs where id=$1',[first.runId])).rows[0].status,'failed');
 });
 await check('historical-revision-fences-already-read-cron-evidence',async()=>{
  const state=await read();
  const evidence=cutoff.buildNativeCutoffEvidence({...base('2026-08-05T01:00:00Z'),maxPriceAgeMs:10*86400000},state,'2026-08-05','2026-08-05T01:00:00Z');
  const original=(await admin.query('select native_data from event_ledger_entries where canonical_owner_user_id=$1 and account_id=$2 order by native_sequence',[owner,account])).rows;
  const added=await write({...missing,operationId:randomUUID(),expectedSequence:state.accounts[0].state.sequence,event:{...missing.event,at:'2026-08-02T12:00:00Z',quantity:'1',settlement:{currency:'USD',amount:'100'}}});
  assert.equal(added.status,'created');
  const stale=await snapshots.saveNativeCutoffSnapshots(context,evidence,'2026-08-05','2026-08-05T01:00:00Z');
  assert.equal(stale.status,'stale');assert.equal(stale.created,0);
  const rows=(await admin.query('select native_data from event_ledger_entries where canonical_owner_user_id=$1 and account_id=$2 order by native_sequence',[owner,account])).rows;
  assert.deepEqual(rows.slice(0,original.length),original,'revision never rewrites originals');
  const next=await read();assert.equal(next.snapshots.filter(s=>Date.parse(s.evidence.frame.at)>=Date.parse('2026-08-02T12:00:00Z')).length,0,'all affected old valuations withheld until rebuild');
 });
 assert.ok(sessions.size>=2,'real multiple TCP connections required');
 report.connectionCount=sessions.size;
 const {runReliabilityRetryCases}=await import('./reliability-retry-cases.mjs');
 await runReliabilityRetryCases({admin,worker,tenant,report,connection});
 const {runReliabilityLimitCases}=await import('./reliability-limit-cases.mjs');
 await runReliabilityLimitCases({admin,worker,tenant,report,connection});
 const {runCompatibilityCases}=await import('./reliability-compatibility-cases.mjs');
 await runCompatibilityCases({admin,worker,tenant,report,connection});
}
