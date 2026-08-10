import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SIMULATION_FACTOR_RESIDUAL_MODEL_POLICY,
  simulateFactorResidualModel,
} from "../src/lib/simulation-factor-residual-model.ts";
import { summarizeSimulationNavPaths } from "../src/lib/simulation-nav-path-summary.ts";

describe("simulation factor-residual Monte Carlo model", () => {
  it("recovers synthetic exposure directions and produces deterministic heavy-tail paths", () => {
    const input = syntheticInput();
    const first = simulateFactorResidualModel(input);
    const second = simulateFactorResidualModel(input);

    assert.equal(first.status, "ready");
    assert.equal(second.status, "ready");
    assert.deepEqual(second.exposures, first.exposures);
    assert.deepEqual(second.paths[0], first.paths[0]);
    assert.deepEqual(second.paths.at(-1), first.paths.at(-1));
    assert.ok(first.exposures[0].standardizedBetas[0] > 0);
    assert.ok(first.exposures[0].standardizedBetas[1] < 0);
    assert.ok(first.exposures[1].standardizedBetas[0] < 0);
    assert.ok(first.exposures[1].standardizedBetas[2] > 0);
    assert.equal(first.paths.length, 500);
    assert.equal(first.paths[0].length, 64);
    assert.equal(first.paths[0][0], 1);
    assert.equal(first.policy.fallback, "forbidden");
    assert.equal(first.policy.studentTDegreesOfFreedom, 7);

    const summary = summarizeSimulationNavPaths({
      paths: first.paths,
      horizon: 63,
      samplePathCount: 12,
    });
    assert.equal(summary.status, "ready");
    assert.equal(summary.bands.length, 64);
    assert.equal(summary.samplePaths.length, 12);
    assert.ok(
      summary.bands.every(
        (row) => row.p10 <= row.p50 && row.p50 <= row.p90,
      ),
    );
  });

  it("stabilizes collinear factors with disclosed shrinkage and ridge", () => {
    const observations = Array.from({ length: 60 }, (_, index) => {
      const factor = Math.sin(index / 4) * 0.01;
      return {
        factorChanges: [factor, factor, factor],
        assetLogReturns: [factor * 0.7 + Math.cos(index) * 0.0001],
      };
    });
    const result = simulateFactorResidualModel({
      assetKeys: ["asset"],
      factorKeys: ["f1", "f2", "f3"],
      observations,
      weights: [1],
      horizon: 63,
      pathCount: 500,
      seed: 7,
    });

    assert.equal(result.status, "ready");
    assert.ok(result.diagnostics.regressionRidge > 0);
    assert.ok(result.diagnostics.factorCholeskyJitter >= 0);
    assert.equal(
      SIMULATION_FACTOR_RESIDUAL_MODEL_POLICY.factorCovarianceOffDiagonalShrinkage,
      0.15,
    );
  });

  it("blocks insufficient and non-finite inputs instead of filling them", () => {
    const tooShort = syntheticInput().observations.slice(0, 44);
    assert.equal(
      simulateFactorResidualModel({
        ...syntheticInput(),
        observations: tooShort,
      }).reason,
      "insufficient_observations",
    );
    const invalid = syntheticInput();
    invalid.observations[0].factorChanges[0] = Number.NaN;
    assert.equal(simulateFactorResidualModel(invalid).reason, "invalid_input");
  });
});

function syntheticInput() {
  const observations = Array.from({ length: 120 }, (_, index) => {
    const factors = [
      Math.sin(index / 7) * 0.008,
      (index % 5 - 2) * 0.0015,
      Math.cos(index / 9) * 0.003,
    ];
    return {
      factorChanges: factors,
      assetLogReturns: [
        0.0004 + factors[0] * 1.2 - factors[1] * 0.6 + Math.sin(index) * 0.0002,
        0.0002 - factors[0] * 0.8 + factors[2] * 0.5 + Math.cos(index) * 0.0002,
      ],
    };
  });
  return {
    assetKeys: ["asset-a", "asset-b"],
    factorKeys: ["fx", "yield", "curve"],
    observations,
    weights: [0.6, 0.4],
    horizon: 63,
    pathCount: 500,
    seed: 0x46414354,
  };
}
