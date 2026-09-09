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

test("Lab first steps preserve the selected scope and distinguish hypothetical exploration in both languages", async () => {
  const [{ InvestmentLabFirstSteps }, { LocaleProvider }] = await importUiWithPorts([
    "src/components/investment-lab/investment-lab-first-steps.tsx",
    "src/components/i18n/locale-provider.tsx",
  ], { "next/link": { default: ({ children, ...props }) => createElement("a", props, children) } });
  for (const locale of ["ko", "en"]) {
    const html = renderToStaticMarkup(createElement(LocaleProvider, { initialLocale: locale }, createElement(InvestmentLabFirstSteps, {
      scopeKey: "account:11111111-1111-4111-8111-111111111111", onOpenPanel() {},
    })));
    assert.match(html, /href="\/simulation\?scope=account%3A11111111-1111-4111-8111-111111111111"/);
    assert.equal((html.match(/<button/g) ?? []).length, 2);
    assert.doesNotMatch(html, /<table|<svg[^>]+data-past-return/);
    assert.match(html, locale === "ko" ? /내 과거 수익이나 실제 매매 기록이 되지 않아요/ : /not your past returns or actual trades/);
    assert.match(html, locale === "ko" ? /확인된 가격·평가액 범위/ : /verified price and valuation evidence/);
    if (locale === "en") assert.doesNotMatch(html, /[가-힣]/);
  }
});

test("Lab replaces only short valid personal histories with first steps, preserving real calculation and error states", async () => {
  const Empty = () => null;
  const ports = {
    "./investment-lab-workspace": { InvestmentLabWorkspace: ({ showFirstSteps, comparison }) => createElement("section", { "data-first-steps": String(showFirstSteps) }, comparison) },
  };
  for (const [path, name] of [
    ["@/components/portfolio-primary-navigation", "PortfolioPrimaryNavigation"],
    ["./investment-lab-scope-tabs", "InvestmentLabScopeTabs"],
    ["./investment-lab-dialog", "InvestmentLabDialog"],
    ["./investment-lab-evidence-group", "InvestmentLabEvidenceGroup"],
    ["./investment-lab-deferred-performance", "InvestmentLabDeferredPerformance"],
    ["./investment-lab-funding-preflight", "InvestmentLabFundingPreflightView"],
    ["./investment-lab-observed-history", "InvestmentLabObservedHistoryView"],
    ["./investment-lab-period-selector", "InvestmentLabPeriodSelector"],
    ["./investment-lab-scenario-chart", "InvestmentLabScenarioChartView"],
  ]) ports[path] = { [name]: Empty };
  const [{ InvestmentLabView }] = await importUiWithPorts(["src/components/investment-lab/investment-lab-view.tsx"], ports);
  const unavailable = { status: "unavailable" };
  const props = {
    weightEvidence: {}, accountComposition: unavailable,
    anchorBasketScenario: unavailable, anchorValueWeightScenario: unavailable,
    anchorCurrentWeightMonthlyScenario: unavailable, anchorEqualWeightMonthlyScenario: unavailable,
    approvedTargetWeightScenario: unavailable, fountScopeAdjustment: unavailable,
    model: { observedPath: unavailable, coverage: {}, sourceAuthority: { coverage: {} }, blockers: [] },
    observedHistory: { status: "unavailable", coverage: { observedDateCount: 0, segmentCount: 0 }, blockers: [] },
    period: { status: "full" }, selectedScope: { key: "all" },
    dataAvailability: createElement("p", null, "DETAILED_DIAGNOSTICS"),
  };
  const render = changes => renderToStaticMarkup(createElement(InvestmentLabView, { ...props, ...changes }));
  const initial = render({});
  assert.match(initial, /data-first-steps="true"/);
  assert.doesNotMatch(initial, /DETAILED_DIAGNOSTICS/);
  assert.match(render({ period: { status: "invalid" } }), /data-first-steps="false"/);
  assert.match(render({ observedHistory: { ...props.observedHistory, blockers: ["invalid_market_value"] } }), /data-first-steps="false"/);
  assert.match(render({ observedHistory: { ...props.observedHistory, coverage: { observedDateCount: 2 } } }), /data-first-steps="false"/);
  assert.match(render({ model: { ...props.model, observedPath: { status: "ready" } } }), /data-first-steps="false"/);
});
