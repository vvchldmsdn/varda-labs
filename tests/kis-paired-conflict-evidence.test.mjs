import {it} from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import {writeKisPairedHistory} from '../src/lib/market-data/kis-paired-history-write.ts';
it('persists the existing and candidate raw evidence in the same paired-write statement',async()=>{
 const db=new PGlite();try{
 await db.exec(`create table market_collection_jobs(key text,claim_token uuid,status text,leased_until timestamptz,ticker text,market text,currency text,start_date date,end_date date);
 create table asset_price_snapshots(id serial,ticker text,market text,currency text,date date,close_price numeric,adjusted_close_price numeric,adjusted_close_basis text,adjusted_close_provider text,adjusted_close_source text,adjusted_close_fetched_at timestamptz,provider_symbol text,provider_exchange text,fetched_at timestamptz,source text,is_sample boolean,unique(market,currency,ticker,date));
 create table market_data_sync_runs(id serial,job_type text,mode text,status text,started_at timestamptz,finished_at timestamptz,source text,requested_count int,failed_count int,metadata_json jsonb);`);
 const claim={key:'kis:history:paired_v1:test',claimToken:'11111111-1111-4111-8111-111111111111'};
 await db.query("insert into market_collection_jobs values($1,$2,'running',now()+interval '1 hour','SYN','us','USD','2026-08-01','2026-08-01')",[claim.key,claim.claimToken]);
 const row={ticker:'SYN',market:'us',currency:'USD',priceDate:'2026-08-01',closePrice:'100',adjustedClosePrice:'99',adjustedCloseBasis:'provider_adjusted_close_v1',adjustedCloseProvider:'kis',adjustedCloseSource:'kis_overseas_dailyprice:NAS:adjusted_v1',adjustedCloseFetchedAt:new Date('2026-08-02'),providerSymbol:'SYN',providerExchange:'NAS',fetchedAt:new Date('2026-08-02'),source:'kis_overseas_dailyprice:NAS:raw_v2',status:'ok',isSample:false};
 const query=async(q,p)=>(await db.query(q,p)).rows;
 assert.equal((await writeKisPairedHistory(query,claim,[row])).insertedCount,1);
 const mismatch=await writeKisPairedHistory(query,claim,[{...row,closePrice:'101'}]);assert.equal(mismatch.conflictCount,1);assert.equal(mismatch.results[0].reason,'raw_price_mismatch');
 const evidence=(await db.query('select metadata_json from market_data_sync_runs')).rows[0].metadata_json.comparisons[0];assert.equal(Number(evidence.existing.closePrice),100);assert.equal(Number(evidence.candidate.closePrice),101);assert.equal(evidence.existing.providerSymbol,'SYN');assert.equal(evidence.existing.providerExchange,'NAS');
 assert.equal(Number((await db.query('select close_price from asset_price_snapshots')).rows[0].close_price),100);
 await db.query("update market_collection_jobs set leased_until=now()-interval '1 second'");assert.equal((await writeKisPairedHistory(query,claim,[row])).failedCount,1);assert.equal((await db.query('select * from market_data_sync_runs')).rows.length,1);
 }finally{await db.close();}
});
