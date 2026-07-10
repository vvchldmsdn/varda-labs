import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPortfolioRiskInput } from "../src/lib/portfolio-risk-input.ts";
import { calculatePortfolioRisk } from "../src/lib/portfolio-risk.ts";
import { crossMarketRiskFixture } from "./fixtures/portfolio-risk-input.mjs";
import {
  makeRiskMathInput,
  parityRiskFixture,
} from "./fixtures/portfolio-risk-math.mjs";

function assertClose(actual, expected, tolerance = 1e-10) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

describe("portfolio risk math", () => {
  it("consumes the normalized cross-market input contract directly", () => {
    const normalized = buildPortfolioRiskInput({
      ...crossMarketRiskFixture(),
      policy: {
        requestedReturnObservations: 2,
        maxPriceCarryDays: 7,
        maxFxCarryDays: 3,
        minimumReturnCoveragePct: 80,
        minimumInstruments: 2,
      },
    });
    const result = calculatePortfolioRisk({
      inputStatus: normalized.status,
      instruments: normalized.instruments,
      returnRows: normalized.returnRows,
    });

    assert.equal(result.calculationStatus, "complete");
    assert.equal(result.observationCount, 2);
    assert.equal(result.instruments.length, 2);
    assert.equal(
      /legacy|assetId|holdingId|authorization|api_key|secret/i.test(
        JSON.stringify(result),
      ),
      false,
    );
  });

  it("computes perfect correlation and equal risk-contribution ENB", () => {
    const returns = [0.01, -0.01, 0.02, -0.02];
    const result = calculatePortfolioRisk(
      makeRiskMathInput({ series: [returns, returns], weights: [0.5, 0.5] }),
    );

    assert.equal(result.calculationStatus, "complete");
    assert.deepEqual(result.portfolio?.correlationMatrix, [
      [1, 1],
      [1, 1],
    ]);
    assert.equal(result.portfolio?.weightedAverageCorrelation.value, 1);
    assertClose(result.portfolio?.riskContributionEnb.value, 2);
    assertClose(result.instruments[0].signedRiskContributionPct, 50);
    assertClose(result.instruments[1].absoluteRiskSharePct, 50);
  });

  it("computes zero correlation for orthogonal synthetic returns", () => {
    const result = calculatePortfolioRisk(
      makeRiskMathInput({
        series: [
          [-0.01, -0.01, 0.01, 0.01],
          [-0.01, 0.01, -0.01, 0.01],
        ],
        weights: [0.5, 0.5],
      }),
    );

    assertClose(result.portfolio?.correlationMatrix[0][1], 0);
    assertClose(result.portfolio?.weightedAverageCorrelation.value, 0);
    assertClose(result.portfolio?.volatilityDaily, Math.sqrt(0.0002 / 3));
  });

  it("keeps negative signed hedge contribution separate from absolute ENB shares", () => {
    const left = [0.01, -0.01, 0.02, -0.02];
    const right = left.map((value) => -value);
    const result = calculatePortfolioRisk(
      makeRiskMathInput({ series: [left, right], weights: [0.8, 0.2] }),
    );

    assertClose(result.instruments[0].signedRiskContributionPct, 400 / 3);
    assertClose(result.instruments[1].signedRiskContributionPct, -100 / 3);
    assertClose(result.instruments[0].absoluteRiskSharePct, 80);
    assertClose(result.instruments[1].absoluteRiskSharePct, 20);
    assertClose(result.portfolio?.riskContributionEnb.value, 1 / 0.68);
  });

  it("returns null correlations for a zero-variance instrument", () => {
    const result = calculatePortfolioRisk(
      makeRiskMathInput({
        series: [
          [0, 0, 0, 0],
          [-0.01, 0.01, -0.02, 0.02],
        ],
        weights: [0.5, 0.5],
      }),
    );

    assert.deepEqual(result.portfolio?.correlationMatrix, [
      [null, null],
      [null, 1],
    ]);
    assert.deepEqual(result.dataHealth.zeroVarianceInstruments, [
      "korea|KRW|RISK1",
    ]);
    assert.deepEqual(result.portfolio?.weightedAverageCorrelation, {
      value: null,
      reason: "undefined_pair_correlation",
    });
    assert.deepEqual(result.instruments[0].sharpe, {
      value: null,
      reason: "zero_variance",
    });
  });

  it("does not fall back to weights when portfolio volatility is zero", () => {
    const left = [0.01, -0.01, 0.02, -0.02];
    const result = calculatePortfolioRisk(
      makeRiskMathInput({
        series: [left, left.map((value) => -value)],
        weights: [0.5, 0.5],
      }),
    );

    assert.equal(result.portfolio?.volatilityDaily, 0);
    assert.deepEqual(result.portfolio?.riskContributionEnb, {
      value: null,
      reason: "zero_portfolio_volatility",
    });
    assert.ok(
      result.instruments.every(
        (instrument) =>
          instrument.signedRiskContributionDaily === null &&
          instrument.riskContributionReason === "zero_portfolio_volatility",
      ),
    );
  });

  it("converts a nonzero annual risk-free rate to a compounded daily rate", () => {
    const series = [0.001, 0.003, -0.001, 0.002];
    const withRf = calculatePortfolioRisk(
      makeRiskMathInput({
        series: [series, series],
        weights: [0.5, 0.5],
        annualRiskFreeRate: 0.05,
      }),
    );
    const withoutRf = calculatePortfolioRisk(
      makeRiskMathInput({ series: [series, series], weights: [0.5, 0.5] }),
    );

    assertClose(withRf.dailyRiskFreeRate, 1.05 ** (1 / 252) - 1);
    assert.ok(
      withRf.portfolio.sharpe.value < withoutRf.portfolio.sharpe.value,
    );
  });

  it("keeps stress correlation unavailable below 10 down days", () => {
    const negatives = Array.from({ length: 9 }, (_, index) =>
      -0.001 * (index + 1),
    );
    const series = [...negatives, 0.01, 0.02, 0.03];
    const result = calculatePortfolioRisk(
      makeRiskMathInput({
        series: [series, series.map((value) => value * 1.5)],
        weights: [0.5, 0.5],
      }),
    );

    assert.equal(result.portfolio?.stress.downDayObservations, 9);
    assert.equal(result.portfolio?.stress.correlationMatrix, null);
    assert.equal(
      result.portfolio?.stress.weightedAverageCorrelation.reason,
      "insufficient_down_days",
    );
  });

  it("computes stress correlation at the 10-down-day boundary", () => {
    const negatives = Array.from({ length: 10 }, (_, index) =>
      -0.001 * (index + 1),
    );
    const series = [...negatives, 0.01, 0.02, 0.03];
    const result = calculatePortfolioRisk(
      makeRiskMathInput({
        series: [series, series.map((value) => value * 1.5)],
        weights: [0.5, 0.5],
      }),
    );

    assert.equal(result.portfolio?.stress.downDayObservations, 10);
    const matrix = result.portfolio?.stress.correlationMatrix;
    assertClose(matrix[0][0], 1);
    assertClose(matrix[0][1], 1);
    assertClose(matrix[1][0], 1);
    assertClose(matrix[1][1], 1);
    assertClose(result.portfolio?.stress.weightedAverageCorrelation.value, 1);
  });

  it("rechecks zero variance inside the stress subset", () => {
    const varyingDown = Array.from({ length: 10 }, (_, index) =>
      -0.001 * (index + 1),
    );
    const result = calculatePortfolioRisk(
      makeRiskMathInput({
        series: [
          [...varyingDown, 0.01, 0.02],
          [...Array(10).fill(-0.001), 0.02, 0.03],
        ],
        weights: [0.5, 0.5],
      }),
    );

    assert.deepEqual(result.portfolio?.stress.correlationMatrix, [
      [1, null],
      [null, null],
    ]);
    assert.equal(
      result.portfolio?.stress.weightedAverageCorrelation.reason,
      "undefined_pair_correlation",
    );
  });

  it("allows standalone volatility and Sharpe for one instrument only", () => {
    const result = calculatePortfolioRisk(
      makeRiskMathInput({
        series: [[0.01, -0.01, 0.02, -0.02]],
        weights: [1],
        inputStatus: "insufficient_instruments",
      }),
    );

    assert.equal(result.calculationStatus, "standalone_only");
    assert.equal(result.portfolio, null);
    assert.ok(result.instruments[0].volatilityAnnualized > 0);
    assert.equal(
      result.instruments[0].riskContributionReason,
      "insufficient_instruments",
    );
  });

  it("does not calculate blocked or insufficient-coverage input", () => {
    for (const [inputStatus, reason] of [
      ["blocked", "input_blocked"],
      ["insufficient_coverage", "input_insufficient_coverage"],
    ]) {
      const result = calculatePortfolioRisk(
        makeRiskMathInput({
          series: [[0.01, -0.01], [0.02, -0.02]],
          weights: [0.5, 0.5],
          inputStatus,
        }),
      );
      assert.equal(result.calculationStatus, "unavailable");
      assert.equal(result.reason, reason);
      assert.equal(result.portfolio, null);
    }
  });

  it("allows full multivariate calculation for partial normalized input", () => {
    const result = calculatePortfolioRisk(
      makeRiskMathInput({
        series: [[0.01, -0.01], [0.02, -0.02]],
        weights: [0.5, 0.5],
        inputStatus: "partial",
      }),
    );

    assert.equal(result.calculationStatus, "complete");
    assert.equal(result.inputStatus, "partial");
  });

  it("rejects invalid weights and annual risk-free assumptions", () => {
    const invalidWeights = calculatePortfolioRisk(
      makeRiskMathInput({
        series: [[0.01, -0.01], [0.02, -0.02]],
        weights: [0.8, 0.8],
      }),
    );
    const invalidRf = calculatePortfolioRisk(
      makeRiskMathInput({
        series: [[0.01, -0.01], [0.02, -0.02]],
        weights: [0.5, 0.5],
        annualRiskFreeRate: -1,
      }),
    );

    assert.equal(invalidWeights.calculationStatus, "invalid");
    assert.equal(invalidWeights.reason, "invalid_input");
    assert.equal(invalidRf.calculationStatus, "invalid");
    assert.equal(invalidRf.reason, "invalid_input");
  });

  it("keeps canonical full precision separate from legacy output policy", () => {
    const result = calculatePortfolioRisk(
      makeRiskMathInput(parityRiskFixture),
    );

    assert.equal(parityRiskFixture.legacyExpected.returnType, "log");
    assert.equal(parityRiskFixture.legacyExpected.roundedDuringCalculation, true);
    assert.equal(parityRiskFixture.canonicalExpected.returnType, "simple");
    assert.equal(
      parityRiskFixture.canonicalExpected.roundedDuringCalculation,
      false,
    );
    assert.deepEqual(parityRiskFixture.legacyExpected.correlationMatrix, [
      [1, 0.63],
      [0.63, 1],
    ]);
    assert.equal(
      parityRiskFixture.legacyExpected.weightedAverageCorrelation,
      0.628,
    );
    assertClose(
      result.portfolio.weightedAverageCorrelation.value,
      parityRiskFixture.canonicalExpected.weightedAverageCorrelation,
    );
    assertClose(
      result.portfolio.volatilityAnnualized,
      parityRiskFixture.canonicalExpected.portfolioVolatilityAnnualized,
    );
    assertClose(
      result.portfolio.weightedAverageStandaloneVolatilityAnnualized,
      parityRiskFixture.canonicalExpected
        .weightedAverageVolatilityAnnualized,
    );
    assertClose(
      result.portfolio.riskContributionEnb.value,
      parityRiskFixture.canonicalExpected.riskContributionEnb,
    );
    assertClose(
      result.portfolio.sharpe.value,
      parityRiskFixture.canonicalExpected.portfolioSharpe,
    );
    for (let index = 0; index < result.instruments.length; index += 1) {
      assertClose(
        result.instruments[index].signedRiskContributionDaily,
        parityRiskFixture.canonicalExpected.riskContributions[index].signedDaily,
      );
      assertClose(
        result.instruments[index].signedRiskContributionPct,
        parityRiskFixture.canonicalExpected.riskContributions[index].signedPct,
      );
    }
  });
});
