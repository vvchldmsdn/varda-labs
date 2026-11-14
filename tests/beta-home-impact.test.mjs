import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";

const [{ HomeImpactProvider, ImpactBars, alignedRanges, periodImpact, ImpactLegend, useHomeImpact, CompactImpactBasis },
  { HomeHistoryTooltip, tooltipPosition }] = await importUiWithPorts([
    "src/components/cairn-v2/home-impact.tsx", "src/components/cairn-v2/home-history-tooltip.tsx",
  ], {});
const dates = ["2026-11-01", "2026-11-02", "2026-11-03"];
const row = (price, fx) => ({
  cells: dates.map((date, i) => ({ date, priceChangeKrw:price[i], fxChangeKrw:fx[i] })),
});
const evidence = {
  state:"partial",
  history:{dates, rows:[row([10, null, 0], [3, 2, 0]), row([-2, 5, 0], [1, -2, 0])]},
};

function renderEvidence(read, date) {
  let observations;
  function Plot() {
    const context = useHomeImpact();
    observations = context.days;
    const chart = { ...context, visible:{ price:true, fx:false } };
    return createElement("div", null,
      createElement("svg", null, createElement(ImpactBars, {chart, plot:{
        start:dates[0], end:dates[2], x:d=>dates.indexOf(d)*10, top:0, bottom:20,
      }})),
      createElement(ImpactLegend, {chart,window:{start:dates[0],end:dates[2]},inspecting:date,view:{},currency:"KRW",returns:false,value:"20원",label:"평가액"}));
  }
  const markup = renderToStaticMarkup(createElement(HomeImpactProvider, {read}, createElement(Plot)));
  return { markup, observations };
}

test("price and FX sum independently for the same day and scope, preserving zero and missing amounts", () => {
  const { markup, observations } = renderEvidence(evidence, dates[1]);
  assert.deepEqual(observations.map(({price,fx})=>[price,fx]), [[8,4],[null,0],[0,0]]);
  assert.match(markup,/data-history-impact="price".*<rect x="17"/);
  assert.equal((markup.match(/<rect /g) ?? []).length, 1);
  assert.doesNotMatch(markup,/data-history-impact="fx"/);
  assert.match(markup,/자료 없음/);
  assert.match(markup,/>0원</);
});

test("no daily series is drawn without admitted evidence or for mismatched observation dates", () => {
  for (const read of [undefined, {...evidence,state:"unavailable"}, {...evidence,history:{dates,rows:[]}}]) {
    const { observations,markup } = renderEvidence(read, dates[0]);
    assert.deepEqual(observations,[]);
    assert.doesNotMatch(markup,/data-history-impact=/);
  }
  const shifted = {state:"ready",history:{dates,rows:[{cells:[{date:dates[2],priceChangeKrw:100,fxChangeKrw:5}]}]}};
  assert.ok(renderEvidence(shifted,dates[0]).observations.every(d=>d.price===null && d.fx===null));
});

test("the two ranges can share the valuation axis only when both observations and the component amounts reconcile", () => {
  const days = [{date:dates[0],value:100,price:null,fx:null},{date:dates[1],value:103,price:5,fx:-2}];
  const rows = days.map(({date,value})=>({date,valueKrw:value}));
  assert.deepEqual(alignedRanges(days,rows),[{date:dates[1],from:100,via:105,to:103}]);
  for (const row of [{...rows[1],valueKrw:120},{...rows[1],date:dates[2]},{...rows[1],segment:"new"}])
    assert.deepEqual(alignedRanges(days,[rows[0],row]),[]);
  const later = {...days[1], date: "2026-11-04", value:106};
  assert.deepEqual(alignedRanges([...days, {...days[1], date:dates[2]}, later],
    [...rows, {date:later.date,valueKrw:later.value}]), []);
  for (const change of [{price:null},{value:101},{fx:3}])
    assert.deepEqual(alignedRanges([days[0],{...days[1],...change}],rows),[]);
});

test("period amounts omit the first day's movement and require each day and component", () => {
  const days=[{date:dates[0],price:99,fx:33},{date:dates[1],price:3,fx:null},{date:dates[2],price:0,fx:2}];
  const window={start:dates[0],end:dates[2]};
  assert.equal(periodImpact(days,window,"price"),3);
  assert.equal(periodImpact(days,window,"fx"),null);
  assert.equal(periodImpact([days[0],days[2]],window,"price"),null);
});

test("the compact chart reserves its bar note even when both daily series are hidden", () => {
  const props = { window:{start:dates[0],end:dates[2]}, aligned:true };
  const days = [{date:dates[1],price:1,fx:null}];
  const render = visible => renderToStaticMarkup(createElement(CompactImpactBasis, { ...props, chart:{days,visible} }));
  const off = render({price:false,fx:false});
  const on = render({price:true,fx:true});
  for (const content of [off,on]) assert.match(content, /data-compact-impact-basis/);
  assert.doesNotMatch(off, /막대 · 평가액과 같은 눈금/);
  assert.match(on, /막대 · 평가액과 같은 눈금/);
  assert.match(on, /환율 · 선택 기간 자료 없음/);
});

test("the readout follows the observation without covering the selected point or running off the edge", () => {
  const plot = {width:600,height:220}, card = {width:176,height:104};
  const points = [{x:8,y:35}, {x:200,y:35}, {x:280,y:209}, {x:320,y:34}, {x:590,y:30}];
  for (const anchor of points) {
    const {x,y} = tooltipPosition(plot,card,anchor,points);
    assert.ok(x >= 0 && y >= 0 && x + card.width <= plot.width && y + card.height <= plot.height);
    assert.ok(anchor.x < x || anchor.x > x + card.width || anchor.y < y || anchor.y > y + card.height);
  }
  const besideDrop = tooltipPosition(plot, card, points[1], points);
  assert.ok(besideDrop.x + card.width < points[1].x);
  assert.ok(besideDrop.y > points[1].y);
});

test("the compact readout keeps the display valuation and reports only observed KRW contributions", () => {
  const props = {id:"test-tip",date:dates[1],returns:false,value:"35.02 USD",plot:{width:340,height:210},
    anchor:{x:130,y:40},points:[{x:130,y:40}],impact:{price:0,fx:null}};
  const markup = renderToStaticMarkup(createElement(HomeHistoryTooltip, props));
  assert.match(markup, /data-tooltip-date="2026-11-02"/);
  assert.match(markup, /35\.02 USD/);
  assert.match(markup, /현재 보유 기준/);
  assert.match(markup, /data-tooltip-series="price".*?0원/);
  assert.match(markup, /data-tooltip-series="fx".*?aria-label="자료 없음".*?—/);
});

test("a rising valuation line stays visible at both ends of a 270px mobile plot", () => {
  const plot = {width:270,height:220}, card = {width:156,height:90};
  const points = Array.from({length:32}, (_,i) => ({x:8+i*8.2,y:207-i*6.2}));
  for (const anchor of [points[1], points[15], points[30]]) {
    const tip = tooltipPosition(plot, card, anchor, points);
    for (const p of points) {
      assert.ok(p.x < tip.x || p.x > tip.x + card.width || p.y < tip.y || p.y > tip.y + card.height);
    }
  }
});

test("a scrolled chart keeps every tooltip row above the bottom tabs and below the sticky header", () => {
  const plot = {width:288,height:220}, card = {width:156,height:92};
  const anchor = {x:214,y:60}, points = [{x:0,y:210}, anchor, {x:285,y:15}];
  for (const visible of [{top:-512,bottom:170}, {top:65,bottom:565}, {top:-695,bottom:65}]) {
    const pos = tooltipPosition(plot,card,anchor,points,visible);
    assert.ok(pos.y >= visible.top + 4);
    assert.ok(pos.y + card.height <= visible.bottom - 4);
  }
});
