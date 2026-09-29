import assert from 'node:assert/strict';
import {it} from 'node:test';
import {buildBrokerHistoryFrames,tradeAtCutoff} from '../scripts/lib/broker-history-reconstruction.mjs';
const asset={id:'a',account_id:'acct',canonical_owner_user_id:'owner',ticker:'SYNTH',market:'korea',currency:'KRW',name:'Synthetic',asset_type:'stock',quantity:'5',fractional_krw_value:null};
const trade={id:'trade',assetId:'a',side:'buy',quantity:'1',tradeDate:'2026-08-01'};
function input(){return {state:{account:{id:'acct',canonical_owner_user_id:'owner',native_state:null},assets:[{...asset}],events:[{id:'trade',asset_id:'a',event_date:'2026-08-01',event_type:'buy',quantity_delta:'1'}]},batches:[{id:'batch',account_id:'acct',canonical_owner_user_id:'owner',recorded_at:'2026-08-03T08:00:00Z',before_state:{assets:[{...asset,quantity:'4'}]},manifest:{holdings:[{id:'a',startQuantity:'4'}],trades:[trade]}}],prices:[{id:'price',ticker:'SYNTH',market:'korea',currency:'KRW',date:'2026-07-31',close_price:'33000',source:'kis_domestic_history_raw_v2',is_sample:false}],fx:[],positions:[],startDate:'2026-08-01',endDate:'2026-08-03'};}
it('reconstructs dated quantities, excludes unknown same-day cutoff and leaves cash/cost/return unknown',()=>{const rows=buildBrokerHistoryFrames(input());assert.equal(rows[0].complete,false);assert.equal(rows[0].reasons[0].reason,'execution_time_unknown');assert.equal(rows[1].totalMarketValue,'165000');assert.equal(rows[2].positions[0].quantity,'5');assert.equal(rows[1].cashIncluded,false);assert.equal(rows[1].performanceAvailable,false);});
it('honors before/exact/after cutoff without inventing timestamps',()=>{assert.equal(tradeAtCutoff({...trade,tradeDate:'2026-08-01',executedAt:'2026-07-31T21:59:59Z'},'2026-08-01'),'before');assert.equal(tradeAtCutoff({...trade,executedAt:'2026-07-31T22:00:00Z'},'2026-08-01'),'after');assert.equal(tradeAtCutoff({...trade,executionNotBefore:'2026-08-01T00:00:00Z'},'2026-08-01'),'after');assert.equal(tradeAtCutoff(trade,'2026-08-01'),'unknown');});
it('does not use current price or stale FX to fill missing historical data',()=>{const a=input();a.prices=[];assert.equal(buildBrokerHistoryFrames(a)[1].complete,false);const b=input();for(const x of [b.state.assets[0],b.batches[0].before_state.assets[0],b.prices[0]]){x.market='us';x.currency='USD';}b.fx=[{id:'fx',date:'2026-07-20',usdkrw:'1300',source:'verified',status:'ok',is_sample:false}];assert.ok(buildBrokerHistoryFrames(b)[1].reasons.some(r=>r.reason==='historical_fx_missing'));});
it('validates original event identity and current reconciliation',()=>{const a=input();a.state.assets=[{...asset,quantity:'6'}];assert.throws(()=>buildBrokerHistoryFrames(a),/current_quantity_does_not_reconcile/);const b=input();b.state.events=[];assert.throws(()=>buildBrokerHistoryFrames(b),/reconstruction_trade_not_applied/);});
it('does not synthesize manual historical valuations from current holdings',()=>{const a=input();a.state.assets=[{...asset,ticker:null}];assert.ok(buildBrokerHistoryFrames(a)[1].reasons.some(r=>r.reason==='manual_cutoff_observation_missing'));});

it('admits only proven manual valuation provenance and labels stored carry honestly',()=>{
 const a=input(),m={...asset,id:'manual',ticker:null,name:'Synthetic manual',quantity:'1'};
 a.state.assets.push(m);a.batches[0].before_state.assets.push(m);
 const p={id:'manual-row',asset_id:'manual',snapshot_date:'2026-08-02',cycle_end_at:'2026-08-01T22:00:00Z',is_sample:false,quantity:'1',market_value_krw:'12365',current_price:'12365',source:'varda_manual_daily_snapshot',price_source:'asset_current_price',price_basis:'manual_current',captured_at:'2026-08-01T22:59:00Z',price_date:null,reference_date:null};
 a.positions=[p];let row=buildBrokerHistoryFrames(a)[1];assert.equal(row.complete,true);assert.equal(row.positions.find(x=>x.assetId==='manual').basis,'preserved_stored_manual_carry');
 for(const change of [{price_source:'fallback_current',price_date:'2026-08-20'},{price_date:'2026-08-20'},{source:'untrusted'},{price_basis:'current'},{captured_at:null},{current_price:null}]){a.positions=[{...p,...change}];assert.equal(buildBrokerHistoryFrames(a)[1].complete,false);}
});
it('uses scoped after-cutoff confirmation without changing original events or inventing an execution instant',()=>{
 const a=input();const original=JSON.stringify(a);const confirmation={ownerId:'owner',accountId:'acct',reference:'synthetic confirmation',confirmedAt:'2026-08-04T00:00:00Z',afterCutoffTradeIds:['trade'],manualValuations:[]};
 const rows=buildBrokerHistoryFrames({...a,confirmation});assert.equal(rows[0].totalMarketValue,'132000');assert.equal(rows[1].totalMarketValue,'165000');assert.equal(JSON.stringify(a),original);
 assert.throws(()=>buildBrokerHistoryFrames({...a,confirmation:{...confirmation,ownerId:'other'}}),/owner_mismatch/);
 assert.throws(()=>buildBrokerHistoryFrames({...a,confirmation:{...confirmation,afterCutoffTradeIds:['other']}}),/unmapped_trade/);
});
it('confirmed manual total is date-specific and never multiplied by quantity',()=>{
 const a=input(),m={...asset,id:'manual',ticker:null,quantity:'8'};a.state.assets.push(m);a.batches[0].before_state.assets.push(m);
 const confirmation={ownerId:'owner',accountId:'acct',reference:'synthetic confirmation',confirmedAt:'2026-08-04T00:00:00Z',afterCutoffTradeIds:['trade'],manualValuations:[{assetId:'manual',date:'2026-08-02',totalValueKrw:'80000'}]};
 const rows=buildBrokerHistoryFrames({...a,confirmation});assert.equal(rows[1].totalMarketValue,'245000');assert.equal(rows[1].positions.find(p=>p.assetId==='manual').valueKrw,'80000');assert.equal(rows[0].complete,false);assert.equal(rows[2].complete,false);
});
