import assert from 'node:assert/strict';
import {test} from 'node:test';
import {importWithPorts} from './helpers/import-with-ports.mjs';
import {createNativePortfolioState,applyNativeEvent,projectNativeInvestmentEvent,resolveNativeTrade,nativeCostAmounts} from '../src/lib/native-portfolio-ledger.ts';
import {investmentEventKey} from '../src/lib/native-investment-basis.ts';
import {tradeEntryKey,saveTradeEntry,readTradeEntry,clearTradeEntry} from '../src/lib/trade-entry-draft.ts';
import {editLedgerDraft,freshLedgerKindDraft} from '../src/lib/ledger-form-draft.ts';
const [input] = await importWithPorts(['src/components/native-trade-input.ts'],{});
const at='2026-10-01T00:00:00Z';
const opening=()=>createNativePortfolioState({accountId:'account',at,cash:{KRW:'0',USD:'0'},positions:[]}).state;
const fill=(type,quantity,total)=>({id:'fill',sequence:1,at:'2026-10-02T00:00:00Z',source:'synthetic',...input.tradeInputFromFields(type,{inputMode:'execution_total',quantity,executionTotal:total,memo:'실제 체결 확인'},'USD','asset')});

test('settlement controls return to the explicit execution total without using a retained per-share price',()=>{
  const original={inputMode:'execution_total',quantity:'0.896567',executionTotal:'628.91',price:'10',memo:'retained'};
  let fields=editLedgerDraft(original,'buy','inputMode','net','USD');
  fields=editLedgerDraft(fields,'buy','inputMode','total','USD');
  fields=editLedgerDraft(fields,'buy','settlementMode','none','USD');
  assert.equal(fields.inputMode,'execution_total');assert.equal(fields.executionTotal,'628.91');
  const event=input.tradeInputFromFields('buy',fields,'USD','asset');
  assert.equal(event.executionTotal.amount,'628.91');assert.equal(event.price,undefined);assert.equal(event.settlement,undefined);
  fields=editLedgerDraft(fields,'buy','inputMode','execution','USD');
  fields=editLedgerDraft(fields,'buy','inputMode','net','USD');
  fields=editLedgerDraft(fields,'buy','settlementMode','none','USD');
  assert.equal(fields.inputMode,'execution');assert.equal(fields.price,'10');
});

test('exchange direction swaps amounts in their currencies and discards a fee in the old debit currency',()=>{
  const original={currency:'USD',amount:'12.34',credit:'17000',fee:'0.12'};
  const changed=editLedgerDraft(original,'exchange','currency','KRW','USD');
  assert.equal(changed.amount,'17000');assert.equal(changed.credit,'12.34');assert.equal(changed.fee,'');
  const back=editLedgerDraft(changed,'exchange','currency','USD','USD');
  assert.equal(back.amount,'12.34');assert.equal(back.credit,'17000');
  assert.equal(original.fee,'0.12');
});

test('trade fee currency changes require new costs and new record types do not inherit amounts or corrections',()=>{
  const original={currency:'USD',inputMode:'execution_total',quantity:'0.896567',executionTotal:'628.91',fee:'2',tax:'1',assetId:'asset',at,historyMode:'yes',notInOpening:'yes',replaces:'old'};
  let fields=editLedgerDraft(original,'buy','settlementCurrency','KRW','USD');
  fields=editLedgerDraft(fields,'buy','inputMode','total','USD');
  assert.equal(fields.fee,'');assert.equal(fields.tax,'');assert.equal(fields.quantity,original.quantity);
  fields=editLedgerDraft({...fields,fee:'100'},'buy','settlementMode','none','USD');assert.equal(fields.fee,'');
  const exchange=freshLedgerKindDraft(original,'exchange');
  for(const key of ['fee','quantity','executionTotal','historyMode','notInOpening','replaces','assetId'])assert.equal(exchange[key],undefined);
  assert.equal(exchange.at,at);assert.equal(exchange.currency,'USD');
});
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
