import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSimulationOwnerOutcomeCandidates,
  SIMULATION_OWNER_OUTCOME_OPTIMIZER_POLICY,
} from "../src/lib/simulation-owner-outcome-optimizer.ts";
import { prepareSimulationResearchPaths } from "../src/lib/simulation-research-execution-core.ts";
import {
  ownerWeights,
  readyOwnerMatrix,
} from "./support/simulation-owner-ready-matrix.mjs";

describe("owner simulation outcome candidate search", () => {
  it("finds deterministic candidates that improve on held-out paths within every guardrail", () => {
    const prepared = readyPrepared();
    const currentWeights = ownerWeights([5_000, 2_500, 2_500]);
    const first = buildSimulationOwnerOutcomeCandidates({
      prepared,
      currentWeights,
    });
    const second = buildSimulationOwnerOutcomeCandidates({
      prepared,
      currentWeights,
    });

    assert.equal(first.status, "ready");
    assert.deepEqual(second, first);
    assert.ok(first.candidates.length >= 2);
    for (const candidate of first.candidates) {
      assert.equal(
        candidate.weights.reduce(
          (sum, row) => sum + row.candidateWeightBps,
          0,
        ),
        10_000,
      );
      assert.ok(candidate.constraints.oneWayTurnoverBps <= 2_000);
      assert.ok(candidate.constraints.fxExposureChangeBps <= 1_000);
      assert.ok(
        candidate.weights.every(
          (row) =>
            row.candidateWeightBps <=
            candidate.constraints.maximumInstrumentWeightBps,
        ),
      );
      assert.ok(candidate.search.objectiveImprovementPctPoints > 0);
      assert.ok(candidate.confirmation.objectiveImprovementPctPoints > 0);
      assert.equal(candidate.search.pathCount, 250);
      assert.equal(candidate.confirmation.pathCount, 250);
    }
    assert.equal(first.policy.persistence, "forbidden");
    assert.equal(first.policy.recommendation, "forbidden");
    assert.equal(first.policy.orderAuthority, "forbidden");
  });

  it("does not let confirmation-path values choose the candidate weights", () => {
    const prepared = readyPrepared();
    const changed = {
      ...prepared,
      grossGrowth: {
        ...prepared.grossGrowth,
        paths: prepared.grossGrowth.paths.map((path, index) =>
          index % 2 === 0
            ? path
            : {
                ...path,
                points: path.points.map((point, pointIndex) =>
                  pointIndex !== path.points.length - 1
                    ? point
                    : {
                        ...point,
                        grossGrowthFactors: point.grossGrowthFactors.map(
                          (factor) => ({
                            ...factor,
                            value: factor.value * 1.01,
                          }),
                        ),
                      },
                ),
              },
        ),
      },
    };
    const currentWeights = ownerWeights([5_000, 2_500, 2_500]);
    const baseline = buildSimulationOwnerOutcomeCandidates({
      prepared,
      currentWeights,
    });
    const withChangedConfirmation = buildSimulationOwnerOutcomeCandidates({
      prepared: changed,
      currentWeights,
    });

    assert.equal(baseline.status, "ready");
    assert.equal(withChangedConfirmation.status, "ready");
    assert.deepEqual(
      withChangedConfirmation.candidates.map((candidate) => ({
        objective: candidate.objective,
        weights: candidate.weights.map((row) => row.candidateWeightBps),
      })),
      baseline.candidates.map((candidate) => ({
        objective: candidate.objective,
        weights: candidate.weights.map((row) => row.candidateWeightBps),
      })),
    );
  });

  it("does not invent alternatives for a one-instrument account", () => {
    const prepared = prepareSimulationResearchPaths({
      matrix: readyOwnerMatrix({ instrumentCount: 1 }),
      seed: 0x56415244,
      expectedBlockLength: 5,
      horizon: 63,
      pathCount: 500,
    });
    assert.equal(prepared.status, "ready");

    const result = buildSimulationOwnerOutcomeCandidates({
      prepared,
      currentWeights: ownerWeights([10_000], 1),
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "input_shape_mismatch");
    assert.deepEqual(result.candidates, []);
    assert.deepEqual(
      SIMULATION_OWNER_OUTCOME_OPTIMIZER_POLICY.coordinateTransferStepsBps,
      [500, 250, 100],
    );
  });
});

function readyPrepared() {
  const prepared = prepareSimulationResearchPaths({
    matrix: readyOwnerMatrix(),
    seed: 0x56415244,
    expectedBlockLength: 5,
    horizon: 63,
    pathCount: 500,
  });
  assert.equal(prepared.status, "ready");
  return prepared;
}
