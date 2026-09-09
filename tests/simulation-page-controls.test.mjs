import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";
import { buildSimulationPageControls } from "../src/lib/simulation-page-controls.ts";
import { resolveSnapshotCycle } from "../src/lib/snapshots/market-calendar.ts";

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
    "@/components/simulation/simulation-section-error-boundary": { SimulationSectionErrorBoundary: component },
    "@/lib/simulation-page-controls": { buildSimulationPageControls },
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
  const params = { end: "2026-09-04", horizon: "126", kodexWeight: "30", researchUniverse: "current" };
  const result = await exports.default({ searchParams: Promise.resolve(params) });
  assert.deepEqual(calls, ["scope", "owner"]);
  assert.equal(result.props.selectedScopeKey, scope.key);
  assert.equal(result.props.model.researchHorizonSelection.horizon, 126);
  assert.equal(result.props.researchUniverse, "current");
  const ownerContent = result.props.ownerResearchExecution.props.children.props.children;
  assert.equal(ownerContent.props.resultPromise, pendingOwner);
  assert.equal(ownerContent.props.selectedScopeKey, scope.key);
  calls.length = 0;
  signedIn = false;
  await exports.default({ searchParams: Promise.resolve(params) });
  assert.deepEqual(calls, []);
  signedIn = true;
  scopeAllowed = false;
  await exports.default({ searchParams: Promise.resolve(params) });
  assert.deepEqual(calls, ["scope"]);
});
