import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FIXED_MIX_RESEARCH_SIMULATION_POLICY,
  buildFixedMixResearchSimulation,
} from "../src/lib/simulation-fixed-mix-research-execution.ts";
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
    assert.doesNotMatch(
      JSON.stringify(left),
      /sha256:|inputMatrixHash|drawPlanHash|scenarioVectorHash/,
    );
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
});

function readyJointMatrix() {
  const requestedServiceDates = Array.from({ length: 91 }, (_, index) =>
    isoDate(index),
  );
  const kodexKey = "korea|KRW|069500";
  const vooKey = "us|USD|VOO";
  const matrix = Array.from({ length: 90 }, (_, index) => ({
    previousServiceDate: requestedServiceDates[index],
    serviceDate: requestedServiceDates[index + 1],
    cells: [
      cell(kodexKey, 0.01, requestedServiceDates[index], requestedServiceDates[index + 1]),
      cell(vooKey, -0.005, requestedServiceDates[index], requestedServiceDates[index + 1], true),
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
