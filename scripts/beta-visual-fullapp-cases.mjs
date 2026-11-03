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
      if(width>700){
        const nav=page.getByLabel('목적별 내비게이션',{exact:true});assert.ok((await nav.boundingBox()).width<=114);
        await expect(nav.locator('svg').first()).toBeVisible();
      }
      await expect(ring.getByRole('button',{name:'KODEX 200',exact:false})).toHaveCount(1);
      await expect(ring.getByRole('button',{name:'069500',exact:false})).toHaveCount(0);
      const ringBox=await ring.boundingBox();assert.ok(ringBox&&Math.abs(ringBox.width-ringBox.height)<1);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      const homeHeatmap=page.locator('[data-beta-card="heatmap"]');
      await expect(homeHeatmap.locator('[data-heatmap-cell]')).toHaveCount(248);
      const viewport=homeHeatmap.getByRole('region',{name:'종목 흐름 · 가로 탐색',exact:true});
      assert.equal(await viewport.evaluate(el=>el.scrollHeight<=el.clientHeight+1),true,'inline heatmap must show all holding rows without a nested vertical scroller');
      await homeHeatmap.locator('[data-row-index="0"][data-cell-index="0"]').focus();
      await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
      await expect(homeHeatmap.locator('[data-cell-index="2"][data-row-index="0"]')).toBeFocused();
      await expect(homeHeatmap).toContainText('비교 자료 없음');
      await homeHeatmap.getByRole('button',{name:'히트맵 선택 해제'}).click();
      await page.getByRole('button',{name:'종목 흐름 확대',exact:true}).click();
      const heatDialog=page.getByRole('dialog');
      await heatDialog.getByRole('group',{name:'종목 흐름 기간'}).getByRole('button',{name:'7일',exact:true}).click();
      await expect(heatDialog.locator('[data-heatmap-cell]')).toHaveCount(56);
      await heatDialog.getByRole('group',{name:'종목 흐름 기간'}).getByRole('button',{name:'전체',exact:true}).click();
      await expect(heatDialog.locator('[data-heatmap-cell]')).toHaveCount(248);
      assert.equal(await heatDialog.getByRole('region',{name:'종목 흐름 · 가로 탐색'}).evaluate(el=>el.scrollHeight<=el.clientHeight+1),true);
      await page.screenshot({path:path.join(output,`beta-heatmap-${width}.png`)});
      await page.keyboard.press('Escape');await expect(heatDialog).toHaveCount(0);
      await expect(page.getByRole('button',{name:'종목 흐름 확대',exact:true})).toBeFocused();
      await page.evaluate(()=>window.scrollTo(0,0));
      await page.screenshot({path:path.join(output,`beta-home-${width}.png`),fullPage:true});
      await page.getByRole('button',{name:'추가 투자 확대',exact:true}).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('dialog').getByRole('heading',{name:'추가 투자',exact:true})).toBeVisible();
      await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByRole('button',{name:'추가 투자 확대',exact:true})).toBeFocused();
      await page.getByRole('button',{name:'현재 평가액 확대',exact:true}).click();
      const dialog=page.getByRole('dialog');await expect(dialog.locator('[data-value-detail]')).toBeVisible();
      assert.equal(await dialog.getByRole('region',{name:'투자자산 구성 표',exact:true}).evaluate(el=>el.scrollHeight<=el.clientHeight+1),true,'value rows use the dialog scroll, not another vertical scroller');
      const ribbon=await dialog.locator('[data-value-ribbon]').boundingBox();
      const costs=await dialog.getByRole('region',{name:'투자자산 보유 수익률',exact:true}).boundingBox();
      assert.ok(ribbon&&costs&&ribbon.y<costs.y&&ribbon.y+ribbon.height<height,'composition must precede costs and appear in the opening viewport');
      await expect(dialog.getByText('전체 투자자산 평가액',{exact:true})).toHaveCount(0);
      await expect(dialog.getByText('현재 가격·환율 기준',{exact:true})).toHaveCount(0);
      const composition=dialog.locator('[data-composition-bar]');const segments=composition.locator('[data-segment-key]');
      const geometries=await segments.evaluateAll(els=>els.map(el=>({x:el.getBoundingClientRect().x,right:el.getBoundingClientRect().right})));
      for(let i=1;i<geometries.length;i++)assert.ok(Math.abs(geometries[i].x-geometries[i-1].right)<1,'segments must be contiguous');
      const korea=dialog.locator('table').getByRole('button',{name:/KODEX 200/});await korea.hover();
      await expect(composition.getByRole('tooltip')).toContainText('KODEX 200');
      const key=await composition.locator('[data-active=true]').getAttribute('data-segment-key');
      await korea.click();await expect(composition.locator('[data-segment-key="'+key+'"]')).toHaveAttribute('aria-pressed','true');
      await expect(composition.locator('[data-segment-key="'+key+'"]')).toHaveCSS('transform','none');
      await page.screenshot({path:path.join(output,`beta-value-${width}.png`)});
      await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
      await page.getByRole('button',{name:'오늘의 변동 확대',exact:true}).click();
      const list=dialog.getByLabel('종목별 변동 기여 목록',{exact:true});await expect(list.getByRole('button')).toHaveCount(8);
      const boxes=await list.getByRole('button').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,bottom:r.bottom};}));
      if(width>1000){const panel=await dialog.locator('[data-beta-panel]').boundingBox();assert.ok(Math.abs(boxes[0].y-boxes[1].y)<1&&boxes[1].x>boxes[0].x,'desktop shows two columns');assert.ok(panel&&boxes.filter(r=>r.bottom<panel.y+panel.height-8).length>=6,'six holdings must fit inside the panel without scrolling');}
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
      const periods=dialog.getByRole('group',{name:'히스토리 기간'});
      const quarter=periods.getByRole('button',{name:'3개월',exact:true});
      await quarter.focus();await page.keyboard.press('Enter');await expect(quarter).toHaveAttribute('aria-pressed','true');
      const periodTargets=await periods.getByRole('button').evaluateAll(els=>els.map(el=>({height:el.getBoundingClientRect().height,width:el.getBoundingClientRect().width,duration:getComputedStyle(el).transitionDuration,underlineDuration:getComputedStyle(el,'::after').transitionDuration})));
      assert.ok(periodTargets.every(button=>button.height>=44&&button.width>=44&&button.duration==='0s'&&button.underlineDuration==='0s'),'period choices retain touch targets and reduced motion');
      await periods.getByRole('button',{name:'전체',exact:true}).click();
      await quarter.click();
      const history=dialog.locator('[data-history-plot] svg');await chartGeometry(history);await history.focus();await page.keyboard.press('Home');
      await expect(history).toHaveAttribute('aria-label',/2026-07-03/);await page.keyboard.press('End');await expect(history).toHaveAttribute('aria-label',/2026-10-03/);
      await page.screenshot({path:path.join(output,`beta-history-${width}.png`)});
      await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
      await page.getByRole('button',{name:'포트 구조 확대',exact:true}).click();
      const detailRing=dialog.locator('[data-allocation-ring] svg');await expect(detailRing).toBeVisible();
      const donutBounds=await detailRing.boundingBox(),panelBounds=await dialog.locator('[data-beta-panel]').boundingBox();
      assert.ok(donutBounds&&panelBounds&&donutBounds.y+donutBounds.height<panelBounds.y+panelBounds.height,'entire donut fits first viewport');
      const domestic=detailRing.getByRole('button',{name:/KODEX 200/});await domestic.click();await expect(domestic).toHaveCSS('outline-style','none');
      await page.screenshot({path:path.join(output,`beta-structure-${width}.png`)});
      await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
      const funding=page.getByRole('region',{name:'Synthetic funding'});await funding.scrollIntoViewIfNeeded();
      await funding.locator('[data-segment-key="KR"]').hover();await expect(funding.getByRole('tooltip')).toContainText('KODEX 200');
      await page.screenshot({path:path.join(output,`beta-funding-${width}.png`)});
      const returned=page.getByRole('region',{name:'Synthetic recovered history'});await returned.scrollIntoViewIfNeeded();
      await chartGeometry(returned.locator('svg'));
      await expect(returned.locator('[data-return-series="recoveredPct"]')).toHaveCount(2);
      await returned.getByRole('slider').focus();await page.keyboard.press('Home');for(let i=0;i<4;i++)await page.keyboard.press('ArrowRight');
      await expect(returned.getByRole('slider')).toHaveAttribute('aria-valuetext',/2026-10-02 .*종가 미확인/);
      await page.screenshot({path:path.join(output,`beta-recovered-${width}.png`)});
    });
  }
  for(const [width,height] of [[1440,900],[390,844],[360,800]]) {
    await check(`original-home-navigation-and-chart-${width}`,async()=>{
      await page.setViewportSize({width,height});await page.emulateMedia({reducedMotion:'reduce'});
      await page.goto(url+'/qa-original-visual');
      const links=page.getByRole('navigation',{name:'내 자산 더 살펴보기'});
      await expect(links.getByRole('link',{name:'추가 투자 계산',exact:true})).toHaveAttribute('href',/additional-contribution.*preview=design/);
      const periods=page.getByRole('group',{name:'조회 기간',exact:true});
      await periods.getByRole('button',{name:'1개월',exact:true}).click();
      await expect(periods.getByRole('button',{name:'1개월',exact:true})).toHaveAttribute('aria-pressed','true');
      const svg=page.getByRole('img',{name:'기간별 포트폴리오 평가액 추이',exact:true});
      await chartGeometry(svg);
      await periods.getByRole('button',{name:'전체',exact:true}).focus();await page.keyboard.press('Space');
      await expect(periods.getByRole('button',{name:'전체',exact:true})).toHaveAttribute('aria-pressed','true');
      const targets=await periods.getByRole('button').evaluateAll(els=>els.map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})));
      assert.ok(targets.every(r=>r.width>=44&&r.height>=44));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:path.join(output,`original-home-${width}.png`),fullPage:true});
    });
  }
  await check('beta-structure-short-viewport-1265',async()=>{
    await page.setViewportSize({width:1265,height:712});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.goto(url+'/qa-beta-visual?mode=domain&scope=all&currency=KRW');
    await expect(page.locator('[data-beta-root]')).toHaveAttribute('data-beta-ready','true');
    await page.getByRole('button',{name:'포트 구조 확대',exact:true}).click();
    const dialog=page.getByRole('dialog');
    const ring=dialog.locator('[data-allocation-ring] svg');await expect(ring).toBeVisible();
    const donutBounds=await ring.boundingBox(),panelBounds=await dialog.locator('[data-beta-panel]').boundingBox();
    assert.ok(donutBounds&&panelBounds&&donutBounds.y>=panelBounds.y&&donutBounds.y+donutBounds.height<panelBounds.y+panelBounds.height,'entire donut fits the shorter opening viewport');
    await ring.getByRole('button',{name:/KODEX 200/}).click();
    const selectedBounds=await ring.boundingBox();
    assert.ok(selectedBounds&&panelBounds&&selectedBounds.y+selectedBounds.height<panelBounds.y+panelBounds.height,'selecting a holding keeps the donut fully visible');
    await page.screenshot({path:path.join(output,'beta-structure-1265.png')});
    await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  });
  await check('beta-visual-currency-basis',async()=>{
    await page.goto(url+'/qa-beta-visual?mode=domain&scope=all&currency=USD');
    const today=page.locator('[data-beta-card="today"]');
    await expect(today.getByLabel('오늘 변동액 · USD',{exact:true})).toContainText('+22.86');
    await expect(today).toContainText('변동률은 KRW 기준');
    await expect(today.getByLabel('오늘 변동률 · KRW 기준',{exact:true})).toContainText('+0.04%');
    await expect(page.locator('[data-beta-card="heatmap"]')).toContainText('KRW 기준');
  });
  await page.emulateMedia({reducedMotion:'no-preference'});
  await check('beta-composition-motion-keyboard',async()=>{
    await page.setViewportSize({width:1440,height:900});
    await page.goto(url+'/qa-beta-visual?mode=domain&scope=all&currency=KRW');
    await page.getByRole('button',{name:'현재 평가액 확대',exact:true}).click();
    const bar=page.getByRole('dialog').locator('[data-composition-bar]');
    const segment=bar.getByRole('button',{name:/KODEX 200/});await segment.hover();
    await expect(segment).toHaveCSS('transform','matrix(1, 0, 0, 1, 0, -4)');
    await page.mouse.move(0,0);await segment.focus();await page.keyboard.press('Enter');
    await expect(segment).toHaveAttribute('aria-pressed','true');
    await expect(bar.getByRole('tooltip')).toContainText('KODEX 200');
    await page.keyboard.press('Escape');
  });
}
