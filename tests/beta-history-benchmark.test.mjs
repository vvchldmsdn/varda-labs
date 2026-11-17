import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHistoryBenchmark } from "../src/lib/cairn-v2/history-benchmark.ts";
import { loadInvestmentLabCounterfactualReadModel } from "../src/lib/investment-lab-counterfactual-read-loader.ts";
import { importWithPorts } from "./helpers/import-with-ports.mjs";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const dates = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"];
const range = { start: dates[0], end: dates[3] };
const request = { startServiceDate: range.start, endServiceDate: range.end };
const snapshotRows = dates.map((snapshotDate, i) => ({ snapshotDate, account: "brokerage", cashValue: 0,
  totalMarketValue: [5000, 5600, 5700, 5900][i], usdKrw: 1300 + i * 10,
  source: "varda_manual_daily_snapshot", ruleVersion: "varda-manual-daily-snapshot-v1" }));
const eventRows = [{ eventDate: dates[1], account: "brokerage", eventType: "buy", sequence: 1, amountKrw: 500,
  quantityDelta: 5, price: 100, fxRate: null, assetCurrency: "KRW", isCorrection: false }];
const evidence = { engineAccount: "brokerage", includedAccountCodes: ["brokerage"], snapshotRows, eventRows,
  fountAdjustment: { status: "not_applicable" }, nativeTradeEvidence: { blocked: [], valued: [] } };
const priceDates = ["2026-01-02", ...dates];
const price = (priceDate, i) => ({ priceDate, closePrice: 100 + i * 10, adjustedClosePrice: 100 + i * 10, source: "fixture" });
function repository(overrides = {}) {
  return { loadSnapshots: async () => snapshotRows, loadEvents: async () => eventRows,
    loadScenarioCloses: async () => priceDates.map(price), loadVooCloses: async () => priceDates.map(price),
    loadFxRows: async () => priceDates.map((rateDate, i) => ({ rateDate, usdKrw: 1290 + i * 10, source: "fixture_fx", status: "ok" })),
    loadAnchorPositionRows: async () => [], loadAnchorPriceRows: async () => [], ...overrides };
}
async function source(overrides = {}, period = request) {
  return loadInvestmentLabCounterfactualReadModel(repository(overrides), period, undefined, undefined, "brokerage");
}

test("history comparison projects the existing engine's three same-flow KRW scenarios", async () => {
  const model = await source();
  const result = buildHistoryBenchmark(model, evidence, range);
  assert.deepEqual(result.scenarios.map(row => row.state), ["ready", "ready", "ready"]);
  assert.equal(result.currency, "KRW");
  assert.equal(result.policy, "same_starting_value_and_trade_amounts");
  const [mix, kodex, voo] = result.scenarios;
  for (const scenario of result.scenarios) {
    assert.equal(scenario.points[0].hypothetical, scenario.points[0].actual);
    assert.equal(scenario.points[0].actual, 5000);
    assert.deepEqual(scenario.points.map(point => point.date), dates);
    assert.equal(scenario.points.at(-1).difference, scenario.points.at(-1).hypothetical - scenario.points.at(-1).actual);
  }
  for (let i = 0; i < dates.length; i++) {
    assert.ok(Math.abs(mix.points[i].hypothetical - (kodex.points[i].hypothetical + voo.points[i].hypothetical) / 2) < 1e-9);
    assert.equal(kodex.points[i].hypothetical, model.model.rows[i].scenarioMarketValueKrw);
    assert.equal(voo.points[i].hypothetical, model.model.vooComparison.rows[i].scenarioMarketValueKrw);
  }
});

test("missing KODEX prices preserve the separately verified VOO comparison without inventing a mix", async () => {
  const result = buildHistoryBenchmark(await source({ loadScenarioCloses: async () => [] }), evidence, range);
  assert.deepEqual(result.scenarios.map(row => row.state), ["unavailable", "unavailable", "ready"]);
  assert.deepEqual(result.scenarios[0].points, []);
  assert.ok(result.scenarios[1].issues.includes("price"));
});

test("missing historical VOO evidence leaves the domestic path available", async () => {
  const result = buildHistoryBenchmark(await source({ loadVooCloses: async () => [] }), evidence, range);
  assert.deepEqual(result.scenarios.map(row => row.state), ["unavailable", "ready", "unavailable"]);
  assert.equal(result.scenarios[2].points.length, 0);
});

test("native opening-day and missing-FX trade evidence block every financial result", async () => {
  const model = await source();
  for (const nativeTradeEvidence of [
    { blocked: [], valued: [{ date: range.start, basis: "recorded_krw" }] },
    { blocked: [{ date: dates[1], label: "Test ETF", reason: "fx_missing" }], valued: [] },
  ]) {
    const result = buildHistoryBenchmark(model, { ...evidence, nativeTradeEvidence }, range);
    for (const scenario of result.scenarios) {
      assert.equal(scenario.state, "unavailable");
      assert.deepEqual(scenario.points, []);
      assert.ok(scenario.issues.includes("trade"));
    }
    assert.ok(result.suggestedRange.start > result.trades.at(-1).date);
  }
});

test("unobserved endpoints suggest explicit observed dates but never silently substitute their values", async () => {
  const selected = { start: "2026-01-04", end: "2026-01-09" };
  const result = buildHistoryBenchmark(await source({}, { startServiceDate: selected.start, endServiceDate: selected.end }), evidence, selected);
  assert.deepEqual(result.range, selected);
  assert.deepEqual(result.suggestedRange, range);
  assert.ok(result.scenarios.every(row => row.state === "unavailable" && row.points.length === 0 && row.issues.includes("period")));
});

test("incomplete saved valuation and a shared source failure suppress all component figures", async () => {
  const model = await source();
  const blocked = { ...model, model: { ...model.model, status: "blocked", blockers: ["source_segment_authority_blocked"] } };
  const result = buildHistoryBenchmark(blocked, evidence, range);
  assert.ok(result.scenarios.every(row => row.state === "unavailable" && row.points.length === 0));
  const incomplete = await source({ loadSnapshots: async () => snapshotRows.map((row, i) => i === 2 ? { ...row, totalMarketValue: null } : row) });
  assert.ok(buildHistoryBenchmark(incomplete, evidence, range).scenarios.every(row => row.points.length === 0));
});

const scope = { kind: "account", key: "account:11111111-1111-4111-8111-111111111111", accountId: "11111111-1111-4111-8111-111111111111", accountCode: "brokerage", label: "Test" };
const tenant = { ownerUserId: "22222222-2222-4222-8222-222222222222", role: "user" };
const binding = "b".repeat(64);
async function harness({ authenticated = true, fail = false, group = false } = {}) {
  const calls = [];
  const [{ GET }] = await importWithPorts(["src/app/beta/api/history/comparison/route.ts"], {
    "@/lib/cairn-v2/server-access": { requireBetaFixtureAccess: async () => {} },
    "@/lib/auth/current-tenant-context": { resolveCurrentTenantContext: async () => authenticated ? { ok: true, tenantContext: tenant } : { ok: false, failure: { httpStatus: 401 } } },
    "@/db/queries/portfolio-analysis-scopes": { getReadOnlyTenantPortfolioAnalysisScopeContext: async args => {
      assert.equal(args.tenantContext, tenant);
      return { state: "ready", catalog: { scopes: [scope] }, resolution: args.scope === scope.key ?
        { state: "resolved", scope: group ? { ...scope, kind: "portfolio_group" } : scope } : { state: "blocked" } };
    } },
    "@/lib/cairn-v2/display-session": { displayBindingForScopes: () => binding },
    "@/lib/cairn-v2/history-benchmark-read": { readHistoryBenchmark: async args => {
      calls.push(args); if (fail) throw Error("private database exception"); return { range, scenarios: [] };
    } },
  });
  return { calls, request: (params = new URLSearchParams({ scope: scope.key, ...range }), marker = binding) => GET(new Request("https://qa.invalid/beta/api/history/comparison?" + params, { headers: marker ? { "X-Cairn-Display-Binding": marker } : {} })) };
}

test("comparison route uses admitted tenant scope, exact dates and private bound response", async () => {
  const { request: get, calls } = await harness();
  const response = await get();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.equal(response.headers.get("x-cairn-display-binding"), binding);
  assert.deepEqual(calls, [{ tenantContext: tenant, scope, range }]);
});

test("comparison rejects stale identity, foreign scope, duplicated/unknown fields and one-day/future ranges before reading", async () => {
  const { request: get, calls } = await harness();
  for (const marker of ["", "another-session"]) assert.equal((await get(undefined, marker)).status, 409);
  for (const [key, value] of [["scope", "all"], ["start", range.end], ["end", "2026-02-30"], ["end", "2999-01-01"], ["owner", "foreign"]]) {
    const params = new URLSearchParams({ scope: scope.key, ...range }); params.set(key, value);
    assert.equal((await get(params)).status, key === "scope" ? 403 : 400);
  }
  const duplicate = new URLSearchParams({ scope: scope.key, ...range }); duplicate.append("start", range.start);
  assert.equal((await get(duplicate)).status, 400);
  assert.equal(calls.length, 0);
  for (const [settings, status] of [[{ authenticated: false }, 401], [{ group: true }, 422]]) {
    const fixture = await harness(settings); assert.equal((await fixture.request()).status, status); assert.equal(fixture.calls.length, 0);
  }
});

test("comparison errors expose neither private diagnostics nor financial amounts", async () => {
  const fixture = await harness({ fail: true });
  const response = await fixture.request();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "comparison_unavailable" });
});

test("comparison read reuses owned evidence once with effective native trades and explicit date request", async () => {
  const calls = [];
  const engine = await source();
  const [{ readHistoryBenchmark }] = await importWithPorts(["src/lib/cairn-v2/history-benchmark-read.ts"], {
    "@/db/queries/investment-lab-scope-evidence": { getReadOnlyTenantInvestmentLabAnalysisScopeEvidence: async args => {
      calls.push(["evidence", args]); return evidence;
    } },
    "@/db/queries/investment-lab": { getReadOnlyTenantInvestmentLabCounterfactualForScope: async args => {
      assert.equal(await args.evidencePromise, evidence);
      calls.push(["research", { tenantContext: args.tenantContext, scope: args.scope, request: args.request }]); return engine;
    } },
  });
  const result = await readHistoryBenchmark({ tenantContext: tenant, scope, range });
  assert.deepEqual(calls, [["evidence", { tenantContext: tenant, scope, includeEffectiveNativeTrades: true }],
    ["research", { tenantContext: tenant, scope, request }]]);
  assert.ok(result.scenarios.every(row => row.state === "ready"));
});

test("comparison UI preserves choices and recovery while withholding blocked financial values", async () => {
  const [{ HistoryBenchmark, HistoryBenchmarkResult }] = await importUiWithPorts(["src/components/cairn-v2/history-benchmark.tsx"], {
    "next/link": { default: ({ children, href }) => createElement("a", { href }, children) },
    "@/components/cairn-v2/history-benchmark-chart": { HistoryBenchmarkChart: () => { throw Error("Blocked chart rendered"); } },
  });
  const context = { mode: "domain", scope: scope.key, currency: "USD", fixture: "ready" };
  const model = await source();
  const data = buildHistoryBenchmark(model, { ...evidence, nativeTradeEvidence: {
    blocked: [{ date: dates[1], label: "Test ETF", reason: "fx_missing" }], valued: [],
  } }, range);
  const html = renderToStaticMarkup(createElement(HistoryBenchmarkResult, { data, context }));
  assert.match(html, /50 : 50/); assert.match(html, /KODEX 200/); assert.match(html, /VOO/);
  assert.match(html, /부족한 기록 확인/); assert.match(html, /KRW/);
  assert.doesNotMatch(html, /5,000|5,900|fx_missing|same_starting_value_and_trade_amounts/);
  const singleDay = renderToStaticMarkup(createElement(HistoryBenchmark, { context, binding,
    range: { start: dates[0], end: dates[0] } }));
  assert.match(singleDay, /시작일과 그 이후의 종료일/);
});
