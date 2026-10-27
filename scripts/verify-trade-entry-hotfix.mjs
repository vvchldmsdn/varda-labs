import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, openSync, closeSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

if (process.env.CI !== 'true') throw Error('Run this verification only in its isolated CI job');
for (const key of ['DATABASE_URL','TENANT_DATABASE_URL','DATABASE_URL_UNPOOLED']) {
  const url = new URL(process.env[key] ?? '');
  if (url.hostname !== '127.0.0.1' || url.port !== '1') throw Error('External database is prohibited');
}
const out = 'output/trade-entry'; mkdirSync(out, { recursive: true });
function run(command, args, name) {
  const fd = openSync(`${out}/${name}.log`, 'w');
  const result = spawnSync(command, args, { stdio: ['ignore', fd, fd], env: process.env }); closeSync(fd);
  const log = readFileSync(`${out}/${name}.log`, 'utf8');
  console.log(`--- ${name}: ${result.status} ---\n${log.split('\n').slice(-45).join('\n')}`);
  if (result.error || result.status !== 0) throw result.error ?? Error(`${name} failed`);
}
run('node', ['--no-warnings','--test','--test-isolation=none','tests/trade-record-intent.test.mjs','tests/native-legacy-lifecycle.test.mjs','tests/identity-bootstrap-claim-migration-cli.test.mjs','tests/identity-bootstrap-claim-handoff-rehearsal.test.mjs'], 'focused-tests');
run('npm', ['run','lint'], 'lint');
run('npm', ['run','build','--','--webpack'], 'production-build');
run('npx', ['playwright','install','--with-deps','chromium'], 'browser-install');

// Ephemeral loopback harness imports the actual client component, and is removed
// before commit. It never ships or adds an authentication exception to the app.
const harness = 'src/app/trade-entry-local-qa';
if (existsSync(harness)) throw Error('Temporary harness path already exists');
mkdirSync(harness, { recursive: true });
writeFileSync(`${harness}/page.tsx`, `import { NativeLedgerView } from "@/components/native-ledger-view";
import { normalizeTradeRecordHint, tradeRecordHref } from "@/lib/trade-record-intent";
export const dynamic = "force-dynamic";
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string>>}){const selection=normalizeTradeRecordHint(await searchParams);return <NativeLedgerView key={tradeRecordHref(selection)} initialSelection={selection}/>;}
`);
const port = 3157, base = `http://127.0.0.1:${port}`;
const serverLog = openSync(`${out}/dev-server.log`, 'w');
const server = spawn('npm', ['run','dev','--','--hostname','127.0.0.1','--port',String(port)], { stdio: ['ignore',serverLog,serverLog], detached: true, env: process.env });
const { chromium, expect } = await import('@playwright/test');
let browser;
const results = [];
const accountId = '11111111-1111-4111-8111-111111111111', assetId = '44444444-4444-4444-8444-444444444444';
function account(opened = true) {
  return { id: accountId, code: 'fixture', name: 'Test account', active: true, assets: [{ id: assetId, name: 'Test ETF', ticker:'TEST', quantity:'10', currency:'USD', archived:false }], state: opened ? { sequence:0, cash:{KRW:'0',USD:'1000'}, positions:[{assetId,quantity:'10',currency:'USD',costLots:null}] } : null };
}
try {
  for (let i=0; i<100; i++) { try { if ((await fetch(base+'/start')).ok) break; } catch {} if(i===99)throw Error('Local server did not start'); await sleep(1000); }
  browser = await chromium.launch({ headless: true });
  for (const locale of ['ko','en']) for (const width of [1440,1366,390,320]) {
    const context = await browser.newContext({ viewport:{width,height:900}, locale:locale==='en'?'en-US':'ko-KR', reducedMotion:'reduce' });
    await context.addCookies([{name:'varda-locale',value:locale,url:base}]);
    const page = await context.newPage();
    let data = account(), canWrite = true; const writes = [];
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (url.pathname === '/api/portfolio/ledger') {
        if (route.request().method()==='POST') {
          const body = route.request().postDataJSON(); writes.push(body);
          if (body.mutation.opening) data = account(true);
          else data.state.sequence++;
          await sleep(120);
          return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({status:'created',snapshot:'unavailable'})});
        }
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({sessionKey:'isolated-fixture-session',accounts:[data],canWrite})});
      }
      return route.continue();
    });
    const buy=locale==='ko'?'매수 기록':'Record buy', sell=locale==='ko'?'매도 기록':'Record sell';
    await page.goto(base+'/portfolio/manage');
    await expect(page.getByRole('link',{name:buy,exact:true}).first()).toBeVisible();
    await expect(page.getByRole('link',{name:sell,exact:true}).first()).toHaveAttribute('href','/portfolio/ledger?action=sell');
    if(width<761) {
      await page.getByRole('button',{name:locale==='ko'?'메뉴 열기':'Open menu',exact:true}).click();
      await expect(page.locator('dialog[open]').getByRole('link',{name:sell,exact:true})).toBeVisible();
      await page.keyboard.press('Escape');
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'management must not overflow');
    await page.screenshot({path:`${out}/manage-${locale}-${width}.png`,fullPage:true});

    await page.goto(base+'/trade-entry-local-qa?action=sell');
    await expect(page.getByRole('button',{name:sell,exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.getByRole('button',{name:sell,exact:true})).toBeEnabled();
    await page.getByRole('combobox',{name:locale==='ko'?'종목':'Holding',exact:true}).selectOption(assetId);
    await page.getByRole('textbox',{name:locale==='ko'?'수량':'Quantity',exact:true}).fill('2');
    await page.getByRole('textbox',{name:locale==='ko'?'한 주당 가격 · USD':'Price per share · USD',exact:true}).fill('100');
    await page.getByRole('button',{name:locale==='ko'?'매도 기록 저장':'Save sell record',exact:true}).click();
    await expect(page.getByText(locale==='ko'?'기록했어요. 홈에서 변경된 보유 정보를 확인할 수 있어요.':'Recorded. Your updated holdings are available on Home.',{exact:true})).toBeVisible();
    assert.equal(writes.at(-1).mutation.event.type,'sell'); assert.equal(writes.at(-1).mutation.event.quantity,'2');
    await page.getByRole('button',{name:buy,exact:true}).click();
    await expect(page.getByRole('button',{name:buy,exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.getByRole('button',{name:locale==='ko'?'매수 기록 저장':'Save buy record',exact:true})).toBeVisible();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'ledger must not overflow');
    await page.screenshot({path:`${out}/ledger-${locale}-${width}.png`,fullPage:true});

    data=account(false);
    await page.goto(base+`/trade-entry-local-qa?action=sell&accountId=${accountId}&assetId=${assetId}`);
    await expect(page.getByRole('button',{name:sell,exact:true})).toHaveAttribute('aria-pressed','true');
    await page.getByRole('textbox',{name:locale==='ko'?'원화 현금 잔액 KRW':'KRW cash balance KRW',exact:true}).fill('0');
    await page.getByRole('textbox',{name:locale==='ko'?'달러 현금 잔액 USD':'USD cash balance USD',exact:true}).fill('1000');
    await page.getByRole('checkbox').check();
    await page.getByRole('button',{name:locale==='ko'?'잔액 확인 후 계속':'Confirm balances and continue',exact:true}).click();
    await expect(page.getByRole('combobox',{name:locale==='ko'?'종목':'Holding',exact:true})).toHaveValue(assetId);
    await expect(page.getByRole('button',{name:sell,exact:true})).toHaveAttribute('aria-pressed','true');
    assert.ok(writes.at(-1).mutation.opening); assert.equal(writes.at(-1).mutation.event,undefined);
    await page.screenshot({path:`${out}/continued-${locale}-${width}.png`,fullPage:true});

    canWrite=false; await page.reload();
    await expect(page.getByRole('button',{name:buy,exact:true})).toBeDisabled();
    await expect(page.getByRole('button',{name:sell,exact:true})).toBeDisabled();
    assert.equal(writes.length,2,'opening confirmation cannot also place or record a trade');
    results.push({locale,width,entry:true,sellPayload:true,modeSwitch:true,openingContinuity:true,gatePreserved:true,overflow:false});
    await context.close();
  }
  writeFileSync(`${out}/browser-results.json`,JSON.stringify(results,null,2));
  console.log('Browser verification: '+results.length+' locale/viewport journeys passed with explicit API doubles. No real auth or Production writes.');
} catch (error) {
  const failedPage = browser?.contexts().flatMap(context => context.pages()).at(-1);
  if (failedPage) { await failedPage.screenshot({path:`${out}/failure.png`,fullPage:true}).catch(()=>{}); writeFileSync(`${out}/browser-failure.txt`, await failedPage.locator('body').innerText().catch(()=>'')); }
  throw error;
} finally {
  await browser?.close();
  try { process.kill(-server.pid,'SIGTERM'); } catch {}
  closeSync(serverLog); rmSync(harness,{recursive:true,force:true});
}
run('node', ['--no-warnings','tests/run.mjs'], 'full-tests');
console.log('Verification complete; temporary harness removed.');
