import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importWithPorts } from "./helpers/import-with-ports.mjs";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";
import { researchDetailQuery, RESEARCH_DETAIL_HEADERS } from "../src/lib/research-detail-query.ts";
import { resolveSimulationPathModel } from "../src/lib/simulation-model-selection.ts";
import { buildSimulationOwnerEconomicResearch } from "../src/lib/simulation-owner-economic-research.ts";
import { evaluateEconomicStatePaths } from "../src/lib/simulation-economic-state-model.ts";
import { summarizeSimulationNavPaths } from "../src/lib/simulation-nav-path-summary.ts";
import { ownerWeights, readyOwnerMatrix } from "./support/simulation-owner-ready-matrix.mjs";

test("economic model selection rejects duplicate and unsupported query values before private reads", async () => {
  let contextReads = 0;
  let researchReads = 0;
  const [{ GET }] = await importWithPorts(["src/app/api/research/simulation/route.ts"], {
    "@/lib/auth/research-detail-context": { resolveResearchDetailContext: async () => {
      contextReads += 1;
      return { ok: false, response: Response.json({ error: "authentication_required" }, { status: 401, headers: RESEARCH_DETAIL_HEADERS }) };
    } },
    "@/db/queries/simulation-detail": { loadSimulationDetail: async () => { researchReads += 1; throw new Error("not authenticated"); } },
    "@/db/queries/simulation-owner-economic": { economicResearchPresentation: neverCalled },
  });
  assert.equal(resolveSimulationPathModel(undefined), "economic");
  assert.equal(resolveSimulationPathModel("bootstrap"), "bootstrap");
  for (const queryString of ["model=economic&model=bootstrap", "model=economic&model=economic", "model=unknown", "model="]) {
    const query = researchDetailQuery(new URLSearchParams(queryString));
    assert.equal(resolveSimulationPathModel(query.model), null);
    const response = await GET(new Request(`https://example.test/api/research/simulation?view=weights&${queryString}`));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_model" });
    assert.match(response.headers.get("cache-control"), /private, no-store/);
    assert.equal(response.headers.get("vary"), "Cookie");
  }
  assert.equal(contextReads, 0);
  assert.equal(researchReads, 0);
  assert.equal((await GET(new Request("https://example.test/api/research/simulation?view=evidence&model=economic"))).status, 401);
  assert.equal(contextReads, 1);
});

test("presentation excludes the real prepared buffers without mutating server results", async () => {
  const [{ economicResearchPresentation }] = await importWithPorts(["src/db/queries/simulation-owner-economic.ts"], {
    "./simulation-regime-evidence": { loadSimulationFactorRows: neverCalled },
  });
  const research = buildSimulationOwnerEconomicResearch(fixtureInput());
  assert.equal(research.status, "ready");
  const prepared = research.prepared;
  const presentation = economicResearchPresentation(research);
  assert.equal(Object.hasOwn(presentation, "prepared"), false);
  assert.equal(research.prepared, prepared);
  assert.ok(prepared.assetGrowth instanceof Float64Array);
  assert.deepEqual(presentation.terminal, research.terminal);
  assert.deepEqual(presentation.currentFactors, research.currentFactors);
  const serialized = JSON.parse(JSON.stringify(presentation));
  assert.equal(Object.hasOwn(serialized, "prepared"), false);
  assert.equal(containsPathBuffer(presentation), false);
  assert.equal(serialized.samplePaths.length, 12);
  assert.equal(serialized.bands.length, 22);
});

test("owner economic reads bind each request's owner inputs and pass the requested state date", async () => {
  const input = fixtureInput();
  const factorDates = [];
  const [{ getReadOnlyTenantSimulationOwnerEconomicResearch }] = await importWithPorts(["src/db/queries/simulation-owner-economic.ts"], {
    "./simulation-regime-evidence": { loadSimulationFactorRows: async (date) => { factorDates.push(date); return input.factorRows; } },
  });
  const stateAsOfServiceDate = input.matrix.requestedServiceDates.at(-1);
  for (const account of ["owner-a-account", "owner-b-account"]) {
    const owner = { execution: { account }, parametricFactorInput: { matrix: input.matrix, weights: input.weights, horizon: 21 } };
    const result = await getReadOnlyTenantSimulationOwnerEconomicResearch({ ownerResearchPromise: Promise.resolve(owner), stateAsOfServiceDate });
    assert.equal(result.status, "ready");
    assert.equal(result.account, account);
    assert.equal(result.source.stateAsOfServiceDate, stateAsOfServiceDate);
    assert.deepEqual(result.executionWeights, input.weights);
  }
  assert.deepEqual(factorDates, [stateAsOfServiceDate, stateAsOfServiceDate]);
  const unavailable = await getReadOnlyTenantSimulationOwnerEconomicResearch({
    ownerResearchPromise: Promise.resolve({ execution: { account: "blocked-owner" }, parametricFactorInput: null }), stateAsOfServiceDate,
  });
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.account, "blocked-owner");
  assert.equal(factorDates.length, 2);
});

test("economic evidence renders included, omitted and unready holdings without hiding shortfalls or inventing zero observations", async () => {
  const [panel, execution, { LocaleProvider }] = await importUiWithPorts([
    "src/components/simulation/economic-detail-panel.tsx",
    "src/components/simulation/economic-execution-section.tsx",
    "src/components/i18n/locale-provider.tsx",
  ], {
    "next/link": { default: ({ children, ...props }) => createElement("a", props, children) },
    "./research-fan-chart": { ResearchFanChart: () => null, resolveResearchFanChartValueDomain: () => null },
    "@/components/explanations/calculation-guide-dialog": { CalculationGuideDialog: () => null },
    "@/components/investment-lab/investment-lab-dialog": { InvestmentLabDialog: ({ children }) => children },
  });
  const input = fixtureInput();
  const ready = buildSimulationOwnerEconomicResearch(input);
  const cutoff = input.matrix.requestedServiceDates.at(-10);
  const insufficient = buildSimulationOwnerEconomicResearch({ ...input, factorRows: input.factorRows.filter((row) => row.releaseDate >= cutoff) });
  assert.equal(ready.status, "ready");
  assert.equal(insufficient.reason, "insufficient_factor_overlap");
  assert.ok(insufficient.source.alignedObservationCount > 0 && insufficient.source.alignedObservationCount < 45);
  const stale = buildSimulationOwnerEconomicResearch({ ...input, stateAsOfServiceDate: "2026-12-31" });
  assert.equal(stale.reason, "current_factor_state_stale");
  const first = input.weights[0];
  const data = {
    panel: "evidence", selectedScope: { key: "all" },
    instruments: [
      { ...first, name: "Included fund", originalWeightBps: 6000, executionRole: "modeled", historicalStatus: "provenance_ready_for_separate_review" },
      { instrumentKey: "manual-gold", name: "Manual gold", ticker: "GOLD", currency: "KRW", originalWeightBps: 4000, executionRole: "omitted_manual_history", historicalStatus: "manual_history_required" },
      { instrumentKey: "missing-history", name: "Unready fund", ticker: "UNREADY", currency: "USD", originalWeightBps: 0, executionRole: "modeled", historicalStatus: "stored_coverage_incomplete" },
    ],
    inputPreflight: { summary: { fountExcludedHoldingCount: 1 }, blockers: ["valuation_evidence_incomplete"], valuationGaps: [{ name: "Missing quote", reason: "missing_price" }], identityGaps: [{ name: "Unknown holding", ticker: null }] },
  };
  const render = (component, props, locale) => renderToStaticMarkup(createElement(LocaleProvider, { initialLocale: locale }, createElement(component, props)));
  for (const locale of ["ko", "en"]) {
    const html = render(panel.EconomicDetailPanel, { data: { ...data, economic: ready } }, locale);
    assert.ok(html.includes("Included fund") && html.includes("Manual gold") && html.includes("Unready fund"));
    assert.ok(html.includes(locale === "ko" ? "계산에 포함" : "Included in paths"));
    assert.ok(html.includes(locale === "ko" ? "별도 평가 이력 필요" : "separate valuation history required"));
    assert.ok(html.includes(locale === "ko" ? "가격 이력 부족" : "Insufficient price history"));
    assert.ok(html.includes("60.00%") && html.includes("50.00%"), "original and normalized weights remain distinct");
    assert.ok(html.includes("Missing quote") && html.includes("Unknown holding") && html.includes("Fount"));
    assert.ok(html.includes("/portfolio/holdings?scope=all"));
    const blocked = render(panel.EconomicDetailPanel, { data: { ...data, economic: insufficient } }, locale);
    assert.match(blocked, /data-economic-observation-shortfall/);
    assert.ok(blocked.includes(String(insufficient.source.observationShortfall)));
    assert.ok(blocked.includes("Included fund") && blocked.includes("Missing quote"));
    assert.ok(!blocked.includes(locale === "ko" ? "계산에 포함" : "Included in paths"));
    const main = render(execution.EconomicExecutionSection, { result: insufficient, baseline: { coverage: { modeledCurrentValuePct: 60 } } }, locale);
    assert.match(main, /data-economic-observation-shortfall/);
    assert.ok(main.includes(locale === "ko" ? "모형·데이터" : "Model &amp; data"));
    assert.ok(!main.includes('/portfolio/holdings'), "main uses the existing model-data panel instead of dropping account scope");
    const aged = render(panel.EconomicDetailPanel, { data: { ...data, economic: stale } }, locale);
    assert.ok(aged.includes(locale === "ko" ? "최신성 기준 초과" : "Too old for this cutoff"));
    assert.doesNotMatch(aged, /data-economic-observation-shortfall/, "uncomputed overlap is not presented as zero observations");
    assert.ok(aged.includes(stale.source.stateAsOfServiceDate));
  }
});

test("economic detail shares one resolved owner input and computes only the selected panel", async () => {
  const input = fixtureInput();
  const economic = buildSimulationOwnerEconomicResearch(input);
  assert.equal(economic.status, "ready");
  const [{ economicResearchPresentation }] = await importWithPorts(["src/db/queries/simulation-owner-economic.ts"], {
    "./simulation-regime-evidence": { loadSimulationFactorRows: neverCalled },
  });
  const tenantContext = { ownerUserId: "owner-a" };
  const selectedScope = { key: "account:a", kind: "account", accountCode: "account-a" };
  const scopeCatalog = [selectedScope];
  const calls = [];
  let expectedPromise;
  let latestOwner;
  let unavailableEconomic = false;
  const ports = detailPorts();
  ports["./simulation-owner-research"] = { getReadOnlyTenantSimulationOwnerResearch: (options) => {
    calls.push("owner");
    assert.equal(options.tenantContext, tenantContext);
    assert.equal(options.scope, selectedScope);
    assert.equal(options.endServiceDate, "2026-04-01");
    assert.equal(options.horizon, "126");
    latestOwner = { execution: { account: "all", instruments: input.matrix.instruments }, inputPreflight: { status: "ready" } };
    for (const name of ["candidateComparison", "walkForwardValidation", "historicalValidation"]) Object.defineProperty(latestOwner, name, { get: neverCalled });
    expectedPromise = Promise.resolve(latestOwner);
    return expectedPromise;
  } };
  ports["./simulation-owner-economic"] = {
    getReadOnlyTenantSimulationOwnerEconomicResearch: async (options) => {
      calls.push("economic");
      assert.equal(options.ownerResearchPromise, expectedPromise);
      assert.equal(await options.ownerResearchPromise, latestOwner);
      assert.equal(options.stateAsOfServiceDate, "2026-04-01");
      return unavailableEconomic ? { ...economic, status: "unavailable", prepared: null, reason: "current_factor_state_stale" } : economic;
    },
    getReadOnlyTenantSimulationOwnerEconomicValidation: async (options) => {
      calls.push("economicValidation");
      assert.equal(options.ownerResearchPromise, expectedPromise);
      return { status: "unavailable", reason: "insufficient_history" };
    },
    economicResearchPresentation,
  };
  ports["@/lib/simulation-owner-economic-candidates"] = { buildSimulationOwnerEconomicCandidates: ({ economic: received }) => {
    calls.push("economicCandidates");
    assert.equal(received, economic);
    return { status: "ready", account: received.account };
  } };
  const [{ loadSimulationDetail }] = await importWithPorts(["src/db/queries/simulation-detail.ts"], ports);
  const request = { tenantContext, selectedScope, scopeCatalog, query: { model: "economic", end: "2026-04-01", horizon: "126", researchUniverse: "owner" } };
  for (const [panel, expectedCalls] of [
    ["weights", ["owner", "economic", "economicCandidates"]],
    ["evidence", ["owner", "economic"]],
    ["validation", ["owner", "economicValidation"]],
  ]) {
    calls.length = 0;
    const result = await loadSimulationDetail({ ...request, panel });
    assert.deepEqual(calls, expectedCalls);
    assert.equal(result.pathModel, "economic");
    assert.equal(result.selectedScope, selectedScope);
    assert.equal(result.scopeCatalog, scopeCatalog);
    assert.deepEqual(result.preservedQuery, { scope: "account:a", model: "economic", end: "2026-04-01", horizon: "126", kodexWeight: null, researchUniverse: "owner" });
    assert.equal(result.candidateComparison, null);
    assert.equal(result.walkForwardValidation, null);
    assert.equal(containsPathBuffer(result), false);
    if (panel === "validation") assert.equal(result.economic, null);
    else assert.equal(result.economic.status, "ready");
  }
  unavailableEconomic = true;
  const result = await loadSimulationDetail({ ...request, panel: "evidence" });
  assert.equal(result.economic.status, "unavailable");
  assert.equal(result.economic.reason, "current_factor_state_stale");
  assert.equal(result.model, null);
  assert.equal(result.ownerParametricFactor, null);
});

test("economic design preview uses the production engine and one common asset-path valuation contract", async () => {
  const [{ buildSimulationEconomicDesignPreview }] = await importWithPorts(["src/lib/simulation-economic-design-preview.ts"], {});
  const preview = buildSimulationEconomicDesignPreview({ model: "economic", horizon: "126", scope: "all", end: "2026-08-28" });
  assert.equal(preview.execution.status, "ready");
  assert.equal(preview.economic.status, "ready");
  assert.equal(preview.execution.assumptions.horizon, 126);
  assert.equal(preview.economic.prepared.horizon, 126);
  assert.equal(preview.economic.prepared.modelVersion, "simulation_economic_state_conditional_mean_v1");
  assert.equal(preview.economic.source.stateAsOfServiceDate, "2026-08-28");
  assert.deepEqual(preview.economic.executionWeights, preview.currentWeights);
  const paths = evaluateEconomicStatePaths({ prepared: preview.economic.prepared, weights: preview.currentWeights.map((row) => row.weightBps / 10_000) });
  const summary = summarizeSimulationNavPaths({ paths: paths.paths, horizon: 126, samplePathCount: 12 });
  assert.deepEqual(preview.economic.terminal, summary.terminal);
  assert.deepEqual(preview.economic.samplePaths, summary.samplePaths);
  const stale = buildSimulationEconomicDesignPreview({ model: "economic", previewState: "stale" });
  assert.equal(stale.economic.status, "unavailable");
  assert.equal(stale.economic.reason, "current_factor_state_stale");
});

test("production and detail response boundaries keep previews opt-in and private computation uncached", () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const page = read("src/app/simulation/page.tsx");
  const route = read("src/app/api/research/simulation/route.ts");
  assert.match(page, /dynamic\s*=\s*"force-dynamic"/);
  assert.match(page, /NODE_ENV\s*===\s*"development"\s*&&\s*previewParams\?\.preview\s*===\s*"design"/);
  assert.match(route, /NODE_ENV\s*===\s*"development"\s*&&\s*query\.preview\s*===\s*"design"/);
  for (const path of ["src/db/queries/simulation-owner-economic.ts", "src/db/queries/simulation-detail.ts"]) {
    assert.doesNotMatch(read(path), /unstable_cache|use cache|new Map\(|new WeakMap\(/);
  }
});

test("economic preview reuses an already prepared preview instead of repeating its heavy baseline", async () => {
  const [{ buildSimulationEconomicDesignPreview }] = await importWithPorts(["src/lib/simulation-economic-design-preview.ts"], {
    "./simulation-design-preview.ts": { buildSimulationDesignPreview: neverCalled },
  });
  const input = fixtureInput();
  const existing = {
    execution: { status: "ready", account: input.account, assumptions: { horizon: input.horizon } },
    matrix: input.matrix, currentWeights: input.weights, dates: input.matrix.requestedServiceDates,
    existingBaselineMarker: "already-evaluated",
  };
  const result = buildSimulationEconomicDesignPreview({ model: "economic" }, existing);
  assert.equal(result.economic.status, "ready");
  assert.equal(result.execution, existing.execution);
  assert.equal(result.matrix, existing.matrix);
  assert.equal(result.existingBaselineMarker, "already-evaluated");
});

function fixtureInput() {
  const matrix = readyOwnerMatrix();
  return { account: "all", matrix, weights: ownerWeights([5000, 2500, 2500]), horizon: 21, ownerExecutionReady: true,
    factorRows: matrix.requestedServiceDates.flatMap((date, i) => [
      ["usdkrw", 1300 + Math.sin(i / 5) * 6], ["us_10y_yield", 4 + Math.sin(i / 7) * 0.08], ["us_10y2y_curve", 0.2 + Math.cos(i / 9) * 0.04],
    ].map(([factorKey, value]) => ({ factorKey, value, factorDate: date, periodEndDate: date, releaseDate: date, volatility20dPct: 1 }))),
  };
}
function containsPathBuffer(value) {
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return true;
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, nested]) => ["prepared", "assetGrowth", "factorStates"].includes(key) || containsPathBuffer(nested));
}
function neverCalled() { throw new Error("unexpected computation or data access"); }
function detailPorts() {
  const ports = {};
  for (const [path, name] of [
    ["holding-analysis-data-readiness", "getReadOnlyTenantHoldingAnalysisDataReadinessForScope"],
    ["simulation-historical-outcome-validation", "getReadOnlySimulationHistoricalOutcomeValidation"],
    ["simulation-input-readiness", "getReadOnlySimulationInputReadiness"],
    ["simulation-owner-parametric-factor", "getReadOnlyTenantSimulationOwnerParametricFactorResearch"],
    ["simulation-owner-model-calibration", "getReadOnlyTenantSimulationOwnerModelCalibration"],
    ["simulation-owner-model-comparison", "getReadOnlyTenantSimulationOwnerModelComparison"],
    ["simulation-regime-bootstrap", "getReadOnlySimulationRegimeBootstrap"],
    ["simulation-regime-historical-outcome-validation", "getReadOnlySimulationRegimeHistoricalOutcomeValidation"],
    ["simulation-research-universe-preflight", "getReadOnlySimulationResearchUniversePreflight"],
  ]) ports[`./${path}`] = { [name]: neverCalled };
  return ports;
}
