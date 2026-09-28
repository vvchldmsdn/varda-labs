import assert from 'node:assert/strict';
import { it } from 'node:test';
import { importWithPorts } from './helpers/import-with-ports.mjs';

// Fixed-coefficient unit check, deliberately NOT a provider/raw-factor test.
// Only factor resolution is substituted; raw allocation, score, caps, rounding,
// minimum and redistribution all execute the unchanged production engine.
const known=value=>({status:'ready',value,source:'synthetic-fixed-coefficients',asOf:'2026-09-27T00:00:00Z'});
const row=(key,penalty,extra={})=>({allocationKey:key,assetType:'etf',buyable:true,costBasisKrw:null,currentValueKrw:500000,targetWeightBps:5000,maAssetClass:'broad_index',maRuleEnabled:false,fxExposureType:'DOMESTIC',riskContribution:known(penalty),...extra});
const [engine]=await importWithPorts(['src/lib/additional-contribution-policy-engine.ts'],{
 './additional-contribution-modifiers.ts':{
  contributionMinimumRatio:()=>.85, contributionFxPriority:()=>1,
  resolveContributionMultipliers:({riskContribution})=>({fx:known(1),rc:known(1),regime:known(1),event:known(1),performance:known(1),penaltyMult:riskContribution.value}),
 },
});
const calc=(rows,cash=100000)=>engine.calculateExplainableAdditionalContribution({rows,cashAmountKrw:cash,minimumExecutionRatioPct:85,trimDriftThresholdPct:12,modifiers:{fundingBasis:'KRW'}});
const amounts=r=>Object.fromEntries(r.rows.map(x=>[x.allocationKey,x.allocationKrw]));
it('fixed .90/.70: 45000+35000 then A +5000; final 50000/35000/cash15000',()=>{
 const r=calc([row('A',.9),row('B',.7)]);
 assert.equal(r.status,'ready');assert.equal(r.minimumExecutionTargetKrw,85000);
 assert.deepEqual(r.rows.map(x=>x.baseNeedKrw),[50000,50000]);
 assert.deepEqual(r.rows.map(x=>x.modifierBreakdown.penalizedAllocationKrw),[45000,35000]);
 assert.deepEqual(r.rows.map(x=>x.modifierBreakdown.topupAllocationKrw),[5000,0]);
 assert.deepEqual(amounts(r),{A:50000,B:35000});assert.equal(r.residualCashKrw,15000);
});
it('no eligible candidates has zero score and preserves cash',()=>{
 const r=calc([row('A',.7),row('B',.7)]);
 assert.deepEqual(amounts(r),{A:35000,B:35000});assert.equal(r.residualCashKrw,30000);
 assert.ok(r.rows.every(x=>x.modifierBreakdown.topupScore===0 && !x.modifierBreakdown.topupEligible));
});
const roomy=(a,b)=>[row('A',a,{currentValueKrw:100000,targetWeightBps:2000}),row('B',b,{currentValueKrw:100000,targetWeightBps:2000}),row('C',.5,{currentValueKrw:100000,targetWeightBps:2000}),row('D',.5,{currentValueKrw:100000,targetWeightBps:2000}),row('over',1,{currentValueKrw:600000,targetWeightBps:2000})];
it('different scores 57.50/56.25 split 16250 into 8214/8036 independently',()=>{
 const r=calc(roomy(.9,.85));
 assert.deepEqual(r.rows.slice(0,2).map(x=>x.modifierBreakdown.topupScore),[57.5,56.25]);
 assert.deepEqual(amounts(r),{A:30714,B:29286,C:12500,D:12500,over:0});assert.equal(r.residualCashKrw,15000);
});
it('capacity exhaustion caps both candidates and leaves an unmet minimum as cash',()=>{
 const r=calc(['A','B','C','D'].map((k,i)=>row(k,[.9,.85,.5,.5][i],{currentValueKrw:250000,targetWeightBps:2500})));
 assert.deepEqual(amounts(r),{A:25000,B:25000,C:12500,D:12500});assert.equal(r.residualCashKrw,25000);assert.equal(r.minimumExecutionSatisfied,false);
});
it('score ties and odd minor units are key deterministic under row reordering',()=>{
 const rows=roomy(.9,.9),r=calc(rows,100001),back=calc([...rows].reverse(),100001);
 // raw A=25001 B/C/D=25000; rounded A=22501 B=22500 C/D=12500.
 // floor minimum=85000, shortfall14999; equal rounded scores57.50 give A7500/B7499.
 assert.deepEqual(amounts(r),{A:30001,B:29999,C:12500,D:12500,over:0});
 assert.deepEqual(amounts(r),amounts(back));assert.equal(r.residualCashKrw,15001);
});
it('redistributes after the small candidate caps instead of losing its unused share',()=>{
 const r=calc([row('A',.9,{currentValueKrw:218000,targetWeightBps:2000}),row('B',.85,{currentValueKrw:100000,targetWeightBps:2000}),row('C',.5,{currentValueKrw:100000,targetWeightBps:2000}),row('D',.5,{currentValueKrw:100000,targetWeightBps:2000}),row('over',1,{currentValueKrw:482000,targetWeightBps:2000})]);
 // A caps at 2000; all remaining shortfall can go to B (capacity120000).
 assert.deepEqual(amounts(r),{A:2000,B:49850,C:16575,D:16575,over:0});assert.equal(r.residualCashKrw,15000);
});
