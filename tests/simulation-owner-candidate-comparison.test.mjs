import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SIMULATION_OWNER_CANDIDATE_COMPARISON_POLICY,
  buildSimulationOwnerCandidateComparison,
} from "../src/lib/simulation-owner-candidate-comparison.ts";
import {
  executeSimulationResearchPathsFromPrepared,
  prepareSimulationResearchPaths,
} from "../src/lib/simulation-research-execution-core.ts";
import {
  ownerWeights,
  readyOwnerMatrix,
} from "./support/simulation-owner-ready-matrix.mjs";

describe("owner simulation minimum-volatility candidate comparison", () => {
  it("uses one prepared draw plan and enforces turnover, FX and concentration constraints", () => {
    const matrix = readyOwnerMatrix();
    const prepared = prepareSimulationResearchPaths({
      matrix,
      seed: 0x56415244,
      expectedBlockLength: 5,
      horizon: 63,
      pathCount: 500,
    });
    assert.equal(prepared.status, "ready");

    const currentWeights = ownerWeights([5_000, 2_500, 2_500]);
    const currentExecution = executeSimulationResearchPathsFromPrepared({
      prepared,
      scenarioId: "owner-current-all",
      scenarioVersion: "v1",
      weights: currentWeights,
      samplePathCount: 12,
    });
    assert.equal(currentExecution.status, "ready");

    const result = buildSimulationOwnerCandidateComparison({
      account: "all",
      prepared,
      currentExecution,
      currentWeights,
      samplePathCount: 12,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.pairing.status, "shared_prepared_paths_verified");
    assert.equal(
      result.pairing.inputMatrixHash,
      prepared.grossGrowth.inputMatrixHash,
    );
    assert.equal(
      result.pairing.drawPlanHash,
      prepared.grossGrowth.drawPlanHash,
    );
    assert.deepEqual(
      result.currentExecution.samplePaths.map((row) => row.pathIndex),
      result.candidateExecution.samplePaths.map((row) => row.pathIndex),
    );
    assert.equal(
      result.weights.reduce((sum, row) => sum + row.candidateWeightBps, 0),
      10_000,
    );
    assert.ok(
      result.weights.every(
        (row) =>
          row.candidateWeightBps <=
          result.constraints.maximumInstrumentWeightBps,
      ),
    );
    assert.ok(result.constraints.oneWayTurnoverBps <= 2_000);
    assert.ok(result.constraints.fxExposureChangeBps <= 1_000);
    assert.ok(
      result.training.candidateAnnualizedVolatilityPct <=
        result.training.currentAnnualizedVolatilityPct + 1e-10,
    );
    assert.equal(result.outcomeCandidateStatus, "ready");
    assert.ok(result.outcomeCandidates.length >= 2);
    for (const candidate of result.outcomeCandidates) {
      assert.equal(candidate.execution.status, "ready");
      assert.deepEqual(
        candidate.execution.samplePaths.map((row) => row.pathIndex),
        result.currentExecution.samplePaths.map((row) => row.pathIndex),
      );
      assert.ok(candidate.confirmation.objectiveImprovementPctPoints > 0);
      assert.ok(candidate.constraints.oneWayTurnoverBps <= 2_000);
      assert.ok(candidate.constraints.fxExposureChangeBps <= 1_000);
    }
    assert.equal(result.policy.recommendation, "forbidden");
    assert.equal(result.policy.persistence, "forbidden");
    assert.equal(result.policy.providerCalls, "forbidden");
  });

  it("is deterministic and keeps an explicit zero-cost research assumption", () => {
    const matrix = readyOwnerMatrix();
    const prepared = prepareSimulationResearchPaths({
      matrix,
      seed: 0x56415244,
      expectedBlockLength: 5,
      horizon: 63,
      pathCount: 500,
    });
    assert.equal(prepared.status, "ready");
    const currentWeights = ownerWeights([5_000, 2_500, 2_500]);
    const currentExecution = executeSimulationResearchPathsFromPrepared({
      prepared,
      scenarioId: "owner-current-all",
      scenarioVersion: "v1",
      weights: currentWeights,
      samplePathCount: 12,
    });
    assert.equal(currentExecution.status, "ready");

    const input = {
      account: "all",
      prepared,
      currentExecution,
      currentWeights,
      samplePathCount: 12,
    };
    const first = buildSimulationOwnerCandidateComparison(input);
    const second = buildSimulationOwnerCandidateComparison(input);

    assert.equal(first.status, "ready");
    assert.deepEqual(second, first);
    assert.equal(
      SIMULATION_OWNER_CANDIDATE_COMPARISON_POLICY.transactionCostBps,
      0,
    );
    assert.match(
      SIMULATION_OWNER_CANDIDATE_COMPARISON_POLICY.validation,
      /walk_forward/,
    );
  });

  it("leaves a one-instrument account on its current simulation without inventing a candidate", () => {
    const matrix = readyOwnerMatrix({ instrumentCount: 1 });
    const prepared = prepareSimulationResearchPaths({
      matrix,
      seed: 0x56415244,
      expectedBlockLength: 5,
      horizon: 63,
      pathCount: 500,
    });
    assert.equal(prepared.status, "ready");
    const currentWeights = ownerWeights([10_000], 1);
    const currentExecution = executeSimulationResearchPathsFromPrepared({
      prepared,
      scenarioId: "owner-current-irp",
      scenarioVersion: "v1",
      weights: currentWeights,
      samplePathCount: 12,
    });
    assert.equal(currentExecution.status, "ready");

    const result = buildSimulationOwnerCandidateComparison({
      account: "irp",
      prepared,
      currentExecution,
      currentWeights,
      samplePathCount: 12,
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "candidate_requires_two_instruments");
    assert.deepEqual(result.weights, []);
  });
});
