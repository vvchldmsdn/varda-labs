import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSimulationOwnerModelCalibration,
  SIMULATION_OWNER_MODEL_CALIBRATION_POLICY,
} from "../src/lib/simulation-owner-model-calibration.ts";

describe("owner simulation model calibration", () => {
  it("pairs exact outcomes and computes comparable retrospective errors", () => {
    const bootstrap = validationFixture("bootstrap");
    const factor = validationFixture("factor");
    const result = buildSimulationOwnerModelCalibration({ bootstrap, factor });

    assert.equal(result.status, "ready");
    assert.equal(result.summary.pairedEndpointCount, 3);
    assert.equal(result.summary.effectiveNonOverlappingWindowCount, 3);
    assert.equal(result.summary.overlappingPairedEndpointCount, 0);
    assert.equal(result.summary.bootstrap.meanAbsoluteP50ErrorPctPoints, 1);
    assert.equal(result.summary.factor.meanAbsoluteP50ErrorPctPoints, 0.5);
    assert.ok(
      result.summary.factor.lossBrierScore <
        result.summary.bootstrap.lossBrierScore,
    );
  });

  it("preserves a missing endpoint instead of discarding the comparison set", () => {
    const bootstrap = validationFixture("bootstrap");
    const factor = validationFixture("factor");
    factor.rows[1] = unavailableRow(factor.rows[1].outcomeEndServiceDate);
    const result = buildSimulationOwnerModelCalibration({ bootstrap, factor });

    assert.equal(result.status, "partial");
    assert.equal(result.summary.pairedEndpointCount, 2);
    assert.equal(result.summary.unavailableEndpointCount, 1);
    assert.equal(result.rows[1].status, "unavailable");
    assert.equal(result.rows[1].reason, "source_endpoint_unavailable");
  });

  it("blocks an endpoint when the two models do not share the exact outcome", () => {
    const bootstrap = validationFixture("bootstrap");
    const factor = validationFixture("factor");
    factor.rows[0] = {
      ...factor.rows[0],
      actualReturnPct: factor.rows[0].actualReturnPct + 0.01,
    };
    const result = buildSimulationOwnerModelCalibration({ bootstrap, factor });

    assert.equal(result.status, "partial");
    assert.equal(result.rows[0].status, "unavailable");
    assert.equal(result.rows[0].reason, "observed_outcome_mismatch");
  });

  it("forbids turning the short non-overlapping diagnostic into model selection", () => {
    const policy = SIMULATION_OWNER_MODEL_CALIBRATION_POLICY;

    assert.equal(policy.maximumEndpointCount, 7);
    assert.equal(policy.outcomeWindowOverlap, "forbidden_by_service_date_stride");
    assert.equal(policy.statisticalConfidence, "not_established");
    assert.equal(policy.modelSelection, "forbidden");
    assert.equal(policy.probabilityAveraging, "forbidden");
    assert.equal(policy.persistence, "forbidden");
    assert.equal(policy.recommendation, "forbidden");
  });
});

function validationFixture(model) {
  const endpoints = [
    {
      outcomeStartServiceDate: "2026-01-01",
      outcomeEndServiceDate: "2026-01-21",
      actualReturnPct: 2,
      actualTerminalLoss: false,
      actualMaxDrawdownPct: 3,
      bootstrapP50: 1,
      factorP50: 1.5,
      bootstrapLoss: 20,
      factorLoss: 10,
    },
    {
      outcomeStartServiceDate: "2026-01-21",
      outcomeEndServiceDate: "2026-02-11",
      actualReturnPct: -1,
      actualTerminalLoss: true,
      actualMaxDrawdownPct: 5,
      bootstrapP50: 0,
      factorP50: -1.5,
      bootstrapLoss: 70,
      factorLoss: 80,
    },
    {
      outcomeStartServiceDate: "2026-02-11",
      outcomeEndServiceDate: "2026-03-04",
      actualReturnPct: 4,
      actualTerminalLoss: false,
      actualMaxDrawdownPct: 2,
      bootstrapP50: 3,
      factorP50: 3.5,
      bootstrapLoss: 30,
      factorLoss: 10,
    },
  ];
  return {
    status: "ready",
    account: "all",
    weights: weights(),
    rows: endpoints.map((row) => readyRow(row, model)),
  };
}

function readyRow(input, model) {
  const predictedP50ReturnPct =
    model === "bootstrap" ? input.bootstrapP50 : input.factorP50;
  const predictedLossProbabilityPct =
    model === "bootstrap" ? input.bootstrapLoss : input.factorLoss;
  return {
    status: "ready",
    reason: null,
    outcomeEndServiceDate: input.outcomeEndServiceDate,
    trainingEndServiceDate: "2025-12-31",
    outcomeStartServiceDate: input.outcomeStartServiceDate,
    trainingReturnStepCount: 90,
    outcomeReturnStepCount: 21,
    actualReturnPct: input.actualReturnPct,
    actualTerminalLoss: input.actualTerminalLoss,
    actualMaxDrawdownPct: input.actualMaxDrawdownPct,
    predictedP10ReturnPct: -3,
    predictedP50ReturnPct,
    predictedP90ReturnPct: 5,
    absoluteP50ErrorPctPoints: Math.abs(
      input.actualReturnPct - predictedP50ReturnPct,
    ),
    inP10P90Band: input.actualReturnPct >= -3 && input.actualReturnPct <= 5,
    predictedLossProbabilityPct,
    predictedMaxDrawdownP50Pct: input.actualMaxDrawdownPct + 0.5,
    absoluteMddP50ErrorPctPoints: 0.5,
    factorAlignedObservationCount: 89,
    factorObservationCoveragePct: 98.89,
  };
}

function unavailableRow(outcomeEndServiceDate) {
  return {
    status: "unavailable",
    reason: "factor_model_unavailable",
    outcomeEndServiceDate,
  };
}

function weights() {
  return [
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
  ];
}
