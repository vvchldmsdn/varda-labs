import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as nextServer from 'next/server.js';
import { importWithPorts } from '../tests/helpers/import-with-ports.mjs';
import { sqlTransport } from './krw-usd-rc-rehearsal.mjs';

/** Only called with pools from the fresh, loopback-only disposable PG runner. */
export async function runCutoffObservationCases({admin,worker,tenant,report}) {
  const sessions=new Set(), transport=sqlTransport(worker,sessions);
  let gate=false,arrivals=0,release;
  const barrier=new Promise(resolve=>{release=resolve;});
  const sqlClient={...transport,async transaction(build,options){
    const commands=build({query:(text,parameters=[])=>({text,parameters})});
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
  const openingDate=new Date(Date.parse(`${snapshotDate}T00:00:00Z`)-10*86400000).toISOString();
  const bootstrap=await admin.connect();
  try {
    await bootstrap.query('BEGIN');await bootstrap.query("select set_config('app.trade_reliability_version','0059',true)");
    await bootstrap.query("insert into app_users(id,status,role) values($1,'active','user')",[owner]);
    await bootstrap.query("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency,created_at,updated_at) values($1,$2,'brokerage','Synthetic cutoff','brokerage','USD',$3,$3)",[account,owner,openingDate]);
    await bootstrap.query("insert into assets(id,canonical_owner_user_id,account_id,account,name,ticker,market,currency,asset_type,quantity,current_price,created_at,updated_at) values($1,$2,$3,'brokerage','Synthetic cutoff','CUTUNIT','us','USD','stock',10,100,$4,$4)",[asset,owner,account,openingDate]);
    await bootstrap.query('COMMIT');
  }catch(error){await bootstrap.query('ROLLBACK');throw error;}finally{bootstrap.release();}
  let at=new Date(receipt('21:59:00')),price='105';
  // The combined suite has earlier synthetic holdings: answer every requested test target.
  // The real collector must still enforce complete target coverage; never relax its guard.
  const provider={name:'kis',supportedMarkets:['us'],fetchLiveQuotes:async targets=>({provider:'kis',fetchedAt:at,warnings:[],rows:targets.map(target=>({ticker:target.ticker,market:target.market,currency:target.currency,price,priceAsOf:at,fetchedAt:at,source:'kis_overseas_price:NAS',quoteType:'live',status:'ok'}))})};
  const writePrice=()=>lease.withKisCollectionLease(()=>sync.runMarketPriceSync({mode:'live',dryRun:false,fixture:false,provider,explicitTargets:[{ticker:'CUTUNIT',market:'us',currency:'USD'}]}));
  const writeFx=value=>fx.runUsdKrwFxCandidateJob({dryRun:false,acceptExistingVardaRow:true,candidate:{provider:'kis',pair:'USD/KRW',rateDate:snapshotDate,usdKrw:value,source:'kis_overseas_price_detail:NAS',status:'ok',fetchedAt:at.toISOString()}});
  const snapshot=()=>daily.runDailySnapshot({tenantContext:{ownerUserId:owner},now:new Date(receipt('22:20:00')),dryRun:false,account:'brokerage'});
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
  await check('cutoff-real-daily-writer-concurrency-10-times-105-times-1300-equals-1365000',async()=>{
    gate=true;const results=await Promise.allSettled([snapshot(),snapshot()]);gate=false;
    assert.equal(arrivals,2,'both plans reached real concurrent transactions');
    assert.equal(results.filter(row=>row.status==='fulfilled').length,1);
    assert.equal(results.filter(row=>row.status==='rejected').length,1);
    const rows=(await worker.query('select total_market_value,num_assets from daily_portfolio_snapshots where account_id=$1 and snapshot_date=$2',[account,snapshotDate])).rows;
    assert.equal(rows.length,1);assert.equal(Number(rows[0].total_market_value),1365000);assert.equal(rows[0].num_assets,1);
    const positions=(await worker.query('select quantity,current_price,market_value_krw,fx_rate,description from daily_position_snapshots where account_id=$1 and snapshot_date=$2',[account,snapshotDate])).rows;
    assert.equal(positions.length,1);assert.equal(Number(positions[0].quantity),10);assert.equal(Number(positions[0].current_price),105);
    assert.equal(Number(positions[0].market_value_krw),1365000);assert.equal(Number(positions[0].fx_rate),1300);
  });
  await check('cutoff-completed-record-survives-refresh-retry-and-shared-evidence-prune',async()=>{
    const before=(await worker.query('select to_jsonb(s) data from daily_portfolio_snapshots s where account_id=$1',[account])).rows;
    await worker.query("delete from snapshot_cutoff_price_observations where ticker='CUTUNIT'");
    await worker.query('delete from snapshot_cutoff_fx_observations where snapshot_date=$1',[snapshotDate]);
    const retry=await snapshot();assert.equal(retry.results.brokerage.totalMarketValue,1365000);
    assert.equal(retry.results.brokerage.reason,'completed_cutoff_preserved');
    assert.deepEqual((await worker.query('select to_jsonb(s) data from daily_portfolio_snapshots s where account_id=$1',[account])).rows,before);
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
  report.cutoffConnectionCount=sessions.size;
}
