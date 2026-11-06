import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Decimal} from '../src/lib/money.ts';
import {expect} from '@playwright/test';

async function capture(page,output,name,width,height) {
  await page.setViewportSize({width,height});
  await expect(page.getByText('화면을 준비하고 있어요',{exact:true})).toBeHidden();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name}: horizontal overflow`);
  await page.screenshot({path:path.join(output,`${name}-${width}.png`),fullPage:true,animations:'disabled'});
  await page.screenshot({path:path.join(output,`${name}-${width}-viewport.png`),animations:'disabled'});
}

// Only called inside the disposable PostgreSQL + actual Next route rehearsal.
export async function runGuidedHoldingsQa({page,check,admin,owner,account,url,output}) {
  // Manual holdings are private observations, not a public security catalog.
  // Seed the synthetic catalog separately so exact matching uses the real search query.
  await admin.query("insert into etf_masters(id,ticker,name,market,currency,is_active,is_sample,data_source) values($1,'QAFUND','QA 보유 6','us','USD',true,false,'isolated-guided-qa')",[randomUUID()]);
  for(const [beta,width,height] of [[false,390,844],[true,360,800]]) {
    await check(`guided-holdings-${beta?'beta':'original'}-${width}`,async()=>{
      const selectedAccount=beta?randomUUID():account;
      if(beta){
        const seed=await admin.connect();
        try {
          await seed.query('BEGIN');
          await seed.query("select set_config('app.trade_reliability_version','0059',true)");
          await seed.query("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency) values($1,$2,'qa_guided_photo','QA 사진등록','brokerage','KRW')",[selectedAccount,owner]);
          await seed.query('COMMIT');
        } catch(error){await seed.query('ROLLBACK');throw error;} finally {seed.release();}
      }
      const route=url+(beta?'/beta':'')+'/portfolio/holdings/new?'+new URLSearchParams({scope:`account:${selectedAccount}`,...(beta?{mode:'domain'}:{accountId:selectedAccount})});
      await page.goto(route);
      await page.evaluate(()=>{for(const key of Object.keys(sessionStorage))if(key.startsWith('cairn:holding-draft:'))sessionStorage.removeItem(key);});
      await page.reload();await page.setViewportSize({width,height});
      const form=page.locator('form.varda-holding-onboarding');
      await expect(form).toHaveAttribute('data-entry-step','0');
      const photoMethod=form.getByRole('radio',{name:/캡처로 가져오기/});
      await photoMethod.focus();await page.keyboard.press('ArrowDown');
      await expect(form.getByRole('radio',{name:/텍스트·표 붙여넣기/})).toBeChecked();
      await photoMethod.check();
      await capture(page,output,'guided-method-'+beta,width,height);
      const primary=form.getByRole('button',{name:'자료 입력하기',exact:true});
      await expect(primary).toBeInViewport({ratio:1});
      assert.equal(await primary.evaluate(button=>{const r=button.getBoundingClientRect();return button.contains(document.elementFromPoint(r.x+r.width/2,r.bottom-2));}),true,'primary action must not sit behind mobile navigation');
      await form.getByRole('radio',{name:'텍스트·표 붙여넣기',exact:false}).click();
      await form.getByRole('button',{name:'자료 입력하기',exact:true}).click();
      await expect(form.locator('h2')).toBeFocused();
      await form.getByLabel('보유종목 표',{exact:true}).fill('종목명,수량,통화,평균매입가\nQA 보유 6,0.896567,KRW,10');
      await form.getByRole('button',{name:'표 읽고 종목 확인',exact:true}).click();
      await expect(form.getByRole('alert')).toContainText('표의 통화와 선택한 종목');
      await expect(form.getByRole('button',{name:'확인 목록으로 가져오기',exact:true})).toBeDisabled();
      await form.getByRole('button',{name:'자료 입력으로',exact:true}).click();
      const text='종목명,수량\nQA 보유 6,0.896567';
      await form.getByLabel('보유종목 표',{exact:true}).fill(text);
      await page.reload();await expect(form.getByLabel('보유종목 표',{exact:true})).toHaveValue(text);
      await form.getByRole('button',{name:'표 읽고 종목 확인',exact:true}).click();
      await expect(form).toHaveAttribute('data-entry-step','2');
      await expect(form.getByRole('button',{name:'종목 다시 선택',exact:true})).toBeVisible();
      await expect(form.getByRole('button',{name:'확인 목록으로 가져오기',exact:true})).toBeEnabled();
      await capture(page,output,'guided-text-review-'+beta,width,height);
      await form.getByRole('button',{name:'자료 입력으로',exact:true}).click();
      await page.reload();await expect(form.getByLabel('보유종목 표',{exact:true})).toHaveValue(text);
      await form.getByRole('button',{name:'표 읽고 종목 확인',exact:true}).click();
      await expect(form.getByRole('button',{name:'확인 목록으로 가져오기',exact:true})).toBeEnabled();
      // Explicitly changing a match must not immediately re-select the same result.
      await form.getByRole('button',{name:'종목 다시 선택',exact:true}).click();
      const search=form.getByLabel('어떤 종목을 가지고 있나요?',{exact:true}).filter({visible:true});
      await expect(search).toBeVisible();
      await search.fill('QAFU');
      await form.getByRole('button',{name:'자료 입력으로',exact:true}).click();
      await page.reload();
      await form.getByRole('button',{name:'표 읽고 종목 확인',exact:true}).click();
      await expect(search).toHaveValue('QAFU');
      await form.getByRole('button',{name:/QAFUND.*QA 보유 6/}).click();
      await form.getByRole('button',{name:'확인 목록으로 가져오기',exact:true}).click();
      await expect(form.getByRole('button',{name:'QA 보유 6 목록에서 제거',exact:true})).toBeVisible();
      await expect(form.getByLabel('QA 보유 6 보유 수량',{exact:true})).toHaveValue('0.896567');
      await page.reload();await expect(form.getByLabel('QA 보유 6 보유 수량',{exact:true})).toHaveValue('0.896567');
      await expect(form.getByRole('button',{name:'QA 보유 6 목록에서 제거',exact:true})).toBeVisible();
      await expect(form).toContainText('매입가가 없는 종목은 평가액만 표시해요.');
      await capture(page,output,'guided-final-review-'+beta,width,height);
      // Leaving the screen is not a write, and returning restores the reviewed draft.
      const before=(await admin.query('select id,quantity::text from assets where canonical_owner_user_id=$1 and account_id=$2 order by id',[owner,selectedAccount])).rows;
      await page.goto(url+'/portfolio/manage');await page.goBack();
      await expect(form.getByRole('button',{name:'QA 보유 6 목록에서 제거',exact:true})).toBeVisible();
      await expect(form.getByLabel('QA 보유 6 보유 수량',{exact:true})).toHaveValue('0.896567');
      assert.deepEqual((await admin.query('select id,quantity::text from assets where canonical_owner_user_id=$1 and account_id=$2 order by id',[owner,selectedAccount])).rows,before);
      await form.getByRole('button',{name:'QA 보유 6 목록에서 제거',exact:true}).click();
      await form.getByRole('button',{name:'종목 더 추가하기',exact:true}).click();
      await form.getByRole('radio',{name:'캡처로 가져오기',exact:false}).click();
      await form.getByRole('button',{name:'자료 입력하기',exact:true}).click();
      await capture(page,output,'guided-photo-'+beta,width,height);
      const uploaded=[];const record=request=>{if(request.method()==='POST'&&/image|multipart/.test(request.headers()['content-type']??''))uploaded.push(request.url());};
      page.on('request',record);
      try { await form.getByLabel('잔고 사진 파일',{exact:true}).setInputFiles({name:'unsupported.gif',mimeType:'image/gif',buffer:Buffer.from('GIF89a')});
        await expect(form.getByRole('alert')).toContainText('사진을 읽지 못했어요');
        // Render a synthetic, clearly labelled balance; exercise the real local OCR worker.
        const png=await page.evaluate(async()=>{
          await document.fonts.ready;
          const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=800;
          const context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,1000,800);
          context.fillStyle='black';context.font=`42px ${getComputedStyle(document.body).fontFamily}`;
          context.fillText('종목명',50,160);context.fillText('보유수량',740,160);
          context.fillText('QAFUND',50,300);context.fillText('0.896567',735,300);
          return canvas.toDataURL('image/png').split(',')[1];
        });
        await form.getByLabel('잔고 사진 파일',{exact:true}).setInputFiles({name:'synthetic-balance.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
        await expect(form).toHaveAttribute('data-entry-step','2',{timeout:90000});
        await expect(form.getByLabel('보유 수량',{exact:true})).toHaveValue('0.896567');
        await expect(form.getByRole('button',{name:'종목 다시 선택',exact:true})).toBeVisible();
        await capture(page,output,'guided-photo-review-'+beta,width,height);
        await page.reload();await expect(form.getByLabel('보유 수량',{exact:true})).toHaveValue('0.896567');
        assert.equal(await page.locator('img[src^="blob:"]').count(),0,'only parsed fields survive reload');
        await form.getByRole('button',{name:'다른 사진 선택',exact:true}).click();
        await expect(form).toHaveAttribute('data-entry-step','1');
        await form.getByLabel('잔고 사진 파일',{exact:true}).setInputFiles({name:'unsupported.gif',mimeType:'image/gif',buffer:Buffer.from('GIF89a')});
        await expect(form.getByRole('alert')).toContainText('사진을 읽지 못했어요');
        await form.getByRole('button',{name:'읽어둔 내용 확인',exact:true}).click();
        await expect(form.getByLabel('보유 수량',{exact:true})).toHaveValue('0.896567');
        assert.equal(uploaded.length,0,'photo must not upload to a server');
        await form.getByRole('checkbox',{name:'사진의 종목과 수량을 확인했어요.',exact:true}).check();
        await form.getByRole('button',{name:'1종목 확인 목록에 담기',exact:true}).click();
        const row=form.locator('ol > li').filter({hasText:'QA 보유 6'});
        await expect(row.getByLabel('QA 보유 6 보유 수량',{exact:true})).toHaveValue('0.896567');
        await row.locator('summary').click();
        await row.getByLabel('현재 1주 가격 · 자동 조회가 안 될 때',{exact:true}).fill('701.2638');
        await form.getByRole('button',{name:'종목 더 추가하기',exact:true}).click();
        await form.getByRole('radio',{name:/직접 입력하기/}).check();await form.getByRole('button',{name:'자료 입력하기',exact:true}).click();
        const manual=form.locator('details').filter({has:page.locator('summary').filter({hasText:'검색되지 않는 종목 직접 입력'})});
        await manual.locator(':scope > summary').click();
        await manual.getByLabel('상장 시장',{exact:true}).selectOption('us');
        await manual.getByLabel('티커',{exact:true}).fill(beta?'QRTRYB':'QRTRYA');
        await manual.getByLabel('이름 (선택)',{exact:true}).fill('QA OCR 재시도');
        await manual.getByRole('button',{name:'이 종목의 수량 입력',exact:true}).click();
        await form.getByLabel('몇 주 가지고 있나요?',{exact:true}).fill('1');await form.getByRole('button',{name:'목록에 추가',exact:true}).click();
        await form.getByRole('button',{name:'2종목 확인하기',exact:true}).click();
        await form.getByRole('button',{name:'2종목 저장',exact:true}).click();
        await expect(row).toHaveAttribute('data-saved','true');
        const retry=form.locator('ol > li').filter({hasText:'QA OCR 재시도'});
        await expect(retry).toContainText('가격 입력 필요');
        await capture(page,output,'guided-ocr-partial-'+beta,width,height);
        await retry.locator('summary').click();await retry.getByLabel('현재 1주 가격 · 자동 조회가 안 될 때',{exact:true}).fill('100');
        await retry.getByRole('button',{name:'이 종목 다시 저장',exact:true}).click();
        const readSaved=async()=>(await admin.query("select quantity::text,average_cost::text,currency from assets where canonical_owner_user_id=$1 and account_id=$2 and ticker='QAFUND'",[owner,selectedAccount])).rows;
        await expect.poll(readSaved).toEqual([{quantity:'0.896567',average_cost:null,currency:'USD'}]);
        assert.deepEqual((await admin.query("select id,quantity::text from assets where canonical_owner_user_id=$1 and account_id=$2 and ticker not in ('QAFUND','QRTRYA','QRTRYB') order by id",[owner,selectedAccount])).rows,before,'registration must preserve existing holdings');
        if(beta)await expect.poll(()=>new URL(page.url()).pathname).toBe('/beta/portfolio/holdings/manage');
        else await expect(form.locator('h2')).toHaveText('보유종목을 등록했어요');
        await capture(page,output,'guided-photo-saved-'+beta,width,height);
      } finally {page.off('request',record);}
    });
  }
}

export async function runGuidedTradeQa({page,check,setIdentity,token,account,asset,readState,url,output}) {
  await setIdentity(token);await page.context().addCookies([{name:'varda-locale',value:'ko',url}]);
  for(const [beta,width,height] of [[false,390,844],[true,360,800]]) {
    await check(`guided-trade-${beta?'beta':'original'}-${width}`,async()=>{
      await page.emulateMedia({reducedMotion:'reduce'});
      const before=await readState(), beforeQuantity=before.positions.find(row=>row.assetId===asset).quantity;
      const route=url+(beta?'/beta':'')+'/portfolio/ledger?'+new URLSearchParams({accountId:account,assetId:asset,action:'sell',...(beta?{mode:'domain'}:{})});
      await page.goto(route);await page.setViewportSize({width,height});
      const qty=page.getByLabel('체결 수량',{exact:true});
      await qty.fill(String(Number(beforeQuantity)+1));
      await expect(qty).toHaveAttribute('aria-invalid','true');
      await expect(page.getByRole('alert').filter({hasText:`최대 ${beforeQuantity}주까지`})).toBeVisible();
      await qty.fill('0.896567');
      await page.getByRole('button',{name:'총 체결금액',exact:true}).click();
      await page.getByLabel('총 체결금액 · KRW',{exact:true}).fill('123');
      const optional=page.locator('summary').filter({hasText:'수수료·메모·정산'});
      await optional.click();await page.getByLabel('메모 · 선택',{exact:true}).fill('합성 검증 메모');
      await page.reload();await expect(qty).toHaveValue('0.896567');
      await expect(page.getByLabel('총 체결금액 · KRW',{exact:true})).toHaveValue('123');
      await optional.click();await expect(page.getByLabel('메모 · 선택',{exact:true})).toHaveValue('합성 검증 메모');
      await expect(page.getByLabel('기록 날짜',{exact:true})).toBeVisible();
      await optional.click();await page.evaluate(()=>scrollTo(0,0));
      await capture(page,output,'guided-trade-'+beta,width,height);
      const save=page.getByRole('button',{name:'매도 기록 저장',exact:true});
      // The read-only history follows the form. Test the save action at the form,
      // rather than the end of the history where the form is outside the viewport.
      await save.scrollIntoViewIfNeeded();
      const unobscured=await save.evaluate(button=>{const rect=button.getBoundingClientRect();return rect.top>=0&&rect.bottom<innerHeight-60&&button.contains(document.elementFromPoint(rect.x+rect.width/2,rect.bottom-2));});
      assert.equal(unobscured,true,'save button must stay above mobile navigation');
      let dropped=false;
      const loseResponse=async route=>{
        if(route.request().method()!=='POST'||dropped||!route.request().postDataJSON()?.mutation)return route.continue();
        dropped=true;await route.fetch();await route.abort('failed');
      };
      await page.route('**/api/portfolio/ledger',loseResponse);
      await page.getByRole('button',{name:'매도 기록 저장',exact:true}).click();
      await expect(page.getByRole('button',{name:'저장 여부 확인·재시도',exact:true})).toBeVisible();
      await page.unroute('**/api/portfolio/ledger',loseResponse);
      await page.getByRole('button',{name:'저장 여부 확인·재시도',exact:true}).click();
      await expect(page.getByRole('status').filter({hasText:'기록했어요.'})).toBeVisible();
      const after=await readState();assert.deepEqual(after.cash,before.cash);
      assert.equal(after.positions.find(row=>row.assetId===asset).quantity,Decimal.from(beforeQuantity).sub("0.896567").toExactString());
      await page.reload();await expect(qty).toHaveValue('');assert.equal(dropped,true);
      assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('cairn:trade-entry:v1:')).map(key=>JSON.parse(sessionStorage.getItem(key))).some(draft=>!draft.fields.quantity&&!draft.fields.price&&!draft.fields.memo)),false,'loading an empty form must not freeze a new default timestamp');
      assert.deepEqual(await readState(),after,'reload must not replay the already saved trade');
      const records=page.getByRole('region',{name:'직접 기록한 거래',exact:true});
      await expect(records.getByRole('listitem').filter({hasText:'합성 검증 메모'}).first()).toContainText('0.896567');
      await capture(page,output,'context-records-'+beta,width,height);
      // A correction is a different draft; switching back must never create a new trade from the old fill.
      await page.getByLabel('기록 종류',{exact:true}).selectOption('buy');
      await page.getByRole('combobox',{name:/^종목/}).selectOption(asset);
      await qty.fill('0.000002');await page.getByLabel('체결 단가 · KRW',{exact:true}).fill('2');
      await optional.click();await page.getByLabel('메모 · 선택',{exact:true}).fill('새 거래 초안');
      await page.locator('summary').filter({hasText:'계좌 현금'}).click();
      const pendingLedger=await (await page.request.get(url+'/api/portfolio/ledger')).json();
      const pendingFill=pendingLedger.trades.find(row=>row.accountId===account&&row.event.settlementStatus==='unconfirmed');
      await page.getByRole('button',{name:'정산 보완',exact:true}).click();
      await expect(qty).toHaveValue(pendingFill.event.quantity);
      await expect(page.getByLabel('시작 잔액에 이미 포함된 거래가 아닙니다.',{exact:true})).not.toBeChecked();
      await page.reload();
      await page.getByRole('button',{name:'새 거래 초안으로 돌아가기',exact:true}).click();
      await expect(qty).toHaveValue('0.000002');await expect(page.getByLabel('체결 단가 · KRW',{exact:true})).toHaveValue('2');
      await optional.click();await expect(page.getByLabel('메모 · 선택',{exact:true})).toHaveValue('새 거래 초안');
      await expect(page.getByLabel('정정할 기록',{exact:true})).toHaveCount(0);
      await capture(page,output,'context-correction-restored-'+beta,width,height);
      assert.deepEqual(await readState(),after,'editing and cancelling a correction must not mutate the ledger');
      await page.getByRole('button',{name:'총 체결금액',exact:true}).click();
      await page.getByLabel('총 체결금액 · KRW',{exact:true}).fill('123');
      await page.getByRole('button',{name:/^정산 금액/}).click();
      await page.getByRole('button',{name:'정산액 없이 체결만 기록',exact:true}).click();
      await expect(page.getByLabel('총 체결금액 · KRW',{exact:true})).toHaveValue('123');
      await page.getByLabel('기록 종류',{exact:true}).selectOption('exchange');
      const currency=page.getByRole('combobox',{name:/^통화/});
      await currency.selectOption('USD');
      await page.getByRole('textbox',{name:'환전할 금액 USD',exact:true}).fill('12.34');
      await page.getByRole('textbox',{name:'실제로 받은 금액 KRW',exact:true}).fill('17000');
      await currency.selectOption('KRW');
      await expect(page.getByRole('textbox',{name:'환전할 금액 KRW',exact:true})).toHaveValue('17,000');
      await expect(page.getByRole('textbox',{name:'실제로 받은 금액 USD',exact:true})).toHaveValue('12.34');
      await capture(page,output,'context-exchange-swapped-'+beta,width,height);
      await page.getByLabel('기록 종류',{exact:true}).selectOption('buy');
      await expect(page.getByLabel('총 체결금액 · KRW',{exact:true})).toHaveValue('123');
      assert.deepEqual(await readState(),after,'switching form modes and record types must not mutate the ledger');

      const time=page.getByLabel('기록 시간',{exact:true}),date=page.getByLabel('기록 날짜',{exact:true});
      assert.ok((await time.boundingBox()).width>240,'AM/PM and time control need full width');
      assert.ok((await time.boundingBox()).y>(await date.boundingBox()).y);
      await time.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'context-time-'+beta+'-'+width+'.png')});
      await page.getByLabel('기록 종류',{exact:true}).selectOption('cost_basis');
      await page.getByLabel('매입 근거 1 · 매입원가',{exact:true}).fill('12.34');
      await page.getByLabel('매입 근거 1 · 실제 매입 시각',{exact:true}).fill('2026-09-18T10:00:00.123');
      await page.getByRole('button',{name:'다른 매입 날짜 추가',exact:true}).click();
      await page.getByLabel('매입 근거 2 · 통화',{exact:true}).selectOption('KRW');
      await page.getByLabel('매입 근거 2 · 매입원가',{exact:true}).fill('12345');
      await page.getByLabel('매입 근거 2 · 실제 매입 시각',{exact:true}).fill('2026-09-19T12:00:00.456');
      await page.getByRole('button',{name:'매입 근거 1 입력 지우기',exact:true}).click();
      await expect(page.getByLabel('매입 근거 1 · 매입원가',{exact:true})).toBeFocused();
      await expect(page.getByLabel('매입 근거 1 · 매입원가',{exact:true})).toHaveValue('12,345');
      await expect(page.getByLabel('매입 근거 1 · 통화',{exact:true})).toHaveValue('KRW');
      await expect(page.getByLabel('매입 근거 1 · 실제 매입 시각',{exact:true})).toHaveValue('2026-09-19T12:00:00.456');
      await page.screenshot({path:path.join(output,'context-cost-entry-'+beta+'-'+width+'.png')});
      assert.deepEqual(await readState(),after,'cost draft removal must not change stored cost or trades');
      await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('cairn:trade-entry:v1:')).forEach(k=>sessionStorage.removeItem(k)));

      await page.emulateMedia({reducedMotion:'no-preference'});
    });
  }
}

export async function runGuidedRecoveryQa({page,check,admin,owner,url,output}) {
  const makeAccount=async(label,{archived=false}={})=>{
    const account=randomUUID(),asset=randomUUID(),ticker='R'+randomUUID().replaceAll('-','').slice(0,8).toUpperCase();
    const client=await admin.connect();
    try {
      await client.query('BEGIN');await client.query("select set_config('app.trade_reliability_version','0059',true)");
      await client.query("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency) values($1,$2,$3,$3,'brokerage','KRW')",[account,owner,label]);
      await client.query("insert into assets(id,canonical_owner_user_id,account_id,account,name,ticker,market,currency,asset_type,category,quantity,current_price,price_source,price_status,price_quote_type,price_as_of,price_fetched_at,archived_at) values($1,$2,$3,$4,$4,$5,'korea','KRW','etf','국내주식',2,100,'user_entered_onboarding','ok','manual',now(),now(),$6)",[asset,owner,account,label,ticker,archived?new Date().toISOString():null]);
      await client.query('COMMIT');
    } catch(error) {await client.query('ROLLBACK');throw error;} finally{client.release();}
    return {account,asset,ticker};
  };
  for(const beta of [false,true]) await check(`guided-recovery-archived-retry-scope-${beta}`,async()=>{
    const a=await makeAccount('QA 종료 '+beta,{archived:true}),b=await makeAccount('QA 빈초안 '+beta);
    const href=id=>url+(beta?'/beta':'')+'/portfolio/holdings/new?'+new URLSearchParams({scope:'account:'+id,...(beta?{mode:'domain'}:{accountId:id})});
    if (!beta) {
      await page.goto(url+'/portfolio/risk?'+new URLSearchParams({scope:'account:'+a.account,currency:'USD'}));
      const riskPage=page.locator('main[data-page="portfolio-risk"]');
      await expect(riskPage).toBeVisible();
      const analysisBasis=page.getByText('분석 기준 · KRW',{exact:true});
      // The streaming loading header may coexist briefly with the resolved page.
      await expect(analysisBasis).toHaveCount(1);
      await expect(analysisBasis).toBeVisible();
      await expect(page.getByRole('combobox',{name:'분석 통화',exact:true})).toHaveCount(0);
      const thirty=riskPage.getByRole('link',{name:'30일',exact:true});
      await expect(thirty).toHaveAttribute('href',/currency=USD/);await thirty.click();
      await expect.poll(()=>new URL(page.url()).searchParams.get('currency')).toBe('USD');
      await expect(thirty).toHaveAttribute('aria-current','page');
      await capture(page,output,'context-risk-krw-basis',390,844);
    }

    await page.goto(href(a.account));
    const form=page.locator('form.varda-holding-onboarding');
    await form.getByRole('radio',{name:/직접 입력하기/}).check();await form.getByRole('button',{name:'자료 입력하기',exact:true}).click();
    const manual=form.locator('details').filter({has:page.locator('summary').filter({hasText:'검색되지 않는 종목 직접 입력'})});
    await manual.locator(':scope > summary').click();
    for(const [ticker,name] of [[a.ticker,'QA 종료 종목'],['F'+a.ticker,'QA 나머지 1'],['S'+a.ticker,'QA 나머지 2']]) {
      await manual.getByLabel('티커',{exact:true}).fill(ticker);await manual.getByLabel('이름 (선택)',{exact:true}).fill(name);
      await manual.getByRole('button',{name:'이 종목의 수량 입력',exact:true}).click();
      await form.getByLabel('몇 주 가지고 있나요?',{exact:true}).fill('0.896567');await form.getByRole('button',{name:'목록에 추가',exact:true}).click();
    }
    await form.getByRole('button',{name:'3종목 확인하기',exact:true}).click();
    await page.goto(href(b.account));await expect(form.locator('ol > li')).toHaveCount(0);
    await page.goto(href(a.account));await expect(form.locator('ol > li')).toHaveCount(3);
    const archived=form.locator('ol > li').filter({hasText:'QA 종료 종목'});
    await archived.locator('summary').click();await archived.getByLabel('현재 1주 가격 · 자동 조회가 안 될 때',{exact:true}).fill('100');
    await form.getByRole('button',{name:'3종목 저장',exact:true}).click();
    await expect(archived).toContainText('종료된 보유 기록');
    await expect(archived.getByRole('link',{name:'기존 보유 기록 확인',exact:true})).toHaveAttribute('href',new RegExp(a.account));
    assert.equal(Number((await admin.query('select count(*)::int n from assets where account_id=$1',[a.account])).rows[0].n),1);
    await archived.getByRole('button',{name:'QA 종료 종목 목록에서 제거',exact:true}).click();
    const first=form.locator('ol > li').filter({hasText:'QA 나머지 1'}),second=form.locator('ol > li').filter({hasText:'QA 나머지 2'});
    await first.locator('summary').click();await first.getByLabel('현재 1주 가격 · 자동 조회가 안 될 때',{exact:true}).fill('100');
    await first.getByRole('button',{name:'이 종목 다시 저장',exact:true}).click();
    await expect(first).toHaveAttribute('data-saved','true');await expect(second).toContainText('가격 입력 필요');
    await page.reload();await expect(first).toHaveAttribute('data-saved','true');await expect(second).toContainText('가격 입력 필요');
    await second.locator('summary').click();await second.getByLabel('현재 1주 가격 · 자동 조회가 안 될 때',{exact:true}).fill('100');
    await second.getByRole('button',{name:'이 종목 다시 저장',exact:true}).click();
    if(beta)await expect.poll(()=>new URL(page.url()).pathname).toBe('/beta/portfolio/holdings/manage');
    else await expect(form.locator('h2')).toHaveText('보유종목을 등록했어요');
    await page.goto(href(b.account));await expect(form.locator('ol > li')).toHaveCount(0);
    await page.goto(href(a.account));await expect(form.locator('li[data-saved="true"]')).toHaveCount(2);
    assert.equal(Number((await admin.query('select count(*)::int n from assets where account_id=$1',[a.account])).rows[0].n),3);
    const old=(await admin.query('select quantity::text,archived_at from assets where id=$1',[a.asset])).rows[0];
    assert.equal(Decimal.from(old.quantity).compare('2'),0);assert.ok(old.archived_at);
    await capture(page,output,'guided-recovery-'+beta,beta?360:390,beta?800:844);
  });
  await check('guided-home-opening-refresh-keeps-dialog-and-investment-value',async()=>{
    const {account,asset}=await makeAccount('QA 연속 기록');
    const href=url+'/?'+new URLSearchParams({scope:'account:'+account,currency:'KRW'});
    await page.goto(href);await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'QA 연속 기록 매수',exact:true}).click();
    const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
    await dialog.getByLabel('원화 현금 잔액 KRW',{exact:true}).fill('0');
    await dialog.getByLabel('달러 현금 잔액 USD',{exact:true}).fill('0');
    await dialog.getByRole('checkbox',{name:'현재 보유 수량과 현금 잔액을 확인했어요.',exact:true}).check();
    await dialog.getByRole('button',{name:'잔액 확인 후 계속',exact:true}).click();
    await expect(dialog.getByLabel('체결 수량',{exact:true})).toBeVisible();
    await dialog.getByLabel('체결 수량',{exact:true}).fill('0.896567');
    await dialog.getByLabel('체결 단가 · KRW',{exact:true}).fill('100');
    await page.evaluate(()=>window.dispatchEvent(new Event('cairn-fullapp-refresh')));
    await expect(page.getByRole('region',{name:'현재 평가'})).toContainText('투자자산 평가액');
    await expect(dialog).toBeVisible();await expect(dialog.getByLabel('체결 수량',{exact:true})).toHaveValue('0.896567');
    const state=async()=>(await admin.query('select native_state from accounts where id=$1',[account])).rows[0].native_state;
    assert.equal((await state()).positions.find(row=>row.assetId===asset).quantity,'2');
    await dialog.getByRole('button',{name:'매수 기록 저장',exact:true}).click();await expect(dialog).not.toBeVisible();
    await expect.poll(async()=>(await state()).positions.find(row=>row.assetId===asset).quantity).toBe('2.896567');
    assert.deepEqual((await state()).cash,{KRW:'0',USD:'0'});
    await expect(page.getByRole('region',{name:'현재 평가'})).toContainText('투자자산 평가액 · 현금 제외');
    await expect(page.getByRole('region',{name:'현재 평가'})).not.toContainText('확인 가능한 자산의 소계');
    await capture(page,output,'guided-home-after-opening',390,844);
  });
}
