import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSimulationOwnerEconomicCandidates } from "../src/lib/simulation-owner-economic-candidates.ts";
import { SIMULATION_ECONOMIC_STATE_MODEL_POLICY, evaluateEconomicStatePaths } from "../src/lib/simulation-economic-state-model.ts";
import { summarizeSimulationNavPaths } from "../src/lib/simulation-nav-path-summary.ts";
import { buildSimulationOwnerOutcomeCandidates, searchSimulationOwnerOutcomeCandidatesFromTerminalGrowth } from "../src/lib/simulation-owner-outcome-optimizer.ts";
import { prepareSimulationResearchPaths } from "../src/lib/simulation-research-execution-core.ts";
import { ownerWeights, readyOwnerMatrix } from "./support/simulation-owner-ready-matrix.mjs";

describe("economic asset-path candidate search", () => {
  it("preserves the bootstrap adapter's existing search result", () => {
    const prepared = prepareSimulationResearchPaths({ matrix: readyOwnerMatrix(), seed: 25, expectedBlockLength: 5, horizon: 63, pathCount: 500 });
    assert.equal(prepared.status, "ready");
    const currentWeights = ownerWeights([6000, 2000, 2000]);
    const original = buildSimulationOwnerOutcomeCandidates({ prepared, currentWeights });
    const core = searchSimulationOwnerOutcomeCandidatesFromTerminalGrowth({
      instruments: prepared.matrix.instruments, currentWeights,
      terminalFactors: prepared.grossGrowth.paths.map((path) => ({ pathIndex: path.pathIndex, factors: path.points.at(-1).grossGrowthFactors.map((row) => row.value) })),
    });
    assert.equal(original.status, core.status);
    assert.deepEqual(original.candidates, core.candidates);
    assert.deepEqual(original.current, core.current);
    assert.equal(original.policy.version, "simulation_owner_outcome_candidate_search_v1");
  });

  it("reweights the exact same cube for all candidates without mutation or rerolls", () => {
    const economic = fixture();
    const before = new Float64Array(economic.prepared.assetGrowth);
    const result = buildSimulationOwnerEconomicCandidates({ economic });
    assert.equal(result.status, "ready");
    assert.equal(result.candidateStatus, "ready");
    assert.equal(result.outcomeCandidates.length, 3);
    assert.deepEqual(buildSimulationOwnerEconomicCandidates({ economic }), result);
    assert.deepEqual(economic.prepared.assetGrowth, before);
    for (const candidate of result.outcomeCandidates) {
      const evaluated = evaluateEconomicStatePaths({ prepared: economic.prepared, weights: candidate.weights.map((row) => row.candidateWeightBps / 10000) });
      const expected = summarizeSimulationNavPaths({ paths: evaluated.paths, horizon: 2, samplePathCount: 12 });
      assert.deepEqual(candidate.execution.terminal, expected.terminal);
      assert.deepEqual(candidate.execution.bands, expected.bands);
      assert.equal(candidate.search.pathCount, 500);
      assert.equal(candidate.confirmation.pathCount, 500);
      assert.ok(candidate.confirmation.objectiveImprovementPctPoints > 0);
      assert.ok(candidate.constraints.oneWayTurnoverBps <= 2000);
      assert.ok(candidate.constraints.fxExposureChangeBps <= 1000);
    }
    assert.ok(!("prepared" in result));
  });

  it("withholds unconfirmed choices without blocking the current distribution", () => {
    const economic = fixture();
    for (let path = 1; path < 1000; path += 2) {
      const offset = (path * 3 + 2) * 3;
      economic.prepared.assetGrowth.set([1.5, 0.5, 0.5], offset);
    }
    const result = buildSimulationOwnerEconomicCandidates({ economic });
    assert.equal(result.status, "ready");
    assert.equal(result.currentExecution.status, "ready");
    assert.equal(result.candidateStatus, "unavailable");
    assert.equal(result.candidateReason, "no_confirmed_candidate");
    assert.deepEqual(result.outcomeCandidates, []);
  });

  it("rejects swapped identities, a corrupt cube and duplicated partition identities", () => {
    const economic = fixture();
    assert.equal(buildSimulationOwnerEconomicCandidates({ economic: { ...economic, executionWeights: [...economic.executionWeights].reverse() } }).reason, "prepared_identity_mismatch");
    economic.prepared.assetGrowth[0] = 2;
    assert.equal(buildSimulationOwnerEconomicCandidates({ economic }).reason, "prepared_identity_mismatch");
    const weights = ownerWeights([6000, 2000, 2000]);
    const core = searchSimulationOwnerOutcomeCandidatesFromTerminalGrowth({ instruments: weights, currentWeights: weights, terminalFactors: Array.from({ length: 20 }, () => ({ pathIndex: 0, factors: [1, 2, 1] })) });
    assert.equal(core.reason, "input_shape_mismatch");
  });

  it("does not replace an unavailable economic model with bootstrap", () => {
    const result = buildSimulationOwnerEconomicCandidates({ economic: { status: "unavailable", account: "all", reason: "current_factor_state_stale" } });
    assert.equal(result.status, "unavailable");
    assert.equal(result.currentExecution, null);
  });
});

function fixture() {
  const executionWeights = ownerWeights([6000, 2000, 2000]);
  const assetGrowth = new Float64Array(1000 * 3 * 3);
  for (let path = 0; path < 1000; path += 1) {
    const delta = (path % 10) / 1000;
    assetGrowth.set([1, 1, 1, 0.9 + delta, 1.2 + delta, 1.05 + delta, 0.8 + delta, 1.4 + delta, 1.1 + delta], path * 9);
  }
  return {
    status: "ready", account: "all", executionWeights,
    source: { matrixEndServiceDate: "2026-09-10", stateAsOfServiceDate: "2026-09-10" },
    prepared: {
      status: "ready", modelVersion: SIMULATION_ECONOMIC_STATE_MODEL_POLICY.version,
      assetKeys: executionWeights.map((row) => row.instrumentKey), factorKeys: SIMULATION_ECONOMIC_STATE_MODEL_POLICY.factorKeys,
      horizon: 2, pathCount: 1000, seed: 33, assetGrowth, factorStates: new Float64Array(1000 * 3 * 3),
    },
  };
}
