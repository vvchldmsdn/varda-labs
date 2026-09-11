import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";
import ts from "typescript";
import { buildSimulationPageControls } from "../src/lib/simulation-page-controls.ts";
import { resolveSimulationPathModel } from "../src/lib/simulation-model-selection.ts";
import { resolveSnapshotCycle } from "../src/lib/snapshots/market-calendar.ts";

test("the horizon selector never marks the default as selected for invalid or duplicate periods", async () => {
  const [view] = await importUiWithPorts(["src/components/simulation/simulation-input-readiness-view.tsx"], {
    "@/components/portfolio-primary-navigation": { PortfolioPrimaryNavigation: () => null },
    "@/components/investment-lab/investment-lab-dialog": { InvestmentLabDialog: () => null },
    "./simulation-workspace": { SimulationWorkspace: ({ tools }) => tools },
    "./simulation-query-controls": {
      SimulationNavigationBoundary: ({ children }) => children,
      SimulationScopeTabs: () => null, SimulationDateControl: () => null, SimulationModelSelector: () => null,
      SimulationLink: ({ href, children, scroll, ...props }) => { assert.equal(scroll, false); return createElement("a", { ...props, href }, children); },
    },
  });
  const scope = "account:11111111-1111-4111-8111-111111111111";
  for (const [horizon, expectedSelection] of [[undefined, 63], ["126", 126], ["999", null], [["63", "126"], null]]) {
    const model = buildSimulationPageControls({ now: new Date("2026-09-10T08:00:00Z"), horizon, endServiceDate: "2026-09-09" });
    const html = renderToStaticMarkup(createElement(view.SimulationInputReadinessView, { model, pathModel: "economic", scopeCatalog: [], selectedScopeKey: scope, researchUniverse: null }));
    assert.ok(html.includes(`data-simulation-research-horizon="${expectedSelection ?? "invalid"}"`));
    const links = [...html.matchAll(/<a\b([^>]*)>/g)].map(match => ({ attributes: match[1], url: new URL(match[1].match(/href="([^"]+)"/)[1].replaceAll("&amp;", "&"), "https://example.test") }));
    assert.deepEqual(links.map(link => link.url.searchParams.get("horizon")), ["63", "126"]);
    assert.ok(links.every(link => link.url.searchParams.get("scope") === scope && link.url.searchParams.get("end") === "2026-09-09"));
    const selected = links.filter(link => link.attributes.includes('aria-current="page"'));
    assert.equal(selected.length, expectedSelection === null ? 0 : 1);
    if (expectedSelection !== null) assert.equal(Number(selected[0].url.searchParams.get("horizon")), expectedSelection);
    else assert.match(html, /data-invalid-horizon-query/);
  }
});

test("calculation settings describe the selected model and keep the economic cutoffs distinct in both locales", async () => {
  const [view, { LocaleProvider }] = await importUiWithPorts([
    "src/components/simulation/simulation-input-readiness-view.tsx",
    "src/components/i18n/locale-provider.tsx",
  ], {
    "@/components/portfolio-primary-navigation": { PortfolioPrimaryNavigation: () => null },
    "@/components/investment-lab/investment-lab-dialog": { InvestmentLabDialog: ({ children }) => children },
    "./simulation-workspace": { SimulationWorkspace: () => null },
    "./simulation-query-controls": { SimulationNavigationBoundary: ({ children }) => children, SimulationScopeTabs: () => null, SimulationDateControl: () => null, SimulationModelSelector: () => null, SimulationLink: () => null },
  });
  const model = buildSimulationPageControls({ now: new Date("2026-09-10T08:00:00Z") });
  for (const locale of ["ko", "en"]) {
    const render = (pathModel) => renderToStaticMarkup(createElement(LocaleProvider, { initialLocale: locale }, createElement(view.SimulationInputReadinessView, { model, pathModel, scopeCatalog: [], selectedScopeKey: "all", researchUniverse: null })));
    const economic = render("economic");
    assert.ok(economic.includes(locale === "ko" ? "두 날짜는 다를 수" : "These dates can differ"));
    assert.ok(economic.includes(locale === "ko" ? "최신성 한도는 7일" : "no more than seven days old"));
    assert.ok(economic.includes(locale === "ko" ? "최소 45개" : "at least 45"));
    assert.ok(!economic.includes("시장 국면 모델은 별도로"));
    const bootstrap = render("bootstrap");
    assert.ok(!bootstrap.includes(locale === "ko" ? "두 날짜는 다를 수" : "These dates can differ"));
    if (locale === "ko") assert.ok(bootstrap.includes("시장 국면 모델은 별도로 63단계"));
    const invalid = render(null);
    assert.ok(invalid.includes(locale === "ko" ? "모형을 선택한 뒤" : "Choose Economic paths or Historical paths"));
    assert.ok(!invalid.includes(locale === "ko" ? "두 날짜는 다를 수" : "These dates can differ"));
  }
});

test("simulation controls preserve the 7 AM service boundary without reading research history", () => {
  for (const [time, expectedDate] of [
    ["2026-09-09T21:59:59Z", "2026-09-09"],
    ["2026-09-09T22:00:00Z", "2026-09-10"],
  ]) {
    const model = buildSimulationPageControls({ now: new Date(time) });
    assert.equal(model.requestedEndServiceDate, expectedDate);
    assert.equal(model.endServiceDateSelection.source, "server_default");
    assert.equal(model.researchHorizonSelection.horizon, 63);
    assert.equal(model.fixedMixSelection.kodexWeightPct, 50);
    assert.equal(model.runtimeTrustStatus, "not_established");
    assert.equal("inputs" in model, false, "controls cannot claim market readiness");
  }
});

test("simulation controls retain explicit query values and reject ambiguous or invalid financial inputs", () => {
  const now = new Date("2026-09-10T03:00:00Z");
  const selected = buildSimulationPageControls({ now, endServiceDate: "2026-09-04", horizon: "126", kodexWeight: "30" });
  assert.equal(selected.requestedEndServiceDate, "2026-09-04");
  assert.equal(selected.endServiceDateSelection.source, "query");
  assert.equal(selected.researchHorizonSelection.horizon, 126);
  assert.equal(selected.fixedMixSelection.kodexWeightPct, 30);
  for (const value of [["2026-09-04", "2026-09-05"], "2026-02-30", ""]) {
    const invalid = buildSimulationPageControls({ now, endServiceDate: value, horizon: ["63", "126"], kodexWeight: ["30", "70"] });
    assert.equal(invalid.endServiceDateSelection.status, "invalid");
    assert.equal(invalid.requestedEndServiceDate, "");
    assert.equal(invalid.researchHorizonSelection.horizon, null);
    assert.equal(invalid.fixedMixSelection.kodexWeightPct, null);
  }
});

test("simulation page returns authenticated controls while owner research is pending and never loads fixed benchmarks", { timeout: 2000 }, async () => {
  const calls = [];
  const scope = { key: "account:qa", kind: "account" };
  const tenantContext = { ownerUserId: "qa-owner" };
  const pendingOwner = new Promise(() => {});
  let signedIn = true;
  let scopeAllowed = true;
  const component = () => null;
  const ports = {
    "@/lib/i18n/server": { localizedMetadata: () => ({}) },
    "@/components/simulation/simulation-text": { SimulationText: component },
    "@/components/portfolio-read-access-boundary": { PortfolioReadAccessBoundary: component },
    "@/components/portfolio-analysis-scope-boundary": { PortfolioAnalysisScopeBoundary: component },
    "@/components/simulation/simulation-input-readiness-view": { SimulationInputReadinessView: component },
    "@/components/simulation/owner-research-execution-section": { OwnerResearchExecutionSection: component },
    "@/components/simulation/economic-execution-section": { EconomicExecutionSection: component },
    "@/components/simulation/simulation-loading": { SimulationLoading: component },
    "@/components/simulation/simulation-section-error-boundary": { SimulationSectionErrorBoundary: component },
    "@/lib/simulation-page-controls": { buildSimulationPageControls },
    "@/lib/simulation-model-selection": { resolveSimulationPathModel },
    "@/db/queries/simulation-owner-economic": {
      getReadOnlyTenantSimulationOwnerEconomicResearch: () => { throw new Error("unexpected economic research read"); },
      economicResearchPresentation: () => { throw new Error("unexpected economic presentation"); },
    },
    "@/lib/snapshots/market-calendar": { resolveSnapshotCycle },
    "@/lib/auth/current-tenant-context": { resolveCurrentTenantContext: async () => signedIn ? { ok: true, tenantContext } : { ok: false } },
    "@/db/queries/portfolio-analysis-scopes": { getReadOnlyTenantPortfolioAnalysisScopeContext: async () => {
      calls.push("scope");
      return scopeAllowed ? { state: "ready", resolution: { state: "resolved", scope }, catalog: { scopes: [scope] } } : { state: "unavailable" };
    } },
    "@/db/queries/simulation-owner-research": { getReadOnlyTenantSimulationOwnerResearch: (input) => {
      calls.push("owner");
      assert.equal(input.scope, scope);
      assert.equal(input.tenantContext, tenantContext);
      assert.equal(input.horizon, "126");
      assert.equal(input.endServiceDate, "2026-09-04");
      return pendingOwner;
    } },
  };
  const source = readFileSync(new URL("../src/app/simulation/page.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const require = createRequire(import.meta.url);
  const exports = {};
  new Function("exports", "require", "process", compiled)(exports, (name) => {
    if (name in ports) return ports[name];
    assert.ok(name === "react" || name === "react/jsx-runtime", `Unexpected main page dependency: ${name}`);
    return require(name);
  }, { env: { NODE_ENV: "production" } });
  const params = { model: "bootstrap", end: "2026-09-04", horizon: "126", kodexWeight: "30", researchUniverse: "current" };
  const result = await exports.default({ searchParams: Promise.resolve(params) });
  assert.deepEqual(calls, ["scope", "owner"]);
  assert.equal(result.props.selectedScopeKey, scope.key);
  assert.equal(result.props.model.researchHorizonSelection.horizon, 126);
  assert.equal(result.props.researchUniverse, "current");
  assert.equal(result.props.pathModel, "bootstrap");
  const ownerContent = result.props.ownerResearchExecution.props.children.props.children;
  assert.equal(ownerContent.props.resultPromise, pendingOwner);
  assert.equal(ownerContent.props.selectedScopeKey, scope.key);
  assert.equal(ownerContent.props.pathModel, "bootstrap");
  calls.length = 0;
  signedIn = false;
  await exports.default({ searchParams: Promise.resolve(params) });
  assert.deepEqual(calls, []);
  signedIn = true;
  scopeAllowed = false;
  await exports.default({ searchParams: Promise.resolve(params) });
  assert.deepEqual(calls, ["scope"]);
});
