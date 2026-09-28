import {it} from "node:test";
import assert from "node:assert/strict";
import {pairKisHistory,mergeKisPairedHistory} from "../src/lib/market-data/providers/kis-paired-history.ts";
import {writeKisPairedHistory} from "../src/lib/market-data/kis-paired-history-write.ts";
it("pairs independent adjusted closes and refuses missing or conflicting evidence",async()=>{
 const row={ticker:"SYN",market:"us",currency:"USD",priceDate:"2026-09-18",closePrice:"100",source:"kis_overseas_dailyprice:NAS",providerSymbol:"SYN",providerExchange:"NAS",status:"ok",fetchedAt:new Date("2026-09-19T00:00:00Z")};
 const paired=pairKisHistory([row],[{...row,closePrice:"50"}]);assert.equal(paired[0].closePrice,"100");assert.equal(paired[0].adjustedClosePrice,"50");
 assert.throws(()=>pairKisHistory([row],[]),/pair_missing/);
 assert.throws(()=>pairKisHistory([row],[{...row,providerExchange:"NYS"}]),/pair_missing/);
 assert.throws(()=>mergeKisPairedHistory([paired,[{...paired[0],adjustedClosePrice:"40"}]]),/conflicting/);
 let calls=0;await assert.rejects(writeKisPairedHistory(async()=>{calls++;return[];},{key:"kis:history:old",claimToken:"invalid"},paired),/boundary/);assert.equal(calls,0);
});

it("the real adapter makes distinct raw and adjusted requests for both markets",async()=>{
 const previous={key:process.env.KIS_APP_KEY,secret:process.env.KIS_APP_SECRET};
 process.env.KIS_APP_KEY='synthetic-only';process.env.KIS_APP_SECRET='synthetic-only';
 try {
  const {importWithPorts}=await import('./helpers/import-with-ports.mjs');const requests=[];
  const [kis]=await importWithPorts(['src/lib/market-data/providers/kis.ts'],{
   './kis-token-lifecycle':{getReusableKisAccessToken:async()=> 'synthetic-only'},
   '@/lib/market-data/provider-budget':{fetchKisWithBudget:async(_config,value)=>{
    const url=new URL(value);requests.push(url);const domestic=url.pathname.includes('domestic-stock');
    const adjusted=url.searchParams.get(domestic?'fid_org_adj_prc':'MODP')===(domestic?'0':'1');
    return Response.json({rt_cd:'0',output2:[domestic?{stck_bsop_date:'20260918',stck_clpr:adjusted?'50':'100'}:{xymd:'20260918',clos:adjusted?'50':'100'}]});
   }},
  });
  for(const [market,currency,ticker] of [['korea','KRW','999999'],['us','USD','SYN']]) {
   const result=await kis.createKisMarketDataProvider().fetchHistoricalClosePrices([{market,currency,ticker,assetIds:[],assetNames:[],accounts:[],key:ticker}],{startDate:'2026-09-18',endDate:'2026-09-18',requestedAt:new Date(),dryRun:true,includeAdjusted:true});
   assert.equal(result.failures.length,0);assert.equal(result.requestCount,2);assert.equal(result.priceBasis,'raw_and_provider_adjusted');
   assert.equal(result.rows[0].closePrice,'100');assert.equal(result.rows[0].adjustedClosePrice,'50');
  }
  assert.deepEqual(requests.map(u=>u.searchParams.get('fid_org_adj_prc')??u.searchParams.get('MODP')),['1','0','0','1']);
 } finally {for(const [key,value] of [['KIS_APP_KEY',previous.key],['KIS_APP_SECRET',previous.secret]]) if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
