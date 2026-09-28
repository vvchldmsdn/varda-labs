import assert from "node:assert/strict";
import { it } from "node:test";
import { buildCalendarAlignedPrivateOwnerRawCloseMatrix, buildPrivateOwnerRawCloseSimulationReturnMatrix } from "../src/lib/simulation-return-matrix.ts";
import { validateAndHashReadyReturnMatrix } from "../src/lib/simulation-stationary-bootstrap-serialization.ts";
const instruments=[{market:"korea",currency:"KRW",ticker:"TESTKR",historyStatus:"instrument_keyed"},{market:"us",currency:"USD",ticker:"TESTUS",historyStatus:"instrument_keyed"}];
const price=(index,date,value)=>({...instruments[index],priceDate:date,rawClosePrice:value});
function input(){return {
  requestedServiceDates:["2026-09-24","2026-09-25","2026-09-26","2026-09-29"],instruments,
  priceRows:[price(0,"2026-09-23",100),price(0,"2026-09-28",110),price(1,"2026-09-23",100),price(1,"2026-09-24",100),price(1,"2026-09-25",100),price(1,"2026-09-28",110)],
  fxRows:["2026-09-23","2026-09-24","2026-09-25","2026-09-28"].map((rateDate,index)=>({rateDate,usdKrw:index===0?1000:1010,status:"ok"})),
};}
it("carries only a known Korean holiday; applies dated FX once with independent expected returns",()=>{
  const result=buildCalendarAlignedPrivateOwnerRawCloseMatrix(input());
  assert.equal(result.status,"ready");
  assert.equal(result.policy.version,"simulation_private_owner_raw_close_return_matrix_v2");
  assert.equal(result.matrix[0].cells[0].value,0);
  assert.ok(Math.abs(result.matrix[0].cells[1].value-0.01)<1e-12);
  assert.equal(result.matrix[1].cells[0].value,0);
  assert.ok(Math.abs(result.matrix[2].cells[0].value-0.1)<1e-12);
  assert.ok(Math.abs(result.matrix[2].cells[1].value-0.1)<1e-12);
  const one=validateAndHashReadyReturnMatrix(result),two=validateAndHashReadyReturnMatrix(buildCalendarAlignedPrivateOwnerRawCloseMatrix(input()));
  assert.deepEqual(one,two);assert.deepEqual(one.blockers,[]);
});
it("does not carry an open trading-day gap within the old seven-day allowance",()=>{
  const data=input();data.priceRows=data.priceRows.filter(row=>!(row.market==="korea"&&row.priceDate==="2026-09-28"));
  const result=buildCalendarAlignedPrivateOwnerRawCloseMatrix(data);
  assert.equal(result.status,"incomplete");assert.equal(result.matrix[2].cells[0].value,null);
  assert.equal(result.matrix[2].cells[0].current.reason,"missing_trading_day_price");
  assert.notEqual(result.matrix[2].cells[1].value,null);
});
it("rejects a fabricated close dated on a holiday even with zero carry days",()=>{
  const data=input();data.priceRows.push(price(0,"2026-09-24",120));
  const result=buildCalendarAlignedPrivateOwnerRawCloseMatrix(data);
  assert.equal(result.matrix[0].cells[0].current.reason,"missing_trading_day_price");
});
it("retains historical v1 meaning while giving new calendar runs a distinct hash",()=>{
  const data=input(),legacy=buildPrivateOwnerRawCloseSimulationReturnMatrix(data);
  assert.equal(legacy.policy.version,"simulation_private_owner_raw_close_return_matrix_v1");
  assert.equal(legacy.status,"ready");assert.deepEqual(validateAndHashReadyReturnMatrix(legacy).blockers,[]);
  const current=buildCalendarAlignedPrivateOwnerRawCloseMatrix(data);
  assert.notDeepEqual(validateAndHashReadyReturnMatrix(legacy).canonical,validateAndHashReadyReturnMatrix(current).canonical);
});
