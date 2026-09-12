import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculatePlan, validatePlan, parseDraft, SAMPLE_PLAN, PLAN_TTL_MS } from "../src/lib/investment-plan.ts";
import { importWithPorts } from "./helpers/import-with-ports.mjs";
const plan = () => structuredClone(SAMPLE_PLAN);
describe("Anonymous investment plan uses explicit-target allocation", () => {
  it("changes allocations when actual input changes and conserves funding", () => {
    const original=calculatePlan(plan()); const input=plan();input.amount=2000000;const changed=calculatePlan(input);
    assert.ok(original.ok&&changed.ok);assert.notDeepEqual(original.rows,changed.rows);
    assert.equal(changed.rows.reduce((s,r)=>s+r.allocation,0)+changed.result.residualCashKrw,input.amount);
    assert.equal(original.rows[0].allocation,0);
  });
  it("never sells even a zero-target overweight asset and shows a remaining gap",()=>{
    const input={currency:"KRW",amount:100,rows:[{name:"A",value:10000,targetBps:0},{name:"B",value:0,targetBps:10000}]};
    const c=calculatePlan(input);assert.ok(c.ok);assert.equal(c.rows[0].allocation,0);assert.equal(c.rows[1].allocation,100);assert.ok(c.rows[0].afterPct>0);
  });
  it("accepts a new portfolio with zero current holdings without fabricating prior weights",()=>{
    const input=plan();input.rows.forEach(r=>r.value=0);const c=calculatePlan(input);assert.ok(c.ok);assert.ok(c.rows.every(r=>r.beforePct===null));assert.deepEqual(c.rows.map(r=>r.afterPct),[50,30,20]);
  });
  it("keeps integer cap-rounding residual rather than pretending exact allocation",()=>{
    const c=calculatePlan({currency:"KRW",amount:1,rows:[{name:"A",value:0,targetBps:5000},{name:"B",value:0,targetBps:5000}]});assert.ok(c.ok);assert.equal(c.result.residualCashKrw,1);
  });
  it("rejects invalid units, invalid money and target precision/sums",()=>{
    for(const amount of [NaN,Infinity,-1,0,.01,1e13,"100"]){const p=plan();p.amount=amount;assert.equal(validatePlan(p).ok,false);}
    for(const value of [NaN,-1,Infinity,.1]){const p=plan();p.rows[0].value=value;assert.equal(validatePlan(p).ok,false);}
    for(const targetBps of [-1,5000.1,10001,4999]){const p=plan();p.rows[0].targetBps=targetBps;assert.equal(validatePlan(p).ok,false);}
    assert.equal(validatePlan({...plan(),currency:"USD"}).ok,false);
  });
  it("rejects empty/duplicate/oversized rows and labels",()=>{
    for(const rows of [[],Array(13).fill(plan().rows[0]),[null]])assert.equal(validatePlan({...plan(),rows}).ok,false);
    for(const name of [" ","x".repeat(61),"샘플 ETF B"]){const p=plan();p.rows[0].name=name;assert.equal(validatePlan(p).ok,false);}
    const p=plan();p.rows[0].name="sample";p.rows[1].name=" ＳＡＭＰＬＥ ";assert.equal(validatePlan(p).ok,false);
  });
  it("normalizes saved inputs to the minimal schema without accepting owner data",()=>{
    const p=plan();p.owner="someone";p.rows[0].quantity=42;const result=validatePlan(p);assert.ok(result.ok);assert.equal(result.input.owner,undefined);assert.equal(result.input.rows[0].quantity,undefined);
  });
  it("restores only valid unexpired drafts and rejects malformed/tampered state",()=>{
    const now=100000000;const draft={version:1,id:"11111111-1111-4111-8111-111111111111",expiresAt:now+PLAN_TTL_MS,input:plan()};
    assert.deepEqual(parseDraft(JSON.stringify(draft),now),draft);
    for(const d of [{...draft,expiresAt:now},{...draft,expiresAt:now+PLAN_TTL_MS+1},{...draft,id:"../../other"},{...draft,version:2},{...draft,input:null}])assert.equal(parseDraft(JSON.stringify(d),now),null);
    assert.equal(parseDraft("{",now),null);
  });
  it("event tracker sends fixed event names without properties and deduplicates success",async()=>{
    const calls=[];const old=globalThis.sessionStorage;const enabled=process.env.NEXT_PUBLIC_VARDA_FUNNEL_EVENTS;
    const storage=new Map();globalThis.sessionStorage={getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)};process.env.NEXT_PUBLIC_VARDA_FUNNEL_EVENTS="1";
    try{const [mod]=await importWithPorts(["src/lib/first-visit-events.ts"],{"@vercel/analytics":{track:(...args)=>calls.push(args)}});
      mod.trackFirstVisit("plan_saved","private-plan-id");mod.trackFirstVisit("plan_saved","private-plan-id");mod.trackFirstVisit("not-allowed","email@example.com");mod.trackFirstVisit("sample_result");
      assert.deepEqual(calls,[["varda_plan_saved"],["varda_sample_result"]]);
    }finally{globalThis.sessionStorage=old;if(enabled===undefined)delete process.env.NEXT_PUBLIC_VARDA_FUNNEL_EVENTS;else process.env.NEXT_PUBLIC_VARDA_FUNNEL_EVENTS=enabled;}
  });
});
