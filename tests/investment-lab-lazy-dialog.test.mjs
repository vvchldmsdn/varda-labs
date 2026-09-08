import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";

test("closed Lab dialog does not evaluate its deferred body or serialize evidence rows", async () => {
  const [{ InvestmentLabDialog }] = await importUiWithPorts(["src/components/investment-lab/investment-lab-dialog.tsx"], {});
  let calls = 0;
  const html = renderToStaticMarkup(createElement(InvestmentLabDialog, { label: "Evidence", title: "Evidence" }, () => { calls++; return createElement("table", null, "PRIVATE_RAW_ROWS"); }));
  assert.equal(calls, 0);
  assert.doesNotMatch(html, /PRIVATE_RAW_ROWS|<table/);
  assert.match(html, /<dialog/);
});

test("Lab chart initially exposes the same final date and amounts visually and to its slider", async () => {
  const [{ InvestmentLabChartCanvas }] = await importUiWithPorts(["src/components/investment-lab/investment-lab-chart-canvas.tsx"], {});
  const actual = { id: "actual", points: [{ serviceDate: "2026-09-01", valueKrw: 100 }, { serviceDate: "2026-09-08", valueKrw: 200 }] };
  const selected = { id: "kodex200", points: [{ serviceDate: "2026-09-01", valueKrw: 100 }, { serviceDate: "2026-09-08", valueKrw: 250 }] };
  const html = renderToStaticMarkup(createElement(InvestmentLabChartCanvas, { chart: { lines: [actual, selected] }, actual, selected }));
  assert.match(html, /2026\.09\.08/);
  assert.match(html, /aria-valuetext="2026-09-08 실제 ₩200 비교 ₩250"/);
  assert.match(html, /type="range"[^>]*value="1"/);
});


test("fresh blocked performance evidence displays its missing basis instead of dereferencing a prior summary", async () => {
  const Empty = () => null;
  const [{ InvestmentLabPerformanceDetails }] = await importUiWithPorts(["src/components/investment-lab/investment-lab-performance-details.tsx"], {
    "./investment-lab-dialog": { InvestmentLabDialog: ({ label, children }) => label === "가정" ? children() : null },
    "./investment-lab-comparison-chart": { InvestmentLabComparisonChart: Empty },
    "./investment-lab-cash-comparison": { InvestmentLabCashComparisonView: Empty },
    "./investment-lab-contribution-experiment": { InvestmentLabContributionExperiment: Empty },
    "./investment-lab-scenario-matrix": { InvestmentLabScenarioMatrix: Empty },
  });
  const html = renderToStaticMarkup(createElement(InvestmentLabPerformanceDetails, { data: { model: { observedPath: { summary: null } } } }));
  assert.match(html, /role="status"/);
  assert.match(html, /관측 경로 근거가 부족/);
});

test("simulation partial detail keeps available owner evidence when fixed research input is missing", async () => {
  const Empty = () => null;
  const ports = { "./simulation-query-controls": { SimulationLink: Empty }, "@/components/investment-lab/investment-lab-disclosure": { InvestmentLabDisclosure: Empty } };
  for (const [path, name] of [["fixed-mix-research-comparison-section", "FixedMixResearchComparisonSection"], ["fixed-mix-research-execution-section", "FixedMixResearchExecutionSection"], ["fixed-research-execution-section", "FixedResearchExecutionSection"], ["observed-return-alignment-evidence-panel", "ObservedReturnAlignmentEvidencePanel"], ["observed-return-comparison-panel", "ObservedReturnComparisonPanel"], ["walk-forward-min-volatility-section", "WalkForwardMinimumVolatilitySection"], ["walk-forward-stability-history-section", "WalkForwardStabilityHistorySection"]]) ports[`./${path}`] = { [name]: Empty };
  ports["./observed-return-series-panel"] = { ObservedReturnSeriesPanel: Empty, resolveObservedReturnScale: Empty, resolveSharedObservedReturnScale: () => { throw new Error("missing fixed model must not be read"); } };
  const [{ SimulationDetailView }] = await importUiWithPorts(["src/components/simulation/simulation-detail-view.tsx"], ports);
  const html = renderToStaticMarkup(createElement(SimulationDetailView, { model: null, panel: "validation", ownerWalkForwardValidation: createElement("p", null, "AVAILABLE_OWNER_VALIDATION"), ownerHistoricalValidation: createElement("p", null, "AVAILABLE_OWNER_HISTORY") }));
  assert.match(html, /AVAILABLE_OWNER_VALIDATION/);
  assert.match(html, /AVAILABLE_OWNER_HISTORY/);
  assert.match(html, /고정 종목의 연구 입력을 읽지 못했습니다/);
});
