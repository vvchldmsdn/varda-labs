import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Opt-in PostgreSQL verification. Every write targets transaction-local temporary
// copies; public schemas are read only, and ON COMMIT DROP removes fixture rows.
const root=fileURLToPath(new URL('../../',import.meta.url)),req=createRequire(path.join(root,'package.json'));
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cairn-history-sql-')),bundle=path.join(directory,'writers.cjs');
req('esbuild').buildSync({stdin:{contents:'export * from "./src/lib/market-data/kis-paired-history-write";export * from "./src/lib/market-data/kis-missing-raw-write";export * from "./src/lib/market-data/kis-history-revision-policy";',resolveDir:root,loader:'ts'},
 outfile:bundle,bundle:true,platform:'node',format:'cjs',tsconfig:path.join(root,'tsconfig.json'),logLevel:'silent'});
const {KIS_PAIRED_HISTORY_WRITE_SQL,KIS_MISSING_RAW_WRITE_SQL,confirmedKisHistoryRevisions}=req(bundle);
process.on('exit',()=>fs.rmSync(directory,{recursive:true,force:true}));
const url=process.env.CAIRN_SQL_TEST_URL;
const claimToken='00000000-0000-4000-8000-000000000001';
const row={ticker:'TEST',market:'us',currency:'USD',priceDate:'2026-10-22',closePrice:'101',adjustedClosePrice:'101',adjustedCloseBasis:'provider_adjusted_close_v1',adjustedCloseProvider:'kis',adjustedCloseSource:'kis_overseas_dailyprice:NAS:adjusted_v1',adjustedCloseFetchedAt:new Date('2026-10-27T10:01:00Z'),providerSymbol:'TEST',providerExchange:'NAS',fetchedAt:new Date('2026-10-27T10:00:00Z'),source:'kis_overseas_dailyprice:NAS:raw_v2',status:'ok',isSample:false};
const first={...row,fetchedAt:new Date('2026-10-27T09:00:00Z'),adjustedCloseFetchedAt:new Date('2026-10-27T09:01:00Z')};

test('atomic history writers preserve protected/concurrent rows and expired claims', {skip:!url}, async()=>{
 const sql=req('@neondatabase/serverless').neon(url);
 const cases=[
  {name:'matching independent reads revise same-provider value',source:'kis_overseas_dailyprice:NAS',raw:100,proof:true,expected:1},
  {name:'manual raw value is protected',source:'manual_override',raw:100,proof:true,expected:0,reason:'protected_existing_provenance'},
  {name:'one response cannot revise raw',source:'kis_overseas_dailyprice:NAS',raw:100,expected:0,reason:'raw_revision_requires_matching_requery'},
  {name:'large revision requires review',source:'kis_overseas_dailyprice:NAS',raw:80,proof:true,expected:0,reason:'raw_revision_exceeds_review_limit'},
  {name:'foreign adjusted evidence is terminally protected',source:'kis_overseas_dailyprice:NAS',raw:100,proof:true,adjusted:'foreign',expected:0,reason:'protected_existing_provenance'},
  {name:'newer adjusted receipt is terminally protected',source:'kis_overseas_dailyprice:NAS',raw:100,proof:true,adjusted:'newer',expected:0,reason:'protected_existing_provenance'},
  {name:'paired expired claim cannot write',source:'kis_overseas_dailyprice:NAS',raw:100,proof:true,expired:true,expected:0},
  {name:'matching provider value fills missing receipt',source:'kis_overseas_dailyprice:NAS',raw:101,missingReceipt:true,expected:1,revisionAudit:0},
  {name:'unreceipted changed value stays protected',source:'kis_overseas_dailyprice:NAS',raw:100,missingReceipt:true,proof:true,expected:0,reason:'protected_existing_provenance'},
  {name:'raw gap inserts an absent row',mode:'raw',expected:1},
  {name:'raw gap never overwrites a concurrently created manual row',mode:'raw',source:'manual_override',raw:100,expected:0},
  {name:'raw gap expired claim cannot write',mode:'raw',expired:true,expected:0},
 ];
 for(const scenario of cases){
  const key=`kis:history:${scenario.mode==='raw'?'raw_close_v1':'paired_v1'}:us:USD:TEST:2026-10-01:2026-10-27`;
  const result=await sql.transaction(tx=>[
   tx.query('create temporary table market_collection_jobs (like public.market_collection_jobs including all) on commit drop'),
   tx.query('create temporary table asset_price_snapshots (like public.asset_price_snapshots including all) on commit drop'),
   tx.query('create temporary table market_data_sync_runs (like public.market_data_sync_runs including all) on commit drop'),
   tx.query("insert into market_collection_jobs(key,kind,ticker,market,currency,start_date,end_date,status,claim_token,leased_until) values($1,'history','TEST','us','USD','2026-10-01','2026-10-27','running',$2::uuid,clock_timestamp()+make_interval(secs=>$3))",[key,claimToken,scenario.expired?-10:120]),
   tx.query("insert into asset_price_snapshots(ticker,market,currency,date,close_price,source,provider_symbol,provider_exchange,fetched_at,is_sample,adjusted_close_price,adjusted_close_basis,adjusted_close_provider,adjusted_close_source,adjusted_close_fetched_at) select 'TEST','us','USD','2026-10-22',$1::numeric,$2::text,'TEST','NAS',$6::timestamptz,false,$3,'provider_adjusted_close_v1',$4,'kis_overseas_dailyprice:NAS:adjusted_v1',$5::timestamptz where $2::text is not null",[scenario.raw??100,scenario.source??null,scenario.adjusted?100:null,scenario.adjusted==='foreign'?'other':'kis',scenario.adjusted==='newer'?'2026-10-27T11:00:00Z':'2026-10-27T08:00:00Z',scenario.missingReceipt?null:'2026-10-22T22:59:00Z']),
   tx.query(scenario.mode==='raw'?KIS_MISSING_RAW_WRITE_SQL:KIS_PAIRED_HISTORY_WRITE_SQL,scenario.mode==='raw'
    ?[key,claimToken,JSON.stringify([row])]
    :[key,claimToken,JSON.stringify([row]),JSON.stringify(scenario.proof?confirmedKisHistoryRevisions([row],[first]):[]),0.03]),
   tx.query('select close_price,source,fetched_at from asset_price_snapshots'),
   tx.query('select count(*)::int count from market_data_sync_runs'),
  ]);
  assert.equal(result[5][0].written,scenario.expected,scenario.name);
  if(scenario.reason)assert.equal(result[5][0].diagnostics[0].reason,scenario.reason,scenario.name);
  if(scenario.source||scenario.expected)assert.equal(Number(result[6][0].close_price),scenario.expected?101:scenario.raw,scenario.name);
  if(scenario.mode==='raw'&&scenario.source)assert.equal(result[6][0].source,scenario.source,scenario.name);
  if(scenario.expected)assert.equal(result[7][0].count,scenario.revisionAudit??1,scenario.name);
  if(scenario.missingReceipt&&scenario.expected)assert.ok(result[6][0].fetched_at,scenario.name);
 }
});
