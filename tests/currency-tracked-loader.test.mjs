import assert from "node:assert/strict";
import { it } from "node:test";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const scope = {kind:"all",key:"all",label:"All"};
const recent = () => new Date(Date.now()-60_000);
const asset = (extra={}) => ({id:"owned-asset",canonicalOwnerUserId:owner,accountId:"owned-account",name:"Owned ETF",assetType:"etf",market:"us",currency:"USD",ticker:"VOO",quantity:"1.123456",currentPrice:"100.1234",priceSource:"kis",priceAsOf:recent(),priceFetchedAt:recent(),priceQuoteType:"live",priceStatus:"ok",fractionalKrwValue:"0",averageCost:"90",...extra});
const sources = (extra={}) => ({assetRows:[asset()],accountRows:[],settingsRows:[],liveQuoteRows:[],recentFxRows:[],recentPositionRows:[{snapshotDate:"2026-09-01",marketValueKrw:"999999",quantity:"1",currentPrice:"100"}],eventRows:[],...extra});
async function load(rows) {
  let passed;
  const [query] = await importWithPorts(["src/db/queries/currency-tracked-portfolio.ts"], {
    "./portfolio-dashboard": {getReadOnlyTenantPortfolioDashboardSources: async args=>{passed=args;return rows;}},
    "./native-portfolio-ledger": { readNativeLedger: async () => ({ accounts: [], entries: [], snapshots: [] }) },
    "@/lib/market-data/twelve-data-service": { getTwelveDataServerConfig: () => undefined, requestTwelveDataEvidence: async () => { throw new Error("unexpected_provider_request"); }, readTwelveDataEvidence: async () => { throw new Error("unexpected_provider_read"); }, requestTwelveDataHistoricalFx: async () => { throw new Error("unexpected_provider_request"); }, readTwelveDataHistoricalFx: async () => { throw new Error("unexpected_provider_read"); }, readTwelveDataSplitRisk: async () => ({ status: "disabled", actions: [] }), requestTwelveDataSplitRisk: async () => ({ status: "disabled", actions: [] }), resolveTwelveDataTarget: () => ({ status: "disabled" }) },
    "@/lib/snapshots/market-calendar":{resolveSnapshotCycle:()=>({snapshotDate:"2026-09-13"})},
  });
  const result=await query.getTrackedCurrencyEvidence({ownerUserId:owner},scope,"USD");
  return {result,passed};
}
it("reuses scoped source reader and keeps original native decimal amounts",async()=>{
  const {result,passed}=await load(sources());assert.equal(passed.tenantContext.ownerUserId,owner);assert.deepEqual(passed.scope,scope);
  assert.equal(result.current.scopeComplete,false);assert.equal(result.current.positions[0].observation.quantity,"1.123456");assert.equal(result.current.positions[0].observation.price,"100.1234");assert.equal(result.current.positions[0].observation.currency,"USD");
  assert.equal(result.current.positions[0].observation.at,result.current.at);assert.ok(result.current.positions[0].observation.priceObservedAt<result.current.at);
  assert.deepEqual(result.history,[]);assert.equal(result.trades,null);assert.equal(result.current.positions[0].cost,null);
});
it("matches shared quotes by market, currency and ticker instead of ticker alone",async()=>{
  const quote={provider:"kis",market:"korea",currency:"KRW",ticker:"VOO",price:"9999",source:"kis",priceAsOf:recent(),fetchedAt:recent(),status:"ok",quoteType:"live"};
  const {result}=await load(sources({liveQuoteRows:[quote]}));assert.equal(result.current.positions[0].observation.price,"100.1234");
});
it("retains unsupported manual and fractional positions in the coverage universe",async()=>{
  const {result}=await load(sources({assetRows:[asset(),asset({id:"gold",assetType:"commodity"}),asset({id:"fraction",fractionalKrwValue:"1000"}),asset({id:"eur",currency:"EUR"})]}));
  assert.equal(result.current.positions.length,4);assert.equal(result.current.positions[1].unsupportedReason,"manual_gold");assert.equal(result.current.positions[2].unsupportedReason,"fractional_value_not_dated");assert.equal(result.current.positions[3].unsupportedReason,"unsupported_instrument");
});
it("requires real native observation dates and ignores undated historic FX",async()=>{
  const {result}=await load(sources({assetRows:[asset({priceAsOf:null})],recentFxRows:[{usdKrw:"1400",source:"legacy",rateDate:"2026-09-13",fetchedAt:recent(),observedAt:null,rateKind:null}]}));
  assert.equal(result.current.positions[0].observation,null);assert.deepEqual(result.fx,[]);
});
it("finds an admissible KIS quote after a newer unsupported provider candidate",async()=>{
  const quote={provider:"kis",market:"us",currency:"USD",ticker:"VOO",price:"250",source:"kis",priceAsOf:recent(),fetchedAt:recent(),status:"ok",quoteType:"live"};
  const {result}=await load(sources({liveQuoteRows:[{...quote,provider:"unlicensed",source:"unlicensed",price:"999"},quote]}));assert.equal(result.current.positions[0].observation?.price,"250");
});
it("falls back to valid stored native evidence when live provider admission fails",async()=>{
  const quote={provider:"unlicensed",market:"us",currency:"USD",ticker:"VOO",price:"999",source:"unlicensed",priceAsOf:recent(),fetchedAt:recent(),status:"ok",quoteType:"live"};
  const {result}=await load(sources({liveQuoteRows:[quote]}));assert.equal(result.current.positions[0].observation?.price,"100.1234");
});
it("rejects mixed owners before any private source data can reach client props",async()=>{
  await assert.rejects(load(sources({assetRows:[asset({canonicalOwnerUserId:"other-owner",name:"private-other"})]})), error => {
    assert.equal(error.message,"currency_owner_scope_mismatch");
    assert.equal(String(error).includes("private-other"),false);
    return true;
  });
});
