import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSimulationOwnerHistoricalOutcomeValidation,
  buildSimulationOwnerHistoricalValidationEndpointDates,
  SIMULATION_OWNER_HISTORICAL_VALIDATION_POLICY,
} from "../src/lib/simulation-owner-historical-outcome-validation.ts";
import { PRIVATE_OWNER_RAW_CLOSE_SIMULATION_RETURN_MATRIX_POLICY } from "../src/lib/simulation-return-matrix.ts";
import { readyJointMatrix } from "./support/simulation-ready-joint-matrix.mjs";

describe("owner current-composition historical validation", () => {
  it("compares seven 21-return outcomes after exact 90-return training windows", () => {
    const execution = readyExecution();
    const endpoints = readyEndpoints(execution.endSelection.endServiceDate);
    const result = buildSimulationOwnerHistoricalOutcomeValidation({
      execution,
      endpoints,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.account, "all");
    assert.equal(result.rows.length, 7);
    assert.equal(result.summary.readyEndpointCount, 7);
    assert.ok(
      result.rows.every(
        (row) =>
          row.status === "ready" &&
          row.trainingReturnStepCount === 90 &&
          row.outcomeReturnStepCount === 21,
      ),
    );
    assert.equal(result.weights.reduce((sum, row) => sum + row.weightBps, 0), 10_000);
  });

  it("keeps ready endpoint rows when one historical window is incomplete", () => {
    const execution = readyExecution();
    const endpoints = readyEndpoints(execution.endSelection.endServiceDate);
    endpoints[2] = { ...endpoints[2], matrix: null };
    const result = buildSimulationOwnerHistoricalOutcomeValidation({
      execution,
      endpoints,
    });

    assert.equal(result.status, "partial");
    assert.equal(result.summary.readyEndpointCount, 6);
    assert.equal(result.summary.unavailableEndpointCount, 1);
    assert.equal(result.rows[2].status, "unavailable");
    assert.equal(result.rows[2].reason, "input_matrix_unavailable");
  });

  it("does not silently shorten the validation horizon or claim historical holdings", () => {
    const policy = SIMULATION_OWNER_HISTORICAL_VALIDATION_POLICY;

    assert.equal(policy.trainingReturnStepCount, 90);
    assert.equal(policy.outcomeReturnStepCount, 21);
    assert.equal(policy.sourceReturnStepCount, 111);
    assert.equal(policy.automaticHorizonReduction, "forbidden");
    assert.equal(policy.interpolation, "forbidden");
    assert.equal(policy.providerCalls, "forbidden");
    assert.equal(policy.persistence, "forbidden");
    assert.match(policy.compositionDisclosure, /not_historical_holdings/);
  });

  it("blocks mismatched endpoint sets instead of choosing another date", () => {
    const execution = readyExecution();
    const endpoints = readyEndpoints(execution.endSelection.endServiceDate);
    const result = buildSimulationOwnerHistoricalOutcomeValidation({
      execution,
      endpoints: endpoints.slice(1),
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "endpoint_set_mismatch");
    assert.equal(result.rows.length, 0);
  });
});

function readyExecution() {
  const endServiceDate = "2026-08-04";
  return {
    status: "ready",
    account: "all",
    endSelection: {
      status: "valid",
      source: "latest_common_stored",
      endServiceDate,
    },
    coverage: {
      candidateCurrentValueKrw: 10_000,
      modeledCurrentValueKrw: 9_000,
      modeledCurrentValuePct: 90,
      modeledOriginalWeightBps: 9_000,
      omittedWeightBps: 1_000,
      manualHistoryWeightBps: 1_000,
      zeroWeightRowCount: 0,
      modeledInstrumentCount: 2,
      candidateInstrumentCount: 3,
    },
    executionWeights: [
      {
        instrumentKey: "korea|KRW|069500",
        market: "korea",
        currency: "KRW",
        ticker: "069500",
        weightBps: 6_000,
      },
      {
        instrumentKey: "us|USD|VOO",
        market: "us",
        currency: "USD",
        ticker: "VOO",
        weightBps: 4_000,
      },
    ],
  };
}

function readyEndpoints(endServiceDate) {
  return buildSimulationOwnerHistoricalValidationEndpointDates(endServiceDate).map(
    (outcomeEndServiceDate) => ({
      outcomeEndServiceDate,
      matrix: {
        ...readyJointMatrix({
          endServiceDate: outcomeEndServiceDate,
          returnStepCount:
            SIMULATION_OWNER_HISTORICAL_VALIDATION_POLICY.sourceReturnStepCount,
        }),
        policy: PRIVATE_OWNER_RAW_CLOSE_SIMULATION_RETURN_MATRIX_POLICY,
      },
    }),
  );
}
