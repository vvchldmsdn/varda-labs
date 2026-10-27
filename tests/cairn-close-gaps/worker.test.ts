import assert from 'node:assert/strict';
import {syncMissingRawCloses} from '../../src/lib/market-data/close-gap-sync';
import type {MarketDataProvider,ClosePrice} from '../../src/lib/market-data/providers/types';
import type {ClaimedCollectionJob} from '../../src/lib/market-data/collection-queue';
declare global { var gapTest: {dates:Set<string>;writes:string[];claimed:boolean}; }
async function main(){
 globalThis.gapTest={dates:new Set(['2026-10-08']),writes:[],claimed:true};
 const job={key:'kis:history:raw_close_v1:us:USD:VOO:2026-10-08:2026-10-12',kind:'history',market:'us',currency:'USD',ticker:'VOO',startDate:'2026-10-08',endDate:'2026-10-12',attempts:1,claimToken:'test'} as ClaimedCollectionJob;
 const row=(date:string,ticker='VOO')=>({ticker,market:'us',currency:'USD',priceDate:date,closePrice:'100',status:'ok'}) as ClosePrice;
 let response=[row('2026-10-08'),row('2026-10-09'),row('2026-10-11'),row('2026-10-12','MSFT')],requests=0;
 const provider:MarketDataProvider={name:'kis',supportedMarkets:['us'],
 async fetchLiveQuotes(){throw Error('unexpected live fetch');},async fetchClosePrices(){throw Error('unexpected close fetch');},
 async fetchHistoricalClosePrices(){requests++;return {provider:'kis',priceBasis:'raw_price_return',rows:response,failures:[],warnings:[],requestCount:1,fetchedAt:new Date()};}};
 assert.equal((await syncMissingRawCloses(job,provider)).complete,false);
 assert.deepEqual(gapTest.writes,['2026-10-09']); // no weekend, duplicate or wrong ticker writes
 response=[row('2026-10-12')];assert.equal((await syncMissingRawCloses(job,provider)).complete,true);
 assert.equal((await syncMissingRawCloses(job,provider)).insertedCount,0);assert.equal(requests,2);
 gapTest.dates.delete('2026-10-12');gapTest.claimed=false;
 await assert.rejects(syncMissingRawCloses(job,provider),/claim_expired/);assert.equal(gapTest.writes.length,2);
 console.log('PASS: partial provider result retries, exact identity/date, idempotency, expired lease prevents write');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
