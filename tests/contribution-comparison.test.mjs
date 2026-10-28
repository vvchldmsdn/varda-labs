import test from 'node:test';
import assert from 'node:assert/strict';
import { compareContribution, evaluateContributionScenario, prepareContributionComparison } from '../src/lib/contribution-comparison.ts';
import { contributionComparisonPreview } from '../src/lib/contribution-comparison-preview.ts';
import { unavailableContributionModifiers } from '../src/lib/additional-contribution-modifiers.ts';

const base = () => contributionComparisonPreview();
const ready = result => { assert.equal(result.status, 'ready', JSON.stringify(result)); return result; };
const sum = plan => Object.values(plan.amounts).reduce((a,b) => a+b, plan.cash);

test('every arm conserves the same budget including cash; no benefit at unchanged prices', () => {
  const result = ready(compareContribution(base(), '1,000,001'));
  for (const plan of [result.ratio,result.aligned,result.adjusted]) { assert.equal(sum(plan),1000001); assert.ok(plan.cash>=0); for(const n of Object.values(plan.amounts))assert.ok(Number.isSafeInteger(n)&&n>=0); }
  const values = evaluateContributionScenario(result,{pricePct:0,usdKrwPct:0});
  assert.equal(values.ratio,1000001); assert.equal(values.adjusted,1000001); assert.equal(values.gap,0);
});
test('neutral evidence and balanced holdings reproduce ratio allocation', () => {
  const basis=base(); basis.modifiers=unavailableContributionModifiers();
  basis.rows=basis.rows.map(row=>({...row,currentValueKrw:row.targetWeightBps*1000,maRuleEnabled:false}));
  const result=ready(compareContribution(basis,'1000000'));
  assert.deepEqual({...result.ratio.amounts},{...result.adjusted.amounts});
  assert.equal(evaluateContributionScenario(result,{pricePct:10,usdKrwPct:5}).gap,0);
});
test('target deficit effect is separated from FX/MA effect', () => {
  const result=ready(compareContribution(base(),'1000000'));
  const values=evaluateContributionScenario(result,{pricePct:-13.4,usdKrwPct:4.2,rowPricePct:{msft:17.7}});
  assert.ok(Math.abs(values.alignmentEffect+values.adjustmentEffect-values.gap)<1e-8);
  const basis=base();basis.rows=basis.rows.map(row=>({...row,maRuleEnabled:false}));basis.modifiers=unavailableContributionModifiers();
  const neutral=evaluateContributionScenario(ready(compareContribution(basis,'1000000')),{pricePct:5,usdKrwPct:10});
  assert.equal(neutral.adjustmentEffect,0);assert.notEqual(neutral.alignmentEffect,0);
});
test('both advantage and opportunity cost are visible, never guaranteed savings', () => {
  const result=ready(compareContribution(base(),'1000000'));
  assert.ok(evaluateContributionScenario(result,{pricePct:-10,usdKrwPct:0}).gap>0);
  assert.ok(evaluateContributionScenario(result,{pricePct:10,usdKrwPct:0}).gap<0);
});
test('USD value compounds price and currency once; KRW funds stay flat', () => {
  const result=ready(compareContribution(base(),'1000000'));
  const value=evaluateContributionScenario(result,{pricePct:10,usdKrwPct:10});
  assert.equal(value.ratio,1177000); // 700,000 * 1.1 * 1.1 + 300,000 * 1.1
});
test('USD funding disables entry FX penalty and preserves dollar residual exposure', () => {
  const result=ready(compareContribution(base(),'1000.01','USD'));
  assert.equal(result.budget,1350013.5);
  assert.equal(sum(result.ratio),1350013.5);assert.equal(result.ratio.cash,.5);
  assert.ok(result.evidence.every(row=>row.fx===1));
  const fx=evaluateContributionScenario(result,{pricePct:0,usdKrwPct:10});
  const krw=result.adjusted.amounts.kodex;
  assert.ok(Math.abs(fx.adjusted-((result.budget-krw)*1.1+krw))<1e-7);
});
test('input snapshots and their costs are not mutated; even profitable overweight holdings cannot add sale funds', () => {
  const basis=base();basis.rows[0].currentValueKrw=100000000;basis.rows[0].costBasisKrw=1;
  const before=structuredClone(basis);const result=ready(compareContribution(basis,'1000000'));
  assert.deepEqual(basis,before);assert.equal(sum(result.adjusted),1000000);assert.equal(result.budget,1000000);
});
test('stable remainder allocation is order independent and never allocates to zero-target holdings', () => {
  const basis=base();basis.rows[0].targetWeightBps=0;basis.rows[1].targetWeightBps=5000;basis.rows[2].targetWeightBps=5000;
  const a=ready(compareContribution(basis,'1'));basis.rows.reverse();const b=ready(compareContribution(basis,'1'));
  assert.deepEqual(a.ratio,b.ratio);assert.equal(a.ratio.amounts.voo,0);assert.equal(sum(a.ratio),1);
});
test('missing and hedged FX evidence stays unapplied instead of inventing a signal', () => {
  const basis=base();basis.rows[0].fxExposureType='HEDGED';basis.rows[1].fxExposureType='UNKNOWN';
  const result=ready(compareContribution(basis,'1000000'));
  assert.equal(result.evidence.find(row=>row.key==='voo').fxStatus,'not_applicable');
  assert.equal(result.evidence.find(row=>row.key==='msft').fxStatus,'unavailable');
  assert.equal(result.evidence.find(row=>row.key==='voo').fx,1);
});
test('invalid targets, amount, buyability, FX and scenarios fail closed', () => {
  for(const amount of ['','0','-1','1.1','NaN','1e6','100000000001'])assert.equal(compareContribution(base(),amount).status,'blocked');
  const bad=base();bad.rows[0].targetWeightBps=4999;assert.equal(compareContribution(bad,'1').status,'blocked');
  const unbuyable=base();unbuyable.rows[0].buyable=false;assert.equal(compareContribution(unbuyable,'1').status,'blocked');
  const noFx=base();noFx.usdKrw=null;assert.equal(compareContribution(noFx,'1','USD').status,'blocked');
  const good=ready(compareContribution(base(),'1000000'));
  for(const scenario of [{pricePct:-101,usdKrwPct:0},{pricePct:0,usdKrwPct:Infinity},{pricePct:0,usdKrwPct:0,rowPricePct:{unknown:10}}])assert.equal(evaluateContributionScenario(good,scenario),null);
  assert.ok(evaluateContributionScenario(good,{pricePct:-100,usdKrwPct:-100}).adjusted>=0);
});
test('more than 32 holdings can be compared without treating research as sale exclusions', () => {
  const basis=base(), template=basis.rows[0];basis.rows=Array.from({length:40},(_,i)=>({...template,allocationKey:'asset-'+i,targetWeightBps:250,currentValueKrw:250000}));
  const result=ready(compareContribution(basis,'1000000'));assert.equal(sum(result.adjusted),1000000);
});
test('normalized native input strips private records and rejects mixed accounts, stale FX or MA basis mismatch', () => {
  const at='2026-09-01T12:00:00Z'; const template=base().rows[0];
  const context={status:'ready',scopeLabel:'Test',scopeKey:'account:test',policy:{revision:2},names:{voo:'VOO'},availableCash:[{amount:'999999'}],nativeSequences:{private:99},input:{asOf:at,fx:[{base:'USD',quote:'KRW',rate:'1350',observedAt:at,fetchedAt:at,source:'fixture',kind:'spot'}],maxFxAgeMs:86400000,rows:[{...template,metadata:{accountId:'a',secret:'not needed'},value:{amount:'10.709',currency:'USD',at,source:'quote'},costLots:[{private:'secret'}],maBasis:{priceCurrency:'USD',averageCurrency:'KRW',priceBasis:'raw',averageBasis:'raw'}}]}};
  const basis=ready(prepareContributionComparison(context));assert.equal(basis.rows[0].currentValueKrw,14457.15);assert.equal(basis.rows[0].ma120Evidence.status,'unavailable');
  assert.ok(!JSON.stringify(basis).includes('secret'));assert.ok(!JSON.stringify(basis).includes('999999'));
  const stale=structuredClone(context);stale.input.asOf='2026-09-04T12:00:00Z';stale.input.rows[0].value.at=stale.input.asOf;assert.equal(prepareContributionComparison(stale).status,'blocked');
  const mixed=structuredClone(context);mixed.input.rows.push({...mixed.input.rows[0],metadata:{accountId:'b'}});assert.equal(prepareContributionComparison(mixed).status,'blocked');
});
