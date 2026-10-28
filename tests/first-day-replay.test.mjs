import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildFirstDayReplay} from '../src/lib/first-day-replay.ts';
const evidence={status:'ready',reason:null};
const cell=(instrumentKey,value)=>({instrumentKey,value,previous:evidence,current:evidence});
const weights=[{instrumentKey:'A',name:'A',weightBps:5000},{instrumentKey:'B',name:'B',weightBps:5000}];
function matrix(){return {status:'ready',policy:{priceField:'adjusted_close_price_only'},instruments:[{instrumentKey:'A'},{instrumentKey:'B'}],matrix:[{previousServiceDate:'2026-10-01',serviceDate:'2026-10-02',cells:[cell('A',1),cell('B',0)]},{previousServiceDate:'2026-10-02',serviceDate:'2026-10-05',cells:[cell('A',-.5),cell('B',0)]}]};}
test('frozen initial weights use buy-and-hold, not unannounced daily rebalancing',()=>{
 const input=matrix(),copy=JSON.stringify(input),result=buildFirstDayReplay(input,weights);
 assert.equal(result.state,'ready');assert.deepEqual(result.points,[100,150,100]);assert.equal(result.changePct,0);assert.equal(JSON.stringify(input),copy);
});
test('missing price/FX, raw-only prices, duplicate cells and broken date chains block output',()=>{
 for(const mutate of [m=>m.matrix[0].cells[0].value=null,m=>m.matrix[0].cells[0].current={status:'missing'},m=>m.policy.priceField='raw_close_price_only',m=>m.matrix[1].previousServiceDate='2026-10-03',m=>m.matrix[0].cells.push(cell('A',0)),m=>m.matrix[0].cells[0].value=Infinity]){
  const input=matrix();mutate(input);assert.equal(buildFirstDayReplay(input,weights).state,'unavailable');
 }
});
test('partial basket explicitly retains coverage and excluded names',()=>{
 const input=matrix();input.instruments=[{instrumentKey:'A'}];input.matrix.forEach(row=>row.cells=row.cells.slice(0,1));
 const result=buildFirstDayReplay(input,weights);assert.equal(result.coveragePct,50);assert.deepEqual(result.excluded,['B']);assert.equal(result.changePct,0);
});
test('unknown valuation never produces a portfolio return',()=>{
 assert.equal(buildFirstDayReplay(matrix(),[{...weights[0],weightBps:null},weights[1]]).state,'unavailable');
});
