import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";

const [{ HomeImpactProvider, ImpactLines, ImpactLegend, useHomeImpact }] =
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
      createElement("svg", null, createElement(ImpactLines, {chart, plot:{
        start:dates[0], end:dates[2], x:d=>dates.indexOf(d)*10, top:0, bottom:20,
      }})),
      createElement(ImpactLegend, {chart,date,value:"20원",label:"평가액"}));
  }
  const markup = renderToStaticMarkup(createElement(HomeImpactProvider, {read}, createElement(Plot)));
  return { markup, observations };
}

test("price and FX sum independently for the same day and scope, preserving zero and missing amounts", () => {
  const { markup, observations } = renderEvidence(evidence, dates[1]);
  assert.deepEqual(observations.map(({price,fx})=>[price,fx]), [[8,4],[null,0],[0,0]]);
  assert.match(markup,/d="M0,0 M20,10"/);
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
