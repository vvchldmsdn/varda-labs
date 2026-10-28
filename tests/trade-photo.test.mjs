import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTradePhoto, tradePhotoNumber, tradePhotoDate } from '../src/lib/trade-photo.ts';
import { importIssue, preparePhotoTrade, samePhotoTrade, savePhotoTrades, PhotoSaveError, photoOrderingEntries } from '../src/lib/trade-photo-import.ts';
import { applyNativeEvent, projectNativeInvestmentEvent, resolveNativeTrade } from '../src/lib/native-portfolio-ledger.ts';
import { Decimal } from '../src/lib/money.ts';
const line=(text,x,y,w=130)=>({text,confidence:95,bbox:{x0:x,y0:y,x1:x+w,y1:y+25}});
const detail=()=>[line('매수 소수점',50,200),line('마이크로소프트',50,270,300),line('주문일시',50,500),line('2026.10.26 12:47',580,500,300),line('주문수량',50,600),line('0.637204주',700,600),line('체결가격',50,700),line('527.92USD',700,700),line('체결수량',50,800),line('0.633088주',700,800),line('체결금액',50,900),line('334.22USD',700,900),line('결제금액',50,1100),line('467,000원',700,1100)];
test('detail reads actual fill quantity/price, not order quantity or settlement cash',()=>{
 const {rows}=parseTradePhoto([...detail(),line('10월 28일 체결금액의 결제가 완료됩니다.',100,400,700)],1000,2000);assert.equal(rows.length,1);
 assert.deepEqual(rows[0],{label:'마이크로소프트',side:'buy',date:'2026-10-26',quantity:'0.633088',price:'527.92',currency:'USD',gross:'334.22',priceSource:'reported'});
});
test('list derives execution average from fill columns, never uses the limit order price',()=>{
 const result=parseTradePhoto([line('매수 정정',50,200),line('2026.09.21',750,200),line('VXUS',50,270),line('주문',50,450),line('체결수량',450,450),line('체결금액',700,450),line('86.6800USD X 7주',50,500,300),line('7주',450,500),line('606.6900USD',700,500)],1000,2000);
 assert.equal(result.rows[0].price,'86.67');assert.equal(result.rows[0].priceSource,'derived');
});
test('unfilled amended orders and cancelled orders are excluded; held balance is not a fill',()=>{
 const list=[line('매수 정정',50,200),line('VXUS',50,300),line('체결수량',450,450),line('체결금액',700,450),line('0주',450,500),line('0.0000USD',700,500)];
 assert.equal(parseTradePhoto(list,1000,2000).excluded,1);
 assert.equal(parseTradePhoto(detail().map(l=>l.text==='매수 소수점'?{...l,text:'매수 자동취소'}:l),1000,2000).rows.length,0);
 assert.equal(parseTradePhoto([line('보유수량',700,300),line('VOO',50,500),line('6.525621',700,500)],1000,2000).rows.length,0);
});
test('recurring averages and unread numbers stay empty; no rounding or O-to-zero repair',()=>{
 const result=parseTradePhoto([line('매수',50,200),line('VOO',50,300),line('체결수량',450,450),line('체결금액',700,450),line('3주',450,500),line('10.00USD',700,500)],1000,2000);
 assert.equal(result.rows[0].price,'');
 for(const value of ['O.10709','1e5','-1','0','1,23','1.0000001'])assert.equal(tradePhotoNumber(value,6),null);
 assert.equal(tradePhotoDate('2026.02.30'),'');
});
test('multiple cards remain distinct and clipped order-only cards do not become trades',()=>{
 const shifted=detail().map(l=>({...l,bbox:{...l.bbox,y0:l.bbox.y0+1500,y1:l.bbox.y1+1500},text:l.text==='매수 소수점'?'매도 소수점':l.text}));
 assert.deepEqual(parseTradePhoto([...detail(),...shifted],1000,4000).rows.map(r=>r.side),['buy','sell']);
 assert.equal(parseTradePhoto([line('매수',50,100),line('주문수량',450,300),line('3주',450,350)],1000,1000).rows.length,0);
});
const accountId='11111111-1111-4111-8111-111111111111',assetId='22222222-2222-4222-8222-222222222222';
const row=(patch={})=>({key:'r1',operationId:'33333333-3333-4333-8333-333333333333',accountId,assetId,label:'VOO',side:'buy',date:'2026-10-26',quantity:'0.010709',price:'701.263896',currency:'USD',gross:'',priceSource:'reported',verified:true,afterEventId:'',status:'review',...patch});
function context(){return {sessionKey:'a'.repeat(64),serverNow:'2026-10-28T12:00:00Z',canWrite:true,complete:true,entries:[],accounts:[{id:accountId,name:'A',active:true,state:{version:1,accountId,startedAt:'2026-09-01T00:00:00Z',at:'2026-09-01T00:00:00Z',sequence:0,cash:{KRW:'100',USD:'20'},positions:[{assetId,quantity:'1',currency:'USD',costLots:[{amount:'700',currency:'USD',at:'2026-09-01T00:00:00Z',source:'user_native_ledger',remaining:{n:'1',d:'1'}}]}]},assets:[{id:assetId,name:'VOO',ticker:'VOO',quantity:'1',currency:'USD',market:'us',assetType:'etf',archived:false}]}]};}
test('reviewed fractional execution preserves exact product and does not deduct cash',()=>{
 const c=context(),r=row(),m=preparePhotoTrade(r,c,[r]);
 assert.equal(m.event.dateEvidence.precision,'date_only');assert.equal(m.history.notInOpening,true);
 assert.equal(m.event.settlement,undefined);
 assert.equal(resolveNativeTrade(m.event).calculatedConsideration.amount,'7.509835062264');
 const before=JSON.stringify(c.accounts[0].state);
 const buy=applyNativeEvent(c.accounts[0].state,{...m.event,id:'buy',sequence:1,source:'user_native_ledger'});
 assert.equal(buy.ok,true);assert.deepEqual(buy.next.cash,{KRW:'100',USD:'20'});assert.equal(buy.next.positions[0].quantity,'1.010709');assert.deepEqual(buy.cashLegs,[]);
 const sell=applyNativeEvent(buy.next,{...m.event,type:'sell',id:'sell',sequence:2,at:'2026-10-27T10:00:00.000Z',dateEvidence:{...m.event.dateEvidence,reportedDate:'2026-10-27'},source:'user_native_ledger'});
 assert.equal(sell.ok,true);assert.equal(sell.next.positions[0].quantity,'1');assert.deepEqual(sell.next.cash,buy.next.cash);assert.deepEqual(sell.cashLegs,[]);assert.equal(JSON.stringify(c.accounts[0].state),before);
});
test('opening, future dates, missing identity/currency and incomplete history fail closed',()=>{
 for(const [patch,expected] of [[{date:'2026-09-01'},'included_in_opening'],[{date:'2026-10-29'},'invalid_date'],[{assetId:'wrong'},'instrument_required'],[{currency:'KRW'},'currency_mismatch'],[{verified:false},'review_required']])assert.equal(importIssue(row(patch),context()),expected);
 const c=context();c.complete=false;assert.equal(importIssue(row(),c),'incomplete_history');
 c.complete=true;c.accounts[0].state=null;assert.equal(importIssue(row(),c),'opening_required');
});
test('flat-price investment projection keeps buy and sell principal out of profit',()=>{
 const c=context(),r=row(),state=c.accounts[0].state;state.positions[0].costLots[0].amount=r.price;
 const m=preparePhotoTrade(r,c,[r]),event={...m.event,id:'buy',sequence:1,source:'user_native_ledger'};
 const buy=projectNativeInvestmentEvent(state,event);assert.equal(buy.ok,true);
 const cost=lots=>lots.reduce((sum,lot)=>sum.add(Decimal.from(lot.amount).mul(lot.remaining.n).div(lot.remaining.d)),Decimal.from(0));
 assert.equal(Decimal.from(buy.next.positions[0].quantity).mul(r.price).sub(cost(buy.next.positions[0].costLots)).toExactString(),'0');
 const sell=projectNativeInvestmentEvent(buy.next,{...event,type:'sell',id:'sell',sequence:2});assert.equal(sell.ok,true);
 assert.equal(Decimal.from(sell.realized.proceeds.amount).sub(cost(sell.realized.disposedCostLots)).toExactString(),'0');
 assert.deepEqual(sell.next.cash,state.cash);
});
test('duplicates compare exact quantity across screenshots and complete saved history',()=>{
 const a=row(),b=row({key:'r2',operationId:'other',quantity:'0.0107090',price:'701.26'}),c=context();
 assert.equal(samePhotoTrade(a,b),true);assert.equal(importIssue(a,c,[a,b]),'duplicate_photo');
 c.entries=[{id:'old',operationId:'old',accountId,assetId,type:'buy',date:a.date,at:'2026-10-26T10:00:00Z',quantity:a.quantity}];
 assert.equal(importIssue(a,c,[a]),'duplicate_record');
 b.accountId='another';assert.equal(samePhotoTrade(a,b),false);
});
test('same service-day ordering includes overnight exact fills and explicit queued predecessor',()=>{
 const a=row(),b=row({key:'r2',operationId:'other',quantity:'2'}),c=context();
 c.entries=[{id:'night',operationId:'night',accountId,assetId,type:'sell',date:'2026-10-27',at:'2026-10-26T20:00:00Z',quantity:'1'}];
 assert.equal(photoOrderingEntries(a,c.entries).length,1);assert.equal(importIssue(a,c,[a]),'ordering_required');
 c.entries=[];assert.equal(importIssue(b,c,[a,b]),'ordering_required');b.afterEventId='queue:r1';assert.equal(importIssue(b,c,[a,b]),null);
 assert.throws(()=>preparePhotoTrade(b,c,[a,b]),/ordering_required/);
});
function portFixture(failAt=0,definite=false){
 let c=context(),pending=null,posts=[],calls=0;const complete=[];
 return {complete,posts,getPending:()=>pending,context:c,port:{context:async()=>structuredClone(c),pending:()=>pending,remember:p=>{pending=structuredClone(p);},forget:id=>{if(pending?.mutation.operationId===id)pending=null;},lookup:async id=>c.entries.some(e=>e.operationId===id)?'committed':'unconfirmed',post:async m=>{posts.push(structuredClone(m));calls++;if(calls===failAt)throw new PhotoSaveError('unavailable',definite);c.entries.push({id:m.operationId,operationId:m.operationId,accountId,assetId,type:m.event.type,date:m.event.dateEvidence.reportedDate,dateOnly:true,at:m.event.at,quantity:m.event.quantity});c.accounts[0].state.sequence++;}},save:key=>complete.push(key)};
}
test('batch stops after partial success, uncertain retry reuses exact request, then resumes',async()=>{
 const rows=[row(),row({key:'r2',operationId:'44444444-4444-4444-8444-444444444444',date:'2026-10-27',quantity:'2'}),row({key:'r3',operationId:'55555555-5555-4555-8555-555555555555',date:'2026-10-28',quantity:'3'})];
 const f=portFixture(2);await assert.rejects(savePhotoTrades(rows,f.context.sessionKey,f.port,f.save),/unavailable/);
 assert.deepEqual(f.complete,['r1']);assert.equal(f.posts.length,2);assert.ok(f.getPending());
 const retained=structuredClone(f.getPending().mutation);rows[0].status='saved';
 await savePhotoTrades(rows,f.context.sessionKey,f.port,f.save);
 assert.deepEqual(f.posts[2],retained);assert.deepEqual(f.complete,['r1','r2','r3']);assert.equal(f.getPending(),null);assert.equal(f.posts[3].expectedSequence,2);
});
test('complete-on-server unknown-response recovery does not send a second write',async()=>{
 const r=row(),f=portFixture();f.port.remember({sessionKey:f.context.sessionKey,mutation:preparePhotoTrade(r,f.context,[r]),savedAt:Date.now()});
 f.context.entries.push({id:'done',operationId:r.operationId,accountId,assetId,type:'buy',date:r.date,at:'2026-10-26T10:00:00Z',quantity:r.quantity});
 await savePhotoTrades([r],f.context.sessionKey,f.port,f.save);assert.equal(f.posts.length,0);assert.deepEqual(f.complete,['r1']);assert.equal(f.getPending(),null);
});
test('preflight rejects invalid whole queue before any write; another pending trade blocks it',async()=>{
 const f=portFixture();await assert.rejects(savePhotoTrades([row(),row({key:'r2',operationId:'other',verified:false,quantity:'2'})],f.context.sessionKey,f.port,f.save),/review_required/);assert.equal(f.posts.length,0);
 f.port.remember({sessionKey:f.context.sessionKey,mutation:{operationId:'another'},savedAt:Date.now()});
 await assert.rejects(savePhotoTrades([row()],f.context.sessionKey,f.port,f.save),/recovery_pending/);assert.equal(f.posts.length,0);
});
test('session switch prevents all writes; definitive rejection clears only its pending request',async()=>{
 const f=portFixture(1,true);await assert.rejects(savePhotoTrades([row()],'different',f.port,f.save),/account_changed/);assert.equal(f.posts.length,0);
 await assert.rejects(savePhotoTrades([row()],f.context.sessionKey,f.port,f.save),/unavailable/);assert.equal(f.getPending(),null);assert.equal(f.complete.length,0);
});
