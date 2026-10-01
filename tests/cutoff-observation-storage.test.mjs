import assert from 'node:assert/strict';
import { after, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { importWithPorts } from './helpers/import-with-ports.mjs';
import { resolveSnapshotCycle } from '../src/lib/snapshots/market-calendar.ts';

const pg = new PGlite();
// Keep fixed financial inputs, but place receipts within the real DB's retention
// window so this integration remains valid when executed in later months.
const snapshotDate=new Date(Date.now()-2*86400000).toISOString().slice(0,10);
const receiptDate=new Date(Date.parse(`${snapshotDate}T00:00:00Z`)-86400000).toISOString().slice(0,10);
const receipt=time=>`${receiptDate}T${time}Z`;
let runtime;
after(() => pg.close());
it('actual cache writer preserves the 06:59 evidence after a 07:20 refresh', async () => {
  await pg.exec('CREATE ROLE varda_tenant_app');
  const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
  for (const {tag} of journal.entries) await pg.exec(readFileSync(`drizzle/${tag}.sql`, 'utf8'));
  const sqlClient = { query: async (text, params=[]) => (await pg.query(text, params)).rows,
    transaction: build => pg.transaction(async tx => {
      const results=[];
      for (const q of build({query:(text,params=[])=>({text,params})})) results.push((await tx.query(q.text,q.params)).rows);
      return results;
    }) };
  const [sync, lease, reader] = await importWithPorts([
    'src/lib/market-data/price-sync.ts', 'src/lib/market-data/kis-refresh-lease.ts',
    'src/db/queries/snapshot-cutoff-observations.ts',
  ], {'@/db/client':{db:drizzle(pg),sqlClient}});
  const [fx] = await importWithPorts(['src/lib/market-data/fx-refresh-job.ts'], {'@/db/client':{db:drizzle(pg),sqlClient}});
  runtime={reader,fx,sqlClient};
  let at = new Date(receipt('21:59:00')), price='105.000000000001';
  const provider = {name:'kis',supportedMarkets:['us'],fetchLiveQuotes:async()=>({provider:'kis',fetchedAt:at,warnings:[],rows:[{
    ticker:'UNIT',market:'us',currency:'USD',price,priceAsOf:at,fetchedAt:at,source:'kis_overseas_price:NAS',quoteType:'live',status:'ok',
  }]})};
  const write=()=>lease.withKisCollectionLease(()=>sync.runMarketPriceSync({mode:'live',dryRun:false,fixture:false,provider,explicitTargets:[{ticker:'UNIT',market:'us',currency:'USD'}]}));
  assert.equal((await write()).status,'completed');
  at = new Date(receipt('22:20:00')); price='110';
  assert.equal((await write()).status,'completed');
  const evidence=await reader.readSnapshotCutoffObservations(snapshotDate);
  assert.equal(evidence.quotes[0]?.price,'105.000000000001');
  assert.equal(evidence.quotes[0].observedAt,null);
  assert.equal(evidence.quotes[0].timestampBasis,'collection');
  assert.equal(Number((await pg.query("select price from live_price_quotes where ticker='UNIT'")).rows[0].price),110);
});

it('actual FX writer preserves unchanged and replaced receipts without inventing provider time', async () => {
  const candidate={provider:'kis',pair:'USD/KRW',rateDate:snapshotDate,usdKrw:'1300.123456',source:'kis_overseas_price_detail:NAS',status:'ok',fetchedAt:receipt('21:58:00')};
  const write=value=>runtime.fx.runUsdKrwFxCandidateJob({candidate:value,dryRun:false,acceptExistingVardaRow:true});
  assert.equal((await write(candidate)).status,'written');
  assert.equal((await write({...candidate,fetchedAt:receipt('21:59:00')})).status,'skipped');
  assert.equal((await write({...candidate,usdKrw:'1310',fetchedAt:receipt('22:20:00')})).status,'written');
  const {fxRows}=await runtime.reader.readSnapshotCutoffObservations(snapshotDate);
  assert.equal(fxRows.length,2);assert.equal(fxRows[0].usdKrw,'1300.123456');
  assert.equal(fxRows[0].providerObservedAt,null);assert.equal(fxRows[0].providerRateKind,null);
  assert.equal(fxRows[0].timestampBasis,'collection');assert.equal(fxRows[0].observedAt.toISOString(),receipt('21:59:00.000'));
  assert.equal(Number((await pg.query('select usdkrw from fx_rates where date=$1',[snapshotDate])).rows[0].usdkrw),1310);
});

it('cutoff archive keeps the latest 32 unique receipts and includes exactly 07:00', async () => {
  const insert=at=>pg.query("insert into live_price_quotes(ticker,market,currency,provider,source,quote_type,status,price,price_as_of,fetched_at) values('BOUND','us','USD','kis','kis_overseas_price:NAS','live','ok',105,$1,$1) on conflict(market,ticker,provider) do update set fetched_at=excluded.fetched_at,price_as_of=excluded.price_as_of",[at]);
  for(let i=0;i<35;i++) await insert(new Date(Date.parse(receipt('21:45:00'))+i*1000).toISOString());
  await insert(receipt('22:00:00'));await insert(receipt('22:00:00'));
  await insert(receipt('22:00:00.001'));
  const rows=(await runtime.reader.readSnapshotCutoffObservations(snapshotDate)).quotes.filter(row=>row.ticker==='BOUND');
  assert.equal(rows.length,32);assert.equal(rows[0].fetchedAt.toISOString(),receipt('22:00:00.000'));
  assert.equal(rows.at(-1).fetchedAt.toISOString(),receipt('21:45:04.000'));
});

it('immutable receipts roll back with their cache write and reject tenant access', async () => {
  const before=(await pg.query('select count(*)::int n from snapshot_cutoff_price_observations')).rows[0].n;
  await assert.rejects(pg.transaction(async tx=>{
    await tx.query("update live_price_quotes set fetched_at=$1 where ticker='UNIT'",[receipt('21:59:30')]);
    await tx.query('select 1/0');
  }));
  assert.equal((await pg.query('select count(*)::int n from snapshot_cutoff_price_observations')).rows[0].n,before);
  await assert.rejects(pg.query('update snapshot_cutoff_price_observations set price=999'),/cutoff_observation_immutable/);
  await assert.rejects(pg.transaction(async tx=>{await tx.exec('SET LOCAL ROLE varda_tenant_app');await tx.query('select * from snapshot_cutoff_price_observations');}),/permission denied/);
  await assert.rejects(pg.transaction(async tx=>{await tx.exec('SET LOCAL ROLE varda_tenant_app');await tx.query("select record_snapshot_cutoff_fx('kis_overseas_price_detail:NAS','2026-09-25',1300,null,null,'2026-09-24T21:59:00Z')");}),/permission denied/);
});

it('no cache history is fabricated outside the receipt window or from an unapproved provider', async () => {
  for(const [ticker,provider,at] of [['EARLY','kis',receipt('21:44:59.999')],['LATE','kis',receipt('22:20:00')],['OTHER','unapproved',receipt('21:59:00')]]) await pg.query("insert into live_price_quotes(ticker,market,currency,provider,source,quote_type,status,price,fetched_at) values($1,'us','USD',$2,'kis_overseas_price:NAS','live','ok',100,$3)",[ticker,provider,at]);
  const rows=(await runtime.reader.readSnapshotCutoffObservations(snapshotDate)).quotes;
  assert.equal(rows.filter(row=>['EARLY','LATE','OTHER'].includes(row.ticker)).length,0);
  await assert.rejects(runtime.reader.readSnapshotCutoffObservations('2026-02-31'),/invalid_snapshot_date/);
});

it('unchanged FX collection refreshes only a matching receipt and rejects an older racing response', async () => {
  const candidate={provider:'kis',pair:'USD/KRW',rateDate:snapshotDate,usdKrw:'1310',source:'kis_overseas_price_detail:NAS',status:'ok',fetchedAt:receipt('22:21:00')};
  const before=(await runtime.reader.readSnapshotCutoffObservations(snapshotDate)).fxRows;
  const write=value=>runtime.fx.runUsdKrwFxCandidateJob({candidate:value,dryRun:false,acceptExistingVardaRow:true,refreshUnchangedReceipt:true});
  assert.equal((await write(candidate)).status,'skipped');
  const stored=(await pg.query('select usdkrw,fetched_at,observed_at from fx_rates where date=$1',[snapshotDate])).rows[0];
  assert.equal(Number(stored.usdkrw),1310);assert.equal(new Date(stored.fetched_at).toISOString(),receipt('22:21:00.000'));assert.equal(stored.observed_at,null);
  await assert.rejects(write({...candidate,fetchedAt:receipt('22:20:30')}),/fx_receipt_changed/);
  assert.deepEqual((await pg.query('select usdkrw,fetched_at,observed_at from fx_rates where date=$1',[snapshotDate])).rows[0],stored);
  assert.deepEqual((await runtime.reader.readSnapshotCutoffObservations(snapshotDate)).fxRows,before);
});

it('durable FX worker refreshes an unchanged receipt once, then reuses it without another provider call', async () => {
  const rateDate=resolveSnapshotCycle(new Date()).snapshotDate;
  const staleReceipt=new Date(Date.now()-600_000).toISOString();
  const candidate={provider:'kis',pair:'USD/KRW',rateDate,usdKrw:'1320',source:'kis_overseas_price_detail:NAS',status:'ok',fetchedAt:staleReceipt};
  assert.equal((await runtime.fx.runUsdKrwFxCandidateJob({candidate,dryRun:false,acceptExistingVardaRow:true})).status,'written');
  let providerCalls=0, fetchedAt=null, providerFailure=false;
  const [queue,worker]=await importWithPorts(['src/lib/market-data/collection-queue.ts','src/lib/market-data/collection-worker.ts'],{
    'next/server':{after:()=>assert.fail('This fixture drains the worker directly')},
    '@/db/client':{db:drizzle(pg),sqlClient:runtime.sqlClient},
    '@/lib/market-data/providers/kis':{
      getKisProviderPolicy:()=>({configured:true}),createKisProviderRequestSession:()=>({}),createKisMarketDataProvider:()=>({}),
      fetchKisUsdKrwFxCandidate:async input=>{
        providerCalls++;
        if(providerFailure) throw new Error('fixture_provider_failure');
        fetchedAt=input.fetchedAt.toISOString();
        return {...candidate,rateDate:input.rateDate,fetchedAt};
      },
    },
    '@/lib/market-data/kis-refresh-lease':{KisRefreshLeaseBusyError:class extends Error{},withKisCollectionLease:task=>task()},
    '@/lib/market-data/provider-budget':{withKisCollectionDeadline:task=>task()},
    '@/lib/market-data/price-sync':{runMarketPriceSync:()=>assert.fail('No live job was enqueued')},
    '@/lib/market-data/kis-history-cache-sync':{runKisHistoryCacheSync:()=>assert.fail('No history job was enqueued')},
    '@/lib/market-data/fx-refresh-job':{runUsdKrwFxCandidateJob:runtime.fx.runUsdKrwFxCandidateJob},
    '@/lib/market-data/latest-close-revalidation':{revalidateLatestClose:()=>assert.fail('No live job was enqueued')},
    '@/lib/market-data/twelve-data-service':{resumeConfiguredTwelveDataService:()=>assert.fail('No other provider is used')},
  });
  const target={kind:'fx',ticker:'VOO',market:'us',currency:'USD'};
  await queue.enqueueMarketCollection([target]);
  let result=await worker.drainMarketCollection();
  assert.equal(result.failed,0);assert.equal(result.processed,1);assert.equal(result.cacheHits,0);assert.equal(providerCalls,1);
  const stored=(await pg.query('select usdkrw,fetched_at,observed_at,rate_kind from fx_rates where date=$1',[rateDate])).rows[0];
  assert.equal(Number(stored.usdkrw),1320);assert.equal(stored.fetched_at.toISOString(),fetchedAt);
  assert.equal(stored.observed_at,null);assert.equal(stored.rate_kind,null);
  await queue.enqueueMarketCollection([target]);
  result=await worker.drainMarketCollection();
  assert.equal(result.failed,0);assert.equal(result.cacheHits,1);assert.equal(providerCalls,1);
  assert.equal((await pg.query("select last_code from market_collection_jobs where key='kis:fx:USD:KRW'")).rows[0].last_code,'cache_fresh');

  // A failed recheck must neither refresh the receipt nor mark its job collected.
  await pg.query('update fx_rates set fetched_at=$1 where date=$2',[staleReceipt,rateDate]);
  providerFailure=true;
  await queue.enqueueMarketCollection([target]);
  result=await worker.drainMarketCollection();
  assert.equal(result.failed,1);assert.equal(providerCalls,2);
  assert.equal((await pg.query('select fetched_at from fx_rates where date=$1',[rateDate])).rows[0].fetched_at.toISOString(),staleReceipt);
  assert.equal((await pg.query("select status from market_collection_jobs where key='kis:fx:USD:KRW'")).rows[0].status,'pending');
});
