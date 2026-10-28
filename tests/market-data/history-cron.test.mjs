import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const req=createRequire(path.join(root,'package.json'));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cairn-history-cron-'));
const bundle=path.join(temp,'route.cjs');
await req('esbuild').build({entryPoints:[path.join(root,'src/app/api/cron/market-history/run/route.ts')],
 outfile:bundle,bundle:true,platform:'node',format:'cjs',tsconfig:path.join(root,'tsconfig.json'),logLevel:'silent',
 plugins:[{name:'isolate-market-collector',setup(build){
  build.onResolve({filter:/^(server-only|next\/server|@\/lib\/market-data\/close-gap-collection)$/},args=>({path:args.path,namespace:'test-stub'}));
  build.onLoad({filter:/.*/,namespace:'test-stub'},({path:module})=>({loader:'js',contents:
   module==='server-only'?'':module==='next/server'?'export const NextResponse={json:(body,options)=>Response.json(body,options)};':
   'export const runRecentCloseCollection=(options)=>globalThis.__historyCollector(options);'}));
 }}]});
const {GET}=req(bundle);
process.on('exit',()=>fs.rmSync(temp,{recursive:true,force:true}));

test('history cron requires configured auth, rejects params and gates writes before calling collector',async()=>{
 const saved=Object.fromEntries(['ADMIN_JOB_SECRET','CRON_SECRET','MARKET_CYCLE_CRON_WRITE_ENABLED'].map(key=>[key,process.env[key]]));
 let calls=0;
 globalThis.__historyCollector=async options=>{calls++;assert.ok(options.deadline>Date.now());assert.ok(options.deadline<=Date.now()+120000);return {status:'completed',processed:1};};
 const request=(token='',query='')=>new Request('https://example.test/api/cron/market-history/run'+query,{headers:token?{authorization:'Bearer '+token}:{}});
 try{
  delete process.env.ADMIN_JOB_SECRET;delete process.env.CRON_SECRET;
  process.env.MARKET_CYCLE_CRON_WRITE_ENABLED='true';
  assert.equal((await GET(request('synthetic-secret'))).status,401);
  process.env.CRON_SECRET='synthetic-secret';
  assert.equal((await GET(request())).status,401);
  assert.equal((await GET(request('wrong'))).status,401);
  assert.equal((await GET(request('synthetic-secret','?force=true'))).status,400);
  process.env.MARKET_CYCLE_CRON_WRITE_ENABLED='false';
  assert.equal((await GET(request('synthetic-secret'))).status,409);
  assert.equal(calls,0);
  process.env.MARKET_CYCLE_CRON_WRITE_ENABLED='true';
  const response=await GET(request('synthetic-secret'));
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(calls,1);
 }finally{
  for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  delete globalThis.__historyCollector;
 }
});

test('history catch-up keeps the existing cron schedules and runs after New York midnight in either season',()=>{
 const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
 assert.ok(config.crons.some(row=>row.path==='/api/cron/market-history/run'&&row.schedule==='15 5 * * *'));
 assert.ok(config.crons.some(row=>row.path==='/api/cron/market-cycle/run'&&row.schedule==='0 22 * * *'));
 assert.ok(config.crons.some(row=>row.path==='/api/cron/simulation-executions'&&row.schedule==='0 20 * * *'));
 for(const iso of ['2026-07-07T05:15:00Z','2026-12-08T05:15:00Z']){
  const local=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
  assert.equal(local,iso.slice(0,10));
 }
});
