import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { portfolioEnglish } from "../src/components/portfolio/portfolio-copy.ts";
import { simulationEnglish } from "../src/components/simulation/simulation-copy.ts";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";

describe("localized portfolio and simulation evidence", () => {
  it("preserves KRW magnitude when Korean compact units change to English", () => {
    assert.equal(portfolioEnglish("2.4억"), "₩240m");
    assert.equal(portfolioEnglish("50만"), "₩500k");
    assert.equal(simulationEnglish("2,604,000원"), "2,604,000 KRW");
  });

  it("preserves signed percentages, counts and selected path identity", () => {
    assert.equal(portfolioEnglish("드리프트 -3.5%"), "Drift -3.5%");
    assert.equal(portfolioEnglish("전체 11종목 배분"), "All 11 allocations");
    assert.equal(simulationEnglish("표본 3 · 선택됨"), "Sample 3 · Selected");
    assert.equal(simulationEnglish("4단계, 중앙값 -5.20%"), "Step 4, median -5.20%");
  });

  it("preserves unknown holding names, account labels and identifiers", () => {
    for (const original of ["KODEX 미국나스닥100", "새 연금 계좌", "korea:KRW:069500", "2026-09-07"]) {
      assert.equal(portfolioEnglish(original), original);
      assert.equal(simulationEnglish(original), original);
    }
  });

  it("keeps absence of evidence distinct from a zero result", () => {
    assert.equal(portfolioEnglish("근거 없음"), "No evidence");
    assert.equal(portfolioEnglish("목표 0%"), "Target 0%");
    assert.equal(simulationEnglish("관측 없음"), "No observations");
    assert.equal(simulationEnglish("기준일 미확인"), "Reference date unverified");
  });

  it("preserves inherited-property names in mixed service messages", () => {
    for (const name of ["__proto__", "toString", "constructor"]) {
      assert.equal(portfolioEnglish(`${name} · 목표`), `${name} · Target`);
    }
  });

  it("server-renders every simulation SVG title as localized text and preserves actual holding names", async () => {
    const [provider, fan, pathComparison, observed, observedComparison] = await importUiWithPorts([
      "src/components/i18n/locale-provider.tsx",
      "src/components/simulation/simulation-fan-explorer.tsx",
      "src/components/simulation/simulation-path-comparison-chart.tsx",
      "src/components/simulation/observed-return-series-panel.tsx",
      "src/components/simulation/observed-return-comparison-panel.tsx",
    ], {});
    const execution = {
      id: "owner-all", name: "내 포트폴리오", assumptions: { horizon: 63 },
      bands: [{ stepIndex: 0, p10: 100, p50: 100, p90: 100 }, { stepIndex: 63, p10: 90, p50: 105, p90: 120 }],
      samplePaths: [],
    };
    const dates = ["2026-09-01", "2026-09-02", "2026-09-03"];
    const comparison = {
      status: "ready", pointCount: 3, baselineServiceDate: dates[0], endServiceDate: dates[2],
      series: ["KODEX 200", "VOO"].map((ticker, index) => ({
        id: `series-${index}`, ticker, name: ticker, finalIndexValue: 102, totalReturn: 0.02,
        points: dates.map((serviceDate, pointIndex) => ({ serviceDate, value: 100 + pointIndex })),
      })),
    };
    const render = (initialLocale, component, props) => renderToStaticMarkup(React.createElement(provider.LocaleProvider, { initialLocale }, React.createElement(component, props)));
    const scenarios = [
      [fan.SimulationFanExplorer, { execution }, "내 포트폴리오 확률 분포", "My portfolio: probability distribution"],
      [pathComparison.SimulationPathComparisonChart, {
        ariaLabel: "KODEX 200과 VOO의 과거 KRW 누적 관측지수 비교",
        series: [{ id: "series", label: "KODEX 200", color: "#000", points: [{ stepIndex: 0, indexValue: 100 }, { stepIndex: 63, indexValue: 102 }] }],
      }, "KODEX 200과 VOO의 과거 KRW 누적 관측지수 비교", "Historical KRW cumulative indices for KODEX 200 and VOO"],
      [observed.ObservedReturnSeriesPanel, {
        input: { id: "069500", ticker: "069500" }, chartScale: 0.1, scaleMode: "shared",
        rows: [{ previousServiceDate: dates[0], serviceDate: dates[1], value: 0.02 }],
      }, "069500 과거 KRW 단순수익률", "069500: historical simple KRW returns"],
      [observedComparison.ObservedReturnComparisonPanel, { comparison }, "KODEX 200과 VOO의 과거 KRW 누적 관측지수 비교", "Historical KRW cumulative indices for KODEX 200 and VOO"],
    ];
    for (const [component, props, koTitle, enTitle] of scenarios) {
      for (const [locale, expected] of [["ko", koTitle], ["en", enTitle]]) {
        const markup = render(locale, component, props);
        assert.doesNotMatch(markup, /\[object Object\]/);
        assert.equal(markup.match(/<title>(.*?)<\/title>/)?.[1], expected);
      }
    }
    const ownerMarkup = render("en", fan.SimulationFanExplorer, { execution });
    assert.match(ownerMarkup, /aria-label="My portfolio: research paths and P10, P50, P90 bands"/);
    assert.match(ownerMarkup, /aria-label="My portfolio: path step"/);
    for (const name of ["KODEX 미국나스닥100", "내 포트폴리오"]) {
      const holdingMarkup = render("en", fan.SimulationFanExplorer, { execution: { ...execution, id: "fixed-holding-069500", name } });
      assert.equal(holdingMarkup.match(/<title>(.*?)<\/title>/)?.[1], `${name}: probability distribution`);
    }
  });
});
