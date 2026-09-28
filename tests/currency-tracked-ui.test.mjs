import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";
import { trackedCurrencyFixture } from "../src/lib/currency-tracked-fixture.ts";
import { buildTrackedCurrencyPortfolio } from "../src/lib/currency-tracked-portfolio.ts";
import { importWithPorts } from "./helpers/import-with-ports.mjs";
const [{ buildTrackedCurrencyReports }] = await importWithPorts(["src/lib/server/currency-tracked-reports.ts"], {});

const walk = node => node && typeof node === "object" ? [node, ...[node.props?.children].flat(Infinity).flatMap(walk)] : [];
const textOf = node => typeof node === "string" || typeof node === "number" ? String(node) : node?.props ? [node.props.children].flat(Infinity).map(textOf).join("") : "";
const ring = () => null;
const i18n = { useI18n: () => ({ locale: "en", t: (_ko, en) => en ?? _ko }) };
const basePorts = {
  "@/components/quick-trade-actions": { QuickTradeActions: () => null },
  react: { useState: value => [value, () => {}], useMemo: fn => fn() },
  "@/components/i18n/locale-provider": i18n,
  "@/components/portfolio/portfolio-allocation-ring": { PortfolioAllocationRing: ring },
  "@/components/native-contribution-planner": { NativeContributionPlanner: () => null },
};
const importView = async (ports = {}) => {
  const View = (await importUiWithPorts(["src/components/currency-tracked-view.tsx"], { ...basePorts, ...ports }))[0].CurrencyTrackedView;
  return props => View({ ...props, reports: props.reports ?? buildTrackedCurrencyReports(props.evidence) });
};
const contributionPolicy = { trimDriftThresholdPct: 12, minimumExecutionRatioPct: 85 };

describe("owned portfolio currency view", () => {
  it("labels an official close by its session date and a receipt by collection time", async () => {
    const View = await importView();
    const evidence = trackedCurrencyFixture();
    const observation = evidence.current.positions[0].observation;
    Object.assign(observation, {priceKind:"close",timestampBasis:"daily_close",priceReferenceDate:"2026-09-01",priceFetchedAt:evidence.current.at});
    delete observation.priceObservedAt;
    let report = buildTrackedCurrencyPortfolio(evidence);
    assert.equal(report.current.positions[0].priceObservedAt,null);
    assert.equal(report.current.positions[0].priceReferenceDate,"2026-09-01");
    let rendered = textOf(View({evidence}));
    assert.match(rendered,/Close session · 2026-09-01/);
    assert.doesNotMatch(rendered,/Price observed ·/);
    Object.assign(observation,{priceKind:"live",timestampBasis:"collection",priceObservedAt:evidence.current.at});
    report = buildTrackedCurrencyPortfolio(evidence);
    assert.equal(report.current.positions[0].priceObservedAt,null);
    rendered = textOf(View({evidence}));
    assert.match(rendered,/Quote collected ·/);
    assert.doesNotMatch(rendered,/Price observed ·/);
  });
  it("shows complete USD valuation and separates dates from performance claims", async () => {
    const View = await importView();
    const tree = View({ evidence: trackedCurrencyFixture(), timeZone: "America/New_York", contributionPolicy });
    assert.match(textOf(tree), /\$1,100\.00/);
    assert.match(textOf(tree), /2026-09-01 20:00/);
    assert.match(textOf(tree), /does not adjust for portfolio-wide/);
    assert.ok(walk(tree).some(node => node.type === ring));
  });
  it("recalculates native USD values in KRW and renders a loss although USD rose", async () => {
    const View = await importView();
    const tree = View({ evidence: { ...trackedCurrencyFixture(), reporting: "KRW" } });
    assert.match(textOf(tree), /1,386,000/);
    assert.match(textOf(tree), /-₩14,000/);
    assert.match(textOf(tree), /Example US asset/);
  });
  it("draws no normalized ring and permits no allocation form when scope or FX is incomplete", async () => {
    const View = await importView();
    for (const evidence of [
      { ...trackedCurrencyFixture(), reporting: "KRW", fx: [] },
      { ...trackedCurrencyFixture(), current: { ...trackedCurrencyFixture().current, scopeComplete: false } },
    ]) {
      const tree = View({ evidence, contributionPolicy });
      assert.equal(walk(tree).some(node => node.type === ring || node.type === "form"), false);
      assert.match(textOf(tree), /Subtotal with evidence/);
      assert.match(textOf(tree), /full total and weights are unavailable/);
      assert.doesNotMatch(textOf(tree), /100\.00%/);
    }
  });
  it("does not render mixed-owner names even if upstream evidence is incorrect", async () => {
    const View = await importView();
    const evidence = trackedCurrencyFixture();
    evidence.current.positions[0].ownerId = "other";
    evidence.current.positions[0].name = "Must never appear";
    const tree = View({ evidence, contributionPolicy });
    assert.match(textOf(tree), /unavailable/);
    assert.doesNotMatch(textOf(tree), /Must never appear/);
  });
  it("does not turn zero verified holdings into a zero-value claim", async () => {
    const View = await importView();
    const evidence = { ...trackedCurrencyFixture(), reporting: "KRW", fx: [] };
    const tree = View({ evidence, contributionPolicy });
    assert.match(textOf(tree), /0 of 1 holdings/);
    assert.doesNotMatch(textOf(tree), /₩0/);
  });
  it("passes exact native valuation and original dated cost to the shared contribution engine", async () => {
    const evidence = trackedCurrencyFixture();
    const row = evidence.current.positions[0];
    row.observation.quantity = "0.1";
    row.observation.price = "0.2";
    row.cost.amount = "0.020000000000000001";
    let stateIndex = 0, captured;
    const states = ["USD", "Asia/Seoul", "", "10.25", "USD", { example: "100" }, null, ""];
    const View = await importView({
      react: { useMemo: fn => fn(), useState: () => [states[stateIndex++], () => {}] },
      "@/lib/currency-contribution": { calculateCurrencyContribution: input => { captured = input; return { status: "blocked", reason: "test_capture" }; } },
    });
    const tree = View({ evidence, contributionPolicy });
    walk(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
    assert.equal(captured.rows[0].value.amount, "0.02");
    assert.equal(captured.rows[0].value.currency, "USD");
    assert.deepEqual(captured.rows[0].cost, row.cost);
    assert.equal(captured.rows[0].ma120Evidence.status, "unavailable");
    assert.equal(captured.funds[0].amount, "10.25");
  });
  it("does not display an older calculation after the valuation evidence is replaced", async () => {
    let stateIndex = 0;
    const evidence = trackedCurrencyFixture();
    const states = ["USD", "Asia/Seoul", "", "10.25", "USD", { example: "100" }, { evidence: trackedCurrencyFixture(), result: { status: "ready", context: { reportingCurrency: "USD" } } }, ""];
    const View = await importView({ react: { useMemo: fn => fn(), useState: () => [states[stateIndex++], () => {}] } });
    const tree = View({ evidence, contributionPolicy });
    assert.doesNotMatch(textOf(tree), /Calculated allocation/);
  });
  it("renders and switches server-computed reports with a slow or fast browser clock", async t => {
    const evidence = trackedCurrencyFixture(), serverNow = Date.parse(evidence.asOf) + 1000;
    let now = serverNow, index = 0;
    t.mock.method(Date, "now", () => now);
    const reports = buildTrackedCurrencyReports(evidence);
    const states = [];
    const View = await importView({ react: { useState: initial => {
      const i = index++; if (!(i in states)) states[i] = initial;
      return [states[i], value => { states[i] = typeof value === "function" ? value(states[i]) : value; }];
    } } });
    const render = () => { index = 0; return View({ evidence, reports, surface: "home" }); };
    for (const offset of [-60_000, 60_000]) {
      now = serverNow + offset;
      if (offset < 0) assert.equal(buildTrackedCurrencyPortfolio(evidence).current, null, "the unchanged engine still rejects evidence future-dated to its own clock");
      let tree = render();
      walk(tree).find(node => node.type === "select" && ["USD", "KRW"].includes(node.props.value)).props.onChange({ target: { value: "USD" } });
      tree = render(); assert.match(textOf(tree), /\$1,100\.00/);
      walk(tree).find(node => node.type === "select" && node.props.value === "USD").props.onChange({ target: { value: "KRW" } });
      tree = render(); assert.match(textOf(tree), /1,386,000/); assert.match(textOf(tree), /-₩14,000/);
      assert.doesNotMatch(textOf(tree), /sign in again|valuation is unavailable/);
    }
  });
  it("keeps genuine future evidence, foreign ownership and missing FX blocked on the server", t => {
    const evidence = trackedCurrencyFixture(), serverNow = Date.parse(evidence.asOf) + 1000;
    t.mock.method(Date, "now", () => serverNow);
    const future = buildTrackedCurrencyReports({ ...evidence, asOf: new Date(serverNow + 1).toISOString() });
    assert.equal(future.KRW.current, null); assert.equal(future.USD.current, null);
    const other = structuredClone(evidence); other.current.positions[0].ownerId = "foreign-owner";
    const blocked = buildTrackedCurrencyReports(other);
    assert.equal(blocked.USD.reason, "owner_scope_mismatch"); assert.equal(blocked.KRW.current, null);
    const missing = buildTrackedCurrencyReports({ ...evidence, fx: [] });
    assert.equal(missing.USD.current.total, "1100"); assert.equal(missing.KRW.current.complete, false);
    assert.equal(missing.KRW.current.total, null);
  });
  it("passes plain serializable reports including Modified Dietz through the real server surface", async () => {
    const Client = () => null;
    const [{ CurrencyPortfolioSurface }] = await importUiWithPorts(["src/components/currency-portfolio-surface.tsx"], {
      "@/components/currency-portfolio-surface-client": { CurrencyPortfolioSurfaceClient: Client },
    });
    const evidence = { ...trackedCurrencyFixture(), ledgerComplete: true, cashFlows: [], realizedTrades: [], realizedTradesComplete: true };
    const scope = { kind: "all", key: "all", label: "All" };
    const tree = CurrencyPortfolioSurface({ evidence, surface: "home", scopes: [scope], selectedScope: scope });
    assert.equal(tree.type, Client);
    const assertPlain = value => {
      assert.notEqual(typeof value, "bigint"); assert.notEqual(typeof value, "function");
      if (value && typeof value === "object") { assert.ok(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype); Object.values(value).forEach(assertPlain); }
    };
    assertPlain(tree.props.reports);
    const reports = JSON.parse(JSON.stringify(tree.props.reports));
    assert.equal(reports.USD.performanceReturn.status, "ready");
    assert.ok(Math.abs(reports.USD.performanceReturn.totalReturn - 0.1) < 1e-12);
    assert.ok(Math.abs(reports.KRW.performanceReturn.totalReturn + 0.01) < 1e-12);
    const changed = structuredClone(evidence); changed.ownerId = "second-owner";
    for (const frame of [changed.current, ...changed.history]) for (const position of frame.positions) position.ownerId = changed.ownerId;
    changed.current.positions[0].observation.price = "900";
    const second = CurrencyPortfolioSurface({ evidence: changed, surface: "home", scopes: [scope], selectedScope: scope });
    assert.equal(second.props.reports.USD.current.total, "900", "server results must not be cached across owners or evidence refreshes");
    assert.equal(tree.props.reports.USD.current.total, "1100");
  });
  it("computes both reports after the reporting page's authenticated tenant read", async () => {
    const View = () => null, tenant = { ownerUserId: "synthetic-only" }, scope = { key: "all", kind: "all" };
    const evidence = trackedCurrencyFixture(); let reads = 0;
    const [{ default: Page }] = await importUiWithPorts(["src/app/portfolio/reporting/page.tsx"], {
      "next/navigation": { redirect() { throw new Error("unexpected redirect"); } },
      "@/lib/auth/current-tenant-context": { resolveCurrentTenantContext: async () => ({ ok: true, tenantContext: tenant }) },
      "@/db/queries/portfolio-analysis-scopes": { getReadOnlyTenantPortfolioAnalysisScopeContext: async ({ tenantContext }) => { assert.equal(tenantContext, tenant); return { state: "ready", resolution: { state: "resolved", scope } }; } },
      "@/db/queries/currency-tracked-portfolio": { getTrackedCurrencyEvidence: async (owner, selected) => { assert.equal(owner, tenant); assert.equal(selected, scope); reads++; return evidence; } },
      "@/components/portfolio-analysis-scope-boundary": { PortfolioAnalysisScopeBoundary: () => null },
      "@/components/secondary-page-header": { SecondaryPageHeader: () => null },
      "@/components/currency-tracked-view": { CurrencyTrackedView: View },
    });
    const tree = await Page({ searchParams: Promise.resolve({ currency: "USD" }) });
    const result = walk(tree).find(node => node.type === View);
    assert.equal(reads, 1); assert.equal(result.props.evidence, evidence);
    assert.equal(result.props.reports.USD.current.total, "1100");
    assert.equal(result.props.reports.KRW.current.total, "1386000");
  });
});
