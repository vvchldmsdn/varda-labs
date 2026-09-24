import assert from "node:assert/strict";
import { it } from "node:test";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

const [counterfactual, performance, dietz, schedule, tracked] = await importWithPorts([
  "src/lib/investment-lab-counterfactual-path.ts", "src/lib/currency-performance.ts",
  "src/lib/investment-lab-modified-dietz.ts", "src/lib/investment-lab-execution-schedule.ts", "src/lib/currency-tracked-portfolio.ts",
], {});
const at = (day, hour = 7) => new Date(`2026-09-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00+09:00`).toISOString();
const date = day => `2026-09-${String(day).padStart(2, "0")}`;
const asOf = at(15, 10);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const history = (prices = [10, 11, 12, 13], currency = "USD") => ({ instrumentId: "owned-voo", source: "reviewed_provider_history", admission: "normalized_provider_raw",
  points: prices.map((price, index) => ({ at: at(index + 1), price: String(price), currency, basis: "split_adjusted", dataset: "reviewed_us_ARCX_VOO" })),
  corporateActions: { status: "verified_split_adjusted", source: "reviewed_split_coverage", from: at(1), through: at(prices.length) } });
const evidence = (values = [100, 100, 210, 220], externalFlows = [{ id: "deposit", at: at(2, 12), amount: "100", currency: "USD", direction: "inflow" }], reportingCurrency = "USD") => ({ reportingCurrency, asOf, complete: true,
  actualPath: values.map((value, index) => ({ at: at(index + 1), totalValue: String(value) })), externalFlows });
const run = (owned = evidence(), scenario = history(), fx = []) => counterfactual.buildCurrencyInvestmentLabCounterfactual({ evidence: owned, scenario, fx, maxFxAgeMs: 3 * 86400000 });
const value = (day, amount, hour = 7) => ({ serviceDate: date(day), at: at(day, hour), amount: String(amount), currency: "USD", source: "owned_capture" });
const flow = (day, amount, hour = 12, kind = "external_in") => ({ id: `flow-${day}-${hour}`, serviceDate: date(day), at: at(day, hour), amount: String(amount), currency: "USD", source: "owned_ledger", kind });
const md = (valuations, flows) => performance.calculateCurrencyModifiedDietz({ reporting: "USD", valuations, flows, fx: [], maxFxAgeMs: 3 * 86400000, cashFlowEvidence: "complete" });

it("compares actual holdings plus cash with the same external money using the shared execution core", () => {
  const result = run();
  assert.equal(result.status, "ready");
  assert.equal(result.policy.comparisonBasis, "portfolio_including_cash");
  assert.equal(result.policy.returnMethod, "observed_timestamp_modified_dietz_v1");
  assert.deepEqual(result.rows.map(row => row.actualValue), [100, 100, 210, 220]);
  near(result.rows[1].alternativeValue, 110);
  near(result.rows[2].alternativeValue, 220);
  near(result.rows[3].alternativeValue, 13 * (10 + 100 / 12));
  assert.equal(result.rows[1].pendingCash, 0, "noon deposit cannot enter the earlier 07:00 capture");
  const expectedActual = (1 + 10 / (100 + 100 * 19 / 24)) * (220 / 210) - 1;
  near(result.actualReturnPct, expectedActual * 100);
  assert.notEqual(result.actualReturnPct, 120, "external capital is not investment gain");
});

it("keeps later same-day observations and same-day deposits without moving either timestamp", () => {
  const owned = evidence([100, 200], [{ id: "same-day", at: at(1, 9), amount: "100", currency: "USD", direction: "inflow" }]);
  owned.actualPath.splice(1, 0, { at: at(1, 10), totalValue: "200" });
  const result = run(owned);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.rows.map(row => row.at), [at(1), at(1, 10), at(2)]);
  assert.equal(result.rows[1].pendingCash, 100);
  assert.equal(result.rows[1].alternativeValue, 200);
  assert.equal(result.actualReturnPct, 0);
});

it("retains a terminal deposit as cash until an eligible future close exists", () => {
  const owned = evidence([100, 100, 100, 200], [{ id: "latest", at: at(4, 9), amount: "100", currency: "USD", direction: "inflow" }]);
  owned.actualPath[3].at = at(4, 10);
  const result = run(owned);
  assert.equal(result.status, "ready");
  assert.equal(result.rows.at(-1).pendingCash, 100);
  assert.equal(result.rows.at(-1).alternativeValue, 230);
  assert.equal(result.actualReturnPct, 0);
});

it("dated currency conversion changes scenario prices and flows before calculation", () => {
  const owned = evidence([130000, 140000, 140000, 140000], [{ id: "usd-deposit", at: at(2, 12), amount: "100", currency: "USD", direction: "inflow" }], "KRW");
  const fx = [1, 2, 3, 4].map(day => ({ base: "USD", quote: "KRW", rate: String(1300 + (day - 1) * 100), observedAt: at(day), fetchedAt: asOf, source: "reviewed_fx", kind: "daily_reference" }));
  const result = run(owned, history([10, 10, 10, 10]), fx);
  assert.equal(result.status, "ready");
  near(result.rows[1].alternativeValue, 140000);
  near(result.rows[2].alternativeValue, 290000);
  near(result.rows[3].alternativeValue, (10 + 140000 / 15000) * 16000);
  assert.equal(run(owned, history(), []).reason, "fx_missing");
});

it("carries only the native close and revalues FX at every actual capture", () => {
  const owned = evidence([130000, 140000, 150000], [], "KRW");
  const fx = [1, 2, 3].map(day => ({ base: "USD", quote: "KRW", rate: String(1200 + day * 100), observedAt: at(day), fetchedAt: asOf, source: "dated_fx", kind: "daily_reference" }));
  const result = run(owned, history([10, 10]), fx);
  assert.equal(result.status, "ready");
  near(result.rows[2].alternativeValue, 150000, "a closed market must not freeze FX");
  near(result.actualReturnPct, result.alternativeReturnPct);
});

it("uses the captured historical FX pair even when later backfill supplies another value", () => {
  const owned = evidence([130000, 140000], [], "KRW");
  const fx = [1, 2].map(day => ({ base: "USD", quote: "KRW", rate: String(1200 + day * 100), observedAt: at(day), fetchedAt: at(day), capturedAt: at(day), source: "captured_fx", kind: "spot" }));
  fx.push({ base: "KRW", quote: "USD", rate: "0.0002", observedAt: at(2), fetchedAt: asOf, source: "later_backfill", kind: "daily_reference" });
  const result = run(owned, history([10, 10]), fx);
  assert.equal(result.status, "ready");
  near(result.rows[1].alternativeValue, 140000);
});

it("allows a valid fully withdrawn zero endpoint while preserving the positive legacy contract", () => {
  const result = run(evidence([100, 0], [{ id: "withdraw-all", at: at(2), amount: "100", currency: "USD", direction: "outflow" }]), history([10, 10]));
  assert.equal(result.status, "ready"); assert.equal(result.actualReturnPct, 0);
  assert.equal(result.rows.at(-1).actualValue, 0); assert.equal(result.rows.at(-1).alternativeValue, 0);
  const legacy = counterfactual.buildInvestmentLabCounterfactualPath({ actualPath: [{ serviceDate: date(1), totalMarketValueKrw: 100 }, { serviceDate: date(2), totalMarketValueKrw: 0 }], closes: [{ priceDate: "2026-08-31", adjustedClose: 10 }, { priceDate: date(1), adjustedClose: 10 }], scheduledFlows: [] });
  assert.equal(legacy.status, "blocked");
});

it("blocks missing or mixed history provenance and incomplete actual evidence", () => {
  assert.equal(run({ ...evidence(), complete: false }).reason, "actual_portfolio_evidence_incomplete");
  assert.equal(run(evidence(), { ...history(), corporateActions: { ...history().corporateActions, status: "unknown" } }).reason, "corporate_action_evidence_missing");
  const mixed = history(); mixed.points[2].dataset = "another_listing";
  assert.equal(run(evidence(), mixed).reason, "scenario_history_invalid");
  assert.equal(run(evidence(), { ...history(), admission: "synthetic_fixture" }).reason, "corporate_action_evidence_missing");
});

it("blocks insolvent alternatives and duplicate actual captures or flows", () => {
  const owned = evidence([100, 100, 100, 100], [{ id: "withdrawal", at: at(2, 12), amount: "1000", currency: "USD", direction: "outflow" }]);
  assert.equal(run(owned).reason, "scenario_insolvent");
  const duplicates = evidence(); duplicates.actualPath.splice(1, 0, duplicates.actualPath[0]);
  assert.equal(run(duplicates).reason, "duplicate_actual_date");
  const duplicateFlows = evidence(); duplicateFlows.externalFlows.push(duplicateFlows.externalFlows[0]);
  assert.equal(run(duplicateFlows).reason, "duplicate_flow");
});

it("actual Modified Dietz assigns a post-capture deposit to the later interval by its real time", () => {
  const result = md([value(1, 100), value(2, 100), value(3, 210)], [flow(2, 100)]);
  assert.equal(result.status, "ready");
  assert.equal(result.policy.version, "observed_timestamp_modified_dietz_v1");
  assert.equal(result.policy.complianceClaim, "none");
  assert.equal(result.periods[0].flowCount, 0);
  assert.equal(result.periods[1].flowCount, 1);
  near(result.periods[1].weightedExternalFlow, 100 * 19 / 24);
  near(result.totalReturn, 10 / (100 + 100 * 19 / 24));
});

it("actual timestamp weighting supports multiple observations within a service day", () => {
  const result = md([value(1, 100, 7), value(1, 210, 10)], [flow(1, 100, 9)]);
  assert.equal(result.status, "ready");
  near(result.periods[0].calendarDays, 3 / 24);
  near(result.periods[0].weightedExternalFlow, 100 / 3);
  near(result.totalReturn, 10 / (100 + 100 / 3));
  assert.equal(result.riskMetrics.annualizedVolatility, null);
});

it("keeps exact endpoints, rejects forged service dates and unknown timestamp evidence", () => {
  const result = md([value(1, 100), value(2, 200)], [flow(2, 100, 7)]);
  assert.equal(result.status, "ready"); assert.equal(result.totalReturn, 0);
  assert.equal(result.periods[0].weightedExternalFlow, 0);
  const wrong = { ...value(2, 200), serviceDate: date(1) };
  assert.equal(md([value(1, 100), wrong], []).reason, "valuation_service_date_mismatch");
  assert.equal(md([value(1, 100), value(2, 200)], [flow(2, 100, 8)]).blockers[0].reason, "flow_outside_valuation_window");
  const missing = dietz.calculateUnitModifiedDietz({ timing: "observed_timestamps", valuations: [{ serviceDate: date(1), value: 100 }, { serviceDate: date(2), value: 200 }], flows: [] });
  assert.equal(missing.status, "blocked");
});

it("preserves legacy date-only KRW policy and rejects native money provenance in the legacy schedule", () => {
  const result = dietz.calculateInvestmentLabModifiedDietz({ valuations: [{ serviceDate: date(1), valueKrw: 100 }, { serviceDate: date(3), valueKrw: 210 }], flows: [{ effectiveServiceDate: date(2), sequence: 0, direction: "inflow", amountKrw: 100 }] });
  assert.equal(result.policy.version, "modified_dietz_daily_weighted_eod_v1");
  near(result.totalReturn, 10 / 150);
  assert.ok("denominatorKrw" in result.periods[0]);
  assert.ok(!("denominator" in result.periods[0]));
  const invalid = schedule.scheduleInvestmentLabBoundaryFlows({ events: [{ eventDate: date(2), sequence: 0, direction: "inflow", amountKrw: 100, amountProvenance: "dated_reporting_money" }], closes: [{ priceDate: date(2), adjustedClose: 10 }], windowEndPriceDate: date(3) });
  assert.equal(invalid.status, "blocked");
});

it("actual portfolio performance and Lab link the same complete observed periods", () => {
  const frame = (day, amount) => ({ at: at(day), source: "owned_capture", scopeComplete: true, positions: [{ id: "cash", ownerId: "owner", name: "Native cash", kind: "cash", cost: null,
    observation: { at: at(day), priceObservedAt: at(day), quantity: String(amount), price: "1", currency: "USD", basis: "raw", source: "owned_cash" } }] });
  const input = { ownerId: "owner", reporting: "USD", asOf: at(4), current: frame(4, 220), history: [frame(1, 100), frame(2, 100), frame(3, 210)], trades: [], fx: [], maxFxAgeMs: 0, maxPriceAgeMs: 0, ledgerComplete: true,
    cashFlows: [{ id: "deposit", ownerId: "owner", accountId: "account", at: at(2, 12), currency: "USD", delta: "100", kind: "external" }] };
  const report = tracked.buildTrackedCurrencyPortfolio(input);
  assert.equal(report.performanceReturn.status, "ready");
  assert.equal(report.performanceReturn.periodCount, 3);
  near(report.performanceReturn.totalReturn * 100, run().actualReturnPct);
  input.history[1].scopeComplete = false;
  const incomplete = tracked.buildTrackedCurrencyPortfolio(input);
  assert.equal(incomplete.current.complete, true);
  assert.equal(incomplete.performanceReturn, null, "an incomplete middle record must not be silently removed");
});
