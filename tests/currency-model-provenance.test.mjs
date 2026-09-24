import assert from "node:assert/strict";
import { it } from "node:test";
import { buildSimulationOwnerEconomicResearch } from "../src/lib/simulation-owner-economic-research.ts";
import { ownerWeights, readyOwnerMatrix } from "./support/simulation-owner-ready-matrix.mjs";
import { composePortfolioRiskReadModel } from "../src/lib/portfolio-risk-read-model.ts";
import { portfolioRiskReadModelFixture } from "./fixtures/portfolio-risk-read-model.mjs";

function economicInput() {
  const matrix = readyOwnerMatrix();
  return { account: "all", matrix, weights: ownerWeights([5000, 2500, 2500]), horizon: 4, ownerExecutionReady: true,
    factorRows: matrix.requestedServiceDates.flatMap((date, i) => [
      ["usdkrw", 1300 + i * .7 + Math.sin(i / 5) * 4, "fixture_fx", "USD_KRW"],
      ["us_10y_yield", 4 + Math.sin(i / 7) * .08, "fixture_rates", "DGS10"],
      ["us_10y2y_curve", .2 + Math.cos(i / 9) * .04, "fixture_rates", "T10Y2Y"],
    ].map(([factorKey, value, source, sourceSeriesId]) => ({ factorKey, value, source, sourceSeriesId, factorDate: date, periodEndDate: date, releaseDate: date, observedAt: `${date}T22:00:00Z`, volatility20dPct: 1 }))),
  };
}

it("KRW economic result fixes its model, FX, calibration, seed and honest factor provenance", () => {
  const result = buildSimulationOwnerEconomicResearch(economicInput());
  assert.equal(result.status, "ready");
  const p = result.provenance;
  assert.equal(p.reportingCurrency, "KRW"); assert.equal(p.modelKind, "krw_economic_state");
  assert.equal(p.returnBasis, "krw_investor_simple_return_to_log_return");
  assert.equal(p.fxBasis, "dated_usdkrw_in_training_returns_no_second_fx_multiplier");
  assert.equal(p.seed, 0x45434f4e); assert.equal(p.parameters.ewmaDecay, .97);
  assert.equal(p.calibrationPeriod.observations, 89); assert.equal(p.calibrationPeriod.from, result.source.firstAlignedPreviousServiceDate);
  assert.equal(p.factorDataVersion, null); assert.equal(p.availabilityTimestamp, null); assert.equal(p.publicationTimestamp, null);
  assert.deepEqual(p.rateSource, [{ source: "fixture_rates", seriesId: "DGS10", version: null }]);
  assert.equal(p.benchmarkSource, null);
  assert.equal(result.currentFactors[0].importedAt, `${result.currentFactors[0].factorDate}T22:00:00Z`);
});

it("economic wrapper rejects USD and relabeled return/FX matrices before executing", () => {
  const input = economicInput();
  const usd = buildSimulationOwnerEconomicResearch({ ...input, reportingCurrency: "USD" });
  assert.equal(usd.reason, "unsupported_reporting_currency"); assert.equal(usd.prepared, null); assert.equal(usd.requestedReportingCurrency, "USD");
  for (const amendment of [{ returnKind: "usd_investor_simple_return" }, { fxPolicy: "current_spot" }, { version: "usd_renamed_matrix" }]) {
    const result = buildSimulationOwnerEconomicResearch({ ...input, matrix: { ...input.matrix, policy: { ...input.matrix.policy, ...amendment } } });
    assert.equal(result.reason, "unsupported_return_basis"); assert.equal(result.prepared, null);
  }
});

it("production KRW risk keeps covariance/ENB and exposes no invented Sharpe or benchmark beta", () => {
  const result = composePortfolioRiskReadModel(portfolioRiskReadModelFixture());
  assert.equal(result.calculation.calculationStatus, "complete");
  assert.ok(result.calculation.portfolio.volatilityAnnualized > 0); assert.notEqual(result.calculation.portfolio.riskContributionEnb.value, null);
  assert.equal(result.provenance.annualRiskFreeRate, null); assert.equal(result.provenance.dailyRiskFreeRate, null);
  assert.equal(result.calculation.portfolio.sharpe.value, null); assert.equal(result.calculation.portfolio.sharpe.reason, "risk_free_evidence_not_supplied");
  assert.ok(result.calculation.instruments.every(row => row.sharpe.value === null));
  assert.deepEqual(result.pathAnalytics.benchmarkBetas, []); assert.notEqual(result.pathAnalytics.maximumDrawdownPct.value, null);
});
