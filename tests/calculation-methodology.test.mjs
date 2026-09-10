import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";
import { movementMethod, riskMethod } from "../src/components/explanations/portfolio-methods.ts";
import { simulationMethod } from "../src/components/explanations/simulation-method.ts";
import { investmentLabMethod } from "../src/components/explanations/investment-lab-method.ts";
import { contributionMethod } from "../src/components/explanations/contribution-method.ts";
import { calculateFxAwareSnapshotMovementKrw } from "../src/lib/portfolio-math.ts";
import { calculateSimulationPathMaxDrawdowns } from "../src/lib/simulation-path-max-drawdown.ts";
import { syntheticPathMaxDrawdownInput } from "./fixtures/simulation-path-max-drawdown.mjs";

describe("calculation methodology explanations", () => {
  it("reconciles the illustrated price and FX bars with the actual attribution engine", () => {
    const result = calculateFxAwareSnapshotMovementKrw({ quantity: 1, previousQuantity: 1, trades: [], currentPrice: 103, previousPrice: 100, currentFxRate: 1010, previousFxRate: 1000, currentValueKrw: 104030, previousValueKrw: 100000 });
    assert.deepEqual(movementMethod.sections[0].figure.rows.map(row => row.value), [result.priceChangeKrw, result.fxChangeKrw, result.changeKrw]);
    const tradeResult = calculateFxAwareSnapshotMovementKrw({ quantity: 3, previousQuantity: 2, trades: [{ quantityDelta: 1, price: 102, fxRate: 1000 }], currentPrice: 103, previousPrice: 100, currentFxRate: 1010, previousFxRate: 1000, currentValueKrw: 312090, previousValueKrw: 200000, tradeFlowKrw: 102000 });
    assert.equal(tradeResult.changeKrw, 10090);
    assert.equal(tradeResult.priceChangeKrw + tradeResult.fxChangeKrw, tradeResult.changeKrw);
  });

  it("uses a running peak for the drawdown illustration and validates it with the path engine", () => {
    const section = simulationMethod.sections.find(section => section.id === "tail-and-drawdown");
    const [path, peaks] = section.figure.series;
    assert.deepEqual(peaks.values, path.values.map((_, i) => Math.max(...path.values.slice(0, i + 1))));
    const input = path.values.map(value => value / path.values[0]);
    const result = calculateSimulationPathMaxDrawdowns(syntheticPathMaxDrawdownInput({ pathNavs: [input] }));
    assert.equal(result.pathDrawdowns[0].maxDrawdown, 0.25);
    assert.ok(Math.abs(input.at(-1) - 1 - 0.1) < 1e-12);
  });

  it("renders all five methods in both locales with equations, notation and labelled figures", async () => {
    const [provider, explorer] = await importUiWithPorts(["src/components/i18n/locale-provider.tsx", "src/components/explanations/method-explorer.tsx"], {});
    for (const initialLocale of ["ko", "en"]) for (const guide of [movementMethod, riskMethod, simulationMethod, investmentLabMethod, contributionMethod]) {
      const html = renderToStaticMarkup(React.createElement(provider.LocaleProvider, { initialLocale }, React.createElement(explorer.default, { guide })));
      assert.ok(html.includes(guide.title[initialLocale]));
      assert.equal((html.match(/<figure /g) ?? []).length, guide.sections.length);
      for (const section of guide.sections) {
        assert.ok(section.equations.length && section.symbols.length && section.caveat[initialLocale]);
        for (const equation of section.equations) assert.ok(equation.reading[initialLocale]);
      }
      assert.doesNotMatch(html, /NaN|Infinity|\[object Object\]/);
      if (initialLocale === "en") assert.doesNotMatch(html, /[가-힣]/);
      assert.ok(html.includes(initialLocale === "ko" ? "내 포트폴리오 결과가 아닙니다" : "not your portfolio results"));
    }
  });

  it("keeps the advanced content unmounted in the initial closed disclosure", async () => {
    const [provider, detail] = await importUiWithPorts(["src/components/i18n/locale-provider.tsx", "src/components/explanations/method-details.tsx"], {});
    const html = renderToStaticMarkup(React.createElement(provider.LocaleProvider, { initialLocale: "en" }, React.createElement(detail.MethodDetails, { topic: "simulation" })));
    assert.match(html, /Formulas and methodology/);
    assert.doesNotMatch(html, /<section|<figure|METHODOLOGY|<details[^>]*\sopen/);
  });
});
