import assert from "node:assert/strict";
import { it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";
import { buildCurrencyResearch } from "../src/lib/currency-research.ts";
import { currencyResearchFixture } from "../src/lib/currency-research-fixture.ts";

function evidence() {
  const value = currencyResearchFixture();
  value.input.rows = [{ ...value.input.rows[1], value: 100, inputCurrency: "USD" }];
  value.input.currency = "USD"; value.reportingCurrency = "USD"; value.fx = [];
  value.histories = [value.histories[1]];
  value.histories[0].points = value.histories[0].points.slice(-41);
  let price = 100;
  value.histories[0].points.forEach((row, index) => {
    if (index) price *= index % 2 ? 1.01 : .99;
    row.price = String(price);
  });
  return { ...value, calculation: "risk_only" };
}

it("uses the shared return matrix for risk only, with independent volatility and no path generation", async () => {
  const result = await buildCurrencyResearch(evidence());
  assert.equal(result.status, "ready");
  assert.equal(result.risk.observations, 40);
  // Forty alternating +/-1% returns have mean zero and sample variance .004/39.
  assert.ok(Math.abs(result.risk.volatilityPct - Math.sqrt(.004 / 39 * 252) * 100) < 1e-8);
  assert.equal(result.risk.sharpe, null);
  assert.equal(result.risk.beta, null);
  assert.equal(result.lab, null);
  assert.equal(result.simulation, null);
  const missing = evidence(); missing.histories = [];
  const unavailable = await buildCurrencyResearch(missing);
  assert.equal(unavailable.composition.total, 100);
  assert.equal(unavailable.risk, null);
  assert.equal(unavailable.simulation, null);
});

it("renders the existing risk evidence as one section without a second portfolio or simulation", async () => {
  const input = evidence(), result = await buildCurrencyResearch(input);
  const states = ["USD", result, false, false, undefined, null, "0", 126, 126, input.histories[0].instrumentId];
  let index = 0;
  const [view] = await importUiWithPorts(["src/components/currency-research-view.tsx"], {
    react: { ...React, useState: () => [states[index++], () => {}], useMemo: fn => fn(), useEffect: () => {}, useRef: () => ({ current: null }) },
    "@/components/i18n/locale-provider": { useI18n: () => ({ locale: "en", t: (ko, en) => en ?? ko }) },
    "@/components/portfolio/portfolio-allocation-ring": { PortfolioAllocationRing: () => React.createElement("p", null, "DUPLICATE RING") },
  });
  const boundary = view.CurrencyResearchView({ evidence: input, surface: "structure", hideCurrencyControl: true });
  const html = renderToStaticMarkup(boundary.type(boundary.props));
  assert.match(html, new RegExp(result.risk.volatilityPct.toFixed(2).replace(".", "\\.")));
  assert.doesNotMatch(html, /<main|<canvas|DUPLICATE RING|1,000 possible paths|same cash flows, in one instrument/i);
  assert.match(html, /<section/);
});
