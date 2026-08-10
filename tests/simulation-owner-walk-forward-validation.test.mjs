import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSimulationOwnerWalkForwardValidation,
  SIMULATION_OWNER_WALK_FORWARD_VALIDATION_POLICY,
} from "../src/lib/simulation-owner-walk-forward-validation.ts";
import {
  ownerWeights,
  readyOwnerMatrix,
} from "./support/simulation-owner-ready-matrix.mjs";

describe("owner simulation walk-forward validation", () => {
  it("uses three chronological 60-train and 10-test folds with the same constraints", () => {
    const result = buildSimulationOwnerWalkForwardValidation({
      account: "all",
      currentExecutionReady: true,
      matrix: readyOwnerMatrix(),
      currentWeights: ownerWeights([5_000, 2_500, 2_500]),
    });

    assert.equal(result.status, "ready");
    assert.equal(result.summary.readyFoldCount, 3);
    assert.equal(result.summary.comparableOutOfSampleStepCount, 30);
    assert.equal(result.folds.length, 3);
    for (const fold of result.folds) {
      assert.equal(fold.status, "ready");
      assert.equal(fold.trainStepCount, 60);
      assert.equal(fold.testStepCount, 10);
      assert.equal(fold.trainEndServiceDate, fold.testStartServiceDate);
      assert.equal(
        fold.weights.reduce(
          (sum, row) => sum + row.candidateWeightBps,
          0,
        ),
        10_000,
      );
      assert.ok(fold.constraints.oneWayTurnoverBps <= 2_000);
      assert.ok(fold.constraints.fxExposureChangeBps <= 1_000);
      assert.ok(
        fold.training.candidateAnnualizedVolatilityPct <=
          fold.training.currentAnnualizedVolatilityPct + 1e-10,
      );
    }
    assert.equal(result.policy.providerCalls, "forbidden");
    assert.equal(result.policy.persistence, "forbidden");
    assert.equal(result.policy.recommendation, "forbidden");
  });

  it("does not let a held-out return alter the weights selected before it", () => {
    const currentWeights = ownerWeights([5_000, 2_500, 2_500]);
    const baseline = buildSimulationOwnerWalkForwardValidation({
      account: "all",
      currentExecutionReady: true,
      matrix: readyOwnerMatrix(),
      currentWeights,
    });
    const changed = buildSimulationOwnerWalkForwardValidation({
      account: "all",
      currentExecutionReady: true,
      matrix: readyOwnerMatrix({
        returnOverrides: new Map([["AAA:60", 0.4]]),
      }),
      currentWeights,
    });

    assert.equal(baseline.status, "ready");
    assert.equal(changed.status, "ready");
    assert.deepEqual(changed.folds[0].weights, baseline.folds[0].weights);
    assert.notEqual(
      changed.folds[0].outcome.candidateReturnPct,
      baseline.folds[0].outcome.candidateReturnPct,
    );
  });

  it("is deterministic and leaves a one-instrument account without an invented candidate", () => {
    const input = {
      account: "all",
      currentExecutionReady: true,
      matrix: readyOwnerMatrix(),
      currentWeights: ownerWeights([5_000, 2_500, 2_500]),
    };
    assert.deepEqual(
      buildSimulationOwnerWalkForwardValidation(input),
      buildSimulationOwnerWalkForwardValidation(input),
    );

    const oneInstrument = buildSimulationOwnerWalkForwardValidation({
      account: "irp",
      currentExecutionReady: true,
      matrix: readyOwnerMatrix({ instrumentCount: 1 }),
      currentWeights: ownerWeights([10_000], 1),
    });
    assert.equal(oneInstrument.status, "unavailable");
    assert.equal(oneInstrument.reason, "no_ready_folds");
    assert.equal(oneInstrument.folds.length, 3);
    assert.ok(
      oneInstrument.folds.every(
        (fold) => fold.reason === "candidate_requires_two_instruments",
      ),
    );
  });

  it("pins the account-scoped research boundary", () => {
    assert.deepEqual(
      {
        source:
          SIMULATION_OWNER_WALK_FORWARD_VALIDATION_POLICY.sourceReturnStepCount,
        train:
          SIMULATION_OWNER_WALK_FORWARD_VALIDATION_POLICY.trainWindowStepCount,
        test:
          SIMULATION_OWNER_WALK_FORWARD_VALIDATION_POLICY.testWindowStepCount,
        folds: SIMULATION_OWNER_WALK_FORWARD_VALIDATION_POLICY.foldCount,
      },
      { source: 90, train: 60, test: 10, folds: 3 },
    );
    assert.equal(
      SIMULATION_OWNER_WALK_FORWARD_VALIDATION_POLICY.transactionCostBps,
      0,
    );
    assert.equal(
      SIMULATION_OWNER_WALK_FORWARD_VALIDATION_POLICY.orderAuthority,
      "forbidden",
    );
  });
});
