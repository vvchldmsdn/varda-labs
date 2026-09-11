import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SIMULATION_ECONOMIC_STATE_MODEL_POLICY,
  evaluateEconomicStatePaths,
  simulateEconomicStateModel,
} from "../src/lib/simulation-economic-state-model.ts";

describe("sequential economic-state conditional research model", () => {
  it("admits 1000 complete 126-step paths and rejects a tampered over-budget cube", () => {
    const model = simulateEconomicStateModel(syntheticInput({ horizon: 126, pathCount: 1000 }));
    assert.equal(model.status, "ready");
    assert.equal(model.prepared.assetGrowth.length, 1000 * 127 * 2);
    assert.equal(model.diagnostics.simulatedStepCount, 126000);
    const result = evaluateEconomicStatePaths({ prepared: model.prepared, weights: [0.6, 0.4] });
    assert.equal(result.status, "ready");
    assert.equal(result.paths.length, 1000);
    assert.equal(result.paths[999].length, 127);
    assert.equal(evaluateEconomicStatePaths({ prepared: { ...model.prepared, pathCount: 1001 }, weights: [0.6, 0.4] }).status, "unavailable");
  });
  it("reproduces paths and uses the same asset growth for every portfolio evaluation", () => {
    const input = syntheticInput({ horizon: 63, pathCount: 100 });
    const first = simulateEconomicStateModel(input);
    const repeat = simulateEconomicStateModel(input);
    assert.equal(first.status, "ready");
    assert.deepEqual(first.prepared.assetGrowth, repeat.prepared.assetGrowth);
    assert.deepEqual(first.prepared.factorStates, repeat.prepared.factorStates);
    assert.equal(first.prepared.assetGrowth.length, 100 * 64 * 2);
    assert.equal(first.prepared.factorStates.length, 100 * 64 * 3);
    const portfolio = evaluateEconomicStatePaths({ prepared: first.prepared, weights: [0.6, 0.4] });
    const onlyFirst = evaluateEconomicStatePaths({ prepared: first.prepared, weights: [1, 0], horizon: 21 });
    assert.equal(portfolio.status, "ready");
    assert.equal(portfolio.paths[0][0], 1);
    assert.equal(onlyFirst.paths[0].length, 22);
    for (let path = 0; path < 100; path += 1) {
      for (const step of [1, 21, 63]) {
        const offset = (path * 64 + step) * 2;
        assert.equal(portfolio.paths[path][step], 0.6 * first.prepared.assetGrowth[offset] + 0.4 * first.prepared.assetGrowth[offset + 1]);
        if (step === 21) assert.equal(onlyFirst.paths[path][step], first.prepared.assetGrowth[offset]);
      }
    }
    assert.equal(first.factorBands[0].unit, "KRW_per_USD");
    assert.ok(Math.abs(first.factorBands[0].points[0].p50 - Math.exp(input.initialFactorState[0])) < 1e-9);
    assert.equal(first.factorBands[1].points[0].p50, input.initialFactorState[1]);
    assert.equal(first.factorBands[2].unit, "percentage_points");
    assert.ok(first.factorBands.every((series) => series.points.every((point) => point.p10 <= point.p50 && point.p50 <= point.p90)));
  });

  it("changes the next-step distribution when only the admitted current state changes", () => {
    const input = syntheticInput({ horizon: 2, pathCount: 30 });
    const a = simulateEconomicStateModel({ ...input, initialFactorState: input.observations[10].previousFactorState });
    const b = simulateEconomicStateModel({ ...input, initialFactorState: input.observations[65].previousFactorState });
    assert.equal(a.status, "ready");
    assert.equal(b.status, "ready");
    assert.notDeepEqual(a.diagnostics.initialConditionalFactorMean, b.diagnostics.initialConditionalFactorMean);
    assert.deepEqual(a.diagnostics.factorCovariance, b.diagnostics.factorCovariance);
    assert.deepEqual(a.exposures, b.exposures);
    for (let factor = 0; factor < 3; factor += 1) {
      const firstA = a.prepared.factorStates[3 + factor] - a.prepared.factorStates[factor];
      const firstB = b.prepared.factorStates[3 + factor] - b.prepared.factorStates[factor];
      assert.ok(Math.abs((firstA - firstB) - (a.diagnostics.initialConditionalFactorMean[factor] - b.diagnostics.initialConditionalFactorMean[factor])) < 1e-12);
    }
    assert.notDeepEqual(a.prepared.assetGrowth, b.prepared.assetGrowth);
    assert.ok(a.diagnostics.initialLocalBlend > 0 && a.diagnostics.initialLocalBlend <= 0.5);
  });

  it("attenuates unsupported states to the global mean and reports extrapolated steps", () => {
    const input = syntheticInput({ horizon: 2, pathCount: 20 });
    const result = simulateEconomicStateModel({ ...input, initialFactorState: [Math.log(1300), 100, -50] });
    assert.equal(result.status, "ready");
    assert.ok(result.diagnostics.initialSupportDistance > 2);
    assert.equal(result.diagnostics.initialLocalBlend, 0);
    assert.deepEqual(result.diagnostics.initialConditionalFactorMean, result.diagnostics.globalFactorMean);
    assert.equal(result.diagnostics.extrapolatedStepsPct, 100);
    assert.equal(result.diagnostics.extrapolatedStepCount, 40);
  });

  it("preserves joint factor shocks and correlated asset residuals without doubling FX", () => {
    const observations = Array.from({ length: 90 }, (_, index) => {
      const state = correlatedState(index);
      const next = correlatedState(index + 1);
      const factors = next.map((value, i) => value - state[i]);
      const commonResidual = Math.sin(index * 1.73) * 0.002;
      return {
        previousFactorState: state, factorChanges: factors,
        assetLogReturns: [
          0.0002 + 1.1 * factors[0] - 0.05 * factors[1] + commonResidual,
          0.0003 + 0.7 * factors[0] - 0.02 * factors[1] + commonResidual * 0.8,
        ],
      };
    });
    const input = { assetKeys: ["a", "b"], observations, initialFactorState: correlatedState(89), horizon: 1, pathCount: 500, seed: 4321 };
    const result = simulateEconomicStateModel(input);
    assert.equal(result.status, "ready");
    const factorDraws = [[], [], []];
    const residualDraws = [[], []];
    for (let p = 0; p < 500; p += 1) {
      const changes = [0, 1, 2].map((j) => result.prepared.factorStates[(p * 2 + 1) * 3 + j] - input.initialFactorState[j]);
      changes.forEach((value, j) => factorDraws[j].push(value));
      for (let a = 0; a < 2; a += 1) {
        const predicted = result.exposures[a].intercept + result.exposures[a].betas.reduce((sum, beta, j) => sum + beta * changes[j], 0);
        residualDraws[a].push(Math.log(result.prepared.assetGrowth[(p * 2 + 1) * 2 + a]) - predicted);
      }
    }
    assert.ok(correlation(factorDraws[0], factorDraws[1]) > 0.65);
    assert.ok(correlation(residualDraws[0], residualDraws[1]) > 0.55);
    assert.ok(Math.abs(correlation(residualDraws[0], factorDraws[0])) < 0.18);
    const ewma = observations.map((_, i) => 0.97 ** (89 - i));
    const total = ewma.reduce((s, v) => s + v, 0);
    for (let a = 0; a < 2; a += 1) {
      const muY = observations.reduce((sum, row, i) => sum + row.assetLogReturns[a] * ewma[i] / total, 0);
      const impliedMean = result.exposures[a].intercept + result.exposures[a].betas.reduce((sum, beta, j) => sum + beta * result.diagnostics.globalFactorMean[j], 0);
      assert.ok(Math.abs(muY - impliedMean) < 1e-14);
    }
  });

  it("bounds work and rejects malformed inputs and invalid candidate weights", () => {
    const input = syntheticInput({ horizon: 1, pathCount: 2 });
    for (const patch of [
      { observations: input.observations.slice(0, 44) },
      { observations: [...input.observations, input.observations[0]] },
      { horizon: 127 }, { pathCount: 1001 }, { seed: 1.5 },
      { initialFactorState: [Number.NaN, 4, 0.1] }, { assetKeys: ["a", "a"] },
      { observations: [{ ...input.observations[0], assetLogReturns: [0, Number.NaN] }, ...input.observations.slice(1)] },
    ]) assert.equal(simulateEconomicStateModel({ ...input, ...patch }).status, "unavailable");
    const result = simulateEconomicStateModel(input);
    for (const weights of [[0.5], [0.5, 0.6], [-0.1, 1.1], [Number.NaN, 1]]) {
      assert.equal(evaluateEconomicStatePaths({ prepared: result.prepared, weights }).status, "unavailable");
    }
    assert.equal(SIMULATION_ECONOMIC_STATE_MODEL_POLICY.studentTDegreesOfFreedom, 7);
    assert.equal(SIMULATION_ECONOMIC_STATE_MODEL_POLICY.conditioning, "sequential_state_local_mean_fixed_global_covariance");
  });
});

function state(index) {
  return [Math.log(1300) + 0.015 * Math.sin(index * 0.19), 4 + 0.2 * Math.cos(index * 0.13), 0.3 + 0.1 * Math.sin(index * 0.17)];
}
function correlatedState(index) {
  return [Math.log(1300) + 0.01 * Math.sin(index * 0.23), 4 + 0.08 * Math.sin(index * 0.23) + 0.001 * Math.cos(index), 0.2 + 0.01 * Math.sin(index * 0.37)];
}
function syntheticInput({ horizon, pathCount }) {
  const observations = Array.from({ length: 90 }, (_, index) => {
    const previousFactorState = state(index);
    const factorChanges = state(index + 1).map((v, i) => v - previousFactorState[i]);
    return { previousFactorState, factorChanges,
      assetLogReturns: [0.0004 + factorChanges[0] * 1.2 - factorChanges[1] * 0.05 + Math.sin(index) * 0.0002,
        0.0002 - factorChanges[0] * 0.8 + factorChanges[2] * 0.1 + Math.cos(index) * 0.0002],
    };
  });
  return { assetKeys: ["a", "b"], observations, initialFactorState: state(90), horizon, pathCount, seed: 12345 };
}
function correlation(a, b) {
  const meanA = a.reduce((s, v) => s + v, 0) / a.length;
  const meanB = b.reduce((s, v) => s + v, 0) / b.length;
  const covariance = a.reduce((s, v, i) => s + (v - meanA) * (b[i] - meanB), 0);
  return covariance / Math.sqrt(a.reduce((s, v) => s + (v - meanA) ** 2, 0) * b.reduce((s, v) => s + (v - meanB) ** 2, 0));
}
