import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { expect } from '@playwright/test';
import { resolveSnapshotCycle, buildCycleForSnapshotDate } from '../src/lib/snapshots/market-calendar.ts';

/** Disposable PostgreSQL only. Keep the real authenticated API read receipt and
 * App Router rendering; model the provider's asynchronous queue with a response
 * override and explicit synthetic quote writes. Never call the test refresh control. */
export async function runAutoRefreshUiCases({admin,browser,owner,identityToken,url,output,report}) {
  const account=randomUUID(),asset=randomUUID(),ticker='999997';
  const now=new Date(),{snapshotDate}=resolveSnapshotCycle(now),cycle=buildCycleForSnapshotDate(snapshotDate,now);
  await admin.query("insert into app_users(id,status,role) values($1,'active','user')",[owner]);
  await admin.query("insert into auth_identities(app_user_id,provider,provider_subject) values($1::uuid,'neon_auth',$1::text)",[owner]);
  await admin.query("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency) values($1,$2,'brokerage','Auto refresh QA','brokerage','KRW')",[account,owner]);
  await admin.query("insert into assets(id,canonical_owner_user_id,account_id,account,name,ticker,market,currency,asset_type,quantity,current_price) values($1,$2,$3,'brokerage','Auto refresh holding',$4,'korea','KRW','stock',10,100)",[asset,owner,account,ticker]);
  await admin.query("insert into daily_position_snapshots(canonical_owner_user_id,account_id,account,asset_id,asset_name,ticker,asset_type,market,currency,snapshot_date,source,quantity,unit_price,market_value_krw,fx_rate,captured_at) values($1,$2,'brokerage',$3,'Auto refresh holding',$4,'stock','korea','KRW',$5,'varda_manual_daily_snapshot',10,100,1000,1,$6)",[owner,account,asset,ticker,snapshotDate,cycle.cycleEndAt]);
  const quote=price=>admin.query("insert into live_price_quotes(ticker,market,currency,provider,source,quote_type,status,price,price_as_of,fetched_at) values($1,'korea','KRW','kis','kis','live','ok',$2,now(),now()) on conflict(market,ticker,provider) do update set price=excluded.price,price_as_of=excluded.price_as_of,fetched_at=excluded.fetched_at",[ticker,price]);
  for(const viewport of [{width:1440,height:900},{width:1366,height:768},{width:390,height:844}]) {
    for(const surface of ['home','today','beta']) {
      const context=await browser.newContext({viewport,timezoneId:'Asia/Seoul'});
      await context.route('**/*',route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
      await context.addCookies([{name:'cairn_fullapp_identity',value:identityToken,url,httpOnly:true,sameSite:'Lax'},{name:'varda-locale',value:'ko',url}]);
      const page=await context.newPage(),requests=[];
      const result={name:`automatic-refresh-${surface}-${viewport.width}`,status:'FAIL'};report.cases.push(result);
      try {
        await quote(200);
        await page.clock.install({time:new Date()});
        await page.route('**/api/portfolio/live-prices/sync',async route=>{
          const response=await route.fetch(),body=await response.json();
          assert.equal(response.status(),200,'Actual authenticated read must succeed with fresh synthetic evidence');
          assert.match(body.readVersion,/^[a-f0-9]{64}$/);
          requests.push({reason:route.request().postDataJSON().reason,readVersion:body.readVersion});
          await route.fulfill({response,status:202,json:{...body,state:'queued',freshTargetCount:1,targetCount:2}});
        });
        const pathname=surface==='home'?'/':surface==='today'?'/today':'/beta';
        await page.goto(`${url}${pathname}?scope=account%3A${account}${surface==='beta'?'&mode=domain':''}`);
        const visible=()=>surface==='beta'?page.locator('[data-beta-card="value"]'):page.locator('body');
        const expectPrice=async price=>{
          await expect(visible()).toContainText((surface==='today'?(price-100)*10:price*10).toLocaleString('en-US'),{timeout:30000});
          if(surface==='beta')await expect(page.locator('[data-beta-card="today"]')).toContainText(((price-100)*10).toLocaleString('en-US'));
        };
        await expectPrice(200);
        await expect.poll(()=>requests.length).toBeGreaterThan(0);
        await page.screenshot({path:path.join(output,`auto-${surface}-${viewport.width}-before.png`),fullPage:true});
        // First receipt always refreshes; second catches equal-count price changes.
        await quote(210);await page.clock.runFor(10000);await expectPrice(210);
        await quote(220);await page.clock.runFor(10000);await expectPrice(220);
        const beforeCycle=requests.filter(r=>r.reason==='page_view').length;
        // Expire the bounded poller and advance to the next automatic 5-minute check.
        for(let tick=0;tick<10;tick++) {
          const previous=requests.length;
          await page.clock.runFor(10000);
          await expect.poll(()=>requests.length).toBeGreaterThan(previous);
        }
        await page.clock.runFor(180000);
        await expect.poll(()=>requests.filter(r=>r.reason==='page_view').length).toBeGreaterThan(beforeCycle);
        await quote(230);await page.clock.runFor(10000);await expectPrice(230);
        assert.equal(requests.some(r=>r.reason==='manual'),false,'No refresh button clicks');
        // A same-window route return must rejoin the queue, rather than suppress it.
        await page.goto(`${url}/portfolio/structure?scope=account%3A${account}`);
        await quote(240);const onReturn=requests.length;await page.goBack();await expectPrice(240);
        await expect.poll(()=>requests.length).toBeGreaterThan(onReturn);
        await quote(250);await page.clock.runFor(10000);await expectPrice(250);
        await page.screenshot({path:path.join(output,`auto-${surface}-${viewport.width}-after.png`),fullPage:true});
        result.status='PASS';result.requests=requests.length;result.receipts=new Set(requests.map(r=>r.readVersion)).size;
      } catch(error) {
        await page.screenshot({path:path.join(output,`auto-${surface}-${viewport.width}-failure.png`),fullPage:true});
        throw error;
      } finally {await context.close();}
    }
  }
}
