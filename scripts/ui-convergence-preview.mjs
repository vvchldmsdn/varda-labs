import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { ROOT, childEnvironment } from './reliability-ci.mjs';
import { prepareFullApp } from './reliability-fullapp.mjs';

// Visual/interaction QA of real components with explicit synthetic design data.
// No parent credentials, environment files, provider access or financial writes.
const outputRoot=path.join(ROOT,'output/playwright/ui-convergence');await mkdir(outputRoot,{recursive:true});
const output=await mkdtemp(path.join(outputRoot,'preview-'));
const stageArgument=process.argv[2]==='--reuse-stage'?process.argv[3]:null;
const stage=stageArgument?path.resolve(stageArgument):path.join(output,'workspace');
if(stageArgument)assert.ok(stage.startsWith(outputRoot+path.sep),'Reusable build must be inside the isolated preview output');
else await mkdir(stage);
const reuse=process.argv[2]==='--reuse-url'?process.argv[3]:null;
const onlyIndex=process.argv.indexOf('--only');
const only=onlyIndex<0?null:new Set(process.argv[onlyIndex+1].split(','));
if(reuse)assert.match(reuse,/^http:\/\/localhost:\d+$/,'Only the isolated local preview may be reused');
if(!reuse&&!stageArgument)await prepareFullApp(stage);
const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
const url=reuse??`http://localhost:${port}`;
const cache=path.dirname(path.dirname(path.dirname(chromium.executablePath())));
const env={...childEnvironment(process.env,stage,'production-build',cache),NODE_ENV:'development'};
const logfile=createWriteStream(path.join(output,'next.log'));
const server=reuse?null:spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port',String(port)],{cwd:stage,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
server?.stdout.pipe(logfile,{end:false});server?.stderr.pipe(logfile,{end:false});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({timezoneId:'Asia/Seoul',reducedMotion:'reduce'});
await context.route('**/*',route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
const page=await context.newPage();page.setDefaultTimeout(90000);page.setDefaultNavigationTimeout(180000);
const report={mode:'development design fixtures, real components and path-detail API; not production market data',url,output,cases:[],consoleErrors:[]};
page.on('pageerror',error=>report.consoleErrors.push(error.message));
const scope='account:11111111-1111-4111-8111-111111111111',query=`preview=design&scope=${encodeURIComponent(scope)}`;
async function visit(route){await page.goto(`${url}${route}${route.includes('?')?'&':'?'}${query}`);await page.locator('main').waitFor();await expect(page.locator('.varda-topbar-language button')).toBeEnabled({timeout:90000});await page.evaluate(()=>document.fonts.ready);}
async function check(name,run){const row={name,status:'FAIL'};report.cases.push(row);try{await run();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page horizontal overflow');row.status='PASS';}catch(error){row.error=String(error.message).slice(0,700);await page.screenshot({path:path.join(output,`${name}-FAIL.png`),fullPage:true});}await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));}
try {
  for(let attempt=0;attempt<120;attempt++){if(server&&server.exitCode!==null)throw Error('preview server stopped');try{if((await fetch(url+'/start')).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,500));}
  for(const locale of ['ko','en']) for(const [width,height] of [[1440,900],[1366,768],[390,844],[320,844]]) {
    await context.addCookies([{name:'varda-locale',value:locale,url}]);await page.setViewportSize({width,height});
    for(const [name,route] of [['home','/'],['today','/today'],['target','/portfolio/targets?from=home'],['structure','/portfolio/structure'],['risk','/portfolio/risk'],['history','/history'],['contribution','/additional-contribution'],['simulation','/simulation?model=economic&horizon=126']]) {
      if(only&&!only.has(`${name}-${locale}-${width}`))continue;
      await check(`${name}-${locale}-${width}`,async()=>{
        await visit(route);await page.screenshot({path:path.join(output,`${name}-${locale}-${width}.png`),fullPage:true});
        if(name==='target'){await expect(page.locator('input[name="scope"]')).toHaveValue(scope);await page.locator('input[name="targetWeight:0"]').fill('25');await expect(page.locator('input[name="targetWeight:0"]')).toHaveValue('25');}
        if(name==='today'&&width<761){await page.locator('[data-today-select-holding]').first().click();const bar=page.locator('#today-selected-holding-summary');await expect(bar).toBeVisible();assert.ok((await bar.boundingBox()).height<=64,'selected summary exceeds one-row height');await bar.click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();}
        if(name==='risk'){const empty=page.locator('[data-unavailable="true"]');if(await empty.count())assert.ok((await empty.first().boundingBox()).height<85,'unavailable metric occupies a hero block');}
        if(name==='simulation'){
          const graph=page.locator('[data-research-fan-chart]');await expect(graph).toBeVisible({timeout:90000});
          const chart=graph.locator('svg[role="img"]');assert.ok((await chart.boundingBox()).height>=260,'graph is not dominant');
          await graph.getByText(locale==='ko'?'그래프 설정':'Chart settings',{exact:true}).click();
          await graph.getByRole('button',{name:locale==='ko'?'시작값 100':'Starting value 100',exact:true}).click();
          await graph.getByRole('button',{name:locale==='ko'?'수익률':'Return',exact:true}).click();
          await graph.getByText(locale==='ko'?'그래프 설정':'Chart settings',{exact:true}).click();
          await graph.getByLabel(locale==='ko'?'경로 번호':'Path number',{exact:true}).fill('1');
          await graph.getByRole('button',{name:locale==='ko'?'경로 자세히 보기':'Path details',exact:true}).click();
          // First dev compilation of this API is separate from its response time.
          await expect(page.locator('[data-simulation-path-detail]')).toContainText(locale==='ko'?'종목별 변화':'Holding changes',{timeout:90000});
          await page.keyboard.press('Escape');await expect(page.locator('[data-simulation-path-detail]')).not.toBeVisible();
          await page.getByRole('button',{name:locale==='ko'?'크게 보기':'Expand chart',exact:true}).click();
          await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();
          await page.getByRole('link',{name:locale==='ko'?'과거 수익률 경로':'Historical paths',exact:true}).click();await expect(page).toHaveURL(/model=bootstrap/,{timeout:90000});await expect(page.locator('[data-research-fan-chart]')).toBeVisible({timeout:90000});
          await page.getByRole('link',{name:locale==='ko'?'63단계':/^63\s*steps$/i,exact:true}).click();await expect(page).toHaveURL(/horizon=63/,{timeout:90000});assert.equal(new URL(page.url()).searchParams.get('model'),'bootstrap');
          await page.reload();await expect(page.locator('[data-simulation-research-horizon]')).toHaveAttribute('data-simulation-research-horizon','63');
          await expect(page.locator('.varda-topbar-language button')).toBeEnabled({timeout:90000});
          const before=page.url();if(width<761)await page.getByRole('button',{name:locale==='ko'?'메뉴 열기':'Open menu',exact:true}).click();await page.getByRole('button',{name:locale==='ko'?'Switch to English':'한국어로 전환',exact:true}).click();assert.equal(page.url(),before);await context.addCookies([{name:'varda-locale',value:locale,url}]);await page.reload();
        }
      });
    }
  }
} finally {await browser.close();server?.kill();await new Promise(resolve=>logfile.end(resolve));report.status=report.cases.length>0&&report.cases.every(row=>row.status==='PASS')&&report.consoleErrors.length===0?'PASS':'FAIL';await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,report:path.join(output,'report.json'),failed:report.cases.filter(row=>row.status==='FAIL').map(row=>({name:row.name,error:row.error}))}));}
