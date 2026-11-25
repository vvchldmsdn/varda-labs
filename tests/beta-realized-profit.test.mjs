import assert from "node:assert/strict";
import { test } from "node:test";
import { importWithPorts } from "./helpers/import-with-ports.mjs";
import { buildTrackedCurrencyPortfolio } from "../src/lib/currency-tracked-portfolio.ts";
import { attachNativeLedgerEvidence } from "../src/lib/native-portfolio-projection.ts";
import { summarizeRecordedSales } from "../src/lib/cairn-v2/realized-profit.ts";

const costAt="2025-03-03T01:00:00Z", saleAt="2025-03-10T01:00:00Z", asOf="2025-03-11T01:00:00.000Z";
const owner="owner", scope={kind:"account",key:"account:a",accountId:"a"};
const daily=(at,rate)=>({base:"USD",quote:"KRW",kind:"daily_reference",rate,source:"bank",observedAt:at,fetchedAt:at});
const fx=[daily(costAt,"1300"),daily(saleAt,"1400")];
const account={id:"a",active:true,name:"Account",state:{at:saleAt,cash:{USD:"0",KRW:"0"},positions:[],sequence:1},
  assets:[{id:"stock",quantity:"0",name:"Sold stock",archived:true,currency:"USD"}]};
const lot={at:costAt,amount:"100",currency:"USD",source:"broker",remaining:{n:"1",d:"1"}};
const sale=(id,lots)=>({id,accountId:"a",data:{event:{type:"sell",at:saleAt,assetId:"stock",quantity:"1",currency:"USD",source:"broker"},
  state:{sequence:1},effect:{cashLegs:[],realized:{proceeds:{amount:"120",currency:"USD"},disposedCostLots:lots}}}});
const ledger={accounts:[account],accountsComplete:true,historyComplete:true,entries:[sale("sale1",[lot]),sale("sale2",null)],snapshots:[],captures:[]};
async function reader(stored=ledger,bank=[]) {
  const [r]=await importWithPorts(["src/lib/cairn-v2/realized-profit-read.ts"],{
    "@/db/queries/native-portfolio-ledger":{readNativeSaleLedger:async(tenant,id)=>{assert.equal(tenant.ownerUserId,owner);assert.equal(id,"a");if(stored instanceof Error)throw stored;return stored}},
    "@/db/queries/native-recorded-sale-fx":{readRecordedSaleFx:async()=>fx},
    "@/db/queries/broker-realized-statements":{readBrokerRealizedStatements:async()=>{if(bank instanceof Error)throw bank;return bank}},
    "@/db/queries/tenant-group-reads":{loadTenantPortfolioGroupMemberships:()=>assert.fail("unexpected group read")},
  });
  return r.readBetaRealizedProfit({ownerUserId:owner,role:"user"},scope,new Date(asOf));
}
test("detail reuses the full report sale policy for closed positions, original FX and incomplete lots",async()=>{
  const result=await reader();
  const base={ownerId:owner,asOf,current:{at:asOf,source:"test",scopeComplete:true,positions:[]},history:[],trades:null,fx,maxFxAgeMs:3*86400000,maxPriceAgeMs:86400000};
  for(const currency of ["KRW","USD"]){
    const input=attachNativeLedgerEvidence({...base,reporting:currency},ledger,"account");
    const full=buildTrackedCurrencyPortfolio(input).realizedPnl;
    assert.deepEqual(result.ledger[currency],summarizeRecordedSales(full));
    assert.equal(result.ledger[currency].sales,2);assert.equal(result.ledger[currency].valued,1);
    assert.equal(result.ledger[currency].total,null);assert.equal(result.ledger[currency].missingCostSales,1);
    assert.equal(result.ledger[currency].verifiedSubtotal,currency==="KRW"?"38000":"20");
  }
  const none=await reader({...ledger,entries:[],historyComplete:false});
  assert.equal(none.ledger.KRW.total,null);assert.equal(none.ledger.KRW.verifiedSubtotal,null);
  const empty=await reader({...ledger,entries:[]});assert.equal(empty.ledger.KRW.total,"0");
});
test("a broker statement and the native ledger are independently available with no double counting",async()=>{
  const statement={subtotalKrw:"1500"};
  assert.equal((await reader(new Error("failed"),[statement])).broker[0].subtotalKrw,"1500");
  const result=await reader(ledger,new Error("failed"));assert.equal(result.broker,null);assert.equal(result.ledger.KRW.sales,2);
  await assert.rejects(reader(new Error("failed"),new Error("failed")),/realized_profit_unavailable/);
});
test("realized endpoint rejects invalid, unsupported or stale session bindings before a financial read",async()=>{
  let calls=0;
  const [route]=await importWithPorts(["src/app/beta/api/realized-profit/route.ts"],{
    "@/lib/auth/current-tenant-context":{resolveCurrentTenantContext:async()=>({ok:true,tenantContext:{ownerUserId:owner}})},
    "@/lib/cairn-v2/server-access":{requireBetaFixtureAccess:async()=>{}},
    "@/lib/cairn-v2/display-session":{displayBindingForScopes:()=>"binding"},
    "@/db/queries/portfolio-analysis-scopes":{getReadOnlyTenantPortfolioAnalysisScopeContext:async()=>({state:"ready",catalog:{},resolution:{state:"resolved",scope}})},
    "@/lib/cairn-v2/realized-profit-read":{readBetaRealizedProfit:async()=>{calls++;return {scope:scope.key}}},
  });
  const get=(query,binding="binding")=>route.GET(new Request("https://example.test/beta/api/realized-profit?"+query,{headers:{"X-Cairn-Display-Binding":binding}}));
  for(const [q,b,status] of [["scope=account:a&scope=other","binding",400],["scope=another","binding",403],["scope=account:a","stale",409]]){
    assert.equal((await get(q,b)).status,status);assert.equal(calls,0);
  }
  const good=await get("scope=account:a");assert.equal(good.status,200);assert.equal(good.headers.get("X-Cairn-Display-Binding"),"binding");
  assert.match(good.headers.get("Cache-Control"),/no-store/);assert.deepEqual(await good.json(),{scope:scope.key});assert.equal(calls,1);
});
