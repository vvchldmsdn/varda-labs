import assert from 'node:assert/strict';
import { it } from 'node:test';
import { refreshItem, refreshProgress, refreshProgressState } from '../src/lib/market-data/quote-refresh-progress.ts';
import { importWithPorts } from './helpers/import-with-ports.mjs';
const startedAt='2026-11-03T00:00:00.000Z', now=Date.parse(startedAt)+600_000;
const base={id:'kis:VOO',label:'VOO',provider:'KIS',startedAt,now,valid:true,fresh:false,priceAsOf:'2026-11-02T20:00:00Z'};
it('keeps an eight-instrument operation queued until the last work item reaches a terminal result',()=>{
 const rows=Array.from({length:8},(_,index)=>refreshItem({...base,id:String(index),fresh:index<3,job:index<3?undefined:{status:'pending'}}));
 let progress=refreshProgress(rows);assert.equal(progress.completed,3);assert.equal(progress.pending,5);assert.equal(refreshProgressState(progress),'queued');
 for(let index=3;index<8;index++) rows[index]=refreshItem({...base,id:String(index),job:{status:'done',completedAt:'2026-11-03T00:09:00Z'}});
 progress=refreshProgress(rows);assert.equal(progress.completed,8);assert.equal(refreshProgressState(progress),'fresh');
 assert.equal(rows[7].priceAsOf,base.priceAsOf,'market-close price time is never replaced by check time');
});
it('shows provider delay, running, exhausted failure and missing admission separately without synthetic success',()=>{
 assert.equal(refreshItem({...base,job:{status:'pending',availableAt:'2026-11-03T00:11:00Z'}}).state,'delayed');
 assert.equal(refreshItem({...base,job:{status:'running'}}).state,'running');
 assert.equal(refreshItem({...base,job:{status:'failed'}}).state,'failed');
 assert.equal(refreshItem({...base,fresh:true,job:{status:'pending'}}).state,'pending','partial live write does not complete the queued close check');
 assert.equal(refreshItem({...base,fresh:true,job:{status:'failed'}}).state,'failed');
 assert.equal(refreshItem({...base,valid:false,readAt:'2026-11-03T00:08:59Z',job:{status:'done',completedAt:'2026-11-03T00:09:00Z'}}).state,'running','a worker completing between reads requires a newer evidence read');
 assert.equal(refreshItem(base).state,'unavailable');
 assert.equal(refreshItem({...base,valid:false,job:{status:'done',completedAt:'2026-11-03T00:09:00Z'}}).state,'unavailable');
 assert.equal(refreshItem({...base,job:{status:'done',completedAt:'2026-11-02T00:00:00Z'}}).state,'unavailable');
 const partial=refreshProgress([refreshItem({...base,fresh:true}),refreshItem({...base,job:{status:'failed'}})]);
 assert.equal(refreshProgressState(partial),'partial');assert.equal(partial.failed,1);
});
it('reads only exact server-resolved job keys and never broad queue counts',async()=>{
 const calls=[];
 const [module]=await importWithPorts(['src/lib/market-data/collection-queue.ts'],{'@/db/client':{sqlClient:{query:async(sql,args)=>{calls.push({sql,args});return [{key:'kis:live:us:USD:VOO::',status:'pending',attempts:2,available_at:'2026-11-03T00:11:00Z'}];}}}});
 assert.deepEqual(await module.readCollectionProgress([]),[]);assert.equal(calls.length,0);
 const rows=await module.readCollectionProgress(['kis:live:us:USD:VOO::']);
 assert.match(calls[0].sql,/where key=any\(\$1::text\[\]\)/);assert.deepEqual(calls[0].args,[['kis:live:us:USD:VOO::']]);assert.equal(rows[0].status,'pending');
 await assert.rejects(module.readCollectionProgress(['anything%']),/identity_invalid/);
});
