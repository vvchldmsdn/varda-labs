import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";

const [{ HomeImpactProvider, ImpactBars, alignedRanges, periodImpact, ImpactLegend, useHomeImpact }] =
  await importUiWithPorts(["src/components/cairn-v2/home-impact.tsx"], {});
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
