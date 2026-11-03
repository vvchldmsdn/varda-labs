import assert from 'node:assert/strict';
import {it} from 'node:test';
import {importWithPorts} from './helpers/import-with-ports.mjs';
async function fixture(){
 const calls=[];let failLive=false;let price='100';let enabled=true;
 const evidence=q=>{if(failLive&&q.kind==='live')throw Error('isolated failure');return {status:'admitted',refreshDue:false,prices:q.kind==='live'?[{value:price}]:[],fx:q.kind==='fx'?[{rate:'1300'}]:[]};};
 const [module]=await importWithPorts(['src/lib/market-data/manual-native-quotes.ts'],{'./twelve-data-service':{
  getTwelveDataServerConfig:()=>enabled?{provider:{audience:'member_display'}}:undefined,
  resolveTwelveDataTarget:t=>t.market==='us'?{status:'resolved',target:{key:t.ticker,ticker:t.ticker}}:{status:'unsupported'},
  readTwelveDataEvidence:async q=>{calls.push(['read',q]);return evidence(q);},
  requestTwelveDataEvidence:async q=>{calls.push(['collect',q]);return evidence(q);},
 }, './twelve-data-collection':{getTwelveDataCollectionJobs:()=>[]}, './collection-queue':{readCollectionProgress:async()=>[]}});
 return {run:module.manualNativeQuotes,calls,set fail(v){failLive=v},set price(v){price=v},set enabled(v){enabled=v}};
}
it('deduplicates owned instruments and polls without new demand; quote changes alter receipt',async()=>{
 const f=await fixture(),targets=[{ticker:'VOO',market:'us',currency:'USD'},{ticker:'VOO',market:'us',currency:'USD'}];
 const first=await f.run(targets,true);assert.equal(f.calls.length,2);assert.ok(f.calls.every(c=>c[0]==='collect'));
 f.calls.length=0;assert.equal((await f.run(targets,false)).version,first.version);assert.ok(f.calls.every(c=>c[0]==='read'));
 f.price='101';assert.notEqual((await f.run(targets,false)).version,first.version);
});
it('requests reviewed FX for KRW-only or cash-only views and isolates one failed instrument',async()=>{
 const f=await fixture();await f.run([{ticker:'069500',market:'korea',currency:'KRW'}],true);assert.equal(f.calls[0][1].kind,'fx');
 f.calls.length=0;await f.run([],true);assert.equal(f.calls[0][1].kind,'fx');
 f.fail=true;const result=await f.run([{ticker:'VOO',market:'us',currency:'USD'}],true);assert.equal(result.failed,true);assert.equal(result.available,true);
 f.enabled=false;f.calls.length=0;await f.run([],true);assert.equal(f.calls.length,0);
});
it('keeps cache evidence fresh at the explicit start complete throughout a slow queue',async()=>{
 const startedAt=new Date(Date.now()-600_000).toISOString(), checkedAt=new Date(Date.parse(startedAt)-10_000).toISOString();
 const [module]=await importWithPorts(['src/lib/market-data/manual-native-quotes.ts'],{
  './twelve-data-service':{requestTwelveDataEvidence:async()=>{throw Error('poll must not admit new work')},getTwelveDataServerConfig:()=>({provider:{audience:'member_display'},storage:{fxFreshSeconds:60,quoteFreshSeconds:60}}),resolveTwelveDataTarget:()=>({status:'unsupported'}),
   readTwelveDataEvidence:async()=>({status:'stale',refreshDue:true,checkedAt,fx:[{rate:'1300',fetchedAt:'2026-01-01T00:00:00Z',observedAt:'2026-01-01T00:00:00Z'}],prices:[]})},
  './twelve-data-collection':{getTwelveDataCollectionJobs:()=>[]},'./collection-queue':{readCollectionProgress:async()=>[]}});
 const result=await module.manualNativeQuotes([],false,startedAt);
 assert.equal(result.items[0].state,'ready');assert.equal(result.items[0].checkedAt,checkedAt);
 assert.equal(result.items[0].priceAsOf,'2026-01-01T00:00:00Z');
});
