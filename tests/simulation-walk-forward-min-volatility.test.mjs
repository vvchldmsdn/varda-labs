import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SIMULATION_RETURN_MATRIX_POLICY } from "../src/lib/simulation-return-matrix.ts";
import {
  SIMULATION_WALK_FORWARD_MIN_VOLATILITY_POLICY,
  buildSimulationWalkForwardMinimumVolatility,
} from "../src/lib/simulation-walk-forward-min-volatility.ts";

describe("Walk-forward minimum-volatility research", () => {
  it("uses three strict 60-train and 10-test folds on the fixed paired universe", () => {
    const matrix = readyJointMatrix();
    const result = buildSimulationWalkForwardMinimumVolatility({
      explicitEndServiceDate: matrix.requestedServiceDates.at(-1),
      matrix,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.folds.length, 3);
    assert.equal(result.source.outOfSampleStepCount, 30);
    assert.equal(result.paths.minimumVolatility.points.length, 31);
    assert.equal(result.paths.equalWeight.points.length, 31);
    for (const fold of result.folds) {
      assert.equal(fold.trainStepCount, 60);
      assert.equal(fold.testStepCount, 10);
      assert.equal(
        fold.weights.reduce((sum, row) => sum + row.weightBps, 0),
        10_000,
      );
      assert.ok(fold.weights.every((row) => row.weightBps >= 0));
      assert.ok(fold.weights.every((row) => row.weightBps <= 10_000));
      assert.ok(fold.trainEndServiceDate <= fold.testStartServiceDate);
    }
  });

  it("does not let a test return alter the weight selected for that fold", () => {
    const leftMatrix = readyJointMatrix();
    const rightMatrix = readyJointMatrix({
      override: new Map([
        [60, [0.8, -0.5]],
        [61, [-0.5, 0.8]],
      ]),
    });
    const left = buildSimulationWalkForwardMinimumVolatility({
      explicitEndServiceDate: leftMatrix.requestedServiceDates.at(-1),
      matrix: leftMatrix,
    });
    const right = buildSimulationWalkForwardMinimumVolatility({
      explicitEndServiceDate: rightMatrix.requestedServiceDates.at(-1),
      matrix: rightMatrix,
    });

    assert.equal(left.status, "ready");
    assert.equal(right.status, "ready");
    assert.deepEqual(right.folds[0].weights, left.folds[0].weights);
    assert.notEqual(
      right.paths.minimumVolatility.points[2].indexValue,
      left.paths.minimumVolatility.points[2].indexValue,
    );
  });

  it("holds the selected sleeves inside a fold instead of rebalancing daily", () => {
    const override = new Map();
    for (let index = 60; index < 70; index += 1) {
      override.set(index, [0.1, 0]);
    }
    const matrix = readyJointMatrix({
      override,
      flatTraining: true,
    });
    const result = buildSimulationWalkForwardMinimumVolatility({
      explicitEndServiceDate: matrix.requestedServiceDates.at(-1),
      matrix,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.folds[0].weights[0].weightBps, 5_000);
    const firstFoldEnd = result.paths.minimumVolatility.points[10].indexValue;
    const expectedBuyAndHold = (0.5 * 1.1 ** 10 + 0.5) * 100;
    const dailyRebalanced = (0.5 * 1.1 + 0.5) ** 10 * 100;
    assert.ok(Math.abs(firstFoldEnd - expectedBuyAndHold) < 1e-9);
    assert.ok(Math.abs(firstFoldEnd - dailyRebalanced) > 0.1);
  });

  it("regularizes identical training returns and resolves the neutral tie", () => {
    const matrix = readyJointMatrix({ flatTraining: true });
    const result = buildSimulationWalkForwardMinimumVolatility({
      explicitEndServiceDate: matrix.requestedServiceDates.at(-1),
      matrix,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.folds[0].weights[0].weightBps, 5_000);
    assert.equal(result.folds[0].weights[1].weightBps, 5_000);
    assert.equal(
      result.policy.covarianceEstimator,
      "sample_covariance_with_diagonal_shrinkage",
    );
    assert.equal(result.policy.annualizationFactor, 252);
  });

  it("blocks only this research result when the endpoint or matrix is unavailable", () => {
    const matrix = readyJointMatrix();
    const missingEnd = buildSimulationWalkForwardMinimumVolatility({
      explicitEndServiceDate: null,
      matrix,
    });
    const incomplete = buildSimulationWalkForwardMinimumVolatility({
      explicitEndServiceDate: matrix.requestedServiceDates.at(-1),
      matrix: { ...matrix, status: "incomplete" },
    });
    const wrongUniverse = buildSimulationWalkForwardMinimumVolatility({
      explicitEndServiceDate: matrix.requestedServiceDates.at(-1),
      matrix: {
        ...matrix,
        instruments: [matrix.instruments[0]],
      },
    });

    assert.equal(missingEnd.status, "unavailable");
    assert.equal(missingEnd.reason, "explicit_end_required");
    assert.equal(incomplete.reason, "input_matrix_unavailable");
    assert.equal(wrongUniverse.reason, "input_matrix_shape_mismatch");
  });

  it("keeps the result research-only and free of account or durable authority", () => {
    const matrix = readyJointMatrix();
    const result = buildSimulationWalkForwardMinimumVolatility({
      explicitEndServiceDate: matrix.requestedServiceDates.at(-1),
      matrix,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.runtimeTrustStatus, "research_only");
    assert.equal(result.policy.accountBinding, "forbidden");
    assert.equal(result.policy.targetBinding, "forbidden");
    assert.equal(result.policy.recommendation, "forbidden");
    assert.equal(result.policy.persistence, "forbidden");
    assert.doesNotMatch(
      JSON.stringify(result),
      /owner|holding|targetWeight|scenarioVectorHash|inputMatrixHash|drawPlanHash/,
    );
  });

  it("pins the expected v1 window and execution policy", () => {
    assert.deepEqual(
      {
        source: SIMULATION_WALK_FORWARD_MIN_VOLATILITY_POLICY.sourceReturnStepCount,
        train: SIMULATION_WALK_FORWARD_MIN_VOLATILITY_POLICY.trainWindowStepCount,
        test: SIMULATION_WALK_FORWARD_MIN_VOLATILITY_POLICY.testWindowStepCount,
        folds: SIMULATION_WALK_FORWARD_MIN_VOLATILITY_POLICY.foldCount,
      },
      { source: 90, train: 60, test: 10, folds: 3 },
    );
    assert.equal(
      SIMULATION_WALK_FORWARD_MIN_VOLATILITY_POLICY.portfolioPath,
      "costless_rebalance_at_test_fold_boundary_buy_and_hold_within_fold",
    );
  });
});

function readyJointMatrix({ override = new Map(), flatTraining = false } = {}) {
  const requestedServiceDates = Array.from({ length: 91 }, (_, index) =>
    isoDate(index),
  );
  const kodexKey = "korea|KRW|069500";
  const vooKey = "us|USD|VOO";
  const matrix = Array.from({ length: 90 }, (_, index) => {
    const replacement = override.get(index);
    const trainingFlat = flatTraining && index < 60;
    const kodexReturn = replacement?.[0] ??
      (trainingFlat ? 0.001 : ((index % 7) - 3) * 0.002);
    const vooReturn = replacement?.[1] ??
      (trainingFlat ? 0.001 : ((index % 5) - 2) * 0.003);
    return {
      previousServiceDate: requestedServiceDates[index],
      serviceDate: requestedServiceDates[index + 1],
      cells: [
        cell(kodexKey, kodexReturn),
        cell(vooKey, vooReturn),
      ],
    };
  });

  return {
    status: "ready",
    policy: SIMULATION_RETURN_MATRIX_POLICY,
    requestedServiceDates,
    instruments: [
      {
        instrumentKey: kodexKey,
        market: "korea",
        currency: "KRW",
        ticker: "069500",
      },
      {
        instrumentKey: vooKey,
        market: "us",
        currency: "USD",
        ticker: "VOO",
      },
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

function cell(instrumentKey, value) {
  return {
    instrumentKey,
    value,
    previous: evidence(),
    current: evidence(),
  };
}

function evidence() {
  return {
    status: "ready",
    reason: null,
    sourcePriceDate: null,
    priceCarryDays: 0,
    sourceFxDate: null,
    fxCarryDays: 0,
  };
}

function isoDate(offset) {
  const date = new Date(Date.UTC(2025, 0, 1 + offset));
  return date.toISOString().slice(0, 10);
}
