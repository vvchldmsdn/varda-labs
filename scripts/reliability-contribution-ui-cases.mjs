import assert from 'node:assert/strict';
import path from 'node:path';
import { expect } from '@playwright/test';

async function switchLanguage(page, label) {
  const menuButton = page.getByRole('button', {name: /^(메뉴 열기|Open menu)$/});
  const mobile = await menuButton.isVisible();
  if (mobile) await menuButton.click();
  const surface = mobile ? page.getByRole('dialog', {name: /^(전체 메뉴|All navigation)$/}) : page;
  await surface.getByRole('button', {name: label, exact: true}).click();
  await expect(page.locator('html')).toHaveAttribute('lang', label === 'Switch to English' ? 'en' : 'ko');
  if (mobile) {
    await surface.getByRole('button', {name: /^(메뉴 닫기|Close menu)$/}).click();
    await expect(surface).not.toBeVisible();
  }
}

/** Actual Next pages/actions/API + local PostgreSQL. No route, query or result mocks. */
export async function runContributionUiCases({page,check,admin,owner,account,url,output}) {
  const scope=`account:${account}`, query=new URLSearchParams({scope,currency:'KRW'}).toString();
  const at=new Date().toISOString(), date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date());
  await admin.query(`insert into market_regime_daily(canonical_owner_user_id,account_id,account,date,label,drivers_json,macro_stress_score,regime_score,news_sentiment_score,updated_at)
    values($1,$2,'brokerage',$3,'경계','{"macro":["synthetic evidence"],"portfolio":["synthetic evidence"],"news":["synthetic evidence"]}',30,30,0.4,$4)`,[owner,account,date,at]);
  let savedId;
  await check('fullapp-contribution-ko-desktop-target-preview-five-factor-server-save',async()=>{
    await page.setViewportSize({width:1440,height:900});
    await page.goto(`${url}/portfolio/targets?${new URLSearchParams({scope,from:'additional-contribution'})}`);
    await expect(page.getByRole('heading',{name:'종목별 목표',exact:true})).toBeVisible();
    await page.locator('input[name="targetWeight:0"]').fill('100');
    await page.getByRole('button',{name:'목표비중 저장',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:'이 범위의 목표비중을 저장했습니다.'})).toBeVisible();
    const target=(await admin.query("select approval_revision from portfolio_target_policy_revisions where canonical_owner_user_id=$1 and scope_account_id=$2 and lifecycle_status='approved'",[owner,account])).rows;
    assert.equal(target.length,1);
    const loaded=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/native-contribution-plans'&&response.request().method()==='GET');
    await page.goto(`${url}/additional-contribution?${query}`);
    const context=await (await loaded).json();assert.equal(context.context.status,'ready');assert.equal(context.context.input.modifiers.regime.value,'경계');
    const planner=page.getByRole('region',{name:'추가 투자 계획',exact:true});
    await planner.getByRole('textbox',{name:'새 투자금',exact:true}).fill('10000');
    await planner.getByRole('button',{name:'배분 미리보기',exact:true}).click();
    const result=planner.locator('[id^="native-plan-"]');
    await expect(result.getByRole('heading',{name:'배분 미리보기 · KRW',exact:true})).toBeVisible();
    await expect(result).toContainText('7,000');await expect(result).toContainText('3,000');
    await result.getByText('감액·보충 계산 근거',{exact:true}).click();
    for(const label of ['환율','위험기여','시장','뉴스','성과'])await expect(result.locator('details[open]')).toContainText(label);
    await expect(result.locator('details[open]')).toContainText('×0.70');
    await expect(result.locator('details[open]')).toContainText('근거 부족 · 미적용');
    for (const width of [1440,390,320]) {
      await page.setViewportSize({width,height:width===1440?900:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Korean contribution overflow at ${width}px`);
      await page.getByRole('heading',{level:1}).click();await page.evaluate(()=>window.scrollTo(0,0));
      await page.screenshot({path:path.join(output,`contribution-ko-${width}.png`),fullPage:true});
    }
    await page.setViewportSize({width:1440,height:900});
    // A changed server evidence revision must be visible; do not persist stale client output.
    await admin.query("update market_regime_daily set label='안정',regime_score=90,updated_at=clock_timestamp() where canonical_owner_user_id=$1 and account_id=$2",[owner,account]);
    const saved=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/native-contribution-plans'&&response.request().method()==='POST');
    await planner.getByRole('button',{name:'최신 기준으로 계산·저장',exact:true}).click();
    const response=await saved;assert.equal(response.status(),201);const body=await response.json();
    assert.equal(body.basisChanged,true);assert.equal(body.plan.document.result.buys,10000);assert.equal(body.plan.document.result.remainingCash,0);savedId=body.plan.id;
    await expect(result.getByRole('heading',{name:'저장된 계획 · KRW',exact:true})).toBeVisible();
    await expect(planner.getByRole('alert')).toContainText('최신 기준으로 저장했어요');
    const stored=(await admin.query('select document_json from native_contribution_plans where owner_user_id=$1 and id=$2',[owner,savedId])).rows[0].document_json;
    assert.equal(stored.result.context.policyVersion,'gyeol_fin_explainable_rebalance_v2');assert.equal(stored.result.buys,10000);
    assert.equal(stored.result.rows[0].modifierBreakdown.multipliers.regime.value,1);
    assert.equal(stored.result.rows[0].modifierBreakdown.multipliers.event.status,'unavailable');
    // Saving is not a purchase: the known position and cash stay exactly as before.
    const state=(await admin.query('select native_state from accounts where id=$1',[account])).rows[0].native_state;
    assert.equal(state.positions[0].quantity,'10');assert.equal(state.cash.KRW,'101000');
  });
  await check('fullapp-contribution-en-mobile-refresh-frozen-plan-and-evidence',async()=>{
    await switchLanguage(page,'Switch to English');
    await page.setViewportSize({width:390,height:844});await page.reload();
    const planner=page.getByRole('region',{name:'Contribution plan',exact:true});
    await expect(planner.getByRole('heading',{name:'Saved plans',exact:true})).toBeVisible();
    await planner.locator(`a[href="#native-plan-${savedId}"]`).click();
    const result=planner.locator(`[id="native-plan-${savedId}"]`);
    await expect(result.getByRole('heading',{name:'Saved plan · KRW',exact:true})).toBeVisible();
    await result.getByText('Reduction and topup evidence',{exact:true}).click();
    for(const label of ['FX','Risk contribution','Regime','News','Performance'])await expect(result.locator('details[open]')).toContainText(label);
    await expect(result).toContainText('Missing evidence · not applied');
    await expect(result).toContainText('10,000');
    for (const width of [1440,390,320]) {
      await page.setViewportSize({width,height:width===1440?900:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`English contribution overflow at ${width}px`);
      await page.getByRole('heading',{level:1}).click();await page.evaluate(()=>window.scrollTo(0,0));
      await page.screenshot({path:path.join(output,`contribution-en-${width}.png`),fullPage:true});
    }
    assert.equal(Number((await admin.query('select count(*) as n from native_contribution_plans where owner_user_id=$1',[owner])).rows[0].n),1);
    await switchLanguage(page,'한국어로 전환');
  });
}

export async function runLegacyContributionUiCase({page,check,account,url,output}) {
  await check('fullapp-legacy-contribution-five-factor-dialog-ko-en-desktop-mobile',async()=>{
    const scope=`account:${account}`;
    await page.goto(`${url}/portfolio/targets?${new URLSearchParams({scope,from:'additional-contribution'})}`);
    await page.locator('input[name="targetWeight:0"]').fill('100');
    await page.getByRole('button',{name:'목표비중 저장',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:'이 범위의 목표비중을 저장했습니다.'})).toBeVisible();
    await page.goto(`${url}/additional-contribution?${new URLSearchParams({scope,amount:'10000'})}`);
    await expect(page.locator('main[data-preview-status="ready"]')).toBeVisible();
    for(const locale of ['ko','en']) {
      await page.getByRole('button',{name:locale==='ko'?'계산 로직 보기':'Calculation details',exact:true}).click();
      const dialog=page.getByRole('dialog');
      const holdings=dialog.locator('details[aria-labelledby="holding-calculation-title"]');
      if(await holdings.getAttribute('open')===null)await holdings.locator(':scope > summary').click();
      const evidence=dialog.getByText(locale==='ko'?'감액·추가 배분 근거':'Reduction and top-up evidence',{exact:true});
      if(await evidence.locator('..').getAttribute('open')===null)await evidence.click();
      await expect(dialog).toContainText(locale==='ko'?'근거 부족 · 미적용':'Missing evidence · not applied');
      for(const width of [1440,320]) {
        await page.setViewportSize({width,height:width===1440?900:844});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Legacy ${locale} overflow at ${width}px`);
        await evidence.locator('..').scrollIntoViewIfNeeded();
        await expect(evidence).toBeInViewport();
        await page.screenshot({path:path.join(output,`contribution-legacy-${locale}-${width}.png`)});
      }
      await dialog.getByRole('button',{name:locale==='ko'?'계산 로직 닫기':'Close calculation details',exact:true}).click();
      if(locale==='ko')await switchLanguage(page,'Switch to English');
    }
    await switchLanguage(page,'한국어로 전환');
  });
}
