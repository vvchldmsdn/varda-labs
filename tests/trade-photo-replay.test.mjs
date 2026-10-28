import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { applyNativeEvent } from '../src/lib/native-portfolio-ledger.ts';
import { preparePhotoTrade, photoImportEntries } from '../src/lib/trade-photo-import.ts';
// Compile the existing replay module without changing its import conventions or starting a DB.
const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/lib/native-ledger-replay.ts',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm'});
const {replayNativeTrade}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].contents).toString('base64'));
function fixture(){
 const accountId='11111111-1111-4111-8111-111111111111',assetId='22222222-2222-4222-8222-222222222222';
 const opening={version:1,accountId,startedAt:'2026-09-01T00:00:00Z',at:'2026-09-01T00:00:00Z',sequence:0,cash:{KRW:'0',USD:'0'},positions:[{assetId,currency:'USD',quantity:'1',costLots:null}]};
 const event={id:'old-buy',sequence:1,source:'user_native_ledger',type:'buy',assetId,quantity:'1',currency:'USD',price:'700',settlementStatus:'unconfirmed',at:'2026-10-27T10:00:00.000Z',dateEvidence:{precision:'date_only',reportedDate:'2026-10-27',timeZone:'Asia/Seoul',policy:'service_day_midpoint'}};
 const applied=applyNativeEvent(opening,event);assert.equal(applied.ok,true);
 const entries=[{id:'opening',operationId:'opening',accountId,data:{event:{type:'opening',at:opening.at},state:opening,effect:null}},{id:event.id,operationId:event.id,accountId,data:{event,state:applied.next,effect:applied}}];
 const account={id:accountId,name:'A',active:true,state:applied.next,assets:[{id:assetId,quantity:'2',name:'VOO',ticker:'VOO',currency:'USD',market:'us',assetType:'etf',archived:false}]};
 const context={sessionKey:'a'.repeat(64),serverNow:'2026-10-28T12:00:00Z',canWrite:true,complete:true,accounts:[account],entries:photoImportEntries(entries)};
 const row={key:'new',operationId:'33333333-3333-4333-8333-333333333333',accountId,assetId,label:'VOO',side:'buy',date:'2026-10-26',quantity:'2',price:'701.263896',currency:'USD',gross:'',priceSource:'reported',verified:true,afterEventId:'',status:'review'};
 return {context,entries,account,row};
}
test('photo history import replays later trades while preserving original rows and cash',()=>{
 const f=fixture(),before=JSON.stringify(f),m=preparePhotoTrade(f.row,f.context,[f.row]);
 const [replay]=replayNativeTrade([f.account],f.entries,m);
 assert.equal(replay.next.positions[0].quantity,'4');assert.deepEqual(replay.next.cash,{KRW:'0',USD:'0'});
 assert.equal(replay.effective.length,3);assert.equal(replay.effective.at(-1).id,'old-buy');assert.equal(JSON.stringify(f),before);
});
test('overselling at the historical date rejects even if a later purchase exists',()=>{
 const f=fixture();f.row.side='sell';f.row.quantity='2';
 const m=preparePhotoTrade(f.row,f.context,[f.row]);
 assert.throws(()=>replayNativeTrade([f.account],f.entries,m),/historical_replay_invalid/);
 assert.equal(f.account.state.positions[0].quantity,'2');
});
test('same-day date-only photo can follow the explicitly selected existing trade',()=>{
 const f=fixture();f.row.date='2026-10-27';f.row.afterEventId='old-buy';
 const [replay]=replayNativeTrade([f.account],f.entries,preparePhotoTrade(f.row,f.context,[f.row]));
 assert.deepEqual(replay.effective.map(e=>e.id),['opening','old-buy',f.row.operationId]);assert.equal(replay.next.positions[0].quantity,'4');
});
