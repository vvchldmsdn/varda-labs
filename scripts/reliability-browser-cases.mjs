import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createServer} from 'node:http';
import {writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {importWithPorts} from '../tests/helpers/import-with-ports.mjs';
import {sqlTransport,ROOT} from './krw-usd-rc-rehearsal.mjs';

/** Browser-only harness: unchanged UI + route + writer + real disposable PG.
 * External identity resolution and rollout admission are replaced here only. */
export async function runBrowserCases({admin,worker,tenant,report,output}) {
 const owner=randomUUID(),other=randomUUID(),account=randomUUID(),asset=randomUUID(),session=new AsyncLocalStorage();
 const sql=sqlTransport(worker,new Set()),tenantSql=sqlTransport(tenant,new Set());
 const ports={'@/db/client':{sqlClient:sql},'@/db/tenant-client':{getTenantSqlClient:()=>tenantSql},
  '@/lib/auth/current-session-subject':{readCurrentSessionSubject:async()=>session.getStore()==='signed-out'?{state:'anonymous'}:{state:'authenticated',provider:'synthetic',providerSubject:session.getStore()==='other'?other:owner}},
  '@/lib/auth/current-tenant-context':{resolveCurrentTenantContext:async()=>({ok:true,tenantContext:{ownerUserId:session.getStore()==='other'?other:owner,role:'user'}})},
  '@/lib/release-admission':{releaseOwnerAllowed:()=>true}};
 const [ledger,route]=await importWithPorts(['src/db/queries/native-portfolio-ledger.ts','src/app/api/portfolio/ledger/route.ts'],ports);
 await admin.query("insert into app_users(id,status,role) values($1,'active','user'),($2,'active','user')",[owner,other]);
 await admin.query("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency) values($1,$2,'synthetic','Synthetic brokerage','brokerage','USD')",[account,owner]);
 await admin.query("insert into assets(id,canonical_owner_user_id,account_id,account,name,ticker,market,currency,asset_type,quantity,current_price) values($1,$2,$3,'synthetic','Synthetic unit','UNIT','us','USD','stock',10,100)",[asset,owner,account]);
 const ctx={ownerUserId:owner,role:'user'};
 await ledger.writeNativeMutation(ctx,{operationId:randomUUID(),accountId:account,expectedSequence:null,opening:{at:'2026-08-01T00:00:00Z',cash:{KRW:'0',USD:'1000'},positions:[{assetId:asset,currency:'USD',quantity:'10',costLots:null}]}});
 await admin.query("select set_trade_reliability_mode('compatible','Synthetic browser rehearsal')");
 const entry=path.join(output,'entry.tsx'),bundle=path.join(output,'ui.js');
 await writeFile(entry,`import React from 'react';import{createRoot}from'react-dom/client';import{NativeLedgerView}from'${path.join(ROOT,'src/components/native-ledger-view.tsx').replaceAll('\\','/')}';createRoot(document.getElementById('root')!).render(<NativeLedgerView compact initialSelection={{accountId:'${account}',assetId:'${asset}',action:'buy'}}/>);`);
 await build({entryPoints:[entry],outfile:bundle,bundle:true,platform:'browser',format:'iife',jsx:'automatic',tsconfig:path.join(ROOT,'tsconfig.json'),define:{'process.env.NODE_ENV':'"production"'},loader:{'.module.css':'local-css'},plugins:[{name:'shell-only-ports',setup(b){
  b.onResolve({filter:/^(next\/link|next\/navigation|@\/components\/app-navigation)$/},a=>({path:a.path,namespace:'shell'}));
  b.onLoad({filter:/.*/,namespace:'shell'},a=>({loader:'jsx',resolveDir:ROOT,contents:a.path==='next/link'?`import React from 'react';export default function Link(p){return <a {...p}/>}`:a.path==='next/navigation'?`export const usePathname=()=>'/portfolio/ledger';export const useSearchParams=()=>new URLSearchParams();export const useRouter=()=>({push:()=>{},refresh:()=>{}});`:`export function AppNavigation(){return null;}`}));
 }}]});
 let blockNextCommit=true;
 const server=createServer(async(req,res)=>{
  try {
   const origin=`http://127.0.0.1:${server.address().port}`;
   if(req.url==='/api/portfolio/ledger') {
    if(req.method==='GET' && req.headers.cookie?.includes('identity=signed-out')) blockNextCommit=false;
    const chunks=[];for await(const part of req)chunks.push(part);
    const bytes=Buffer.concat(chunks),body=bytes.length?bytes:undefined;
    const response=await session.run(req.headers.cookie?.includes('identity=other')?'other':req.headers.cookie?.includes('identity=signed-out')?'signed-out':'owner',()=>route[req.method](new Request(origin+req.url,{method:req.method,headers:req.headers,body})));
    if(blockNextCommit && req.method==='POST' && [200,201].includes(response.status)){res.destroy();return;}
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
   }
   if(req.url==='/ui.js'||req.url==='/ui.css') {res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(path.join(output,req.url.slice(1))));return;}
   res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"><style>:root{--paper:#fafaf8;--ink:#20221f;--line:#dedfda;--muted:#666b63;--accent:#e65024}*{box-sizing:border-box}body{margin:0;padding:24px;max-width:650px;margin:auto;background:var(--paper);font-family:Arial,sans-serif}button,input,select{font:inherit}</style><main id="root"></main><script src="/ui.js"></script></html>`);
  }catch{res.writeHead(500);res.end('unavailable');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true});
 let activePage;
 async function check(name,fn){const c={name,status:'FAIL'};report.cases.push(c);try{await fn();c.status='PASS';}catch(error){await activePage?.screenshot({path:path.join(output,'failure.png'),fullPage:true});c.visibleText=await activePage?.locator('body').innerText();throw error;}}
 try {
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
  activePage=page;
  await context.route('**/*',async route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto(url);
  await check('browser-commit-response-lost-refresh-relogin-exactly-one',async()=>{
   await page.getByLabel('수량',{exact:true}).fill('2');await page.getByLabel('체결 총액',{exact:true}).fill('200');
   await page.getByRole('button',{name:'매수 기록 저장',exact:true}).click();
   await expect(page.getByText('저장 결과를 확인하지 못했어요.',{exact:false})).toBeVisible();
   await context.addCookies([{name:'identity',value:'signed-out',url}]);await page.reload();await expect(page.getByRole('link',{name:'로그인',exact:true})).toBeVisible();
   await context.clearCookies();await page.reload();await expect(page.getByText('기록했어요. 홈에서 변경된 보유 정보를 확인할 수 있어요.',{exact:true})).toBeVisible();
   const state=await ledger.readNativeLedger(ctx,account);assert.equal(state.entries.length,2);assert.equal(state.accounts[0].state.positions[0].quantity,'12');assert.equal(state.accounts[0].state.cash.USD,'800');
   await page.screenshot({path:path.join(output,'desktop-recovered.png'),fullPage:true});
  });
  await check('browser-historical-entry-and-mobile',async()=>{
   await page.getByText('과거 거래 추가·정정',{exact:true}).click();await page.getByLabel('시작 잔액 이후 거래를 다시 계산',{exact:true}).check();
   await page.getByLabel('수량',{exact:true}).fill('1');await page.getByLabel('체결 총액',{exact:true}).fill('100');
   await page.getByText('초 단위 시각 확인·수정',{exact:true}).click();await page.locator('input[name="at"]').fill('2026-08-02T12:00');await page.getByLabel('변경 이유',{exact:true}).fill('Synthetic missing transaction');
   await page.getByLabel('시작 잔액에 이미 포함된 거래가 아닙니다.',{exact:true}).check();
   await page.getByRole('button',{name:'매수 기록 저장',exact:true}).click();
   await expect(page.getByText('기록했어요. 홈에서 변경된 보유 정보를 확인할 수 있어요.',{exact:true})).toBeVisible();
   const state=await ledger.readNativeLedger(ctx,account);assert.equal(state.accounts[0].state.positions[0].quantity,'13');assert.equal(state.accounts[0].state.cash.USD,'700');
   await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'mobile-historical.png'),fullPage:true});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await context.addCookies([{name:'identity',value:'other',url}]);await page.reload();await expect(page.getByText('보유 정보가 바뀌었어요.',{exact:false})).toBeVisible();
   assert.equal(await page.getByText('Synthetic brokerage',{exact:false}).count(),0);
  });
  await check('browser-expired-draft-owner-switch-and-safe-retirement',async()=>{
   await context.clearCookies();await page.reload();await expect(page.getByRole('button',{name:'매수 기록 저장',exact:true})).toBeEnabled();
   const identity=await (await context.request.get(url+'/api/portfolio/ledger')).json();
   const operationId=randomUUID(),key='cairn:pending-trade:v1:'+identity.sessionKey;
   await page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key,value:{sessionKey:identity.sessionKey,savedAt:Date.now()-25*3600000,mutation:{operationId,accountId:account,expectedSequence:3,event:{type:'buy',at:'2026-08-02T00:00:00Z',assetId:asset,currency:'USD',quantity:'1',settlement:{currency:'USD',amount:'100'}}}}});
   await page.reload();await expect(page.getByRole('button',{name:'미저장 요청 종료',exact:true})).toBeVisible();
   await context.addCookies([{name:'identity',value:'other',url}]);
   await page.getByRole('button',{name:'저장 여부 다시 확인',exact:true}).click();
   await expect(page.getByText('보유 정보가 바뀌었어요.',{exact:false})).toBeVisible();
   assert.equal(await page.getByRole('button',{name:'미저장 요청 종료',exact:true}).count(),0);
   assert.equal(await page.getByText('Synthetic brokerage',{exact:false}).count(),0);
   await context.clearCookies();await page.reload();await expect(page.getByRole('button',{name:'미저장 요청 종료',exact:true})).toBeVisible();
   await context.addCookies([{name:'identity',value:'other',url}]);
   await page.getByRole('button',{name:'미저장 요청 종료',exact:true}).click();
   await expect(page.getByRole('link',{name:'로그인',exact:true})).toBeVisible();
   assert.equal(await page.getByRole('button',{name:'미저장 요청 종료',exact:true}).count(),0);
   assert.equal(await page.getByText('Synthetic brokerage',{exact:false}).count(),0);
   await context.clearCookies();await page.reload();await page.getByRole('button',{name:'미저장 요청 종료',exact:true}).click();
   await expect(page.getByRole('button',{name:'매수 기록 저장',exact:true})).toBeEnabled();
   await expect(page.getByRole('button',{name:'미저장 요청 종료',exact:true})).toHaveCount(0);
   assert.equal(await ledger.readNativeOperation(ctx,operationId),'cancelled');
   assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),null);
   assert.equal((await ledger.readNativeLedger(ctx,account)).accounts[0].state.positions[0].quantity,'13');
  });
  report.browser={url,authBoundary:'external identity resolver replaced in test process only',financialBoundary:'actual route/writer/real PostgreSQL',appShell:'standalone actual component; not Next router or real OAuth'};
 } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
}
