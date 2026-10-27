import assert from "node:assert/strict";
import {test} from "node:test";
import {createRequire} from "node:module";
import fs from "node:fs";import os from "node:os";import path from "node:path";import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../../",import.meta.url)),req=createRequire(path.join(root,"package.json"));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"cairn-kis-revisions-")),bundle=path.join(dir,"domain.cjs");
req("esbuild").buildSync({stdin:{contents:'export * from "./src/lib/market-data/kis-history-revision-policy";export * from "./src/lib/market-data/kis-paired-history-write";export * from "./src/lib/market-data/close-gap-policy";',resolveDir:root,loader:"ts"},outfile:bundle,bundle:true,platform:"node",format:"cjs",tsconfig:path.join(root,"tsconfig.json"),logLevel:"silent"});
const {confirmedKisHistoryRevisions,isFinalizedKisHistoryDate,writeKisPairedHistory,planCloseGapJobs,closeIdentity}=req(bundle);
process.on("exit",()=>fs.rmSync(dir,{recursive:true,force:true}));
const claim={key:"kis:history:paired_v1:us:USD:TEST:2026-10-01:2026-10-27",claimToken:"00000000-0000-4000-8000-000000000001"};
const row={ticker:"TEST",market:"us",currency:"USD",priceDate:"2026-10-22",closePrice:"101",adjustedClosePrice:"101",adjustedCloseBasis:"provider_adjusted_close_v1",adjustedCloseProvider:"kis",adjustedCloseSource:"kis_overseas_dailyprice:NAS:adjusted_v1",adjustedCloseFetchedAt:new Date("2026-10-27T10:01:00Z"),closePriceKrw:null,fxRate:null,providerSymbol:"TEST",providerExchange:"NAS",fetchedAt:new Date("2026-10-27T10:00:00Z"),source:"kis_overseas_dailyprice:NAS:raw_v2",quoteType:"close",status:"ok",isSample:false};
const first={...row,fetchedAt:new Date("2026-10-27T09:00:00Z"),adjustedCloseFetchedAt:new Date("2026-10-27T09:01:00Z")};
test("revision requires independent later matching raw and adjusted evidence",()=>{
 assert.equal(confirmedKisHistoryRevisions([row],[first]).length,1);
 for(const changed of [{closePrice:"100.9"},{adjustedClosePrice:"100.9"},{providerExchange:"NYS"},{source:"manual_override"},{fetchedAt:row.fetchedAt}]){
  assert.equal(confirmedKisHistoryRevisions([row],[{...first,...changed}]).length,0);
 }
});
test("only completed trading dates are admitted across DST and holidays",()=>{
 assert.equal(isFinalizedKisHistoryDate({...row,priceDate:"2026-10-27",fetchedAt:new Date("2026-10-28T04:00:00Z")}),true);
 assert.equal(isFinalizedKisHistoryDate({...row,priceDate:"2026-10-27",fetchedAt:new Date("2026-10-28T00:00:00Z")}),false);
 assert.equal(isFinalizedKisHistoryDate({...row,priceDate:"2026-10-28",fetchedAt:new Date("2026-10-28T00:00:00Z")}),false);
 assert.equal(isFinalizedKisHistoryDate({...row,priceDate:"2026-11-02",fetchedAt:new Date("2026-11-02T20:00:00Z")}),false);
 assert.equal(isFinalizedKisHistoryDate({...row,priceDate:"2026-07-03",fetchedAt:new Date("2026-07-04T00:00:00Z")}),false);
});
test("open-session rows and malformed claim never reach the database",async()=>{
 let calls=0;const query=async()=>{calls++;return []};
 await assert.rejects(()=>writeKisPairedHistory(query,claim,[{...row,priceDate:"2099-10-22"}]),/provenance/);
 await assert.rejects(()=>writeKisPairedHistory(query,{...claim,claimToken:"bad"},[row]),/boundary/);
 assert.equal(calls,0);
});
test("writer passes only validated confirmation evidence to the atomic SQL",async()=>{
 let params;const query=async(_sql,p)=>{params=p;return [{claimed:1,written:1,inserted:0,diagnostics:[]}]};
 await writeKisPairedHistory(query,claim,[row],[first]);
 assert.equal(JSON.parse(params[3]).length,1);
 await writeKisPairedHistory(query,claim,[row],[{...first,closePrice:"100.9"}]);
 assert.equal(JSON.parse(params[3]).length,0);
});
test("raw-only presence still produces an independent adjusted-history job",()=>{
 const target={ticker:"TEST",market:"us",currency:"USD",firstCloseDate:"2026-10-27"};
 const rawPresent=new Set([closeIdentity(target,"2026-10-27")]);
 assert.equal(planCloseGapJobs([target],rawPresent,new Date("2026-10-28T00:00:00Z")).length,0);
 const jobs=planCloseGapJobs([target],new Set(),new Date("2026-10-28T00:00:00Z"));
 assert.equal(jobs.length,1);assert.equal(jobs[0].startDate,"2026-10-27");assert.equal(jobs[0].endDate,"2026-10-27");
});

