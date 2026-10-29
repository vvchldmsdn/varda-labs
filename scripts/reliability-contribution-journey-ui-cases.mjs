import assert from 'node:assert/strict';
import path from 'node:path';
import { expect } from '@playwright/test';

/** Existing full-app fixture: actual Next routes/writers, disposable PostgreSQL, no production credentials. */
export async function runContributionJourneyUiCases({page,check,admin,owner,account,asset,url,output}) {
  const scope = `account:${account}`;
  const back = () => page.getByRole('button', {name:'입력 유지하고 돌아가기',exact:true});
  await check('fullapp-journey-beta-entry-plan-live-draft-target-return', async () => {
    await page.setViewportSize({width:1440,height:900});
    await page.goto(`${url}/beta/plans?${new URLSearchParams({mode:'domain',scope,currency:'KRW'})}`);
    await page.getByRole('link',{name:/^보유 기반 계획 계산·저장/}).click();
    await expect(page.getByRole('heading',{name:'보유 기반 투자계획',exact:true})).toBeVisible();
    const planner=page.getByRole('region',{name:'추가 투자 계획',exact:true});
    await planner.getByRole('combobox',{name:'투자금 통화',exact:true}).selectOption('USD');
    await planner.getByRole('textbox',{name:'새 투자금',exact:true}).fill('237.75');
    await planner.getByRole('checkbox',{name:/^보유 현금도 사용/}).check();
    const picker=planner.locator('details').filter({has:page.locator('summary').filter({hasText:/^매도 제외 종목/})});
    await picker.locator('summary').click();
    await picker.locator('input[name="excludeSell"]').check();
    await planner.getByRole('navigation',{name:'추가투입 진행 단계'}).getByRole('link',{name:'목표 설정',exact:true}).click();
    await expect(page).toHaveURL(/\/beta\/portfolio\/targets/);
    await back().click();
    await expect(planner.getByRole('textbox',{name:'새 투자금',exact:true})).toHaveValue('237.75');
    await expect(planner.getByRole('combobox',{name:'투자금 통화',exact:true})).toHaveValue('USD');
    await expect(planner.getByRole('checkbox',{name:/^보유 현금도 사용/})).toBeChecked();
    assert.deepEqual(new URL(page.url()).searchParams.getAll('excludeSell'),[asset]);
    // Account choice remains reachable even when the aggregate cannot accept funding.
    await expect(planner.getByRole('navigation',{name:'투자할 계좌 선택'}).getByRole('link')).toHaveCount(1);
    const choice=new URL(await planner.getByRole('navigation',{name:'투자할 계좌 선택'}).getByRole('link').getAttribute('href'),url);
    assert.equal(choice.searchParams.get('amount'),'237.75');
    assert.equal(choice.searchParams.get('fundingCurrency'),'USD');
  });
  for(const beta of [false,true]) {
    await check(`fullapp-journey-${beta?'beta':'original'}-save-buy-link-revisit`, async () => {
      const before=(await admin.query('select native_state from accounts where id=$1',[account])).rows[0].native_state;
      await page.goto(`${url}/additional-contribution/compare?${new URLSearchParams({scope,amount:'10000',currency:'KRW',...(beta?{from:'beta'}:{})})}`);
      await expect(page.getByRole('button',{name:'배분안 저장하고 계속',exact:true})).toBeEnabled();
      await page.getByRole('combobox',{name:'비교 시점',exact:true}).selectOption('90');
      await page.getByRole('spinbutton',{name:/^종목 가격 변화/}).fill('7');
      await page.getByRole('spinbutton',{name:/^USD\/KRW 변화/}).fill('-3');
      await page.getByRole('navigation',{name:'추가투입 진행 단계'}).getByRole('link',{name:'목표 설정',exact:true}).click();
      await back().click();
      await expect(page.getByRole('combobox',{name:'비교 시점',exact:true})).toHaveValue('90');
      await expect(page.getByRole('spinbutton',{name:/^종목 가격 변화/})).toHaveValue('7');
      await expect(page.getByRole('spinbutton',{name:/^USD\/KRW 변화/})).toHaveValue('-3');
      const savedResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/contribution-effects'&&r.request().method()==='POST');
      await page.getByRole('button',{name:'배분안 저장하고 계속',exact:true}).click();
      const response=await savedResponse;
      assert.equal(response.status(),201);const saved=await response.json();
      await expect(page.locator('.varda-sidebar .varda-sidebar-link[href^="/additional-contribution"]')).toHaveAttribute('aria-current','page');
      await expect(page).toHaveURL(new RegExp(`/additional-contribution/tracking\\?.*effectId=${saved.id}`));
      const record=page.locator(`[id="effect-${saved.id}"]`);
      await expect(record).toHaveAttribute('data-selected','true');
      const frozen=(await admin.query('select document from contribution_effects where owner_user_id=$1 and id=$2',[owner,saved.id])).rows[0].document;
      assert.deepEqual((await admin.query('select native_state from accounts where id=$1',[account])).rows[0].native_state,before,'Saving an allocation cannot buy or change cash');
      await record.getByRole('link',{name:'매수 기록하러 가기 ↗',exact:true}).click();
      await expect(page).toHaveURL(new RegExp(`${beta?'/beta':''}/portfolio/ledger\\?`));
      await page.getByRole('combobox',{name:'종목',exact:true}).selectOption(asset);
      await page.getByRole('textbox',{name:'체결 수량',exact:true}).fill('0.1');
      await page.getByRole('textbox',{name:'체결 단가 · KRW',exact:true}).fill('10000');
      const tradeResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/portfolio/ledger'&&r.request().method()==='POST');
      await page.getByRole('button',{name:'매수 기록 저장',exact:true}).click();
      assert.ok((await tradeResponse).ok());
      if(beta) await expect(page).toHaveURL(/_betaRead=/);
      await expect(back()).toBeVisible();
      assert.ok(new URL(page.url()).hash.startsWith('#cairn-return='),'Saving must retain the return link');
      await back().click();
      await expect(record).toBeVisible();
      await record.getByText('실제 매수 연결 · 0건',{exact:true}).click();
      await expect(record.getByRole('checkbox')).toHaveCount(1);
      await record.getByRole('checkbox').check();
      const linkedResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/contribution-effects'&&r.request().method()==='PATCH');
      await record.getByRole('button',{name:'선택한 1건 연결 저장',exact:true}).click();
      assert.ok((await linkedResponse).ok());
      await expect(record).toContainText('실제 매수 1건 연결됨');
      await page.reload();
      await expect(record).toContainText('실제 매수 1건 연결됨');
      await expect(record.getByRole('heading',{name:'연결한 실제 매수',exact:true})).toBeVisible();
      const after=(await admin.query('select native_state from accounts where id=$1',[account])).rows[0].native_state;
      assert.equal(Number(after.positions[0].quantity),Number(before.positions[0].quantity)+.1);
      assert.deepEqual(after.cash,before.cash,'Execution-only entry and attribution must preserve cash');
      assert.deepEqual((await admin.query('select document from contribution_effects where owner_user_id=$1 and id=$2',[owner,saved.id])).rows[0].document,frozen,'Linking and revisiting must preserve the original allocation');
      for(const width of [1440,390,320]) {
        await page.setViewportSize({width,height:width===1440?900:844});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Tracking overflow at ${width}px`);
        await page.screenshot({path:path.join(output,`journey-${beta?'beta':'original'}-${width}.png`),fullPage:true});
      }
    });
  }
}
