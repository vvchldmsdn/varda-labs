import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Decimal, moneyMinor, moneyFromMinor, parseMoneyInput } from '../src/lib/money.ts';
import { fxFactor, valuePosition, decomposeCurrencyMovement, reportingReturnSeries } from '../src/lib/currency-valuation.ts';
import { calculateCurrencyContribution } from '../src/lib/currency-contribution.ts';
import { calculatePlan } from '../src/lib/investment-plan.ts';
import { analyzeQuickPortfolio, validateQuickPortfolio, createQuickDraft, parseQuickDraft } from '../src/lib/quick-portfolio.ts';
import { calculateCurrencyModifiedDietz, attributeCurrencyTrades } from '../src/lib/currency-performance.ts';
import { fxObservationWrite } from '../src/lib/market-data/fx-observation-write.ts';
const t0='2026-09-01T00:00:00Z', t1='2026-09-02T00:00:00Z';
const fx=[{base:'USD',quote:'KRW',rate:'1400',observedAt:t0,fetchedAt:t0,source:'test',kind:'synthetic'}, {base:'USD',quote:'KRW',rate:'1260',observedAt:t1,fetchedAt:t1,source:'test',kind:'synthetic'}];
const point=(price,at)=>({quantity:'1',price:String(price),currency:'USD',at,basis:'raw',source:'test'});
it('preserves decimal products and exact cents without rounding quantity or FX',()=>{
  assert.equal(Decimal.from('0.1').add('0.2').compare('0.3'),0);
  assert.equal(Decimal.from('0.12345678').mul('123.456').toExactString(),'15.24148023168');
  assert.throws(()=>Decimal.from(1).div(3).toExactString());
  assert.equal(moneyMinor(10.29,'USD'),1029); assert.equal(parseMoneyInput('1,000.25','USD'),1000.25);
  for(const bad of ['1,23','1.000,25','1e3','Infinity','-1','10.001']) assert.equal(parseMoneyInput(bad,'USD'),null);
  assert.equal(parseMoneyInput('10.25','KRW'),null);
  const value=valuePosition({...point(123.456,t0),quantity:'0.12345678'},'KRW',fx,0);
  assert.equal(value.ok,true); assert.equal(value.value.compare(Decimal.from('0.12345678').mul('123.456').mul(1400)),0);
});
it('calculates +10% USD and -1% KRW from dated prices and dated FX',()=>{
  for(const [currency,expected] of [['USD',.1],['KRW',-.01]]) {
    const series=reportingReturnSeries([{at:t0,price:'1000',currency:'USD',basis:'raw_price',dataset:'one'},{at:t1,price:'1100',currency:'USD',basis:'raw_price',dataset:'one'}],currency,fx,0);
    assert.equal(series.ok,true); assert.equal(series.value[0].return,expected);
  }
  const change=decomposeCurrencyMovement(point(1000,t0),point(1100,t1),'KRW',fx,0).value;
  assert.equal(change.total.toNumber(),-14000); assert.equal(change.price.toNumber(),140000); assert.equal(change.exchange.toNumber(),-154000);
  assert.equal(change.price.add(change.exchange).add(change.position).compare(change.total),0);
});
it('fails closed for missing, stale, future and invalid FX and mismatched prices',()=>{
  assert.equal(fxFactor('USD','KRW',t1,[],0).reason,'fx_missing');
  assert.equal(fxFactor('USD','KRW',t1,[fx[0]],1).reason,'fx_stale');
  assert.equal(fxFactor('USD','KRW',t0,[fx[1]],0).reason,'future_evidence');
  assert.equal(fxFactor('USD','KRW',t0,[{...fx[0],fetchedAt:'2099-01-01T00:00:00Z'}],0).reason,'future_evidence');
  assert.equal(valuePosition(point(10,'2099-01-01T00:00:00Z'),'USD',[],0).reason,'future_evidence');
  assert.equal(fxFactor('USD','KRW',t0,[{...fx[0],rate:'0'}],0).reason,'fx_invalid');
  assert.equal(fxFactor('KRW','USD',t0,fx,0).value.mul(1400).compare(1),0);
  assert.equal(fxFactor('USD','USD',t0,[],0).value.toNumber(),1);
  assert.equal(valuePosition({...point(10,t0),basis:'adjusted'},'USD',[],0).reason,'price_basis_mismatch');
  assert.equal(reportingReturnSeries([{at:t0,price:'10',currency:'USD',basis:'raw_price',dataset:'one'},{at:t1,price:'20',currency:'USD',basis:'split_adjusted',dataset:'two'}],'USD',[],0).reason,'price_basis_mismatch');
});
const input={version:2,currency:'USD',source:'manual',locale:'en',timeZone:'America/New_York',asOf:t1,rows:[{name:'VOO',value:1000.25,instrumentId:'us-voo',inputCurrency:'USD'},{name:'Unknown',value:500.15,instrumentId:null,inputCurrency:'USD'}]};
it('keeps original USD cents, language, time zone and retry identity without invented holdings',()=>{
  const valid=validateQuickPortfolio(input); assert.equal(valid.ok,true); assert.deepEqual(valid.input,input);
  const draft=createQuickDraft(input); assert.deepEqual(parseQuickDraft(JSON.stringify(draft)),draft); assert.equal(createQuickDraft(input,draft).id,draft.id);
  const result=analyzeQuickPortfolio(input); assert.equal(result.total,1500.4); assert.equal(result.rows[0].value,1000.25); assert.equal(Object.hasOwn(result.rows[0],'quantity'),false);
  assert.deepEqual(analyzeQuickPortfolio({...input,locale:'ko'}),result);
});
it('does not normalize partial currency coverage or confuse quote and input currency',()=>{
  const mixed={...input,rows:[input.rows[0],{...input.rows[1],value:1400000,inputCurrency:'KRW'}]};
  const result=analyzeQuickPortfolio(mixed); assert.equal(result.total,null); assert.equal(result.complete,false); assert.equal(result.largest,null); assert.equal(result.rows[0].weightPct,null);
  assert.deepEqual(result.currencyTotals,[{currency:'KRW',value:1400000},{currency:'USD',value:1000.25}]);
  const manual={...fx[1],source:'manual',kind:'user_input'};
  const ready=analyzeQuickPortfolio({...mixed,fx:[manual]}); assert.equal(ready.complete,true); assert.equal(ready.rows[1].reportingValue,1400000/1260);
});
it('USD allocation conserves cents and matches legacy KRW proportional policy',()=>{
  const usd=calculatePlan({version:2,asOf:t1,currency:'USD',amount:.01,rows:[{name:'A',value:1,targetBps:5000},{name:'B',value:1,targetBps:5000}]});
  assert.equal(usd.ok,true); assert.equal(moneyMinor(usd.totalAllocated,'USD')+moneyMinor(usd.residualCash,'USD'),1);
  const krw=calculatePlan({currency:'KRW',amount:500000,rows:[{name:'A',value:3000000,targetBps:5000},{name:'B',value:1000000,targetBps:3000},{name:'C',value:1000000,targetBps:2000}]});
  assert.deepEqual(krw.rows.map(row=>row.allocation),[0,433333,66667]);
});
it('sell eligibility uses dated cost FX in pinned profit currency and unknown cost never passes',()=>{
  const row={allocationKey:'a',assetType:'stock',buyable:true,ma120Evidence:{status:'unavailable',distanceFromMaPct:null},maAssetClass:'broad_index',maRuleEnabled:true,metadata:null,targetWeightBps:0,value:{amount:'1100',currency:'USD',at:t1,source:'test'},cost:{amount:'1000',currency:'USD',at:t0,source:'trade'}};
  const second={...row,allocationKey:'b',targetWeightBps:10000,value:{...row.value,amount:'10'},cost:null};
  const run=(reportingCurrency,rows=[row,second])=>calculateCurrencyContribution({reportingCurrency,asOf:t1,fx,maxFxAgeMs:0,rows,funds:[{amount:'10',currency:reportingCurrency,at:t1,source:'user'}],trimDriftThresholdPct:12,minimumExecutionRatioPct:0});
  const usd=run('USD'), krw=run('KRW'); assert.equal(usd.status,'ready'); assert.equal(krw.status,'ready');
  assert.equal(usd.rows[0].sell,1100); assert.equal(krw.rows[0].sell,0); assert.equal(usd.context.profitCurrency,'USD');
  assert.equal(run('USD',[{...row,cost:null},second]).rows[0].sell,0);
  const tinyLoss=run('USD',[{...row,cost:{...row.cost,amount:'1100.00000000000001'}},second]);
  assert.equal(tinyLoss.rows[0].sell,0); assert.equal(tinyLoss.rows[0].trimReason,'target_zero_but_loss');
  assert.equal(moneyMinor(usd.buys,'USD')+moneyMinor(usd.remainingCash,'USD'),moneyMinor(usd.available,'USD'));
});
it('preserves Modified Dietz definition and excludes deposits, internal transfers and conversions from profit',()=>{
  const valuations=[{amount:'1000',currency:'USD',at:t0,serviceDate:'2026-09-01',source:'snapshot'},{amount:'1500',currency:'USD',at:t1,serviceDate:'2026-09-02',source:'snapshot'}];
  const flow={amount:'500',currency:'USD',at:t1,serviceDate:'2026-09-02',source:'ledger',id:'external',kind:'external_in'};
  const options={reporting:'USD',valuations,flows:[flow,{...flow,id:'move',kind:'internal_transfer'},{...flow,id:'exchange',kind:'exchange'}],cashFlowEvidence:'complete',fx,maxFxAgeMs:0};
  const result=calculateCurrencyModifiedDietz(options); assert.equal(result.status,'ready'); assert.equal(result.totalReturn,0); assert.equal(result.flowCount,1); assert.equal(result.policy.method,'modified_dietz');
  assert.equal(result.policy.cashBalance,'included_in_portfolio_valuation');assert.equal(result.policy.incomeTreatment,'included_in_valuation_not_external_flow');assert.equal(result.policy.feeTaxTreatment,'included_in_valuation_not_external_flow');assert.equal(result.policy.externalFlowTiming,'observed_timestamps');
  assert.equal(calculateCurrencyModifiedDietz({...options,cashFlowEvidence:'missing'}).status,'blocked');
  assert.equal(calculateCurrencyModifiedDietz({...options,flows:[flow,flow]}).reason,'duplicate_flow');
});
it('actual trade price and FX attribution reconcile without treating purchases as gains',()=>{
  const after={...point(1100,t1),quantity:'2'};
  const result=attributeCurrencyTrades({before:point(1000,t0),after,reporting:'KRW',fx,maxFxAgeMs:0,trades:[{quantityDelta:'1',price:'1100',currency:'USD',at:t1,source:'ledger'}]});
  assert.equal(result.ok,true); assert.equal(result.value.change.toNumber(),-14000);
  assert.equal(result.value.price.add(result.value.exchange).add(result.value.flow).compare(result.value.valuationChange),0);
  assert.equal(attributeCurrencyTrades({before:point(1000,t0),after,reporting:'USD',fx,maxFxAgeMs:0,trades:[]}).reason,'quantity_mismatch');
});
it('rejects same-time conflicting FX and invalid same-currency context',()=>{
  assert.equal(fxFactor('USD','USD','bad',[],0).ok,false);
  assert.equal(fxFactor('USD','USD',t0,[],-1).ok,false);
  assert.equal(fxFactor('USD','KRW',t0,[fx[0],{...fx[0],rate:'1401'}],0).reason,'fx_invalid');
  assert.equal(decomposeCurrencyMovement({...point(1000,t0),quantity:'-1'},point(1100,t1),'USD',fx,0).ok,false);
});
it('persists only provider-dated FX and clears unknown metadata on a replacement',()=>{
  const candidate={provider:'er-api-open',providerTimestamp:t0,fetchedAt:t1};
  assert.deepEqual(fxObservationWrite(candidate),{observedAt:new Date(t0),rateKind:'daily_reference'});
  assert.deepEqual(fxObservationWrite({...candidate,provider:'kis'}),{observedAt:null,rateKind:null});
  assert.deepEqual(fxObservationWrite({...candidate,providerTimestamp:'2099-01-01T00:00:00Z'}),{observedAt:null,rateKind:null});
  const closed=valuePosition({...point(1100,t1),priceObservedAt:t0},'KRW',fx,0);
  assert.equal(closed.ok,true); assert.equal(closed.value.toNumber(),1386000);
});
it('rejects dollar presentation that would lose a cent within safe integer minor units',()=>{
  assert.throws(()=>moneyFromMinor(9007199254740991,'USD'),/money_overflow/);
  assert.equal(parseMoneyInput('90071992547409.91','USD'),null);
  const exact=9007199254740990;assert.equal(moneyMinor(moneyFromMinor(exact,'USD'),'USD'),exact);
  assert.equal(moneyFromMinor(Number.MAX_SAFE_INTEGER,'KRW'),Number.MAX_SAFE_INTEGER);
});
it('does not count a later cash flow in an earlier valuation via a misleading service date',()=>{
  const options={reporting:'USD',cashFlowEvidence:'complete',fx:[],maxFxAgeMs:0,valuations:[{amount:'1000',currency:'USD',at:t0,serviceDate:'2026-09-01',source:'snapshot'},{amount:'1500',currency:'USD',at:t1,serviceDate:'2026-09-02',source:'snapshot'}],flows:[{id:'cash',kind:'external_in',amount:'500',currency:'USD',at:'2026-09-03T00:00:00Z',serviceDate:'2026-09-02',source:'ledger'}]};
  assert.equal(calculateCurrencyModifiedDietz(options).reason,'flow_service_date_mismatch');
  options.flows[0].at='2026-09-02T12:00:00Z';assert.equal(calculateCurrencyModifiedDietz(options).blockers[0].reason,'flow_outside_valuation_window');
  options.flows[0].at=t1;assert.equal(calculateCurrencyModifiedDietz(options).totalReturn,0);
  options.valuations[0].at='2026-09-02T01:00:00Z';assert.equal(calculateCurrencyModifiedDietz(options).reason,'valuation_time_mismatch');
});
it('does not hide an impossible earlier sale by processing a later purchase first',()=>{
  const observation={...point(100,t0),quantity:'0'};
  const result=attributeCurrencyTrades({before:observation,after:{...observation,at:t1},reporting:'USD',fx:[],maxFxAgeMs:0,trades:[{quantityDelta:'1',price:'100',currency:'USD',at:'2026-09-01T18:00:00Z',source:'ledger'},{quantityDelta:'-1',price:'100',currency:'USD',at:'2026-09-01T12:00:00Z',source:'ledger'}]});
  assert.equal(result.ok,false);assert.equal(result.reason,'trade_time_order_invalid');
});
it('full sale price and FX effects use the observed exit, independent of a zero-endpoint dummy quote',()=>{
  const quote={quantity:'10',price:'100',currency:'USD',at:t0,basis:'raw',source:'raw'};
  const rates=[{...fx[0],rate:'1400'},{...fx[1],rate:'1300'}];
  for(const dummy of ['1','9999']) {
    const result=attributeCurrencyTrades({before:quote,after:{...quote,quantity:'0',price:dummy,at:t1},reporting:'KRW',fx:rates,maxFxAgeMs:0,trades:[{quantityDelta:'-10',price:'110',currency:'USD',at:t1,source:'ledger'}]});
    assert.equal(result.ok,true); assert.equal(result.value.price.toNumber(),140000);
    assert.equal(result.value.exchange.toNumber(),-110000); assert.equal(result.value.change.toNumber(),30000);
  }
});
it('contribution fails closed for malformed and oversized native evidence before float conversion',()=>{
  const row={allocationKey:'a',assetType:'stock',buyable:true,ma120Evidence:{status:'unavailable',distanceFromMaPct:null},maAssetClass:'broad_index',maRuleEnabled:true,metadata:null,targetWeightBps:10000,value:{amount:'1',currency:'USD',at:t1,source:'test'},cost:null};
  const options={reportingCurrency:'USD',asOf:t1,fx:[],maxFxAgeMs:0,rows:[row],funds:[{amount:'1',currency:'USD',at:t1,source:'user'}],trimDriftThresholdPct:12,minimumExecutionRatioPct:0};
  row.value.amount='90071992547409.915';assert.equal(calculateCurrencyContribution(options).reason,'money_overflow');
  row.value.amount='not-a-number';assert.equal(calculateCurrencyContribution(options).status,'blocked');
  row.value.amount='1';options.funds[0].amount='bad';assert.equal(calculateCurrencyContribution(options).status,'blocked');
});
