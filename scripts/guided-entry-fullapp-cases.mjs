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
      const route=url+(beta?'/beta':'')+'/portfolio/holdings/new?'+new URLSearchParams({scope:`account:${selectedAccount}`,accountId:selectedAccount,...(beta?{mode:'domain'}:{})});
      await page.goto(route);
      await page.evaluate(()=>{for(const key of Object.keys(sessionStorage))if(key.startsWith('cairn:holding-draft:'))sessionStorage.removeItem(key);});
      await page.reload();await page.setViewportSize({width,height});
      const form=page.locator('form.varda-holding-onboarding');
      await expect(form).toHaveAttribute('data-entry-step','0');
      await capture(page,output,'guided-method-'+beta,width,height);
      await form.getByRole('button',{name:'텍스트·표 붙여넣기',exact:false}).click();
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
      await form.getByRole('button',{name:/QA 보유 6.*QAFUND/}).click();
      await form.getByRole('button',{name:'확인 목록으로 가져오기',exact:true}).click();
      await expect(form.getByLabel('QA 보유 6 보유 수량',{exact:true})).toHaveValue('0.896567');
      await page.reload();await expect(form.getByLabel('QA 보유 6 보유 수량',{exact:true})).toHaveValue('0.896567');
      await expect(form).toContainText('매입가가 없는 종목은 평가액만 표시해요.');
      await capture(page,output,'guided-final-review-'+beta,width,height);
      // Leaving the screen is not a write, and returning restores the reviewed draft.
      const before=(await admin.query('select id,quantity::text from assets where canonical_owner_user_id=$1 and account_id=$2 order by id',[owner,selectedAccount])).rows;
      await page.goto(url+'/portfolio/manage');await page.goBack();
      await expect(form.getByLabel('QA 보유 6 보유 수량',{exact:true})).toHaveValue('0.896567');
      assert.deepEqual((await admin.query('select id,quantity::text from assets where canonical_owner_user_id=$1 and account_id=$2 order by id',[owner,selectedAccount])).rows,before);
      await form.getByRole('button',{name:'QA 보유 6 목록에서 제거',exact:true}).click();
      await form.getByRole('button',{name:'종목 더 추가하기',exact:true}).click();
      await form.getByRole('button',{name:'캡처로 가져오기',exact:false}).click();
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
        await form.getByRole('button',{name:'1종목 저장',exact:true}).click();
        const readSaved=async()=>(await admin.query("select quantity::text,average_cost::text,currency from assets where canonical_owner_user_id=$1 and account_id=$2 and ticker='QAFUND'",[owner,selectedAccount])).rows;
        await expect.poll(readSaved).toEqual([{quantity:'0.896567',average_cost:null,currency:'USD'}]);
        assert.deepEqual((await admin.query("select id,quantity::text from assets where canonical_owner_user_id=$1 and account_id=$2 and ticker<>'QAFUND' order by id",[owner,selectedAccount])).rows,before,'registration must preserve existing holdings');
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
      await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
      const save=page.getByRole('button',{name:'매도 기록 저장',exact:true});
      const unobscured=await save.evaluate(button=>{const rect=button.getBoundingClientRect();return rect.bottom<innerHeight-60&&button.contains(document.elementFromPoint(rect.x+rect.width/2,rect.bottom-2));});
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
      await page.emulateMedia({reducedMotion:'no-preference'});
    });
  }
}
