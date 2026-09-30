import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as nextServer from 'next/server.js';
import { importWithPorts } from '../tests/helpers/import-with-ports.mjs';
import { sqlTransport } from './krw-usd-rc-rehearsal.mjs';

/** Only called with pools from the fresh, loopback-only disposable PG runner. */
export async function runCutoffObservationCases({admin,worker,tenant,report}) {
  const sessions=new Set(), transport=sqlTransport(worker,sessions);
  let gate=false,arrivals=0,release, mutateBeforeWrite=null;
  const barrier=new Promise(resolve=>{release=resolve;});
  const sqlClient={...transport,async transaction(build,options){
    const commands=build({query:(text,parameters=[])=>({text,parameters})});
    if(mutateBeforeWrite && commands.some(q=>q.text.includes('insert into "daily_portfolio_snapshots"'))) { const mutate=mutateBeforeWrite; mutateBeforeWrite=null; await mutate(); }
    if(gate && commands.some(q=>q.text.includes('insert into "daily_portfolio_snapshots"'))) {
      if(++arrivals===2) release();
      await Promise.race([barrier,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('cutoff_write_barrier_timeout')),10000);timer.unref();})]);
    }
    return transport.transaction(tx=>commands.map(q=>tx.query(q.text,q.parameters)),options);
  }};
  const [sync,lease,fx,reader,daily,runs]=await importWithPorts([
    'src/lib/market-data/price-sync.ts','src/lib/market-data/kis-refresh-lease.ts','src/lib/market-data/fx-refresh-job.ts',
    'src/db/queries/snapshot-cutoff-observations.ts','src/lib/snapshots/daily.ts','src/lib/cron-market-cycle-run-repository.ts',
  ],{'@/db/client':{db:drizzle(worker),sqlClient}});
  const check=async(name,task)=>{const row={name,status:'FAIL'};report.cases.push(row);await task();row.status='PASS';};
  const owner=randomUUID(),account=randomUUID(),asset=randomUUID();
  const snapshotDate=new Date(Date.now()-2*86400000).toISOString().slice(0,10);
  const receiptDate=new Date(Date.parse(`${snapshotDate}T00:00:00Z`)-86400000).toISOString().slice(0,10);
  const receipt=time=>`${receiptDate}T${time}Z`;
  const openingDate=new Date(Date.parse(`${snapshotDate}T00:00:00Z`)-10*86400000).toISOString().replace(".000Z", ".123456Z");
  const bootstrap=await admin.connect();
  try {
    await bootstrap.query('BEGIN');await bootstrap.query("select set_config('app.trade_reliability_version','0059',true)");
    await bootstrap.query("insert into app_users(id,status,role) values($1,'active','user')",[owner]);
    await bootstrap.query("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency,created_at,updated_at) values($1,$2,'brokerage','Synthetic cutoff','brokerage','USD',$3,$3)",[account,owner,openingDate]);
    await bootstrap.query("insert into assets(id,canonical_owner_user_id,account_id,account,name,ticker,market,currency,asset_type,quantity,current_price,created_at,updated_at) values($1,$2,$3,'brokerage','Synthetic cutoff','CUTUNIT','us','USD','stock',10,100,$4,$4)",[asset,owner,account,openingDate]);
    await bootstrap.query("insert into event_ledger_entries(legacy_asset_id,canonical_owner_user_id,account_id,account,event_date,event_type,asset_name,before_value,after_value,created_at,updated_at) values('synthetic-cutoff-legacy',$1,$2,'brokerage',$3,'manual_adjustment','Synthetic cutoff','unchanged','unchanged',$4,$4)",[owner,account,openingDate.slice(0,10),openingDate]);
    await bootstrap.query('COMMIT');
  }catch(error){await bootstrap.query('ROLLBACK');throw error;}finally{bootstrap.release();}
  let at=new Date(receipt('21:59:00')),price='105';
  // The combined suite has earlier synthetic holdings: answer every requested test target.
  // The real collector must still enforce complete target coverage; never relax its guard.
  const provider={name:'kis',supportedMarkets:['us'],fetchLiveQuotes:async targets=>({provider:'kis',fetchedAt:at,warnings:[],rows:targets.map(target=>({ticker:target.ticker,market:target.market,currency:target.currency,price,priceAsOf:at,fetchedAt:at,source:'kis_overseas_price:NAS',quoteType:'live',status:'ok'}))})};
  const writePrice=()=>lease.withKisCollectionLease(()=>sync.runMarketPriceSync({mode:'live',dryRun:false,fixture:false,provider,explicitTargets:[{ticker:'CUTUNIT',market:'us',currency:'USD'}]}));
  const writeFx=value=>fx.runUsdKrwFxCandidateJob({dryRun:false,acceptExistingVardaRow:true,candidate:{provider:'kis',pair:'USD/KRW',rateDate:snapshotDate,usdKrw:value,source:'kis_overseas_price_detail:NAS',status:'ok',fetchedAt:at.toISOString()}});
  const snapshot=(now=new Date(receipt('22:20:00')))=>daily.runDailySnapshot({tenantContext:{ownerUserId:owner},now,dryRun:false,account:'brokerage'});
  await check('cutoff-real-writer-cache-overwrite-retains-precutoff-price-and-fx',async()=>{
    const [runner]=await importWithPorts(['src/lib/cron-market-cycle-runner.ts'],{
      'next/server':{after:nextServer.after,NextResponse:nextServer.NextResponse},
      '@/db/client':{db:drizzle(worker),sqlClient},
      '@/lib/market-data/collection-worker':{scheduleMarketCollection:()=>assert.fail('preparation must never schedule auxiliary provider work')},
      // Financial clock is a historical synthetic cutoff; SQL lease expiration
      // uses the real database clock. Keep both actual repository functions.
      '@/lib/cron-market-cycle-run-repository':{
        claimCronMarketCycleRun:input=>runs.claimCronMarketCycleRun({...input,startedAt:new Date()}),
        finishCronMarketCycleRun:runs.finishCronMarketCycleRun,
      },
      '@/lib/market-data/providers/kis':{getKisProviderPolicy:()=>({configured:true}),createKisMarketDataProvider:()=>provider},
      // Replace only external FX acquisition with the existing actual candidate writer.
      '@/lib/market-data/fx-refresh-job':{runUsdKrwFxRefreshJob:()=>writeFx('1300')},
    });
    const prepared=await runner.runCronMarketCycle({now:at});
    assert.equal(prepared.status,'prepared',JSON.stringify({blockers:prepared.blockers,fx:prepared.fx,liveSync:prepared.liveSync}));assert.equal(prepared.snapshotDate,snapshotDate);
    assert.equal(prepared.snapshot.targetCount,0);
    assert.equal((await worker.query('select count(*)::int n from daily_portfolio_snapshots where account_id=$1',[account])).rows[0].n,0);
    at=new Date(receipt('22:20:00'));price='110';
    assert.equal((await writePrice()).status,'completed');assert.equal((await writeFx('1310')).status,'written');
    const evidence=await reader.readSnapshotCutoffObservations(snapshotDate);
    assert.equal(Number(evidence.quotes.find(row=>row.ticker==='CUTUNIT').price),105);
    assert.equal(Number(evidence.fxRows[0].usdKrw),1300);
    assert.equal(evidence.fxRows[0].providerObservedAt,null);assert.equal(evidence.fxRows[0].timestampBasis,'collection');
    assert.equal(Number((await worker.query("select price from live_price_quotes where ticker='CUTUNIT'")).rows[0].price),110);
  });
  await check('historical-dry-run-retains-strict-cutoff-10-times-105-times-1300-equals-1365000',async()=>{
    const options={tenantContext:{ownerUserId:owner},snapshotDate,now:new Date(Date.parse(receipt('22:20:00'))+86400000),account:'brokerage'};
    const historical=await daily.runDailySnapshot({...options,dryRun:true});
    assert.equal(historical.results.brokerage.totalMarketValue,1365000);
    assert.equal(historical.fx.usdKrw,1300);
    assert.equal(historical.cutoffValuation.policy,'pre_cutoff_kis_quote_else_exact_official_close');
    assert.equal(historical.cycle.cycleEndAt,new Date(receipt('22:00:00')).toISOString());
    await assert.rejects(daily.runDailySnapshot({...options,dryRun:false}),error=>error.code==='historical_write_not_enabled');
    assert.equal((await worker.query('select count(*)::int n from daily_portfolio_snapshots where account_id=$1',[account])).rows[0].n,0);
    assert.equal((await worker.query('select count(*)::int n from daily_position_snapshots where account_id=$1',[account])).rows[0].n,0);
  });
  for (const table of ['assets', 'event_ledger_entries']) {
    await check(`cutoff-${table}-one-microsecond-concurrent-change-rejects-and-rolls-back`, async()=>{
      const modify=async token=>{const c=await admin.connect();try{await c.query('BEGIN');await c.query("select set_config('app.trade_reliability_version','0059',true)");await c.query(`update ${table} set updated_at=$2 where account_id=$1`,[account,token]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
      mutateBeforeWrite=()=>modify(openingDate.replace('123456','123457'));
      await assert.rejects(snapshot(),error=>error.code==='22012');
      assert.equal((await worker.query('select count(*)::int n from daily_portfolio_snapshots where account_id=$1',[account])).rows[0].n,0);
      assert.equal((await worker.query('select count(*)::int n from daily_position_snapshots where account_id=$1',[account])).rows[0].n,0);
      await modify(openingDate);
    });
  }
  await check('execution-real-daily-writer-concurrency-10-times-110-times-1310-equals-1441000',async()=>{
    gate=true;const results=await Promise.allSettled([snapshot(),snapshot()]);gate=false;
    assert.equal(arrivals,2,'both plans reached real concurrent transactions');
    assert.equal(results.filter(row=>row.status==='fulfilled').length,1);
    assert.equal(results.filter(row=>row.status==='rejected').length,1);
    const completed=results.find(row=>row.status==='fulfilled').value;
    assert.equal(completed.cutoffValuation.policy,'execution_quote_else_exact_official_close');
    assert.equal(completed.fx.usdKrw,1310);
    assert.equal(completed.fx.fetchedAt,new Date(receipt('22:20:00')).toISOString());
    const rows=(await worker.query('select total_market_value,num_assets,description,cycle_end_at,captured_at from daily_portfolio_snapshots where account_id=$1 and snapshot_date=$2',[account,snapshotDate])).rows;
    assert.equal(rows.length,1);assert.equal(Number(rows[0].total_market_value),1441000);assert.equal(rows[0].num_assets,1);
    const positions=(await worker.query('select quantity,current_price,market_value_krw,fx_rate,description,cycle_end_at,captured_at from daily_position_snapshots where account_id=$1 and snapshot_date=$2',[account,snapshotDate])).rows;
    assert.equal(positions.length,1);assert.equal(Number(positions[0].quantity),10);assert.equal(Number(positions[0].current_price),110);
    assert.equal(Number(positions[0].market_value_krw),1441000);assert.equal(Number(positions[0].fx_rate),1310);
    for(const row of [rows[0],positions[0]]) {
      assert.match(row.description,/(?:^|; )valuation_policy=execution_collection_v1(?:;|$)/);
      assert.match(row.description,/(?:^|; )fx_valuation_policy=execution_collection_v1(?:;|$)/);
      assert.equal(row.cycle_end_at.toISOString(),new Date(receipt('22:20:00')).toISOString());
      assert.equal(row.captured_at.toISOString(),new Date(receipt('22:20:00')).toISOString());
    }
    assert.ok(positions[0].description.includes(`fx_fetched_at=${new Date(receipt('22:20:00')).toISOString()}`));
    assert.match(positions[0].description,/(?:^|; )fx_observed_at=unknown(?:;|$)/);
    assert.match(positions[0].description,/(?:^|; )fx_timestamp_basis=collection(?:;|$)/);
  });
  await check('execution-completed-record-survives-refresh-retry-and-shared-evidence-prune',async()=>{
    const before=(await worker.query('select to_jsonb(s) data from daily_portfolio_snapshots s where account_id=$1 order by id',[account])).rows;
    const positionsBefore=(await worker.query('select to_jsonb(s) data from daily_position_snapshots s where account_id=$1 order by id',[account])).rows;
    at=new Date(receipt('22:30:00'));price='120';
    assert.equal((await writePrice()).status,'completed');assert.equal((await writeFx('1320')).status,'written');
    await worker.query("delete from snapshot_cutoff_price_observations where ticker='CUTUNIT'");
    await worker.query('delete from snapshot_cutoff_fx_observations where snapshot_date=$1',[snapshotDate]);
    const retry=await snapshot(at);assert.equal(retry.results.brokerage.totalMarketValue,1441000);
    assert.equal(retry.results.brokerage.reason,'completed_cutoff_preserved');
    assert.equal(retry.cutoffValuation.policy,'execution_quote_else_exact_official_close');
    assert.equal(retry.fx.usdKrw,1310);
    assert.equal(retry.cycle.capturedAt,new Date(receipt('22:20:00')).toISOString());
    assert.deepEqual((await worker.query('select to_jsonb(s) data from daily_portfolio_snapshots s where account_id=$1 order by id',[account])).rows,before);
    assert.deepEqual((await worker.query('select to_jsonb(s) data from daily_position_snapshots s where account_id=$1 order by id',[account])).rows,positionsBefore);
  });
  await check('cutoff-shared-observations-tenant-read-and-write-denied',async()=>{
    for(const table of ['snapshot_cutoff_price_observations','snapshot_cutoff_fx_observations']) {
      await assert.rejects(tenant.query(`select * from ${table}`),error=>error.code==='42501');
      await assert.rejects(tenant.query(`delete from ${table}`),error=>error.code==='42501');
    }
    await assert.rejects(tenant.query("select record_snapshot_cutoff_fx('kis_overseas_price_detail:NAS','2026-09-25',1300,null,null,'2026-09-24T21:59:00Z')"),error=>error.code==='42501');
  });
  await check('cutoff-real-pg-bounded-receipts-expiration-and-immutable-decimals',async()=>{
    const oldDate=new Date(Date.now()-45*86400000).toISOString().slice(0,10);
    const oldReceipt=new Date(Date.parse(`${oldDate}T07:00:00+09:00`)-60000).toISOString();
    await worker.query("insert into snapshot_cutoff_price_observations(snapshot_date,ticker,market,currency,provider,source,quote_type,price,fetched_at,timestamp_basis) values($1,'EXPIRED','us','USD','kis','kis_overseas_price:NAS','live',100,$2,'collection')",[oldDate,oldReceipt]);
    const write=i=>worker.query("insert into live_price_quotes(ticker,market,currency,provider,source,quote_type,status,price,price_as_of,fetched_at) values('CUTBOUND','us','USD','kis','kis_overseas_price:NAS','live','ok',105.123456789012,$1,$1) on conflict(market,ticker,provider) do update set fetched_at=excluded.fetched_at,price_as_of=excluded.price_as_of",[new Date(Date.parse(receipt('21:45:00'))+i*1000).toISOString()]);
    for(let start=0;start<40;start+=8) await Promise.all(Array.from({length:8},(_,i)=>write(start+i)));
    await write(39);
    const rows=(await reader.readSnapshotCutoffObservations(snapshotDate)).quotes.filter(row=>row.ticker==='CUTBOUND');
    assert.equal(rows.length,32);assert.equal(rows[0].price,'105.123456789012');
    assert.equal(rows[0].fetchedAt.toISOString(),receipt('21:45:39.000'));assert.equal(rows.at(-1).fetchedAt.toISOString(),receipt('21:45:08.000'));
    assert.equal((await worker.query("select count(*)::int n from snapshot_cutoff_price_observations where ticker='EXPIRED'")).rows[0].n,0);
    await assert.rejects(worker.query("update snapshot_cutoff_price_observations set price=1 where ticker='CUTBOUND'"),/cutoff_observation_immutable/);
    const rollback=await worker.connect();
    try {await rollback.query('BEGIN');await rollback.query("update live_price_quotes set fetched_at=$1 where ticker='CUTBOUND'",[receipt('21:59:00')]);await assert.rejects(rollback.query('select 1/0'));await rollback.query('ROLLBACK');}
    finally{rollback.release();}
    assert.equal((await reader.readSnapshotCutoffObservations(snapshotDate)).quotes.find(row=>row.ticker==='CUTBOUND').fetchedAt.toISOString(),receipt('21:45:39.000'));
  });
  await check('cutoff-preparation-claim-is-separate-from-daily-completion-and-attempt-cap',async()=>{
    const now=new Date(),date='2099-02-03';
    await admin.query("insert into market_data_sync_runs(job_type,mode,source,status,started_at,metadata_json) select 'market_cycle','daily','varda_cron_market_cycle','completed',clock_timestamp()-interval '10 minutes',jsonb_build_object('snapshotDate',$1::text) from generate_series(1,4)",[date]);
    assert.equal((await runs.claimCronMarketCycleRun({snapshotDate:date,startedAt:now,cronScheduleUtc:null})).outcome,'already_attempted');
    const prep=await runs.claimCronMarketCycleRun({snapshotDate:date,startedAt:now,cronScheduleUtc:null,phase:'pre_cutoff'});
    assert.equal(prep.outcome,'claimed');
    assert.equal((await worker.query('select mode from market_data_sync_runs where id=$1',[prep.runId])).rows[0].mode,'pre_cutoff');
    await runs.finishCronMarketCycleRun({runId:prep.runId,status:'completed',finishedAt:new Date(),requestedCount:1,successCount:1,failedCount:0,skippedCount:0,metadata:{snapshotDate:date,phase:'pre_cutoff'}});
    const nextDate='2099-02-04',next=await runs.claimCronMarketCycleRun({snapshotDate:nextDate,startedAt:new Date(),cronScheduleUtc:null,phase:'pre_cutoff'});
    assert.equal(next.outcome,'claimed');
    assert.equal((await runs.claimCronMarketCycleRun({snapshotDate:nextDate,startedAt:new Date(),cronScheduleUtc:null,phase:'pre_cutoff'})).outcome,'already_attempted');
    const dailyRun=await runs.claimCronMarketCycleRun({snapshotDate:nextDate,startedAt:new Date(),cronScheduleUtc:null});
    assert.equal(dailyRun.outcome,'claimed','an active preparation does not consume the daily run lease or attempt');
    await runs.finishCronMarketCycleRun({runId:next.runId,status:'completed',finishedAt:new Date(),requestedCount:1,successCount:1,failedCount:0,skippedCount:0,metadata:{snapshotDate:nextDate,phase:'pre_cutoff'}});
    await runs.finishCronMarketCycleRun({runId:dailyRun.runId,status:'completed',finishedAt:new Date(),requestedCount:1,successCount:1,failedCount:0,skippedCount:0,metadata:{snapshotDate:nextDate}});
  });
  await check('partial-batch-preserves-only-precutoff-completions-and-late-retry-cannot-backfill',async()=>{
    for(const [ticker,at] of [['ON_TIME',receipt('21:59:59')],['TOO_LATE',receipt('22:00:01')]]) {
      await worker.query("insert into live_price_quotes(ticker,market,currency,provider,source,quote_type,status,price,price_as_of,fetched_at) values($1,'us','USD','kis','kis_overseas_price:NAS','live','ok',123,$2,$2)",[ticker,at]);
    }
    const before=(await reader.readSnapshotCutoffObservations(snapshotDate)).quotes;
    assert.equal(before.filter(q=>q.ticker==='ON_TIME').length,1);assert.equal(before.filter(q=>q.ticker==='TOO_LATE').length,0);
    await worker.query("update live_price_quotes set fetched_at=$1,price_as_of=$1,price=999 where ticker in ('ON_TIME','TOO_LATE')",[receipt('22:05:00')]);
    const after=(await reader.readSnapshotCutoffObservations(snapshotDate)).quotes;
    assert.equal(Number(after.find(q=>q.ticker==='ON_TIME').price),123);assert.equal(after.filter(q=>q.ticker==='TOO_LATE').length,0);
  });
  await check('cutoff-progress-read-is-owner-and-scope-bounded', async()=>{
    const [progress]=await importWithPorts(['src/db/queries/snapshot-progress.ts'],{'@/db/client':{db:drizzle(worker),sqlClient}});
    await transport.transaction(tx=>[tx.query("select set_config('app.trade_reliability_version','0059',true)"),tx.query("insert into daily_snapshot_work(canonical_owner_user_id,account_id,snapshot_date,stage,revision,status,reason) values($1,$2,$3,'legacy',0,'failed','snapshot_write_failed') on conflict do nothing",[owner,account,snapshotDate])]);
    const scope={kind:'account',key:`account:${account}`,accountId:account,accountCode:'brokerage',label:'Synthetic'};
    assert.equal(await progress.getOwnedLegacySnapshotProgress({tenantContext:{ownerUserId:owner,role:'user'},scope,serviceDate:snapshotDate}),'failed');
    for(const [lease,expected] of [[new Date(Date.now()+60000).toISOString(),'running'],[new Date(Date.now()-60000).toISOString(),'failed'],[null,'failed']]) {
      await transport.transaction(tx=>[tx.query("select set_config('app.trade_reliability_version','0059',true)"),tx.query("update daily_snapshot_work set status='running',lease_until=$2 where account_id=$1",[account,lease])]);
      assert.equal(await progress.getOwnedLegacySnapshotProgress({tenantContext:{ownerUserId:owner,role:'user'},scope,serviceDate:snapshotDate}),expected);
    }
    assert.equal(await progress.getOwnedLegacySnapshotProgress({tenantContext:{ownerUserId:randomUUID(),role:'user'},scope,serviceDate:snapshotDate}),'unknown');
    assert.equal(await progress.getOwnedLegacySnapshotProgress({tenantContext:{ownerUserId:owner,role:'user'},scope:{...scope,accountId:randomUUID()},serviceDate:snapshotDate}),'unknown');
  });
  await check('target-approval-stale-editor-cas-and-explicit-zero-real-writer-query',async()=>{
    const secondAsset=randomUUID();
    const c=await admin.connect();
    try {
      await c.query('BEGIN'); await c.query("select set_config('app.trade_reliability_version','0059',true)");
      await c.query("insert into assets(id,canonical_owner_user_id,account_id,account,name,ticker,market,currency,asset_type,quantity,current_price) values($1,$2,$3,'brokerage','Synthetic target','TARGETUNIT','us','USD','stock',4,100)",[secondAsset,owner,account]);
      await c.query('COMMIT');
    }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
    const scope={kind:'account',key:`account:${account}`,accountId:account,accountCode:'brokerage',label:'Synthetic'};
    const policy=await import('../src/lib/portfolio-target-policy.ts');
    const universe=policy.normalizePortfolioTargetUniverse([
      {accountCode:'brokerage',accountId:account,accountName:'Synthetic',assetId:asset,assetName:'Synthetic cutoff',assetType:'stock',market:'us',currency:'USD',ticker:'CUTUNIT',currentValueKrw:600000},
      {accountCode:'brokerage',accountId:account,accountName:'Synthetic',assetId:secondAsset,assetName:'Synthetic target',assetType:'stock',market:'us',currency:'USD',ticker:'TARGETUNIT',currentValueKrw:400000},
    ]);
    const hash=policy.createPortfolioTargetUniverseHash({scope,universe:universe.rows});
    let readRevision=0;let modelRows=universe.rows;let currentHash=hash;let policyVersion='portfolio_target_policy_v1';
    const tenantTransport=sqlTransport(tenant,sessions);
    const [writer,reader]=await importWithPorts(['src/lib/portfolio-target-policy-write.ts','src/db/queries/tenant-target-policies.ts'],{
      '@/db/client':{db:drizzle(worker),sqlClient},
      '@/db/tenant-client':{getTenantSqlClient:()=>tenantTransport},
      './tenant-client':{getTenantSqlClient:()=>tenantTransport},
      // Only the external identity and pre-write screen projection are substituted.
      // The actual SQL writer, lock/CAS and RLS reader are exercised below.
      '@/db/queries/onboarding-instrument-search':{resolveOnboardingInstrumentById:async id=>id==='fixture:C'?{id,name:'Candidate C',ticker:'CANDUNIT',market:'us',currency:'USD',assetType:'stock'}:null},
      '@/lib/auth/current-tenant-context':{resolveCurrentTenantContext:async()=>({ok:true,tenantContext:{ownerUserId:owner,role:'user'}})},
      '@/db/queries/portfolio-analysis-scopes':{getReadOnlyTenantPortfolioAnalysisScopeContext:async()=>({state:'ready',resolution:{state:'resolved',scope}})},
      '@/db/queries/portfolio-target-policy':{getReadOnlyTenantPortfolioTargetPolicyModel:async()=>({status:'ready',rows:modelRows,selectableAccounts:[{id:account,code:'brokerage',name:'Synthetic'}],universe:{...universe,rows:modelRows},currentUniverseHash:currentHash,approvedPolicy:{policy:readRevision?{approvalRevision:readRevision,policyVersion}:null}})},
    });
    const form=(revision,zeroAsset=asset)=>{const f=new FormData();f.set('scope',scope.key);f.set('rowCount','2');f.set('universeHash',hash);f.set('approvalRevision',String(revision));universe.rows.forEach((r,i)=>f.set(`targetWeight:${i}`,r.assetId===zeroAsset?'0':'100'));return f;};
    const read=ownerUserId=>reader.loadCurrentTenantPortfolioTargetPolicy({scopeKind:'account',scopeAccountId:account,scopePortfolioGroupId:null,tenantContext:{ownerUserId,role:'user'}});
    assert.equal((await writer.writeSessionPortfolioTargetPolicy(form(0))).status,'success');
    const first=await read(owner); assert.equal(first.policy.approvalRevision,1);
    assert.equal(first.policy.rows.find(r=>r.assetId===asset).targetWeightBps,0);
    assert.equal((await read(randomUUID())).status,'missing');
    // Deliberately retain the stale projection to force rejection at the SQL boundary.
    assert.equal((await writer.writeSessionPortfolioTargetPolicy(form(0,secondAsset))).status,'conflict');
    assert.deepEqual((await read(owner)).policy,first.policy);
    readRevision=1;
    const results=await Promise.all([writer.writeSessionPortfolioTargetPolicy(form(1,secondAsset)),writer.writeSessionPortfolioTargetPolicy(form(1,secondAsset))]);
    assert.deepEqual(results.map(r=>r.status).sort(),['conflict','success']);
    const second=await read(owner);assert.equal(second.policy.approvalRevision,2);assert.equal(second.policy.rows.find(r=>r.assetId===secondAsset).targetWeightBps,0);
    assert.equal((await worker.query('select count(*)::int n from portfolio_target_policy_revisions where canonical_owner_user_id=$1',[owner])).rows[0].n,2);
    assert.equal(Number((await worker.query('select quantity from assets where id=$1',[secondAsset])).rows[0].quantity),4);
    assert.equal((await worker.query('select count(*)::int n from portfolio_target_policy_lifecycle_events where canonical_owner_user_id=$1',[owner])).rows[0].n,3);
    const countBefore=(await worker.query('select count(*)::int n from assets where canonical_owner_user_id=$1',[owner])).rows[0].n;
    readRevision=2;
    const add=form(2);add.set('rowCount','3');add.set('candidates',JSON.stringify([{accountId:account,instrumentId:'fixture:C'}]));
    universe.rows.forEach((r,i)=>add.set('targetWeight:'+i,r.assetId===asset?'0':'50'));add.set('targetWeight:2','50');
    assert.equal((await writer.writeSessionPortfolioTargetPolicy(add)).status,'success');
    const saved=(await read(owner)).policy;
    assert.equal(saved.policyVersion,'portfolio_target_policy_v2');assert.equal(saved.rows.length,3);
    const candidate=saved.rows.find(r=>r.ticker==='CANDUNIT');assert.equal(candidate.originAssetId,null);assert.equal(candidate.targetWeightBps,5000);
    assert.equal((await read(randomUUID())).status,'missing');
    assert.equal((await worker.query('select count(*)::int n from assets where canonical_owner_user_id=$1',[owner])).rows[0].n,countBefore);
    await assert.rejects(tenant.query('insert into portfolio_target_plan_rows select * from portfolio_target_plan_rows limit 1'),e=>e.code==='42501');
    const {unionTargetPlanRows}=await import('../src/lib/portfolio-target-plan.ts');
    modelRows=policy.normalizePortfolioTargetUniverse(unionTargetPlanRows(universe.rows,saved.rows,[{id:account,code:'brokerage',name:'Synthetic'}])).rows;
    policyVersion=saved.policyVersion;currentHash=saved.universeHash;readRevision=3;
    // Removing then re-adding the same canonical candidate must retain the new row.
    const readd=new FormData();readd.set('scope',scope.key);readd.set('rowCount','4');readd.set('universeHash',currentHash);readd.set('approvalRevision','3');
    readd.set('removed',JSON.stringify([candidate.assetId]));readd.set('candidates',JSON.stringify([{accountId:account,instrumentId:'fixture:C'}]));
    modelRows.forEach((r,i)=>readd.set('targetWeight:'+i,r.assetId===secondAsset?'50':'0'));readd.set('targetWeight:3','50');
    assert.equal((await writer.writeSessionPortfolioTargetPolicy(readd)).status,'success');
    assert.equal((await read(owner)).policy.rows.find(r=>r.ticker==='CANDUNIT').targetWeightBps,5000);

  });
  await check('simulation-paired-queue-writer-query-calendar-engine-and-stale-worker',async()=>{
    const [prices,history,queue]=await importWithPorts(['src/lib/market-data/asset-price-snapshot-repository.ts','src/db/queries/simulation-owner-private-history.ts','src/lib/market-data/collection-queue.ts'],{'@/db/client':{db:drizzle(worker),sqlClient}});
    const {writeKisPairedHistory}=await import('../src/lib/market-data/kis-paired-history-write.ts');
    const {pairKisHistory}=await import('../src/lib/market-data/providers/kis-paired-history.ts');
    const target={ticker:'CALUNIT',market:'korea',currency:'KRW',assetIds:[],assetNames:[]};
    const rows=[['2026-09-18','100'],['2026-09-21','50'],['2026-09-22','55']].map(([priceDate,closePrice])=>({
      ...target,priceDate,closePrice,source:'kis_domestic_itemchartprice',quoteType:'close',status:'ok',
      providerSymbol:'CALUNIT',providerExchange:'KRX',fetchedAt:new Date('2026-09-23T00:00:00Z'),
      adjustedClosePrice:null,adjustedCloseBasis:null,adjustedCloseProvider:null,adjustedCloseSource:null,adjustedCloseFetchedAt:null,
      closePriceKrw:null,fxRate:null,isSample:false,
    }));
    assert.equal((await prices.applyAssetPriceSnapshotRows({rows,targets:[target],dryRun:false,allowWrite:true,writePolicy:'kis'})).insertedCount,3);
    const rawBefore=(await admin.query("select date::text,close_price::text,source,fetched_at from asset_price_snapshots where ticker='CALUNIT' order by date")).rows;
    const paired=pairKisHistory(rows,rows.map((row,i)=>({...row,closePrice:i<2?'50':'55'})));
    await queue.enqueueMarketCollection([{...target,kind:'history',startDate:'2026-09-18',endDate:'2026-09-22'}]);
    const claim=await queue.claimMarketCollection();assert.ok(claim.key.startsWith('kis:history:paired_v1:'));
    const write=(job,data=paired)=>writeKisPairedHistory(async(text,args)=>(await worker.query(text,args)).rows,job,data);
    assert.equal((await write(claim)).conflictCount,0);
    assert.deepEqual((await admin.query("select date::text,close_price::text,source,fetched_at from asset_price_snapshots where ticker='CALUNIT' order by date")).rows,rawBefore);
    const selection={status:'valid',instruments:[{...target,instrumentKey:'korea|KRW|CALUNIT',classification:'listed_instrument',weightBps:10000}]};
    const args={tenantContext:{ownerUserId:owner,role:'user'},selection,endServiceDate:'2026-09-23',returnStepCount:2};
    const first=await history.getReadOnlyPrivateOwnerRawHistoryBundle(args);
    assert.equal(first.status,'ready');
    assert.deepEqual(first.requestedServiceDates,['2026-09-19','2026-09-22','2026-09-23']);
    assert.equal(first.matrix.policy.version,'simulation_return_matrix_calendar_adjusted_v2');
    assert.equal(first.matrix.matrix[0].cells[0].value,0,'split must not become a 50 percent loss');
    assert.ok(Math.abs(first.matrix.matrix[1].cells[0].value-0.1)<1e-12);
    assert.equal((await write(claim)).conflictCount,0);
    assert.deepEqual((await history.getReadOnlyPrivateOwnerRawHistoryBundle(args)).matrix,first.matrix);
    const mismatch=paired.map(r=>({...r,closePrice:'999'}));assert.equal((await write(claim,mismatch)).conflictCount,3);
    const legacy=await prices.applyAssetPriceSnapshotRows({rows,targets:[target],dryRun:false,allowWrite:true,writePolicy:'kis'});
    assert.equal(legacy.updatedCount,0,'old raw writer cannot erase adjusted evidence');
    await admin.query("update market_collection_jobs set leased_until=now()-interval '1 second' where key=$1",[claim.key]);
    assert.equal((await write(claim)).failedCount,3);
    const replacement=await queue.claimMarketCollection();assert.notEqual(replacement.claimToken,claim.claimToken);
    await admin.query("delete from asset_price_snapshots where ticker='CALUNIT' and date='2026-09-21'");
    assert.equal((await write(claim)).failedCount,3,'stale claim cannot reinsert a missing row');
    const incomplete=await history.getReadOnlyPrivateOwnerRawHistoryBundle(args);
    assert.equal(incomplete.status,'incomplete');
    assert.equal(incomplete.matrix.matrix[0].cells[0].current.reason,'missing_trading_day_price');
    assert.equal((await write(replacement)).conflictCount,0);
    assert.deepEqual((await history.getReadOnlyPrivateOwnerRawHistoryBundle(args)).matrix,first.matrix);
    const batch=await history.getReadOnlyPrivateOwnerRawHistoryValidationBatch({...args,currentReturnStepCount:2});
    assert.equal(batch.current.status,'ready');assert.deepEqual(batch.current.matrix,first.matrix);
  });
  report.cutoffConnectionCount=sessions.size;
}
