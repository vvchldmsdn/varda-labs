import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {expect} from '@playwright/test';

// Called only by the disposable PostgreSQL/full Next application rehearsal.
export async function runOnboardingQaCases({page,check,admin,setIdentity,token,owner,url,output}) {
  assert.ok(['127.0.0.1','localhost'].includes(new URL(url).hostname));
  const account=randomUUID(),alternate=randomUUID();
  const query={scope:`account:${account}`,currency:'KRW'};
  const count=async()=>Number((await admin.query('select count(*)::int n from assets where canonical_owner_user_id=$1 and account_id=$2',[owner,account])).rows[0].n);
  async function capture(name,focus){
    for(const [width,height] of [[390,844],[360,800]]){
      await page.setViewportSize({width,height});await focus.scrollIntoViewIfNeeded();await expect(focus).toBeInViewport();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name} overflow at ${width}`);
      await page.screenshot({path:path.join(output,`${name}-${width}.png`),fullPage:true});
    }
  }
  await setIdentity(token);
  await page.context().addCookies([{name:'varda-locale',value:'ko',url}]);
  const observed=new Date(Date.now()-60000).toISOString();
  const seed=await admin.connect();
  try {
    await seed.query('BEGIN');
    await seed.query("select set_config('app.trade_reliability_version','0059',true)");
    await seed.query("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency) values($1,$3,'qa_batch_a','QA 일괄등록','brokerage','KRW'),($2,$3,'qa_batch_b','QA 다른계좌','brokerage','KRW')",[account,alternate,owner]);
    await seed.query("insert into fx_rates(date,usdkrw,source,status,observed_at,fetched_at,rate_kind) values($1,1400,'synthetic','ok',$2,$2,'spot')",[observed.slice(0,10),observed]);
    await seed.query('COMMIT');
  } catch(error) { await seed.query('ROLLBACK'); throw error; } finally { seed.release(); }

  await check('fullapp-onboarding-six-independent-rows-partial-reload-and-lost-response-replay',async()=>{
    await page.goto(url+'/portfolio/holdings/new?'+new URLSearchParams({accountId:alternate,scope:`account:${alternate}`}));
    await page.evaluate(()=>{for(const key of Object.keys(sessionStorage))if(key.startsWith('cairn:holding-draft:'))sessionStorage.removeItem(key);});
    await page.reload();
    const form=page.locator('form.varda-holding-onboarding');
    await form.getByRole('combobox',{name:'보유 계좌',exact:true}).selectOption(account);
    const manual=form.locator('details').filter({has:page.locator('summary').filter({hasText:'검색되지 않는 종목 직접 입력'})});
    await manual.locator(':scope > summary').click();
    for(let i=0;i<6;i++){
      await manual.getByLabel('상장 시장',{exact:true}).selectOption(i===5?'us':'korea');
      await manual.getByLabel('티커',{exact:true}).fill(i===5?'QAFUND':`90010${i}`);
      await manual.getByLabel('이름 (선택)',{exact:true}).fill(`QA 보유 ${i+1}`);
      await manual.getByRole('button',{name:'이 종목의 수량 입력',exact:true}).click();
      await form.getByLabel('몇 주 가지고 있나요?',{exact:true}).fill(i===5?'0.896567':'2');
      await form.getByRole('button',{name:'목록에 추가',exact:true}).click();
      if(i!==3){
        const row=form.locator('ol > li').filter({hasText:`QA 보유 ${i+1}`});
        await row.locator('summary').click();
        await row.getByLabel('현재 1주 가격 · 자동 조회가 안 될 때',{exact:true}).fill(i===5?'701.2638':'100');
      }
    }
    await page.reload();
    await expect(form.getByRole('combobox',{name:'보유 계좌',exact:true})).toHaveValue(account);
    await expect(form.locator('ol > li')).toHaveCount(6);
    await expect(form.getByLabel('QA 보유 6 보유 수량',{exact:true})).toHaveValue('0.896567');
    await form.getByRole('button',{name:'6종목 저장',exact:true}).click();
    await expect(form.locator('li[data-saved="true"]')).toHaveCount(5);
    assert.equal(await count(),5,'a missing quote must not defer later independent holdings');
    const remaining=form.locator('ol > li').filter({hasText:'QA 보유 4'});
    await expect(remaining).toContainText('가격 입력 필요');
    await capture('onboarding-partial',remaining);
    await remaining.locator('summary').click();
    await remaining.getByLabel('현재 1주 가격 · 자동 조회가 안 될 때',{exact:true}).fill('100');
    let discarded=false;
    const drop=async route=>{
      if(route.request().method()!=='POST'||discarded)return route.continue();
      discarded=true;await route.fetch();await route.abort('failed');
    };
    await page.route('**/portfolio/holdings/new?**',drop);
    await form.getByRole('button',{name:'1종목 저장',exact:true}).click();
    await expect.poll(count).toBe(6);
    await page.unroute('**/portfolio/holdings/new?**',drop);
    await page.reload();
    await expect(remaining.getByLabel('QA 보유 4 보유 수량',{exact:true})).toBeDisabled();
    await form.getByRole('button',{name:'1종목 저장',exact:true}).click();
    await expect(form.locator('li[data-saved="true"]')).toHaveCount(6);
    assert.equal(await count(),6);assert.equal(discarded,true);
    await capture('onboarding-replayed',form.getByRole('link',{name:'내 포트폴리오 첫 화면 보기',exact:true}));
  });

  await check('fullapp-beta-onboarding-restores-shared-draft-and-keeps-cancelled-inputs',async()=>{
    await page.goto(url+'/beta/portfolio/holdings/new?'+new URLSearchParams({mode:'domain',...query}));
    const form=page.locator('form.varda-holding-onboarding');
    await expect(form.locator('li[data-saved="true"]')).toHaveCount(6);
    await expect(form.getByLabel('QA 보유 6 보유 수량',{exact:true})).toHaveValue('0.896567');
    await capture('beta-onboarding-restored',form.getByRole('link',{name:'내 포트폴리오 첫 화면 보기',exact:true}));
    await form.getByRole('link',{name:'내 포트폴리오 첫 화면 보기',exact:true}).click();
    await page.goBack();await expect(form.locator('li[data-saved="true"]')).toHaveCount(6);
    assert.equal(await count(),6);
  });

  await check('fullapp-completed-batch-does-not-lock-a-different-account',async()=>{
    await page.goto(url+'/beta/portfolio/holdings/new?'+new URLSearchParams({mode:'domain',scope:'account:'+alternate}));
    const form=page.locator('form.varda-holding-onboarding');
    await expect(form.getByRole('combobox',{name:'보유 계좌',exact:true})).toHaveValue(alternate);
    await expect(form.getByRole('combobox',{name:'보유 계좌',exact:true})).toBeEnabled();
    await expect(form.locator('ol > li')).toHaveCount(0);assert.equal(await count(),6);
  });

  await check('fullapp-lab-over-maximum-inline-error-preserves-input-and-cancel',async()=>{
    await page.goto(url+'/investment-lab?'+new URLSearchParams({...query,view:'weights'}));
    const section=page.locator('[data-section="investment-lab-small-adjustment"]');
    const source=section.getByLabel('줄일 보유자산',{exact:true});
    await expect(source).toBeVisible();
    await source.selectOption({index:1});
    await section.getByLabel('늘릴 보유자산',{exact:true}).selectOption({index:2});
    const amount=section.getByRole('spinbutton',{name:/이동 금액/});
    const max=Number(await amount.getAttribute('max'));
    await expect(section).toContainText(`이동 가능 상한 ₩${max.toLocaleString('ko-KR')}`);
    await amount.fill(String(max+1));await section.getByRole('button',{name:'영향 계산',exact:true}).click();
    await expect(section.getByRole('alert')).toContainText('까지 입력해 주세요.');
    await expect(amount).toHaveValue(String(max+1));await expect(amount).toHaveAttribute('aria-invalid','true');
    await capture('lab-over-maximum',amount);
    await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
    assert.equal(await count(),6);
  });

  await check('fullapp-current-investments-currency-parity-and-history-shortage',async()=>{
    for(const currency of ['KRW','USD']){
      await page.goto(url+'/?'+new URLSearchParams({...query,currency}));
      const home=page.locator('main[data-page="home"], main[data-surface="home"]');
      await expect(home).toBeVisible();
      await expect(home).toContainText('QA 보유 6');
      if(currency==='USD'){
        await expect(page.getByText('현재 투자자산 · 현금 제외 · 과거 수익률과 별도',{exact:true})).toBeVisible();
        await expect(home).not.toContainText('cash_not_observed');
      }
      await capture('investments-'+currency,home);
    }
    await page.goto(url+'/beta/simulation?'+new URLSearchParams({mode:'domain',...query}));
    await page.getByText('가격·환율 준비 상태',{exact:true}).click();
    await expect(page.locator('[data-section="holding-analysis-data-repair"]')).toBeVisible();
    await expect(page.locator('[data-section="holding-analysis-data-repair"]')).toContainText('과거 가격 없음');
    await capture('beta-history-readiness',page.locator('[data-section="holding-analysis-data-repair"]'));
  });

  await check('fullapp-target-approve-revoke-reapprove-both-fronts-keeps-assets',async()=>{
    const financial=async()=>(await admin.query('select id,quantity::text,average_cost::text from assets where canonical_owner_user_id=$1 and account_id=$2 order by id',[owner,account])).rows;
    const before=await financial();
    for(const beta of [false,true]){
      await page.goto(url+(beta?'/beta/portfolio/targets':'/portfolio/targets')+'?'+new URLSearchParams({...query,...(beta?{mode:'domain',cashAmountKrw:'1234567'}:{from:'contribution',amount:'1234567'})}));
      const form=page.locator('form').filter({has:page.locator('input[name="universeHash"]')});
      await expect(form.locator('input[name="approvalRevision"]')).toBeAttached();
      const targetWeights=form.locator('input[name^="targetWeight:"]');
      await expect(targetWeights).toHaveCount(6);
      for(let index=0;index<6;index++)await targetWeights.nth(index).fill(index<4?'20':'10');
      await form.getByRole('button',{name:'목표비중 저장',exact:true}).click();
      await expect(page.getByRole('status').filter({hasText:'이 범위의 목표비중을 저장했습니다.'})).toBeVisible();
      const targetsUrl=page.url();
      await page.getByRole('link',{name:beta?'추가 투자 계산 ↗':'추가 투입으로',exact:true}).first().click();
      await expect.poll(()=>new URL(page.url()).searchParams.get('scope')).toBe(query.scope);
      await expect.poll(()=>new URL(page.url()).searchParams.get(beta?'cashAmountKrw':'amount')).toBe('1234567');
      await expect(page.locator('[data-recovery-kind="targets"]')).toHaveCount(0);
      const calculation=page.locator(beta?'[data-contribution-state="ready"]':'main[data-page="additional-contribution"][data-preview-status="ready"]');
      await expect(calculation).toBeVisible();
      await capture((beta?'beta-':'')+'onboarding-contribution-ready',calculation);
      await page.goto(targetsUrl);
      await form.getByText('승인 목표 관리',{exact:true}).click();
      await capture((beta?'beta-':'')+'target-revoke',form.getByRole('button',{name:'목표 승인 해제',exact:true}));
      await form.getByRole('button',{name:'목표 승인 해제',exact:true}).click();
      await expect(page.getByRole('status').filter({hasText:'목표 승인을 해제했습니다.'})).toBeVisible();
      await expect(form.locator('input[name="approvalRevision"]')).toHaveValue('0');
      await page.reload();await expect(form.locator('input[name="approvalRevision"]')).toHaveValue('0');
      const lifecycle=(await admin.query('select lifecycle_status from portfolio_target_policy_revisions where canonical_owner_user_id=$1 and scope_account_id=$2 order by approval_revision',[owner,account])).rows;
      assert.ok(lifecycle.length>0);assert.ok(lifecycle.every(row=>row.lifecycle_status==='revoked'));
      assert.deepEqual(await financial(),before);
    }
  });

  await check('fullapp-cancel-remainder-after-hiding-saved-rows-unlocks-account-without-deleting-assets',async()=>{
    await page.goto(url+'/portfolio/holdings/new?'+new URLSearchParams({accountId:alternate,scope:'account:'+alternate}));
    const form=page.locator('form.varda-holding-onboarding');
    const manual=form.locator('details').filter({has:page.locator('summary').filter({hasText:'검색되지 않는 종목 직접 입력'})});
    await manual.locator(':scope > summary').click();
    for(let index=0;index<2;index++){
      await manual.getByLabel('티커',{exact:true}).fill(`90020${index}`);
      await manual.getByLabel('이름 (선택)',{exact:true}).fill(`QA 취소 ${index}`);
      await manual.getByRole('button',{name:'이 종목의 수량 입력',exact:true}).click();
      await form.getByLabel('몇 주 가지고 있나요?',{exact:true}).fill('2');
      await form.getByRole('button',{name:'목록에 추가',exact:true}).click();
      if(index===0){const row=form.locator('ol > li').filter({hasText:'QA 취소 0'});await row.locator('summary').click();await row.getByLabel('현재 1주 가격 · 자동 조회가 안 될 때',{exact:true}).fill('100');}
    }
    await form.getByRole('button',{name:'2종목 저장',exact:true}).click();
    await expect(form.locator('li[data-saved="true"]')).toHaveCount(1);
    await form.getByRole('button',{name:'저장된 목록 접고 더 추가하기',exact:true}).click();
    await form.getByRole('button',{name:'QA 취소 1 목록에서 제거',exact:true}).click();
    await form.getByRole('button',{name:'저장된 목록 접고 더 추가하기',exact:true}).click();
    await expect(form.getByRole('combobox',{name:'보유 계좌',exact:true})).toBeEnabled();
    await form.getByRole('combobox',{name:'보유 계좌',exact:true}).selectOption(account);
    assert.equal(await count(),6);
    assert.equal(Number((await admin.query('select count(*)::int n from assets where canonical_owner_user_id=$1 and account_id=$2',[owner,alternate])).rows[0].n),1);
    await expect(form.locator('ol > li')).toHaveCount(0);
    await capture('onboarding-cancelled-remainder',form.getByRole('combobox',{name:'보유 계좌',exact:true}));
  });
}
