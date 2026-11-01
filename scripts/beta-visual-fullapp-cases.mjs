import assert from 'node:assert/strict';
import path from 'node:path';
import {expect} from '@playwright/test';

// Actual presentation components/CSS in the disposable Next build. No account writes.
export async function runBetaVisualCases({page,check,url,output}) {
  const chartGeometry=async svg=>{
    await expect.poll(async()=>svg.evaluate(el=>Math.abs(el.viewBox.baseVal.width-el.getBoundingClientRect().width))).toBeLessThan(1);
    await expect.poll(async()=>svg.evaluate(el=>Math.abs(el.viewBox.baseVal.height-el.getBoundingClientRect().height))).toBeLessThan(1);
    const dot=svg.locator('circle').last(), bounds=await dot.boundingBox();
    assert.ok(bounds&&bounds.width>0&&Math.abs(bounds.width-bounds.height)<0.5,'selected marker must remain circular');
  };
  for(const [width,height] of [[1440,900],[1366,768],[390,844],[360,800]]) {
    await check(`beta-visual-${width}`,async()=>{
      await page.setViewportSize({width,height});
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.goto(url+'/qa-beta-visual?mode=domain&scope=all&currency=KRW');
      const home=page.locator('[data-beta-root]');await expect(home).toHaveAttribute('data-beta-ready','true');
      const today=page.locator('[data-beta-card="today"]');
      await expect(today.getByLabel('오늘 변동률 · KRW 기준',{exact:true})).toContainText('+0.04%');
      const amount=today.getByLabel('오늘 변동액 · KRW',{exact:true});await expect(amount).toContainText('+32,000');
      assert.ok(await amount.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))>=22);
      await expect(today).toContainText('일부 종목 기준 · 1종목 제외');
      await expect(page.getByRole('button',{name:'추가 투자 계산하기',exact:true})).toHaveCount(0);
      await chartGeometry(page.locator('[data-beta-card="history"] [data-history-plot] svg'));
      if(width===1440){
        await page.setViewportSize({width:900,height});
        await chartGeometry(page.locator('[data-beta-card="history"] [data-history-plot] svg'));
        await page.setViewportSize({width,height});
        await chartGeometry(page.locator('[data-beta-card="history"] [data-history-plot] svg'));
      }
      const ring=page.locator('[data-beta-card="structure"] [data-allocation-ring] svg');
      const ringBox=await ring.boundingBox();assert.ok(ringBox&&Math.abs(ringBox.width-ringBox.height)<1);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:path.join(output,`beta-home-${width}.png`),fullPage:true});
      await page.getByRole('button',{name:'추가 투자 확대',exact:true}).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('dialog').getByRole('heading',{name:'추가 투자',exact:true})).toBeVisible();
      await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByRole('button',{name:'추가 투자 확대',exact:true})).toBeFocused();
      await page.getByRole('button',{name:'현재 평가액 확대',exact:true}).click();
      const dialog=page.getByRole('dialog');await expect(dialog.locator('[data-value-detail]')).toBeVisible();
      const ribbon=await dialog.locator('[data-value-ribbon]').boundingBox();
      const costs=await dialog.getByRole('region',{name:'투자자산 보유 수익률',exact:true}).boundingBox();
      assert.ok(ribbon&&costs&&ribbon.y<costs.y&&ribbon.y+ribbon.height<height,'composition must precede costs and appear in the opening viewport');
      await expect(dialog.getByText('전체 투자자산 평가액',{exact:true})).toHaveCount(0);
      await expect(dialog.getByText('현재 가격·환율 기준',{exact:true})).toHaveCount(0);
      await page.screenshot({path:path.join(output,`beta-value-${width}.png`)});
      await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
      await page.getByRole('button',{name:'오늘의 변동 확대',exact:true}).click();
      const list=dialog.getByLabel('종목별 변동 기여 목록',{exact:true});await expect(list.getByRole('button')).toHaveCount(8);
      const boxes=await list.getByRole('button').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,bottom:r.bottom};}));
      if(width>1000){assert.ok(Math.abs(boxes[0].y-boxes[1].y)<1&&boxes[1].x>boxes[0].x,'desktop shows two columns');assert.ok(boxes.filter(r=>r.bottom<height-40).length>=6,'six holdings must fit without scrolling');}
      else {
        assert.ok(boxes[1].y>boxes[0].y&&Math.abs(boxes[1].x-boxes[0].x)<1,'mobile retains readable single column');
        const sizes=await dialog.locator('header [data-cairn-metric] > dd:first-of-type').evaluateAll(els=>els.map(el=>parseFloat(getComputedStyle(el).fontSize)));
        assert.equal(sizes.length,2);assert.ok(sizes.every(size=>size>=23&&size<=32),'two mobile metrics fit at readable matched sizes');
      }
      const last=list.getByRole('button').last();await last.click();await expect(last).toHaveAttribute('aria-pressed','true');
      await list.scrollIntoViewIfNeeded();
      const closeBounds=await dialog.locator('[data-dialog-close]').boundingBox();
      const scrollBounds=await list.evaluate(el=>{let node=el.parentElement;while(node&&getComputedStyle(node).overflowY!=='auto')node=node.parentElement;const r=node?.getBoundingClientRect();return r?{y:r.y}:null;});
      assert.ok(closeBounds&&scrollBounds&&closeBounds.y+closeBounds.height<=scrollBounds.y,'close control must remain outside scrolling financial content');
      await page.screenshot({path:path.join(output,`beta-today-${width}.png`)});
      await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
      await page.getByRole('button',{name:'히스토리 확대',exact:true}).click();
      const history=dialog.locator('[data-history-plot] svg');await chartGeometry(history);await history.focus();await page.keyboard.press('Home');
      await expect(history).toHaveAttribute('aria-label',/2026-07-03/);await page.keyboard.press('End');await expect(history).toHaveAttribute('aria-label',/2026-10-03/);
      await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
      const returned=page.getByRole('region',{name:'Synthetic recovered history'});await returned.scrollIntoViewIfNeeded();
      await chartGeometry(returned.locator('svg'));
      await expect(returned.locator('[data-return-series="recoveredPct"]')).toHaveCount(2);
      await returned.getByRole('slider').focus();await page.keyboard.press('Home');for(let i=0;i<4;i++)await page.keyboard.press('ArrowRight');
      await expect(returned.getByRole('slider')).toHaveAttribute('aria-valuetext',/2026-10-02 .*종가 미확인/);
      await page.screenshot({path:path.join(output,`beta-recovered-${width}.png`)});
    });
  }
  await check('beta-visual-currency-basis',async()=>{
    await page.goto(url+'/qa-beta-visual?mode=domain&scope=all&currency=USD');
    const today=page.locator('[data-beta-card="today"]');
    await expect(today.getByLabel('오늘 변동액 · USD',{exact:true})).toContainText('+22.86');
    await expect(today).toContainText('변동률은 KRW 기준');
    await expect(today.getByLabel('오늘 변동률 · KRW 기준',{exact:true})).toContainText('+0.04%');
  });
  await page.emulateMedia({reducedMotion:'no-preference'});
}
