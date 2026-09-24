import assert from "node:assert/strict";
import { it } from "node:test";
import { buildTrackedCurrencyPortfolio } from "../src/lib/currency-tracked-portfolio.ts";

const start = "2026-09-01T00:00:00Z", end = "2026-09-02T00:00:00Z";
const position = (price, at, quantity = "1") => ({id:"a",ownerId:"owner",name:"Actual holding",observation:{quantity,price,currency:"USD",at,basis:"raw",source:"verified_quote"}});
const fixture = () => ({ownerId:"owner",reporting:"KRW",asOf:end,current:{at:end,source:"owned_positions",scopeComplete:true,positions:[position("110",end)]},history:[{at:start,source:"owned_snapshot",scopeComplete:true,positions:[position("100",start)]}],trades:[],fx:[{base:"USD",quote:"KRW",rate:"1000",observedAt:start,fetchedAt:start,source:"daily",kind:"daily_reference"},{base:"USD",quote:"KRW",rate:"900",observedAt:end,fetchedAt:end,source:"daily",kind:"daily_reference"}],maxFxAgeMs:86400000,maxPriceAgeMs:86400000});

it("values native prices per date: +10% USD and -1% KRW, preserving FX cross term",()=>{
  const input=fixture(), krw=buildTrackedCurrencyPortfolio(input), usd=buildTrackedCurrencyPortfolio({...input,reporting:"USD"});
  assert.equal(krw.current.total,"99000"); assert.equal(krw.history[0].total,"100000");
  assert.equal(krw.movement.attribution.price,"10000");assert.equal(krw.movement.attribution.exchange,"-11000");assert.equal(krw.movement.attribution.investmentChange,"-1000");
  assert.equal(usd.current.total,"110");assert.equal(usd.history[0].total,"100");assert.equal(usd.movement.attribution.investmentChange,"10");
  assert.equal(usd.performanceReturn,null); assert.equal(usd.current.positions[0].cost,null);
});
it("closed native quote still uses valuation-time FX and retains observed price time",()=>{
  const input=fixture();input.current.positions[0].observation={...input.current.positions[0].observation,price:"100",at:end,priceObservedAt:start};
  const result=buildTrackedCurrencyPortfolio(input);assert.equal(result.current.total,"90000");assert.equal(result.current.positions[0].priceObservedAt,start);assert.equal(result.movement.attribution.exchange,"-10000");
});
it("never backfills dated history with current FX or manual exchange assumptions",()=>{
  const input=fixture();input.fx=input.fx.slice(1);input.fx.push({...input.fx[0],observedAt:start,kind:"user_input"});
  const result=buildTrackedCurrencyPortfolio(input);assert.equal(result.history[0].total,null);assert.equal(result.movement.attribution,null);assert.equal(result.current.total,"99000");
});
it("keeps unsupported gold, cash and fractional evidence in coverage without renormalizing",()=>{
  const input=fixture();input.current.positions.push({id:"gold",ownerId:"owner",name:"Gold",observation:null,unsupportedReason:"manual_gold"});
  const result=buildTrackedCurrencyPortfolio(input);assert.equal(result.current.total,null);assert.equal(result.current.verifiedSubtotal,"99000");assert.equal(result.current.coverage.positions,2);assert.equal(result.current.coverage.valued,1);assert.equal(result.current.positions[0].weightPct,null);
});
it("unknown trades do not become zero transactions when endpoint quantity matches",()=>{
  const input=fixture();input.trades=null;const result=buildTrackedCurrencyPortfolio(input);assert.equal(result.movement.attribution,null);assert.equal(result.movement.reason,"trade_evidence_missing");assert.equal(result.movement.valuationChange,"-1000");
});
it("reconciles buy legs and rejects quantity mismatch or duplicate trade IDs",()=>{
  const input=fixture();input.reporting="USD";input.current.positions[0].observation.quantity="2";
  input.trades=[{id:"t",ownerId:"owner",positionId:"a",quantityDelta:"1",price:"105",currency:"USD",at:"2026-09-01T12:00:00Z",source:"ledger"}];
  let result=buildTrackedCurrencyPortfolio(input);assert.equal(result.movement.attribution.assetTradeFlow,"105");assert.equal(result.movement.attribution.investmentChange,"15");assert.equal(result.movement.attribution.valuationChange,"120");
  input.trades=[];result=buildTrackedCurrencyPortfolio(input);assert.equal(result.movement.reason,"quantity_mismatch");
  input.trades=[{id:"t",ownerId:"owner",positionId:"a",quantityDelta:".5",price:"105",currency:"USD",at:end,source:"ledger"},{id:"t",ownerId:"owner",positionId:"a",quantityDelta:".5",price:"105",currency:"USD",at:end,source:"ledger"}];assert.equal(buildTrackedCurrencyPortfolio(input).movement.reason,"invalid_trade_ledger");
});
it("blocks cross-owner input before returning names or amounts",()=>{
  const input=fixture();input.current.positions[0].ownerId="other";input.current.positions[0].name="private-other";
  const result=buildTrackedCurrencyPortfolio(input);assert.equal(result.status,"blocked");assert.equal(result.reason,"owner_scope_mismatch");assert.equal(JSON.stringify(result).includes("private-other"),false);assert.equal(result.current,null);
});
it("rejects duplicate positions, future or stale price observations, and unordered history",()=>{
  const input=fixture();input.current.positions.push(input.current.positions[0]);assert.equal(buildTrackedCurrencyPortfolio(input).current.total,null);
  input.current.positions.pop();input.current.positions[0].observation.at="2026-09-03T00:00:00Z";assert.equal(buildTrackedCurrencyPortfolio(input).current.positions[0].reason,"invalid_price_time");
  input.current.positions[0].observation.at="2026-08-01T00:00:00Z";assert.equal(buildTrackedCurrencyPortfolio(input).current.positions[0].reason,"price_stale");
  input.current.positions[0].observation.at=end;input.history.push(input.history[0]);assert.equal(buildTrackedCurrencyPortfolio(input).history[0].complete,false);
});
it("uses only actual dated cost evidence and leaves undated acquisition basis unavailable",()=>{
  const input=fixture();input.current.positions[0].cost={amount:"90",currency:"USD",at:start,source:"trade_ledger"};assert.equal(buildTrackedCurrencyPortfolio(input).current.positions[0].cost,"90000");
  input.current.positions[0].cost.at="";assert.equal(buildTrackedCurrencyPortfolio(input).current.positions[0].cost,null);
});
it("sums fractional native values exactly before the final display boundary",()=>{
  const input=fixture();input.reporting="USD";input.current.positions=[position("0.1",end),{...position("0.2",end),id:"b"}];input.history=[];
  const result=buildTrackedCurrencyPortfolio(input);assert.equal(result.current.total,"0.3");assert.equal(result.current.verifiedSubtotal,"0.3");
});
it("keeps a captured baseline FX when later historical observations are more recent",()=>{
  const input=fixture();
  input.fx[0]={...input.fx[0],kind:"spot",observedAt:"2026-08-31T23:59:55Z",fetchedAt:"2026-08-31T23:59:56Z",capturedAt:start};
  input.fx.push({base:"USD",quote:"KRW",rate:"1050",kind:"historical_spot",source:"later_backfill",observedAt:start,requestedAt:start,fetchedAt:end});
  const result=buildTrackedCurrencyPortfolio(input);
  assert.equal(result.history[0].total,"100000");
  assert.equal(result.current.total,"99000");
  assert.equal(result.movement.attribution.investmentChange,"-1000");
  assert.equal(result.movement.attribution.price,"10000");
  assert.equal(result.movement.attribution.exchange,"-11000");
});
