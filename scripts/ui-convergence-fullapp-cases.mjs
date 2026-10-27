import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { expect } from '@playwright/test';

/** Actual routes and authenticated queries against the disposable PostgreSQL only. */
export async function runUiContextCases({ page, check, admin, setIdentity, legacyToken, legacyOwner, legacyAccount, nativeToken, nativeAccount, nativeAsset, readNativeState, url, output }) {
  const client=await admin.connect();
  try {
    await client.query('BEGIN');await client.query("select set_config('app.trade_reliability_version','0059',true)");
    await client.query("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency) values($1,$2,'cash','Cash','bank','KRW')",[randomUUID(),legacyOwner]);
    await client.query('COMMIT');
  } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
  await setIdentity(legacyToken);
  await page.clock.setSystemTime(new Date());
  const query='scope='+encodeURIComponent('account:'+legacyAccount);
  for(const locale of ['ko','en']) for(const [width,height] of [[1440,900],[1366,768],[390,844],[320,844]]) {
    await setIdentity(legacyToken);
    await page.context().addCookies([{name:'varda-locale',value:locale,url}]);
    await page.setViewportSize({width,height});
    await check(`ui-context-${locale}-${width}`,async()=>{
      await page.goto(`${url}/?${query}`);
      const target=page.getByRole('link',{name:locale==='ko'?'목표비중 설정':'Set target weights',exact:true});
      await target.click();
      await expect(page.locator('input[name="scope"]')).toHaveValue('account:'+legacyAccount);
      await page.getByRole('link',{name:locale==='ko'?'홈으로':'Back to home',exact:true}).click();
      await expect(page).toHaveURL(`${url}/?${query}`);
      await expect(page.getByRole('heading',{name:locale==='ko'?'자산의 흐름':'Your portfolio, over time',exact:true})).toBeVisible();
      assert.equal(new URL(page.url()).searchParams.get('scope'),'account:'+legacyAccount);
      if(width<761)await page.getByRole('button',{name:locale==='ko'?'메뉴 열기':'Open menu',exact:true}).click();
      const addScope=width<761?page.locator('.varda-mobile-menu'):page;
      await addScope.getByRole('link',{name:locale==='ko'?'종목 추가':'Add holding',exact:true}).first().click();
      await expect(page.getByLabel(locale==='ko'?'보유 계좌':'Holding account',{exact:true})).toHaveValue(legacyAccount);
      await page.reload();
      await expect(page.getByLabel(locale==='ko'?'보유 계좌':'Holding account',{exact:true})).toHaveValue(legacyAccount);
      if(locale==='ko'&&width===1440) {
        await page.getByText('검색되지 않는 종목 직접 입력',{exact:true}).click();
        await page.getByLabel('티커',{exact:true}).fill('999995');
        await page.getByLabel('이름 (선택)',{exact:true}).fill('Synthetic UI holding');
        await page.getByRole('button',{name:'이 종목의 수량 입력',exact:true}).click();
        await page.getByLabel('몇 주 가지고 있나요?',{exact:true}).fill('1');
        await page.getByRole('button',{name:'목록에 추가',exact:true}).click();
        await page.getByText('매입가·현재가 추가 또는 수정',{exact:true}).click();
        await page.getByLabel('현재 1주 가격 (선택)',{exact:true}).fill('100');
        await page.getByRole('button',{name:'1종목 저장',exact:true}).click();
        await expect(page.getByRole('status').filter({hasText:'1종목이 포트폴리오에 담겼어요.'})).toBeVisible();
        const saved=(await admin.query("select account_id,quantity from assets where canonical_owner_user_id=$1 and ticker='999995'",[legacyOwner])).rows;
        assert.equal(saved.length,1);assert.equal(saved[0].account_id,legacyAccount);assert.equal(Number(saved[0].quantity),1);
        await page.reload();
      }
      const selector=page.getByLabel(locale==='ko'?'보유 계좌':'Holding account',{exact:true});
      const cash=await selector.locator('option').filter({hasText:'Cash'}).getAttribute('value');
      await selector.selectOption(cash);await page.reload();await expect(selector).toHaveValue(cash);
      await page.goto(`${url}/plans?${query}`);
      await expect(page.getByRole('heading',{name:locale==='ko'?'내 투자계획':'My investment plans',exact:true})).toBeVisible();
      await expect(page.locator('.varda-app-navigation')).toBeVisible();
      await expect(page.getByRole('link',{name:locale==='ko'?'홈':'Home',exact:true}).last()).toBeVisible();
      assert.equal(await page.locator('main a[href^="/auth/sign-in"]').count(),0,'verified session must not show a re-login CTA');
      await page.screenshot({path:path.join(output,`plans-${locale}-${width}.png`),fullPage:true});
      await page.getByRole('link',{name:locale==='ko'?'홈':'Home',exact:true}).last().click();
      await expect(page).toHaveURL(`${url}/?${query}`);
      await expect(page.getByRole('heading',{name:locale==='ko'?'자산의 흐름':'Your portfolio, over time',exact:true})).toBeVisible();
      assert.equal(new URL(page.url()).searchParams.get('scope'),'account:'+legacyAccount);
      const before=page.url();
      if(width<761)await page.getByRole('button',{name:locale==='ko'?'메뉴 열기':'Open menu',exact:true}).click();
      await page.getByRole('button',{name:locale==='ko'?'Switch to English':'한국어로 전환',exact:true}).click();
      assert.equal(page.url(),before,'language switch must retain the screen and context');
      await expect(page.locator('html')).toHaveAttribute('lang',locale==='ko'?'en':'ko');
      await page.reload();assert.equal(await page.locator('html').getAttribute('lang'),locale==='ko'?'en':'ko');
    });
    await check(`ui-trade-${locale}-${width}`,async()=>{
      await setIdentity(nativeToken);
      await page.context().addCookies([{name:'varda-locale',value:locale,url}]);
      const before=await readNativeState();
      for(const action of ['buy','sell']) {
        await page.goto(`${url}/portfolio/ledger?accountId=${nativeAccount}&assetId=${nativeAsset}&action=${action}`);
        await expect(page.getByLabel(locale==='ko'?'기록 종류':'Record type',{exact:true})).toHaveValue(action);
        await expect(page.getByLabel(locale==='ko'?'기록 날짜':'Record date',{exact:true})).toBeVisible();
        await page.getByLabel(locale==='ko'?'수량':'Quantity',{exact:true}).fill('1');
        await page.getByLabel(locale==='ko'?'체결 총액':'Executed total',{exact:true}).fill('10000');
        await page.getByRole('button',{name:locale==='ko'?(action==='buy'?'매수 기록 저장':'매도 기록 저장'):(action==='buy'?'Save buy record':'Save sell record'),exact:true}).click();
        await expect(page.getByRole('status').filter({hasText:locale==='ko'?'기록했어요.':'Recorded.'})).toBeVisible();
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        await page.screenshot({path:path.join(output,`${action}-${locale}-${width}.png`),fullPage:true});
      }
      const after=await readNativeState();
      assert.equal(after.positions[0].quantity,before.positions[0].quantity);
      assert.equal(after.cash.KRW,before.cash.KRW);
    });
    await check(`ui-public-session-${locale}-${width}`,async()=>{
      await setIdentity(legacyToken);
      await page.context().addCookies([{name:'varda-locale',value:locale,url}]);
      for(const route of ['/start','/try?mode=personal']) {
        await page.goto(url+route);
        await expect(page.getByRole('button',{name:locale==='ko'?'Switch to English':'한국어로 전환',exact:true})).toBeEnabled();
        await expect(page.locator('main h1')).toContainText(route==='/start'?(locale==='ko'?'내 자산을,':'Your portfolio,'):(locale==='ko'?'이번 투자금, 어디에 얼마씩?':'Where should this month’s money go?'));
        assert.equal(await page.locator('a[href="/auth/sign-in"],a[href="/auth/sign-up"]').count(),0,'verified public navigation must not prompt a new login');
        await expect(page.getByRole('link',{name:locale==='ko'?'홈':'Home',exact:true})).toBeVisible();
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        await page.screenshot({path:path.join(output,`${route==='/start'?'start':'try'}-${locale}-${width}.png`),fullPage:true});
      }
    });
  }
  await check('ui-public-guest-en-320',async()=>{
    await setIdentity(null);await page.context().addCookies([{name:'varda-locale',value:'en',url}]);await page.setViewportSize({width:320,height:844});
    await page.goto(url+'/start');await expect(page.getByRole('link',{name:'Sign in',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Sign up',exact:true})).toBeVisible();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  });
}
