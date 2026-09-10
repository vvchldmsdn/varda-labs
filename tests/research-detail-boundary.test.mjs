import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { importWithPorts } from "./helpers/import-with-ports.mjs";
import { researchDetailQuery, RESEARCH_DETAIL_HEADERS } from "../src/lib/research-detail-query.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";
import { DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS } from "../src/lib/portfolio-analysis-special-holding-authority.ts";

test("detail query preserves duplicate financial and panel values for fail-closed resolvers", () => {
  const query = researchDetailQuery(new URLSearchParams("scope=a&scope=b&view=weights&view=evidence&horizon=126"));
  assert.deepEqual(query.scope, ["a", "b"]);
  assert.deepEqual(query.view, ["weights", "evidence"]);
  assert.equal(query.horizon, "126");
  assert.match(RESEARCH_DETAIL_HEADERS["Cache-Control"], /private, no-store/);
});

test("detail context resolves authentication every time and authorizes scope before reads", async () => {
  let calls = 0;
  let scopeCalls = 0;
  let allowed = false;
  const tenantContext = { ownerUserId: "owner-a" };
  const scope = { key: "account:a", kind: "account" };
  const [{ resolveResearchDetailContext }] = await importWithPorts(["src/lib/auth/research-detail-context.ts"], {
    "./current-tenant-context": { resolveCurrentTenantContext: async () => { calls++; return allowed ? { ok: true, tenantContext } : { ok: false }; } },
    "@/db/queries/portfolio-analysis-scopes": { getReadOnlyTenantPortfolioAnalysisScopeContext: async (input) => {
      scopeCalls++;
      assert.equal(input.tenantContext, tenantContext);
      return input.scope === "foreign" ? { state: "unavailable" } : { state: "ready", resolution: { state: "resolved", scope }, catalog: { scopes: [scope] } };
    } },
  });
  assert.equal((await resolveResearchDetailContext({ scope: "foreign" })).response.status, 401);
  assert.equal(scopeCalls, 0);
  allowed = true;
  assert.equal((await resolveResearchDetailContext({ scope: "foreign" })).response.status, 403);
  const result = await resolveResearchDetailContext({ scope: "account:a", ownerUserId: "attacker" });
  assert.equal(result.tenantContext, tenantContext);
  assert.equal(result.selectedScope, scope);
  assert.equal(calls, 3);
});

test("both detail endpoints reject unauthenticated reads before any research query", async () => {
  let reads = 0;
  const [lab, simulation] = await importWithPorts(["src/app/api/research/investment-lab/route.ts", "src/app/api/research/simulation/route.ts"], {
    "@/lib/auth/research-detail-context": { resolveResearchDetailContext: async () => ({ ok: false, response: Response.json({ error: "authentication_required" }, { status: 401, headers: RESEARCH_DETAIL_HEADERS }) }) },
    "@/db/queries/investment-lab-detail": { loadInvestmentLabDetail: async () => { reads++; } },
    "@/db/queries/simulation-detail": { loadSimulationDetail: async () => { reads++; } },
  });
  for (const endpoint of [lab, simulation]) {
    const response = await endpoint.GET(new Request("https://example.test/api/research?view=weights&scope=all"));
    assert.equal(response.status, 401);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.equal((await endpoint.GET(new Request("https://example.test/api/research?view=weights&view=evidence"))).status, 400);
  }
  assert.equal(reads, 0);
});

test("composition uses only one current portfolio and no counterfactual main loader", async () => {
  const called = [];
  const portfolio = { holdingRows: [] };
  const [{ loadInvestmentLabDetail }] = await importWithPorts(["src/db/queries/investment-lab-detail.ts"], {
    "./portfolio-structure": { getReadOnlyTenantPortfolioStructureForScope: async ({ tenantContext, scope }) => { called.push("portfolio"); assert.equal(tenantContext.ownerUserId, "owner-a"); assert.equal(scope.key, "account:a"); return portfolio; } },
    "./investment-lab-etf-xray": { getReadOnlyTenantInvestmentLabEtfXrayFromPortfolio: async (promise) => { called.push("xray"); assert.equal(await promise, portfolio); return { status: "ready" }; } },
    "./investment-lab-stress-replay": { getReadOnlyTenantInvestmentLabStressReplay: async ({ portfolioStructurePromise }) => { called.push("stress"); assert.equal(await portfolioStructurePromise, portfolio); return { status: "ready" }; } },
    "@/lib/investment-lab-small-adjustment": { buildInvestmentLabSmallAdjustmentModel: () => { throw new Error("weights were not requested"); } },
    "@/lib/investment-lab-current-holding-scope": { applyInvestmentLabCurrentHoldingScope: (input) => ({ portfolio: input }) },
  });
  const result = await loadInvestmentLabDetail({ panel: "composition", tenantContext: { ownerUserId: "owner-a" }, selectedScope: { key: "account:a" }, scopeCatalog: [] });
  assert.deepEqual(called, ["portfolio", "xray", "stress"]);
  assert.equal(result.adjustment, null);
});

test("Lab preserves accounts awaiting their first quotes and renders valuation reasons in Korean and English", async () => {
  const missing = (ticker, currency) => ({ name: ticker, ticker, account: "new-account", market: currency === "USD" ? "us" : "korea", currency, assetType: "stock", reason: "missing_price" });
  let portfolio = { holdingRows: [], exclusions: [missing("005930", "KRW"), missing("AAPL", "USD")] };
  const tenantContext = { ownerUserId: "owner-a" };
  const selectedScope = { key: "account:a", kind: "account", accountCode: "new-account" };
  const scopeCatalog = [
    { ...selectedScope, label: "My account" },
    { key: "account:other", kind: "account", accountCode: "other-account", label: "Other account" },
  ];
  const [{ loadInvestmentLabDetail }] = await importWithPorts(["src/db/queries/investment-lab-detail.ts"], {
    "./portfolio-structure": { getReadOnlyTenantPortfolioStructureForScope: async (input) => { assert.equal(input.tenantContext, tenantContext); assert.equal(input.scope, selectedScope); return portfolio; } },
    "./investment-lab-etf-xray": { getReadOnlyTenantInvestmentLabEtfXrayFromPortfolio: () => { throw new Error("unrequested analysis"); } },
    "./investment-lab-stress-replay": { getReadOnlyTenantInvestmentLabStressReplay: () => { throw new Error("unrequested analysis"); } },
  });
  const load = () => loadInvestmentLabDetail({ panel: "weights", tenantContext, selectedScope, scopeCatalog });
  const { adjustment } = await load();
  assert.deepEqual(adjustment.accounts.map(row => row.account), ["new-account"]);
  assert.equal(adjustment.accounts[0].label, "My account");
  assert.equal(adjustment.accounts[0].status, "unavailable");
  assert.equal(adjustment.accounts[0].excludedHoldingCount, 2);
  assert.equal(adjustment.accounts[0].exclusionReasonCounts.missingPrice, 2);
  assert.ok(adjustment.accounts[0].blockers.includes("incomplete_valuation_coverage"));
  const [{ InvestmentLabSmallAdjustment }, { LocaleProvider }] = await importUiWithPorts([
    "src/components/investment-lab/investment-lab-small-adjustment.tsx",
    "src/components/i18n/locale-provider.tsx",
  ], {});
  for (const locale of ["ko", "en"]) {
    const html = renderToStaticMarkup(createElement(LocaleProvider, { initialLocale: locale }, createElement(InvestmentLabSmallAdjustment, { model: adjustment })));
    assert.match(html, /data-adjustment-account-count="1"/);
    assert.match(html, /data-adjustment-ready-accounts="0"/);
    assert.doesNotMatch(html, /<form|Other account/);
    assert.match(html, locale === "ko" ? /가격·환율 근거가 없는 보유자산/ : /Some holdings lack price or FX evidence/);
    if (locale === "en") assert.doesNotMatch(html, /[가-힣]/);
  }
  portfolio = { holdingRows: [], exclusions: [] };
  assert.deepEqual((await load()).adjustment.accounts, [], "a genuinely empty scope must not acquire catalog accounts");
  const fount = DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions.fount;
  const excludedResearchHolding = { ...missing("", "KRW"), name: fount.assetName, account: fount.account, market: fount.market, currency: fount.currency, assetType: fount.assetType };
  portfolio = { holdingRows: [], exclusions: [excludedResearchHolding] };
  assert.deepEqual((await load()).adjustment.accounts, [], "an intentionally excluded research holding must not reintroduce its account");
  portfolio = { holdingRows: [], exclusions: [missing("AAPL", "USD"), excludedResearchHolding] };
  assert.deepEqual((await load()).adjustment.accounts.map(row => row.account), ["new-account"]);
});

test("main routes and workspace entry bundles do not statically import detail calculators", () => {
  for (const path of ["src/app/investment-lab/page.tsx", "src/app/simulation/page.tsx"]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /requestedPanel|getReadOnlyTenantInvestmentLabEtfXray|OwnerCandidateComparisonContent|InvestmentLabPreperiodOptimizerView/);
  }
  for (const domain of ["investment-lab", "simulation"]) {
    const source = readFileSync(new URL(`../src/components/${domain}/${domain}-workspace.tsx`, import.meta.url), "utf8");
    assert.match(source, /dynamic\(\(\) => import\("\.\/.+-remote-panel"\)/);
    assert.doesNotMatch(source, /router\.push|router\.replace/);
  }
});


test("simulation detail evaluates only the selected owner results and preserves them if fixed research fails", async () => {
  let panel;
  const calls = [];
  const owner = { execution: { instruments: ["actual holding"] }, inputPreflight: { status: "ready" } };
  for (const [name, expectedPanel] of [["candidateComparison", "weights"], ["walkForwardValidation", "validation"], ["historicalValidation", "validation"]]) {
    Object.defineProperty(owner, name, { get() { assert.equal(panel, expectedPanel); calls.push(name); return { status: "ready", result: name }; } });
  }
  const ports = {
    "./simulation-owner-research": { getReadOnlyTenantSimulationOwnerResearch: async (input) => { assert.equal(input.scope.key, "account:a"); assert.equal(input.tenantContext.ownerUserId, "owner-a"); return owner; } },
    "./simulation-input-readiness": { getReadOnlySimulationInputReadiness: async () => { calls.push("fixed"); throw new Error("optional fixed model unavailable"); } },
  };
  for (const [path, name] of [
    ["holding-analysis-data-readiness", "getReadOnlyTenantHoldingAnalysisDataReadinessForScope"],
    ["simulation-historical-outcome-validation", "getReadOnlySimulationHistoricalOutcomeValidation"],
    ["simulation-owner-parametric-factor", "getReadOnlyTenantSimulationOwnerParametricFactorResearch"],
    ["simulation-owner-model-calibration", "getReadOnlyTenantSimulationOwnerModelCalibration"],
    ["simulation-owner-model-comparison", "getReadOnlyTenantSimulationOwnerModelComparison"],
    ["simulation-regime-bootstrap", "getReadOnlySimulationRegimeBootstrap"],
    ["simulation-regime-historical-outcome-validation", "getReadOnlySimulationRegimeHistoricalOutcomeValidation"],
    ["simulation-research-universe-preflight", "getReadOnlySimulationResearchUniversePreflight"],
  ]) ports[`./${path}`] = { [name]: async () => ({ status: "ready" }) };
  const [{ loadSimulationDetail }] = await importWithPorts(["src/db/queries/simulation-detail.ts"], ports);
  const input = { tenantContext: { ownerUserId: "owner-a" }, selectedScope: { key: "account:a" }, scopeCatalog: [], query: { horizon: "126", end: "2026-09-08" } };
  panel = "weights";
  const weights = await loadSimulationDetail({ ...input, panel });
  assert.deepEqual(calls, ["candidateComparison"]);
  assert.equal(weights.walkForwardValidation, null);
  calls.length = 0;
  panel = "validation";
  const validation = await loadSimulationDetail({ ...input, panel });
  assert.deepEqual(calls, ["fixed", "walkForwardValidation", "historicalValidation"]);
  assert.equal(validation.model, null);
  assert.equal(validation.walkForwardValidation.status, "ready");
  assert.equal(validation.historicalValidation.status, "ready");
  assert.deepEqual(validation.unavailableSections, ["고정 종목 연구"]);
});
