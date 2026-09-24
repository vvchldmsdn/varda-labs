import assert from "node:assert/strict";
import { it } from "node:test";
import { calculateCurrencyReferenceMetrics, CURRENCY_REFERENCE_POLICY as policy } from "../src/lib/currency-reference-evidence.ts";
import { annualizedSharpe } from "../src/lib/portfolio-risk-statistics.ts";
import { buildCurrencyResearch } from "../src/lib/currency-research.ts";
import { currencyResearchFixture } from "../src/lib/currency-research-fixture.ts";

function evidence(currency = "USD", periods = [0.02, -0.01, 0.03].map((value, i) => ({ from: `2026-09-0${i + 1}T20:00:00Z`, to: `2026-09-0${i + 2}T20:00:00Z`, value }))) {
  const base = { version: policy.version, admission: "synthetic_fixture", currency, calendar: policy.calendar, source: { provider: "fixture", dataset: `${currency}_reference`, version: "fixture_v1" } };
  const rows = values => periods.map((period, i) => ({ ...period, value: values[i], observedAt: period.to, publishedAt: period.to, fetchedAt: period.to }));
  return {
    reportingCurrency: currency, returnBasis: "price_return", asOf: periods.at(-1).to, periods, annualizationFactor: 252, synthetic: true,
    benchmark: { ...base, identity: { id: `${currency}_benchmark`, name: `${currency} fixture benchmark`, market: currency === "USD" ? "US" : "KR", symbol: "FIXTURE", currency }, returnBasis: "price_return", fxBasis: policy.benchmarkFx, periods: rows(periods.map(row => row.value / 2)) },
    riskFree: { ...base, identity: `${currency}_cash`, maturity: "matched_holding_interval", definition: policy.riskFreeDefinition, conversion: policy.riskFreeConversion, periods: rows(periods.map((_, i) => 0.0001 + i * 0.00001)) },
  };
}

it("admits separate KRW/USD exact-period references and preserves source timestamps", () => {
  for (const currency of ["KRW", "USD"]) {
    const input = evidence(currency), result = calculateCurrencyReferenceMetrics(input);
    assert.equal(result.beta, 2);
    assert.equal(result.sharpe, annualizedSharpe({ returns: input.periods.map((row, i) => row.value - input.riskFree.periods[i].value), dailyRiskFreeRate: 0, annualizationFactor: 252 }).value);
    assert.deepEqual(result.reasons, []);
    assert.equal(result.provenance.benchmark.currency, currency);
    assert.deepEqual(result.provenance.riskFree.observations, input.riskFree.periods);
    assert.equal(result.comparison.benchmarkReturnPct, (1.01 * 0.995 * 1.015 - 1) * 100);
  }
});

it("never falls back to zero rate or converted KRW benchmark in USD", () => {
  const missing = calculateCurrencyReferenceMetrics({ ...evidence(), benchmark: null, riskFree: null });
  assert.equal(missing.sharpe, null); assert.equal(missing.beta, null); assert.equal(missing.comparison, null);
  assert.deepEqual(missing.reasons, ["risk_free_evidence_not_supplied", "matched_benchmark_not_supplied"]);
  const wrongCurrency = calculateCurrencyReferenceMetrics({ ...evidence(), benchmark: evidence("KRW").benchmark, riskFree: evidence("KRW").riskFree });
  assert.equal(wrongCurrency.sharpe, null); assert.equal(wrongCurrency.beta, null);
  assert.deepEqual(wrongCurrency.reasons, ["risk_free_currency_mismatch", "benchmark_currency_mismatch"]);
});

it("rejects date intersection, currency-converted benchmarks and price/total-return mismatch independently", () => {
  const input = evidence(); input.benchmark.periods[1].from = "2026-09-01T20:00:00Z";
  let result = calculateCurrencyReferenceMetrics(input);
  assert.equal(result.beta, null); assert.notEqual(result.sharpe, null); assert.ok(result.reasons.includes("benchmark_calendar_mismatch"));
  for (const amend of [row => { row.fxBasis = "converted_krw_benchmark"; }, row => { row.returnBasis = "total_return"; }]) {
    const current = evidence(); amend(current.benchmark); result = calculateCurrencyReferenceMetrics(current);
    assert.equal(result.beta, null); assert.equal(result.comparison, null); assert.ok(result.reasons.includes("benchmark_return_basis_mismatch"));
  }
});

it("rejects annual yields, future publication/import and synthetic-to-owner promotion", () => {
  const annual = evidence(); annual.riskFree.definition = "annual_treasury_yield";
  assert.ok(calculateCurrencyReferenceMetrics(annual).reasons.includes("risk_free_definition_invalid"));
  for (const key of ["publishedAt", "fetchedAt"]) {
    const future = evidence(); future.riskFree.periods[0][key] = "2026-10-01T20:00:00Z";
    assert.ok(calculateCurrencyReferenceMetrics(future).reasons.includes("risk_free_observation_invalid"));
  }
  const promoted = calculateCurrencyReferenceMetrics({ ...evidence(), synthetic: false });
  assert.equal(promoted.sharpe, null); assert.equal(promoted.beta, null);
  assert.deepEqual(promoted.reasons, ["risk_free_provenance_invalid", "benchmark_provenance_invalid"]);
});

it("admits reviewed provider reference contracts without promoting fixture admission", () => {
  const input = evidence(); input.synthetic = false;
  input.benchmark.admission = "reviewed_provider_series"; input.riskFree.admission = "reviewed_provider_series";
  const result = calculateCurrencyReferenceMetrics(input);
  assert.notEqual(result.sharpe, null); assert.equal(result.beta, 2); assert.deepEqual(result.reasons, []);
});

it("retains an observed flat benchmark comparison but leaves its beta undefined", () => {
  const input = evidence(); input.benchmark.periods.forEach(row => { row.value = 0; });
  const result = calculateCurrencyReferenceMetrics(input);
  assert.equal(result.beta, null); assert.equal(result.comparison.benchmarkReturnPct, 0);
  assert.ok(result.reasons.includes("zero_benchmark_variance")); assert.equal(result.provenance.benchmark.identity.currency, "USD");
});

it("rejects mixed portfolio return bases and impossible observation timestamps", () => {
  const mixed = calculateCurrencyReferenceMetrics({ ...evidence(), returnBasis: "mixed_price_and_total_return" });
  assert.equal(mixed.sharpe, null); assert.equal(mixed.beta, null); assert.ok(mixed.reasons.includes("reference_portfolio_context_invalid"));
  const input = evidence(); input.riskFree.periods[0].observedAt = "2026-02-30T20:00:00Z";
  assert.ok(calculateCurrencyReferenceMetrics(input).reasons.includes("risk_free_observation_invalid"));
});

it("optional references enter the shared research risk result without changing bootstrap paths", async () => {
  const input = { ...currencyResearchFixture(), horizon: 4, reportingCurrency: "USD" };
  const original = await buildCurrencyResearch(input);
  const periods = original.lab.points.slice(1).map((row, i) => ({ from: original.lab.points[i].at, to: row.at, value: row.current / original.lab.points[i].current - 1 }));
  const refs = evidence("USD", periods);
  const result = await buildCurrencyResearch({ ...input, benchmark: refs.benchmark, riskFree: refs.riskFree });
  assert.equal(result.status, "ready"); assert.notEqual(result.risk.sharpe, null); assert.ok(Math.abs(result.risk.beta - 2) < 1e-10);
  assert.deepEqual(result.simulation.paths, original.simulation.paths);
  assert.notEqual(result.metadata.cacheIdentity, original.metadata.cacheIdentity);
  assert.equal(result.metadata.modelProvenance.reportingCurrency, "USD");
  assert.equal(result.metadata.modelProvenance.modelKind, "generic_portfolio_bootstrap");
  assert.equal(result.metadata.modelProvenance.rateSource.dataset, "USD_reference");
  const wrong = await buildCurrencyResearch({ ...input, benchmark: evidence("KRW", periods).benchmark });
  assert.equal(wrong.risk.beta, null); assert.equal(wrong.status, "ready"); assert.deepEqual(wrong.simulation.paths, original.simulation.paths);
});
