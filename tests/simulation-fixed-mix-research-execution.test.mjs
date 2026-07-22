import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FIXED_MIX_RESEARCH_SIMULATION_POLICY,
  buildFixedMixResearchSimulation,
} from "../src/lib/simulation-fixed-mix-research-execution.ts";
import {
  buildFixedMixResearchComparison,
} from "../src/lib/simulation-fixed-mix-research-comparison.ts";
import { resolveKodexVooFixedMixSelection } from "../src/lib/kodex-voo-fixed-mix-selection.ts";
import { SIMULATION_RETURN_MATRIX_POLICY } from "../src/lib/simulation-return-matrix.ts";

describe("Fixed-mix joint research simulation", () => {
  it("jointly resamples paired returns into the selected no-rebalancing path", () => {
    const matrix = readyJointMatrix();
    const endServiceDate = matrix.requestedServiceDates.at(-1);
    const selection = resolveKodexVooFixedMixSelection("25");
    const left = buildFixedMixResearchSimulation({
      explicitEndServiceDate: endServiceDate,
      matrix,
      selection,
    });
    const right = buildFixedMixResearchSimulation({
      explicitEndServiceDate: endServiceDate,
      matrix,
      selection,
    });

    assert.equal(left.status, "ready");
    assert.deepEqual(right, left);
    assert.equal(left.source.returnStepCount, 90);
    assert.equal(left.source.pairedInstrumentCount, 2);
    assert.equal(left.assumptions.pathCount, 500);
    assert.equal(left.assumptions.horizon, 63);
    assert.deepEqual(
      left.weights.map(({ ticker, weightBps }) => ({ ticker, weightBps })),
      [
        { ticker: "069500", weightBps: 2_500 },
        { ticker: "VOO", weightBps: 7_500 },
      ],
    );

    const expectedBuyAndHoldIndex =
      (0.25 * 1.01 ** 63 + 0.75 * 0.995 ** 63) * 100;
    const dailyRebalancedIndex = (0.25 * 1.01 + 0.75 * 0.995) ** 63 * 100;
    assert.ok(
      Math.abs(left.terminal.p50Index - expectedBuyAndHoldIndex) < 1e-9,
      "the path must preserve the initial allocation without periodic rebalancing",
    );
    assert.ok(
      Math.abs(left.terminal.p50Index - dailyRebalancedIndex) > 0.01,
      "the path must not accidentally rebalance to the selected weights every day",
    );
    assert.ok(
      left.terminal.maxDrawdownP90Pct >= left.terminal.maxDrawdownP50Pct,
      "positive drawdown magnitudes must make P90 at least as severe as P50",
    );
    assert.ok(
      left.terminal.lowerTailMeanReturnPct <= left.terminal.p5ReturnPct,
      "the exact lower-tail mean must not exceed the interpolated P5 return",
    );
    assert.doesNotMatch(
      JSON.stringify(left),
      /sha256:|inputMatrixHash|drawPlanHash|scenarioVectorHash/,
    );
  });

  it("supports the fixed 126-step research horizon without changing the 90-row input", () => {
    const matrix = readyJointMatrix();
    const result = buildFixedMixResearchSimulation({
      explicitEndServiceDate: matrix.requestedServiceDates.at(-1),
      horizon: 126,
      matrix,
      selection: resolveKodexVooFixedMixSelection("50"),
    });

    assert.equal(result.status, "ready");
    assert.equal(result.source.returnStepCount, 90);
    assert.equal(result.assumptions.horizon, 126);
    assert.equal(result.bands.length, 127);
    assert.equal(result.samplePaths[0].points.length, 127);
  });

  it("requires an explicit end date without a silent endpoint rollback", () => {
    const result = buildFixedMixResearchSimulation({
      explicitEndServiceDate: null,
      matrix: readyJointMatrix(),
      selection: resolveKodexVooFixedMixSelection(undefined),
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "explicit_end_required");
    assert.deepEqual(result.bands, []);
  });

  it("rejects blank, repeated, and out-of-range weights before execution", () => {
    for (const value of ["", ["25", "75"], "0", "100", "25.5"]) {
      const result = buildFixedMixResearchSimulation({
        explicitEndServiceDate: readyJointMatrix().requestedServiceDates.at(-1),
        matrix: readyJointMatrix(),
        selection: resolveKodexVooFixedMixSelection(value),
      });

      assert.equal(result.status, "unavailable");
      assert.equal(result.reason, "invalid_weight_selection");
      assert.equal(result.weights, null);
      assert.deepEqual(result.samplePaths, []);
    }
  });

  it("does not build a joint path from one independently ready instrument", () => {
    const matrix = readyJointMatrix();
    const result = buildFixedMixResearchSimulation({
      explicitEndServiceDate: matrix.requestedServiceDates.at(-1),
      selection: resolveKodexVooFixedMixSelection(undefined),
      matrix: {
        ...matrix,
        instruments: [matrix.instruments[0]],
        matrix: matrix.matrix.map((row) => ({
          ...row,
          cells: [row.cells[0]],
        })),
      },
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "input_matrix_shape_mismatch");
  });

  it("blocks the whole joint stochastic path when the paired matrix is incomplete", () => {
    const matrix = readyJointMatrix();
    const result = buildFixedMixResearchSimulation({
      explicitEndServiceDate: matrix.requestedServiceDates.at(-1),
      selection: resolveKodexVooFixedMixSelection(undefined),
      matrix: {
        ...matrix,
        status: "incomplete",
        consumerStatus: "blocked_incomplete_matrix",
      },
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "input_matrix_unavailable");
    assert.deepEqual(result.samplePaths, []);
  });

  it("publishes the constrained research model rather than a regime claim", () => {
    assert.equal(
      FIXED_MIX_RESEARCH_SIMULATION_POLICY.bootstrapModel,
      "stationary_bootstrap_unconditional_not_regime_conditioned",
    );
    assert.equal(
      FIXED_MIX_RESEARCH_SIMULATION_POLICY.portfolioPath,
      "initial_fixed_weight_buy_and_hold_without_rebalancing",
    );
    assert.equal(
      FIXED_MIX_RESEARCH_SIMULATION_POLICY.seedPolicy,
      "deterministic_only_for_identical_matrix_engine_policy_and_seed",
    );
  });

  it("reuses one pathwise draw and growth artifact across the three preset mixes", () => {
    const matrix = readyJointMatrix({ varyReturns: true });
    const comparison = buildFixedMixResearchComparison({
      explicitEndServiceDate: matrix.requestedServiceDates.at(-1),
      matrix,
    });

    assert.equal(comparison.status, "ready");
    assert.equal(comparison.pairing.status, "shared_pathwise_draw_verified");
    assert.equal(comparison.pairing.scenarioCount, 3);
    assert.equal(
      comparison.policy.sharedSampling,
      "single_prepared_draw_plan_and_gross_growth_reused_pathwise",
    );
    assert.deepEqual(
      comparison.scenarios.map((scenario) => [
        scenario.execution.weights[0].weightBps,
        scenario.execution.weights[1].weightBps,
      ]),
      [
        [2_500, 7_500],
        [5_000, 5_000],
        [7_500, 2_500],
      ],
    );

    const [lowKodex, midpoint, highKodex] = comparison.scenarios;
    assert.ok(lowKodex && midpoint && highKodex);
    assert.deepEqual(
      lowKodex.execution.samplePaths.map((path) => path.pathIndex),
      midpoint.execution.samplePaths.map((path) => path.pathIndex),
    );
    assert.deepEqual(
      midpoint.execution.samplePaths.map((path) => path.pathIndex),
      highKodex.execution.samplePaths.map((path) => path.pathIndex),
    );

    for (let pathIndex = 0; pathIndex < midpoint.execution.samplePaths.length; pathIndex += 1) {
      const lowPath = lowKodex.execution.samplePaths[pathIndex];
      const middlePath = midpoint.execution.samplePaths[pathIndex];
      const highPath = highKodex.execution.samplePaths[pathIndex];
      assert.ok(lowPath && middlePath && highPath);
      for (let pointIndex = 0; pointIndex < middlePath.points.length; pointIndex += 1) {
        const lowPoint = lowPath.points[pointIndex];
        const middlePoint = middlePath.points[pointIndex];
        const highPoint = highPath.points[pointIndex];
        assert.ok(lowPoint && middlePoint && highPoint);
        assert.equal(lowPoint.stepIndex, middlePoint.stepIndex);
        assert.equal(middlePoint.stepIndex, highPoint.stepIndex);
        assert.ok(
          Math.abs(
            middlePoint.indexValue -
              (lowPoint.indexValue + highPoint.indexValue) / 2,
          ) < 1e-10,
          "the midpoint mix must use the same underlying instrument growth path",
        );
      }
    }

    assert.equal(comparison.policy.ranking, "forbidden");
    assert.equal(comparison.policy.recommendation, "forbidden");
    assert.equal(comparison.policy.optimizer, "forbidden");
    assert.equal(Object.hasOwn(comparison, "rankings"), false);
    assert.doesNotMatch(
      JSON.stringify(comparison),
      /sha256:|inputMatrixHash|drawPlanHash/,
    );
  });

  it("uses one canonical scenario identity for default and explicit 50:50", () => {
    const matrix = readyJointMatrix({ varyReturns: true });
    const input = {
      explicitEndServiceDate: matrix.requestedServiceDates.at(-1),
      matrix,
    };
    const defaultResult = buildFixedMixResearchSimulation({
      ...input,
      selection: resolveKodexVooFixedMixSelection(undefined),
    });
    const explicitResult = buildFixedMixResearchSimulation({
      ...input,
      selection: resolveKodexVooFixedMixSelection("50"),
    });

    assert.equal(defaultResult.status, "ready");
    assert.equal(explicitResult.status, "ready");
    assert.deepEqual(defaultResult.weights, explicitResult.weights);
    assert.deepEqual(defaultResult.terminal, explicitResult.terminal);
    assert.deepEqual(defaultResult.bands, explicitResult.bands);
    assert.deepEqual(defaultResult.samplePaths, explicitResult.samplePaths);
  });
});

function readyJointMatrix({ varyReturns = false } = {}) {
  const requestedServiceDates = Array.from({ length: 91 }, (_, index) =>
    isoDate(index),
  );
  const kodexKey = "korea|KRW|069500";
  const vooKey = "us|USD|VOO";
  const matrix = Array.from({ length: 90 }, (_, index) => ({
    previousServiceDate: requestedServiceDates[index],
    serviceDate: requestedServiceDates[index + 1],
    cells: [
      cell(
        kodexKey,
        varyReturns ? ((index % 7) - 3) * 0.003 : 0.01,
        requestedServiceDates[index],
        requestedServiceDates[index + 1],
      ),
      cell(
        vooKey,
        varyReturns ? ((index % 5) - 2) * 0.002 : -0.005,
        requestedServiceDates[index],
        requestedServiceDates[index + 1],
        true,
      ),
    ],
  }));

  return {
    status: "ready",
    policy: SIMULATION_RETURN_MATRIX_POLICY,
    requestedServiceDates,
    instruments: [
      { instrumentKey: kodexKey, market: "korea", currency: "KRW", ticker: "069500" },
      { instrumentKey: vooKey, market: "us", currency: "USD", ticker: "VOO" },
    ],
    exclusions: [],
    matrix,
    summary: {
      requestedInstrumentCount: 2,
      includedInstrumentCount: 2,
      excludedInstrumentCount: 0,
      requestedServiceDateCount: 91,
      matrixRowCount: 90,
      totalCellCount: 180,
      readyCellCount: 180,
      incompleteCellCount: 0,
      coveragePct: 100,
    },
    sourceSummary: {
      acceptedPriceRows: 182,
      acceptedFxRows: 91,
      ignoredOutOfWindowPriceRows: 0,
      ignoredOutOfWindowFxRows: 0,
    },
    consumerStatus: "matrix_ready",
    blockers: [],
  };
}

function cell(instrumentKey, value, previousDate, currentDate, requiresFx = false) {
  return {
    instrumentKey,
    value,
    previous: evidence(previousDate, requiresFx),
    current: evidence(currentDate, requiresFx),
  };
}

function evidence(date, requiresFx) {
  return {
    status: "ready",
    reason: null,
    sourcePriceDate: date,
    priceCarryDays: 0,
    sourceFxDate: requiresFx ? date : null,
    fxCarryDays: requiresFx ? 0 : null,
  };
}

function isoDate(offset) {
  const date = new Date(Date.UTC(2025, 0, 1 + offset));
  return date.toISOString().slice(0, 10);
}
