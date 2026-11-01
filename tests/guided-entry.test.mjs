import assert from 'node:assert/strict';
import {test} from 'node:test';
import {importWithPorts} from './helpers/import-with-ports.mjs';
import {createNativePortfolioState,applyNativeEvent,projectNativeInvestmentEvent,resolveNativeTrade,nativeCostAmounts} from '../src/lib/native-portfolio-ledger.ts';
import {investmentEventKey} from '../src/lib/native-investment-basis.ts';
import {tradeEntryKey,saveTradeEntry,readTradeEntry,clearTradeEntry} from '../src/lib/trade-entry-draft.ts';
const [input] = await importWithPorts(['src/components/native-trade-input.ts'],{});
const at='2026-10-01T00:00:00Z';
const opening=()=>createNativePortfolioState({accountId:'account',at,cash:{KRW:'0',USD:'0'},positions:[]}).state;
const fill=(type,quantity,total)=>({id:'fill',sequence:1,at:'2026-10-02T00:00:00Z',source:'synthetic',...input.tradeInputFromFields(type,{inputMode:'execution_total',quantity,executionTotal:total,memo:'실제 체결 확인'},'USD','asset')});
test('total-only fractional execution preserves exact consideration without price or cash fabrication',()=>{
  const event=fill('buy','0.896567','628.91');
  assert.equal(event.price,undefined);assert.equal(event.settlement,undefined);assert.equal(event.settlementStatus,'unconfirmed');
  assert.equal(event.memo,'실제 체결 확인');
  assert.equal(resolveNativeTrade(event).executionUnitPrice,null);
  const durable=applyNativeEvent(opening(),event),projection=projectNativeInvestmentEvent(opening(),event);
  assert.equal(durable.ok,true);assert.equal(projection.ok,true);
  assert.deepEqual(durable.cashLegs,[]);assert.deepEqual(durable.next.cash,{KRW:'0',USD:'0'});
  assert.equal(durable.next.positions[0].quantity,'0.896567');
  assert.equal(nativeCostAmounts(projection.next.positions[0].costLots)[0].amount.toExactString(),'628.91');
});
test('total-only proportional sale uses actual proceeds and retains unknown basis',()=>{
  const buy=projectNativeInvestmentEvent(opening(),fill('buy','2','100')).next;
  const sale=projectNativeInvestmentEvent(buy,{...fill('sell','1','60'),id:'sale',sequence:2});
  assert.equal(sale.ok,true);assert.equal(sale.realized.proceeds.amount,'60');
  assert.equal(nativeCostAmounts(sale.realized.disposedCostLots)[0].amount.toExactString(),'50');
  const unknown=structuredClone(buy);unknown.positions[0].costLots=null;
  assert.equal(projectNativeInvestmentEvent(unknown,{...fill('sell','1','60'),id:'unknown-sale',sequence:2}).realized.disposedCostLots,null);
});
test('execution total rejects mixed currencies, conflicts, nonpositive values and oversells',()=>{
  const event=fill('buy','2','100');
  for(const changed of [{executionTotal:{amount:'100',currency:'KRW'}},{price:'60'},{settlementStatus:undefined},{executionTotal:{amount:'0',currency:'USD'}},{memo:'x'.repeat(301)}]) assert.throws(()=>resolveNativeTrade({...event,...changed}));
  assert.equal(resolveNativeTrade({...event,price:'50'}).calculatedConsideration.amount,'100');
  const buy=applyNativeEvent(opening(),event).next;
  assert.equal(applyNativeEvent(buy,{...fill('sell','2.000001','100'),sequence:2}).reason,'insufficient_quantity');
});
test('changing total changes economic identity while memo changes do not',()=>{
  const event=fill('buy','2','100');
  assert.notEqual(investmentEventKey(event),investmentEventKey({...event,executionTotal:{amount:'200',currency:'USD'}}));
  assert.equal(investmentEventKey(event),investmentEventKey({...event,memo:'changed note'}));
});
test('unsubmitted drafts resume exact inputs only for their subject and scope, and expire',()=>{
  const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
  const key=tradeEntryKey('a'.repeat(64),{accountId:'A',assetId:'VOO',action:'buy'});
  const draft={at:1000,accountId:'A',kind:'buy',fields:{assetId:'VOO',quantity:'0.896567',price:'701.263896',memo:'draft'}};
  assert.equal(saveTradeEntry(storage,key,draft),true);assert.deepEqual(readTradeEntry(storage,key,1001),draft);
  assert.equal(readTradeEntry(storage,tradeEntryKey('b'.repeat(64),{accountId:'A',assetId:'VOO',action:'buy'}),1001),null);
  assert.equal(readTradeEntry(storage,tradeEntryKey('a'.repeat(64),{accountId:'B',assetId:'VOO',action:'buy'}),1001),null);
  assert.equal(readTradeEntry(storage,key,86401001),null);assert.equal(map.size,0);
  saveTradeEntry(storage,key,draft);clearTradeEntry(storage,key);assert.equal(map.size,0);
  assert.equal(saveTradeEntry(null,key,draft),false);
});

test('correction draft retains a separate owner-scoped original through reload',()=>{const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};const key=tradeEntryKey('a'.repeat(64),{accountId:'A',action:'buy'});const draft={at:1000,accountId:'A',kind:'sell',fields:{replaces:'old',quantity:'1'},suspended:{kind:'buy',fields:{quantity:'0.896567',price:'701.263896',memo:'new'}}};assert.equal(saveTradeEntry(storage,key,draft),true);assert.deepEqual(readTradeEntry(storage,key,1001),draft);assert.equal(readTradeEntry(storage,tradeEntryKey('b'.repeat(64),{accountId:'A',action:'buy'}),1001),null);draft.suspended.fields.replaces='bad';saveTradeEntry(storage,key,draft);assert.equal(readTradeEntry(storage,key,1001),null);});
