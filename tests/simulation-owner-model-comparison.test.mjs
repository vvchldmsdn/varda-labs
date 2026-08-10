import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSimulationOwnerModelComparison,
  SIMULATION_OWNER_MODEL_COMPARISON_POLICY,
} from "../src/lib/simulation-owner-model-comparison.ts";

describe("owner-scoped simulation model comparison", () => {
  it("compares paired distributions without averaging their probabilities", () => {
    const result = buildSimulationOwnerModelComparison({
      bootstrap: bootstrap(),
      factor: factor(),
    });

    assert.equal(result.status, "ready");
    assert.equal(result.account, "all");
    assert.equal(
      result.agreement.code,
      "direction_agrees_and_ranges_overlap",
    );
    assert.equal(result.agreement.terminalP10P90OverlapPct, 75);
    assert.equal(
      result.deltas.factorMinusBootstrapP50ReturnPctPoints,
      -2,
    );
    assert.equal(result.deltas.factorMinusBootstrapP5ReturnPctPoints, 5);
    assert.equal(
      result.deltas.factorMinusBootstrapLossProbabilityPctPoints,
      -5,
    );
    assert.equal(result.pairing.factorObservationCoveragePct, 60);
    assert.equal(result.models.bootstrap.name, "과거 구간 재표본");
    assert.equal(result.models.factor.name, "환율·금리 요인");
    assert.equal(result.policy.modelCombination, "forbidden");
    assert.equal(result.policy.confidenceScore, "forbidden");
  });

  it("marks direction and range disagreement without choosing a winner", () => {
    const result = buildSimulationOwnerModelComparison({
      bootstrap: bootstrap(),
      factor: factor({
        terminal: terminal({
          p10Index: 70,
          p50Index: 85,
          p90Index: 90,
          p50ReturnPct: -15,
        }),
      }),
    });

    assert.equal(result.status, "ready");
    assert.equal(
      result.agreement.code,
      "direction_differs_ranges_disjoint",
    );
    assert.equal(result.agreement.terminalP10P90Overlaps, false);
    assert.equal(result.agreement.terminalP10P90OverlapPct, 0);
    assert.equal(result.policy.winnerSelection, "forbidden");
  });

  it("keeps comparison unavailable when one model is unavailable", () => {
    const result = buildSimulationOwnerModelComparison({
      bootstrap: bootstrap(),
      factor: {
        ...factor(),
        status: "unavailable",
        reason: "insufficient_factor_overlap",
        assumptions: null,
        terminal: null,
        bands: [],
        samplePaths: [],
      },
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "factor_model_unavailable");
    assert.equal(result.modelStatuses.bootstrap.status, "ready");
    assert.equal(result.modelStatuses.factor.status, "unavailable");
    assert.equal(result.models, null);
  });

  it("blocks mismatched account, date, horizon, and path identities", () => {
    assert.equal(
      buildSimulationOwnerModelComparison({
        bootstrap: bootstrap(),
        factor: factor({
          executionWeights: weights([4_000, 6_000]),
        }),
      }).reason,
      "weight_identity_mismatch",
    );
    assert.equal(
      buildSimulationOwnerModelComparison({
        bootstrap: bootstrap(),
        factor: factor({ account: "isa" }),
      }).reason,
      "account_mismatch",
    );
    assert.equal(
      buildSimulationOwnerModelComparison({
        bootstrap: bootstrap(),
        factor: factor({
          source: { ...factor().source, matrixEndServiceDate: "2026-08-02" },
        }),
      }).reason,
      "end_date_mismatch",
    );
    assert.equal(
      buildSimulationOwnerModelComparison({
        bootstrap: bootstrap(),
        factor: factor({ assumptions: { horizon: 126, pathCount: 500 } }),
      }).reason,
      "horizon_mismatch",
    );
    assert.equal(
      buildSimulationOwnerModelComparison({
        bootstrap: bootstrap(),
        factor: factor({ assumptions: { horizon: 63, pathCount: 1_000 } }),
      }).reason,
      "path_count_mismatch",
    );
  });

  it("pins the read-only assumption-sensitivity boundary", () => {
    assert.equal(
      SIMULATION_OWNER_MODEL_COMPARISON_POLICY.interpretation,
      "assumption_sensitivity_not_model_ranking",
    );
    assert.equal(SIMULATION_OWNER_MODEL_COMPARISON_POLICY.persistence, "forbidden");
    assert.equal(SIMULATION_OWNER_MODEL_COMPARISON_POLICY.providerCalls, "forbidden");
    assert.equal(SIMULATION_OWNER_MODEL_COMPARISON_POLICY.recommendation, "forbidden");
  });
});

function bootstrap(overrides = {}) {
  return {
    id: "owner-all",
    name: "내 포트폴리오",
    account: "all",
    status: "ready",
    reason: null,
    assumptions: { horizon: 63, pathCount: 500 },
    executionWeights: weights([5_000, 5_000]),
    source: { endServiceDate: "2026-08-03", returnStepCount: 90 },
    terminal: terminal(),
    bands: bands(),
    samplePaths: [],
    ...overrides,
  };
}

function factor(overrides = {}) {
  return {
    id: "owner-factor-residual-all",
    name: "환율·금리 요인 모형",
    account: "all",
    status: "ready",
    reason: null,
    assumptions: { horizon: 63, pathCount: 500 },
    executionWeights: weights([5_000, 5_000]),
    source: {
      matrixRowCount: 90,
      alignedObservationCount: 54,
      factorGapRowCount: 36,
      matrixEndServiceDate: "2026-08-03",
    },
    terminal: terminal({
      p10Index: 95,
      p50Index: 108,
      p90Index: 125,
      p50ReturnPct: 8,
      p5ReturnPct: -15,
      lowerTailMeanReturnPct: -19,
      lossProbabilityPct: 25,
      maxDrawdownP50Pct: 9,
      maxDrawdownP90Pct: 16,
    }),
    bands: bands({ p10: 95, p50: 108, p90: 125 }),
    samplePaths: [],
    ...overrides,
  };
}

function weights(weightBps) {
  return weightBps.map((value, index) => ({
    instrumentKey: index === 0 ? "korea|KRW|069500" : "us|USD|QQQ",
    market: index === 0 ? "korea" : "us",
    currency: index === 0 ? "KRW" : "USD",
    ticker: index === 0 ? "069500" : "QQQ",
    weightBps: value,
  }));
}

function terminal(overrides = {}) {
  return {
    p10Index: 90,
    p50Index: 110,
    p90Index: 130,
    p50ReturnPct: 10,
    p5ReturnPct: -20,
    lowerTailMeanReturnPct: -24,
    lossProbabilityPct: 30,
    maxDrawdownP50Pct: 10,
    maxDrawdownP90Pct: 18,
    ...overrides,
  };
}

function bands(terminalBand = { p10: 90, p50: 110, p90: 130 }) {
  return [
    { stepIndex: 0, p10: 100, p50: 100, p90: 100 },
    { stepIndex: 63, ...terminalBand },
  ];
}
