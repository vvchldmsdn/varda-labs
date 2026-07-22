import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SIMULATION_FAN_BAND_VALIDATION_POLICY,
  buildSimulationFanBandValidationHistory,
} from "../src/lib/simulation-fan-band-validation.ts";
import { executeSimulationResearchPaths } from "../src/lib/simulation-research-execution-core.ts";
import { readyJointMatrix } from "./support/simulation-ready-joint-matrix.mjs";

describe("Stationary fan-band validation history", () => {
  it("scores seven exact endpoints with 90 training and 63 observed rows", () => {
    const endpoints = readyEndpoints();
    const result = buildSimulationFanBandValidationHistory({
      explicitEndServiceDate: endpoints[0].outcomeEndServiceDate,
      endpoints,
    });

    assert.equal(result.status, "ready");
    assert.deepEqual(result.summary, {
      endpointCount: 7,
      readyEndpointCount: 7,
      unavailableEndpointCount: 0,
      bandHitCount: 7,
      bandCoveragePct: 100,
      meanAbsoluteP50ErrorPctPoints: 0,
    });
    assert.ok(
      result.rows.every(
        (row) =>
          row.status === "ready" &&
          row.trainingReturnStepCount === 90 &&
          row.outcomeReturnStepCount === 63 &&
          row.actualReturnPct === 0 &&
          row.inP10P90Band === true,
      ),
    );
  });

  it("uses only pre-cutoff rows for the predicted distribution", () => {
    const baselineEndpoints = readyEndpoints();
    const changedEndpoints = readyEndpoints();
    changedEndpoints[0] = {
      ...changedEndpoints[0],
      matrix: zeroMatrix(changedEndpoints[0].outcomeEndServiceDate, [
        [90, [0.1, 0]],
      ]),
    };

    const baseline = buildSimulationFanBandValidationHistory({
      explicitEndServiceDate: baselineEndpoints[0].outcomeEndServiceDate,
      endpoints: baselineEndpoints,
    });
    const changed = buildSimulationFanBandValidationHistory({
      explicitEndServiceDate: changedEndpoints[0].outcomeEndServiceDate,
      endpoints: changedEndpoints,
    });

    assert.equal(baseline.status, "ready");
    assert.equal(changed.status, "ready");
    assert.equal(
      changed.rows[0].predictedP50ReturnPct,
      baseline.rows[0].predictedP50ReturnPct,
    );
    assert.ok(changed.rows[0].actualReturnPct > 0);
    assert.equal(changed.rows[0].inP10P90Band, false);
    assert.deepEqual(changed.rows.slice(1), baseline.rows.slice(1));
  });

  it("matches the existing full research engine terminal quantiles", () => {
    const fullMatrix = readyJointMatrix({
      endServiceDate: "2026-07-09",
      returnStepCount: 153,
    });
    const endpoints = readyEndpoints();
    endpoints[0] = {
      outcomeEndServiceDate: "2026-07-09",
      matrix: fullMatrix,
    };
    const result = buildSimulationFanBandValidationHistory({
      explicitEndServiceDate: "2026-07-09",
      endpoints,
    });
    const trainingEndServiceDate = fullMatrix.requestedServiceDates[90];
    const trainingMatrix = readyJointMatrix({
      endServiceDate: trainingEndServiceDate,
    });
    const execution = executeSimulationResearchPaths({
      matrix: trainingMatrix,
      scenarioId: "research-kodex-voo-equal-mix-fan-band-validation",
      scenarioVersion: "v1",
      weights: trainingMatrix.instruments.map((instrument) => ({
        ...instrument,
        weightBps: 5_000,
      })),
      seed: SIMULATION_FAN_BAND_VALIDATION_POLICY.seed,
      expectedBlockLength:
        SIMULATION_FAN_BAND_VALIDATION_POLICY.expectedBlockLength,
      horizon: SIMULATION_FAN_BAND_VALIDATION_POLICY.outcomeReturnStepCount,
      pathCount: SIMULATION_FAN_BAND_VALIDATION_POLICY.pathCount,
      samplePathCount: 1,
    });

    assert.equal(result.rows[0].status, "ready");
    assert.equal(execution.status, "ready");
    assertApprox(
      result.rows[0].predictedP10ReturnPct,
      execution.terminal.p10Index - 100,
    );
    assertApprox(
      result.rows[0].predictedP50ReturnPct,
      execution.terminal.p50Index - 100,
    );
    assertApprox(
      result.rows[0].predictedP90ReturnPct,
      execution.terminal.p90Index - 100,
    );
  });

  it("preserves ready rows when one endpoint is unavailable", () => {
    const endpoints = readyEndpoints();
    endpoints[3] = { ...endpoints[3], matrix: null };
    const result = buildSimulationFanBandValidationHistory({
      explicitEndServiceDate: endpoints[0].outcomeEndServiceDate,
      endpoints,
    });

    assert.equal(result.status, "partial");
    assert.equal(result.reason, "some_endpoints_unavailable");
    assert.equal(result.summary.readyEndpointCount, 6);
    assert.equal(result.summary.unavailableEndpointCount, 1);
    assert.equal(result.rows.length, 7);
    assert.equal(result.rows[3].status, "unavailable");
    assert.equal(result.rows[3].reason, "input_matrix_unavailable");
    assert.ok(result.rows[2].actualReturnPct !== null);
    assert.ok(result.rows[4].actualReturnPct !== null);
  });

  it("retains all endpoint rows when every matrix is unavailable", () => {
    const endpoints = readyEndpoints().map((endpoint) => ({
      ...endpoint,
      matrix: null,
    }));
    const result = buildSimulationFanBandValidationHistory({
      explicitEndServiceDate: endpoints[0].outcomeEndServiceDate,
      endpoints,
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "all_endpoints_unavailable");
    assert.equal(result.rows.length, 7);
    assert.equal(result.summary.readyEndpointCount, 0);
    assert.equal(result.summary.bandCoveragePct, null);
  });

  it("requires one explicit exact seven-date endpoint set", () => {
    const endpoints = readyEndpoints();
    const missingExplicit = buildSimulationFanBandValidationHistory({
      explicitEndServiceDate: null,
      endpoints,
    });
    const missingRow = buildSimulationFanBandValidationHistory({
      explicitEndServiceDate: endpoints[0].outcomeEndServiceDate,
      endpoints: endpoints.slice(0, 6),
    });
    const reordered = buildSimulationFanBandValidationHistory({
      explicitEndServiceDate: endpoints[0].outcomeEndServiceDate,
      endpoints: [...endpoints].reverse(),
    });

    assert.equal(missingExplicit.reason, "explicit_end_required");
    assert.equal(missingRow.reason, "endpoint_set_mismatch");
    assert.equal(reordered.reason, "endpoint_set_mismatch");
    assert.equal(missingRow.rows.length, 0);
  });

  it("keeps the diagnostic free of account authority and tuning", () => {
    const endpoints = readyEndpoints();
    const result = buildSimulationFanBandValidationHistory({
      explicitEndServiceDate: endpoints[0].outcomeEndServiceDate,
      endpoints,
    });
    const serialized = JSON.stringify(result);

    assert.equal(result.runtimeTrustStatus, "research_only");
    assert.equal(
      SIMULATION_FAN_BAND_VALIDATION_POLICY.hyperparameterSelection,
      "forbidden",
    );
    assert.equal(
      SIMULATION_FAN_BAND_VALIDATION_POLICY.accountBinding,
      "forbidden",
    );
    assert.equal(
      SIMULATION_FAN_BAND_VALIDATION_POLICY.providerBackfill,
      "forbidden",
    );
    assert.doesNotMatch(
      serialized,
      /bestEndpoint|selectedEndpoint|owner|holding|targetWeight|orderAuthority/,
    );
  });
});

function readyEndpoints() {
  return Array.from({ length: 7 }, (_, index) => {
    const outcomeEndServiceDate = shiftDate("2026-07-09", -index);
    return {
      outcomeEndServiceDate,
      matrix: zeroMatrix(outcomeEndServiceDate),
    };
  });
}

function zeroMatrix(outcomeEndServiceDate, changedRows = []) {
  return readyJointMatrix({
    endServiceDate: outcomeEndServiceDate,
    override: new Map([
      ...Array.from({ length: 153 }, (_, index) => [index, [0, 0]]),
      ...changedRows,
    ]),
    returnStepCount: 153,
  });
}

function shiftDate(value, offset) {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return new Date(timestamp + offset * 86_400_000).toISOString().slice(0, 10);
}

function assertApprox(actual, expected, tolerance = 1e-10) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );
}
