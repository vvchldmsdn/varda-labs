import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {selectSnapshotCutoffQuote,isNativeCutoffObservation} from '../src/lib/snapshots/cutoff-valuation.ts';
import {selectSnapshotCutoffFx} from '../src/lib/snapshots/cutoff-fx.ts';
import {isUsdListedAsset} from '../src/lib/snapshots/market-calendar.ts';
import {attachNativeLedgerEvidence} from '../src/lib/native-portfolio-projection.ts';

const cutoff=new Date('2026-09-21T22:00:00Z');
const instrument={ticker:'TEST',market:'us',currency:'USD'};
const quote=(changes={})=>({...instrument,provider:'kis',source:'kis_overseas_price',quoteType:'live',status:'ok',price:'105',priceAsOf:'2026-09-21T21:59:00Z',fetchedAt:'2026-09-21T21:59:01Z',...changes});
describe('07:00 contract followup independent regressions',()=>{
 it('selects FX by actual observation and rejects conflicting rates at that observation',()=>{
  const spot={usdKrw:'1300',rateDate:'2026-09-21',isSample:false,status:'ok',observedAt:'2026-09-21T21:59:00Z',fetchedAt:'2026-09-21T21:59:01Z',rateKind:'spot'};
  const older={...spot,usdKrw:'1400',observedAt:'2026-09-21T00:00:00Z',fetchedAt:'2026-09-21T21:59:30Z',rateKind:'daily_reference'};
  assert.equal(selectSnapshotCutoffFx([spot,older],'2026-09-22',cutoff)?.usdKrw,'1300');
  assert.equal(selectSnapshotCutoffFx([spot,{...spot,usdKrw:'1301',fetchedAt:'2026-09-21T21:59:30Z'}],'2026-09-22',cutoff),null);
 });
 it('requires explicit official-close session evidence rather than a close-labelled cache timestamp',()=>{
  const observation={price:'100',priceCurrency:'USD',priceKind:'close',basis:'raw',source:'kis',priceObservedAt:'2026-09-21T20:00:00Z',priceFetchedAt:'2026-09-21T21:00:00Z'};
  const input={instrument,observation,snapshotDate:'2026-09-22',cycleEndAt:cutoff,capturedAt:cutoff};
  assert.equal(isNativeCutoffObservation(input),false);
  assert.equal(isNativeCutoffObservation({...input,observation:{...observation,timestampBasis:'daily_close',priceReferenceDate:'2026-09-21'}}),true);
 });
 it('does not classify a USD-denominated non-US instrument as US listed',()=>assert.equal(isUsdListedAsset({market:'hongkong',currency:'USD'}),false));
 it('fresh collection cannot make a stale market observation fresh',()=>assert.equal(selectSnapshotCutoffQuote({instrument,rows:[quote({priceAsOf:'2026-09-21T20:00:00Z'})],capturedAt:cutoff,cycleEndAt:cutoff}),null));
 it('rejects a market observation later than its collection',()=>assert.equal(selectSnapshotCutoffQuote({instrument,rows:[quote({priceAsOf:'2026-09-21T21:59:02Z'})],capturedAt:cutoff,cycleEndAt:cutoff}),null));
 it('keeps the latest actual observation ahead of a later collection of older data',()=>{
  const latest=quote({price:'105'}),older=quote({price:'100',priceAsOf:'2026-09-21T21:58:00Z',fetchedAt:'2026-09-21T21:59:30Z'});
  assert.equal(selectSnapshotCutoffQuote({instrument,rows:[latest,older],capturedAt:cutoff,cycleEndAt:cutoff}).price,105);
 });
 it('does not admit stale FX just because its fetch preceded the cutoff',()=>assert.equal(selectSnapshotCutoffFx([{usdKrw:'1300',rateDate:'2026-09-01',isSample:false,status:'ok',observedAt:'2026-09-01T00:00:00Z',fetchedAt:'2026-09-01T00:01:00Z',rateKind:'daily_reference'}],'2026-09-22',cutoff),null));
 it('never uses the first post-trade capture as the regular daily baseline',()=>{
  const base={ownerId:'owner',reporting:'USD',asOf:'2026-09-22T00:00:00Z',current:{at:'2026-09-22T00:00:00Z',source:'test',positions:[],scopeComplete:true},history:[],trades:null,fx:[],maxFxAgeMs:0,maxPriceAgeMs:0};
  const account={id:'account',name:'test',state:{at:'2026-09-21T20:00:00Z',sequence:1,positions:[],cash:{KRW:'0',USD:'100'}},assets:[]};
  const snapshot={accountId:account.id,evidence:{version:1,sequence:1,fx:[],frame:{at:'2026-09-21T21:00:00Z',source:'native_ledger_snapshot',scopeComplete:true,positions:[]}}};
  assert.equal(attachNativeLedgerEvidence(base,{accounts:[account],entries:[],snapshots:[snapshot]},'account').history.length,0);
 });
 it('uses the last completed baseline in the requested currency without borrowing a USD-only completion',()=>{
  const base={ownerId:'owner',reporting:'KRW',asOf:'2026-09-22T00:00:00Z',current:{at:'2026-09-22T00:00:00Z',source:'test',positions:[],scopeComplete:true},history:[],trades:null,fx:[],maxFxAgeMs:0,maxPriceAgeMs:0};
  const account={id:'account',name:'test',state:{at:'2026-09-20T20:00:00Z',sequence:0,positions:[],cash:{KRW:'100',USD:'0'}},assets:[]};
  const snapshot=(at,availableCurrencies)=>({accountId:'account',evidence:{version:1,sequence:0,fx:[],availableCurrencies,frame:{at,boundary:'before',source:'native_ledger_cutoff_v2',scopeComplete:true,positions:[]}}});
  const ledger={accounts:[account],entries:[],snapshots:[snapshot('2026-09-20T22:00:00Z',['KRW','USD']),snapshot('2026-09-21T22:00:00Z',['USD'])]};
  assert.deepEqual(attachNativeLedgerEvidence(base,ledger,'account').history.map(row=>row.at),['2026-09-20T22:00:00Z']);
  assert.equal(attachNativeLedgerEvidence({...base,reporting:'USD'},ledger,'account').history.length,2);
 });
});
