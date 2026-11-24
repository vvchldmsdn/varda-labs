import assert from 'node:assert/strict';
import { it } from 'node:test';
import { calculateExplainableAdditionalContribution } from '../src/lib/additional-contribution-policy-engine.ts';
import { calculateContributionFxOverlay, resolveContributionMultipliers } from '../src/lib/additional-contribution-modifiers.ts';
import { calculateCurrencyContribution } from '../src/lib/currency-contribution.ts';
import { buildNativeContributionPlan } from '../src/lib/native-contribution-plan.ts';

const known = value => ({ status: 'ready', value, source: 'deterministic_test', asOf: '2026-09-27T00:00:00Z' });
const evidence = (label='경계') => ({ regime: known(label), fx: known({ multiplier: 1, hot: false, observationCount: 252 }), eventScore: known(70), performance: known({ alpha90Pct: 1, alpha252Pct: 1, mddPct: 0 }), fundingBasis: 'KRW' });
const row = (key, overrides={}) => ({ allocationKey:key, assetType:'etf', buyable:true, costBasisKrw:500000, currentValueKrw:500000, targetWeightBps:5000, maAssetClass:'broad_index', maRuleEnabled:true, ma120Evidence:{status:'above_ma',distanceFromMaPct:1}, riskContribution:known(0.5), fxExposureType:'DOMESTIC', metadata:null, ...overrides });
const calculate = (rows=[row('a'),row('b')], extra={}) => calculateExplainableAdditionalContribution({ cashAmountKrw:100000, minimumExecutionRatioPct:85, trimDriftThresholdPct:12, rows, modifiers:evidence(), ...extra });

it('applies the verified danger-regime reduction before conditional topup',()=>{
  const result=calculate();
  assert.equal(result.status,'ready');
  assert.deepEqual(result.rows.map(r=>r.allocationKrw),[35000,35000]);
  assert.equal(result.totalAllocatedKrw,70000);
  assert.equal(result.residualCashKrw,30000);
  assert.equal(result.minimumExecutionTargetKrw,85000);
  assert.equal(result.minimumExecutionSatisfied,false);
});

it('retains the basic allocation exactly when all five observed multipliers are neutral',()=>{
  const a=calculate(undefined,{modifiers:evidence('안정')}),b=calculate(undefined,{modifiers:undefined});
  assert.equal(a.totalAllocatedKrw,100000);assert.equal(a.residualCashKrw,0);
  assert.deepEqual(a.rows.map(row=>row.allocationKrw),b.rows.map(row=>row.allocationKrw));
  assert.equal(a.policy.version,'gyeol_fin_explainable_rebalance_v3');assert.equal(b.policy.version,'gyeol_fin_explainable_rebalance_base_v3');
});
it('reconciles each rule to the approved baseline and final allocation, including redistribution and rounding', () => {
  const modifiers = {...evidence('안정'), fx: known({multiplier:.744, hot:false, observationCount:252}),
    eventScore:known(43), performance:known({alpha90Pct:-1,alpha252Pct:-2,mddPct:-13})};
  const rows = [row('a',{currentValueKrw:210000,costBasisKrw:null,fxExposureType:'US_LISTED',riskContribution:known(.9),
    ma120Evidence:{status:'below_ma',distanceFromMaPct:-1.5}}), row('b',{currentValueKrw:790000,costBasisKrw:null})];
  const result = calculate(rows,{cashAmountKrw:1000003, modifiers, minimumExecutionRatioPct:53});
  assert.equal(result.status,'ready');
  assert.equal(result.effectiveMinimumRatioPct,53);
  for (const row of result.rows) {
    const steps = row.ruleSteps;
    assert.deepEqual(steps.map(step=>step.rule),['ma120','fx','rc','regime','event','performance','minimum']);
    assert.equal(steps[0].beforeKrw,row.strategicAllocationKrw);
    assert.equal(steps[0].afterKrw,row.rawAllocationKrw);
    assert.equal(steps.at(-2).afterKrw,row.modifierBreakdown.penalizedAllocationKrw);
    assert.equal(steps.at(-1).deltaKrw,row.modifierBreakdown.topupAllocationKrw);
    assert.equal(steps.at(-1).afterKrw,row.allocationKrw);
    for (const [i, step] of steps.entries()) {
      if (i) assert.equal(step.beforeKrw,steps[i-1].afterKrw);
      assert.equal(step.deltaKrw,step.afterKrw-step.beforeKrw);
    }
  }
  assert.ok(result.rows[0].ruleSteps.find(step=>step.rule==='fx').deltaKrw<0);
  assert.equal(result.rows[1].ruleSteps.find(step=>step.rule==='fx').deltaKrw,0);
});
it('tops up an eligible holding with missing evidence and preserves a known MA reduction',()=>{
  const missing = {status:'unavailable',reason:'missing'};
  const modifiers = {fundingBasis:'KRW',eventScore:missing,regime:missing,fx:missing,performance:missing};
  const common = {currentValueKrw:100000, targetWeightBps:4000, costBasisKrw:null, riskContribution:missing, fxExposureType:'US_LISTED'};
  const result = calculate([
    row('a',{...common,maAssetClass:'thematic',ma120Evidence:{status:'below_ma',distanceFromMaPct:-4}}),
    row('b',common),
    row('over',{currentValueKrw:800000,targetWeightBps:2000,costBasisKrw:null}),
  ],{modifiers});
  const [reduced, eligible] = result.rows;
  assert.equal(reduced.effectiveTargetWeightBps,4000);
  assert.deepEqual(reduced.ruleSteps[0],{rule:'ma120',beforeKrw:50000,afterKrw:25000,deltaKrw:-25000});
  assert.deepEqual(reduced.modifierBreakdown.topupBlockers,['ma_not_eligible']);
  for (const rule of ['fx','rc','regime','event','performance']) {
    assert.equal(eligible.modifierBreakdown.multipliers[rule].status,'unavailable');
    assert.equal(eligible.modifierBreakdown.multipliers[rule].value,1);
  }
  assert.equal(eligible.modifierBreakdown.topupEligible,true);
  assert.equal(eligible.modifierBreakdown.topupAllocationKrw,10000);
  assert.equal(result.minimumExecutionEvidenceAvailable,true);
  assert.equal(result.effectiveMinimumRatioPct,85);
  assert.equal(result.totalAllocatedKrw,85000);
  assert.equal(result.minimumExecutionSatisfied,true);
});
it('uses the raw 60-to-251 observation count, skips unavailable MA120 and clamps FX at 0.55',()=>{
  assert.equal(calculateContributionFxOverlay(Array(59).fill(1000),35),null);
  const partial=calculateContributionFxOverlay([...Array(59).fill(1000),1500],35);
  assert.equal(partial.observationCount,60);assert.equal(partial.percentileLookback,60);assert.equal(partial.ma120Available,false);assert.equal(partial.multiplier,.55);assert.equal(partial.hot,true);
  const full=calculateContributionFxOverlay([...Array(251).fill(1000),1500],35);assert.equal(full.percentileLookback,252);assert.equal(full.ma120Available,true);
  const stretch=calculateContributionFxOverlay([...Array(251).fill(1000),1010],0);assert.equal(stretch.stretchMult,.98);
});
it('applies known FX, MDD and RC reductions while retaining the configured minimum',()=>{
  const m={...evidence('안정'),fx:known({multiplier:.55,hot:true,observationCount:252}),eventScore:known(39),performance:known({alpha90Pct:-1,alpha252Pct:-1,mddPct:-10})};
  const resolved=resolveContributionMultipliers({modifiers:m,exposure:'US_LISTED',riskContribution:known(.75),targetFraction:.5});
  assert.equal(resolved.fx.value,.55);assert.equal(resolved.rc.value,.85);assert.equal(resolved.event.value,.9);assert.equal(resolved.performance.value,.9);assert.equal(resolved.penaltyMult,.3787);
  const result=calculate(undefined,{modifiers:m});assert.equal(result.minimumExecutionTargetKrw,85000);
});
it('caps topup at each remaining gap and redistributes only to eligible candidates',()=>{
  const m={...evidence('안정'),fx:known({multiplier:.55,hot:false,observationCount:252})};
  // Available 300k, exact target gaps 100k and 200k; the safe holding is already full.
  const rows=[row('risky',{currentValueKrw:500000,targetWeightBps:5000,fxExposureType:'US_LISTED'}),row('safe',{currentValueKrw:400000,targetWeightBps:5000})];
  const result=calculate(rows,{cashAmountKrw:300000,modifiers:m,trimDriftThresholdPct:100});
  assert.equal(result.status,'ready');
  const safe=result.rows.find(row=>row.allocationKey==='safe');
  assert.equal(safe.modifierBreakdown.topupEligible,false); // raw allocation already fills its 200k gap
  assert.equal(result.totalAllocatedKrw,255000);assert.equal(result.residualCashKrw,45000);
  const many=[row('risk',{currentValueKrw:700000,targetWeightBps:5000,fxExposureType:'US_LISTED'}),row('a',{currentValueKrw:100000,targetWeightBps:2500,riskContribution:known(.25)}),row('b',{currentValueKrw:200000,targetWeightBps:2500,riskContribution:known(.25)})];
  const forward=calculate(many,{cashAmountKrw:1000000,modifiers:m,trimDriftThresholdPct:100});
  const reverse=calculate([...many].reverse(),{cashAmountKrw:1000000,modifiers:m,trimDriftThresholdPct:100});
  assert.deepEqual(forward.rows,reverse.rows);assert.ok(forward.rows.every(row=>row.allocationKrw<=Math.floor(row.baseNeedKrw)));assert.equal(forward.totalAllocatedKrw+forward.residualCashKrw,forward.totalAvailableFundsKrw);
});
it('tops up one eligible holding and leaves cash when its capacity is exhausted',()=>{
  const m={...evidence('안정'),fx:known({multiplier:.55,hot:false,observationCount:252})};
  const result=calculate([row('risk',{currentValueKrw:100000,targetWeightBps:4000,riskContribution:known(.4),fxExposureType:'US_LISTED',costBasisKrw:null}),row('safe',{currentValueKrw:100000,targetWeightBps:4000,riskContribution:known(.4),costBasisKrw:null}),row('over',{currentValueKrw:800000,targetWeightBps:2000,riskContribution:known(.2),costBasisKrw:null})],{modifiers:m});
  assert.equal(result.totalAllocatedKrw,85000);assert.equal(result.residualCashKrw,15000);
  assert.equal(result.rows.find(r=>r.allocationKey==='safe').modifierBreakdown.topupAllocationKrw,7500);
  const capped=calculate([row('risk',{currentValueKrw:400000,targetWeightBps:5000,fxExposureType:'US_LISTED',costBasisKrw:null}),row('safe',{currentValueKrw:520000,targetWeightBps:5000,costBasisKrw:null}),row('over',{currentValueKrw:80000,targetWeightBps:0,costBasisKrw:null})],{modifiers:m});
  // 150k:30k gaps -> raw 83,333:16,667 -> 45,833 + 30,000 after capacity-limited topup.
  assert.equal(capped.totalAllocatedKrw,75833);assert.equal(capped.residualCashKrw,24167);
  assert.equal(capped.rows.find(r=>r.allocationKey==='safe').allocationKrw,30000);
  assert.equal(capped.minimumExecutionSatisfied,false);
  assert.equal(capped.minimumTopupCapacityKrw,13333);
  assert.equal(capped.rows.find(r=>r.allocationKey==='safe').modifierBreakdown.topupCapacityKrw,13333);
});
it('reports an unmet configured minimum when none of the target gaps covers a whole won', () => {
  const rows = ['a','b'].map(key => row(key, {currentValueKrw:10000.25,
    ma120Evidence:{status:'below_ma',distanceFromMaPct:-4}}));
  const result = calculate(rows, {cashAmountKrw:1, modifiers:evidence('안정')});
  assert.equal(result.status,'ready');
  assert.equal(result.totalBaseNeedKrw,1);
  assert.equal(result.totalBuyCapacityKrw,0);
  assert.equal(result.minimumExecutionTargetKrw,1);
  assert.equal(result.minimumExecutionSatisfied,false);
  assert.equal(result.totalAllocatedKrw,0);
});
it('uses exact whole-won minimum targets for decimal policy percentages', () => {
  const result = calculate(undefined,{cashAmountKrw:10000,modifiers:evidence('안정'),minimumExecutionRatioPct:57});
  assert.equal(result.minimumExecutionTargetKrw,5700);
});
it('uses actual funding currency for FX rather than applying it again after a display switch',()=>{
  const at='2026-09-27T00:00:00Z';
  const input={reportingCurrency:'USD',asOf:at,fx:[],maxFxAgeMs:86400000,trimDriftThresholdPct:12,minimumExecutionRatioPct:85,modifiers:{...evidence('경계'),fx:known({multiplier:.55,hot:true,observationCount:252})},funds:[{amount:'100.01',currency:'USD',at,source:'user',kind:'new_money'}],rows:[row('a'),row('b')].map(r=>({...r,fxExposureType:'US_LISTED',value:{amount:'500',currency:'USD',at,source:'test'},cost:null}))};
  const result=calculateCurrencyContribution(input);assert.equal(result.status,'ready');
  assert.equal(result.rows[0].modifierBreakdown.multipliers.fx.status,'unavailable');
  assert.equal(result.rows[0].modifierBreakdown.multipliers.fx.reason,'funding_currency_policy_undefined');
  // Each exact $50.005 gap caps at $50.00 before the 0.70 multiplier.
  assert.equal(result.buys,70);assert.equal(result.remainingCash,30.01);
});
it('includes native USD sale proceeds in the funding-policy boundary even with KRW new money',()=>{
  const at='2026-09-27T00:00:00Z';
  const input={reportingCurrency:'KRW',asOf:at,fx:[{base:'USD',quote:'KRW',rate:'1000',observedAt:at,fetchedAt:at,source:'test',kind:'daily_reference'}],maxFxAgeMs:86400000,trimDriftThresholdPct:12,minimumExecutionRatioPct:85,modifiers:evidence('안정'),funds:[{amount:'100000',currency:'KRW',at,source:'user',kind:'new_money'}],rows:[{...row('a'),maRuleEnabled:false,fxExposureType:'US_LISTED',value:{amount:'900',currency:'USD',at,source:'test'},cost:{amount:'400',currency:'USD',at,source:'test'}},{...row('b'),maRuleEnabled:false,fxExposureType:'US_LISTED',value:{amount:'100',currency:'USD',at,source:'test'},cost:null}]};
  const result=calculateCurrencyContribution(input);assert.equal(result.status,'ready');assert.ok(result.sales>0);
  assert.equal(result.modifierEvidence.fundingBasis,'unsupported');
  assert.equal(result.rows[1].modifierBreakdown.multipliers.fx.status,'unavailable');
  assert.equal(result.minimumExecutionEvidenceAvailable,false);
});
it('blocks cash from another account without blocking unused or same-account cash',()=>{
  const at='2026-09-27T00:00:00Z', account='11111111-1111-4111-8111-111111111111', cashAccount='22222222-2222-4222-8222-222222222222';
  const context={status:'ready',scopeKey:'all',scopeLabel:'All',policy:{version:'test',revision:1,universeHash:'u',vectorHash:'v',effectiveServiceDate:'2026-09-27'},nativeSequences:{[account]:1,[cashAccount]:1},names:{a:'A'},availableCash:[{amount:'1000',currency:'KRW',at,source:'native_ledger_cash',kind:'native_cash',accountId:cashAccount}],input:{reportingCurrency:'KRW',asOf:at,fx:[],maxFxAgeMs:86400000,trimDriftThresholdPct:12,minimumExecutionRatioPct:85,modifiers:evidence('안정'),rows:[{...row('a'),metadata:{accountId:account},targetWeightBps:10000,value:{amount:'10000',currency:'KRW',at,source:'test'},cost:null}]}};
  const request={id:'33333333-3333-4333-8333-333333333333',scopeKey:'all',reportingCurrency:'KRW',newMoney:{amount:'0',currency:'KRW'},useAvailableCash:true};
  assert.deepEqual(buildNativeContributionPlan(context,request),{status:'blocked',reason:'choose_account_for_funding'});
  assert.equal(buildNativeContributionPlan(context,{...request,newMoney:{amount:'1000',currency:'KRW'},useAvailableCash:false}).status,'ready');
  context.availableCash[0].accountId=account;
  assert.equal(buildNativeContributionPlan(context,request).status,'ready');
});


it('compares RC thresholds exactly without promoting values below the decimal boundary',()=>{
  const cases=[
    [.23999999999999996,.2,1], [.24,.2,.9], [.24000000000000002,.2,.9],
    [.29999999999999993,.2,.9], [.3,.2,.85], [.30000000000000004,.2,.85],
    [.14999,.1,.9], [.15,.1,.85], [.075,.05,.85], [.03,.02,.85],
    [.06,.05,.9], [.12,.1,.9], [.00003,.00002,.85],
  ];
  for(const [risk,target,expected] of cases) {
    const result=resolveContributionMultipliers({modifiers:evidence(),exposure:'DOMESTIC',riskContribution:known(risk),targetFraction:target});
    assert.equal(result.rc.status,'ready');
    assert.equal(result.rc.value,expected,JSON.stringify({risk,target,expected}));
  }
});
