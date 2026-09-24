import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import ts from "typescript";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";
import { trackedCurrencyFixture } from "../src/lib/currency-tracked-fixture.ts";
import { buildSimulationPageControls } from "../src/lib/simulation-page-controls.ts";
import { resolveSimulationPathModel } from "../src/lib/simulation-model-selection.ts";
import { resolveSnapshotCycle } from "../src/lib/snapshots/market-calendar.ts";

const tenant = { ownerUserId: "owner-test", actorUserId: "actor-test" };
const scope = { kind: "all", key: "all", label: "All" };
const Surface = () => null;
const paths = ["", "today/", "history/", "portfolio/structure/", "additional-contribution/", "investment-lab/", "simulation/"];
async function route(path, { authenticated = true, native = true } = {}) {
  const file = `src/app/${path}page.tsx`, source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest);
  // Every external port is replaced, so route wiring tests cannot touch a DB,
  // identity service, quote provider, or the developer's environment.
  const ports = {};
  for (const node of source.statements) if (ts.isImportDeclaration(node) && node.importClause && !node.importClause.isTypeOnly) {
    const values = {};
    if (node.importClause.name) values.default = () => null;
    if (node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) for (const binding of node.importClause.namedBindings.elements) if (!binding.isTypeOnly) values[binding.propertyName?.text ?? binding.name.text] = () => null;
    ports[node.moduleSpecifier.text] = values;
  }
  const calls = [];
  const requests = [];
  ports["@/components/currency-portfolio-surface"] = { CurrencyPortfolioSurface: Surface };
  ports["@/lib/auth/current-tenant-context"] = { resolveCurrentTenantContext: async () => authenticated ? { ok: true, tenantContext: tenant } : { ok: false, failure: { code: "unauthenticated" } } };
  ports["@/db/queries/portfolio-analysis-scopes"] = { getReadOnlyTenantPortfolioAnalysisScopeContext: async args => { assert.equal(args.tenantContext, tenant); calls.push("scope"); return { state: "ready", resolution: { state: "resolved", scope }, catalog: { scopes: [scope] } }; } };
  ports["@/db/queries/native-portfolio-ledger"] = { hasNativeLedger: async value => { assert.equal(value, tenant); calls.push("native"); return native; } };
  ports["@/db/queries/currency-tracked-portfolio"] = { getTrackedCurrencyEvidence: async (value, selected, currency) => { assert.equal(value, tenant); assert.equal(selected, scope); calls.push(`valuation:${currency}`); return { ...trackedCurrencyFixture(), reporting: currency }; } };
  ports["@/db/queries/currency-research"] = { getOwnedCurrencyResearchInput: async (value, selected, currency, options) => { assert.equal(value, tenant); assert.equal(selected, scope); calls.push(`research:${currency}`); requests.push({ currency, options }); return null; } };
  ports["@/lib/simulation-model-selection"] = { resolveSimulationPathModel };
  ports["@/lib/simulation-page-controls"] = { buildSimulationPageControls };
  ports["@/lib/snapshots/market-calendar"] = { resolveSnapshotCycle };
  ports["next/navigation"] = { redirect: path => { throw new Error(`redirect:${path}`); } };
  const [module] = await importUiWithPorts([file], ports);
  return { Page: module.default, calls, requests };
}

describe("reporting currency on existing owned routes", () => {
  it("checks authentication before native ledger or research reads on every route", async () => {
    for (const path of paths) {
      const { Page, calls } = await route(path, { authenticated: false });
      try { await Page({ searchParams: Promise.resolve({ currency: "USD" }) }); }
      catch (error) { assert.equal(path, ""); assert.equal(error.message, "redirect:/start"); }
      assert.deepEqual(calls, [], path);
    }
  });
  it("uses the same owner-scoped native surface for both currencies and all seven routes", async () => {
    for (const currency of ["KRW", "USD"]) for (const path of paths) {
      const { Page, calls } = await route(path);
      const tree = await Page({ searchParams: Promise.resolve({ currency, model: "bootstrap" }) });
      assert.equal(tree.type, Surface, path);
      assert.equal(tree.props.evidence?.reporting ?? tree.props.reporting, currency, path);
      assert.ok(calls.includes(`${["investment-lab/", "simulation/"].includes(path) ? "research" : "valuation"}:${currency}`), path);
    }
  });
  it("never loads or silently substitutes a KRW economic model for USD", async () => {
    for (const model of [undefined, "economic", "unknown"]) {
      const { Page, calls } = await route("simulation/");
      const tree = await Page({ searchParams: Promise.resolve({ currency: "USD", model }) });
      assert.equal(tree.props.economicUnsupported, true);
      assert.equal(calls.some(call => call.startsWith("research")), false);
    }
  });
  it("preserves scope/model/horizon while removing a KRW-only amount on currency selection", async () => {
    const [{ reportingCurrencyHref }] = await importUiWithPorts(["src/components/reporting-currency-switch.tsx"], { "next/navigation": { usePathname() {}, useRouter() {}, useSearchParams() {} }, "@/components/i18n/locale-provider": { useI18n() {} } });
    const result = new URL(reportingCurrencyHref("/simulation", "scope=all&model=bootstrap&horizon=252&amount=3000000", "USD"), "https://local.invalid");
    assert.equal(result.pathname, "/simulation");
    assert.deepEqual(Object.fromEntries(result.searchParams), { scope: "all", model: "bootstrap", horizon: "252", currency: "USD" });
  });
  it("passes the supported horizon and selected historical end into native research", async () => {
    const { Page, requests } = await route("simulation/");
    await Page({ searchParams: Promise.resolve({ currency: "USD", model: "bootstrap", horizon: "126", end: "2026-09-12" }) });
    assert.deepEqual(requests, [{ currency: "USD", options: { horizon: 126, endServiceDate: "2026-09-12" } }]);
  });
  it("connects native Structure risk to the exact scoped valuation already loaded for composition", async () => {
    const { Page, calls, requests } = await route("portfolio/structure/");
    const tree = await Page({ searchParams: Promise.resolve({ currency: "USD" }) });
    assert.equal(calls.filter(call => call === "valuation:USD").length, 1);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.valuationEvidence, tree.props.evidence);
    assert.equal(requests[0].options.calculation, "risk_only");
    assert.ok(tree.props.evidence, "missing research keeps the base native composition");
  });
  it("keeps invalid native selections unavailable without silently substituting defaults", async () => {
    for (const [query, reason] of [[{ horizon: "252" }, "invalid_horizon"], [{ end: "2099-01-01" }, "invalid_end_date"], [{ end: ["2026-09-01", "2026-09-02"] }, "invalid_end_date"], [{ model: "unknown" }, "invalid_model"]]) {
      const { Page, requests } = await route("simulation/");
      const tree = await Page({ searchParams: Promise.resolve({ currency: "USD", model: "bootstrap", ...query }) });
      assert.equal(tree.props.researchUnavailableReason, reason);
      assert.deepEqual(requests, []);
    }
  });
});
