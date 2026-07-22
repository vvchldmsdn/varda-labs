import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SIMULATION_FAN_BAND_VALIDATION_POLICY,
  SIMULATION_DOWNSIDE_OUTCOME_VALIDATION_POLICY,
  buildSimulationHistoricalOutcomeValidation,
} from "../src/lib/simulation-historical-outcome-validation.ts";
import { executeSimulationResearchPaths } from "../src/lib/simulation-research-execution-core.ts";
import { readyJointMatrix } from "./support/simulation-ready-joint-matrix.mjs";

describe("Stationary historical outcome validation", () => {
  it("scores seven exact endpoints with 90 training and 63 observed rows", () => {
    const endpoints = readyEndpoints();
    const result = buildSimulationHistoricalOutcomeValidation({
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
    assert.deepEqual(result.downsideSummary, {
      readyEndpointCount: 7,
      unavailableEndpointCount: 0,
      meanPredictedLossProbabilityPct: 0,
      actualLossEndpointCount: 0,
      actualWithinPredictedMddP90Count: 7,
      meanAbsoluteMddP50ErrorPctPoints: 0,
    });
    assert.ok(
      result.rows.every(
        (row) =>
          row.status === "ready" &&
          row.trainingReturnStepCount === 90 &&
          row.outcomeReturnStepCount === 63 &&
          row.actualReturnPct === 0 &&
          row.inP10P90Band === true &&
          row.predictedLossProbabilityPct === 0 &&
          row.actualTerminalLoss === false &&
          row.predictedMaxDrawdownP50Pct === 0 &&
          row.predictedMaxDrawdownP90Pct === 0 &&
          row.actualMaxDrawdownPct === 0 &&
          row.actualWithinPredictedMddP90 === true,
      ),
    );
  });

  it("scores the approved 126-row outcome horizon from an exact 216-row source", () => {
    const endpoints = readyEndpoints(126);
    const result = buildSimulationHistoricalOutcomeValidation({
      explicitEndServiceDate: endpoints[0].outcomeEndServiceDate,
      endpoints,
      horizon: 126,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.horizon, 126);
    assert.equal(result.policy.outcomeReturnStepCount, 126);
    assert.equal(result.policy.sourceReturnStepCount, 216);
    assert.equal(result.policy.crossHorizonRanking, "forbidden");
    assert.equal(result.downsidePolicy.crossHorizonRanking, "forbidden");
    assert.ok(
      result.rows.every(
        (row) =>
          row.status === "ready" &&
          row.trainingReturnStepCount === 90 &&
          row.outcomeReturnStepCount === 126,
      ),
    );
  });

  it("blocks an invalid horizon before evaluating endpoint evidence", () => {
    const result = buildSimulationHistoricalOutcomeValidation({
      explicitEndServiceDate: "2026-07-09",
      endpoints: readyEndpoints(),
      horizon: null,
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "invalid_horizon_selection");
    assert.equal(result.horizon, null);
    assert.equal(result.policy, null);
    assert.deepEqual(result.rows, []);
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

    const baseline = buildSimulationHistoricalOutcomeValidation({
      explicitEndServiceDate: baselineEndpoints[0].outcomeEndServiceDate,
      endpoints: baselineEndpoints,
    });
    const changed = buildSimulationHistoricalOutcomeValidation({
      explicitEndServiceDate: changedEndpoints[0].outcomeEndServiceDate,
      endpoints: changedEndpoints,
    });

    assert.equal(baseline.status, "ready");
    assert.equal(changed.status, "ready");
    assert.equal(
      changed.rows[0].predictedP50ReturnPct,
      baseline.rows[0].predictedP50ReturnPct,
    );
    assert.equal(
      changed.rows[0].predictedLossProbabilityPct,
      baseline.rows[0].predictedLossProbabilityPct,
    );
    assert.equal(
      changed.rows[0].predictedMaxDrawdownP90Pct,
      baseline.rows[0].predictedMaxDrawdownP90Pct,
    );
    assert.ok(changed.rows[0].actualReturnPct > 0);
    assert.equal(changed.rows[0].inP10P90Band, false);
    assert.deepEqual(changed.rows.slice(1), baseline.rows.slice(1));
  });

  it("matches the existing full research engine terminal and MDD summaries", () => {
    const fullMatrix = readyJointMatrix({
      endServiceDate: "2026-07-09",
      returnStepCount: 153,
    });
    const endpoints = readyEndpoints();
    endpoints[0] = {
      outcomeEndServiceDate: "2026-07-09",
      matrix: fullMatrix,
    };
    const result = buildSimulationHistoricalOutcomeValidation({
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
    assertApprox(
      result.rows[0].predictedLossProbabilityPct,
      execution.terminal.lossProbabilityPct,
    );
    assertApprox(
      result.rows[0].predictedMaxDrawdownP50Pct,
      execution.terminal.maxDrawdownP50Pct,
    );
    assertApprox(
      result.rows[0].predictedMaxDrawdownP90Pct,
      execution.terminal.maxDrawdownP90Pct,
    );
  });

  it("compares predicted downside with the exact following observed path", () => {
    const endpoints = readyEndpoints();
    endpoints[0] = {
      ...endpoints[0],
      matrix: zeroMatrix(endpoints[0].outcomeEndServiceDate, [
        [90, [0.1, 0.1]],
        [91, [-0.2, -0.2]],
      ]),
    };
    const result = buildSimulationHistoricalOutcomeValidation({
      explicitEndServiceDate: endpoints[0].outcomeEndServiceDate,
      endpoints,
    });
    const row = result.rows[0];

    assert.equal(row.status, "ready");
    assert.equal(row.predictedLossProbabilityPct, 0);
    assert.equal(row.predictedMaxDrawdownP50Pct, 0);
    assert.equal(row.predictedMaxDrawdownP90Pct, 0);
    assert.equal(row.actualTerminalLoss, true);
    assertApprox(row.actualReturnPct, -12);
    assertApprox(row.actualMaxDrawdownPct, 20);
    assert.equal(row.actualWithinPredictedMddP90, false);
    assertApprox(row.signedMddP50ErrorPctPoints, 20);
  });

  it("preserves ready rows when one endpoint is unavailable", () => {
    const endpoints = readyEndpoints();
    endpoints[3] = { ...endpoints[3], matrix: null };
    const result = buildSimulationHistoricalOutcomeValidation({
      explicitEndServiceDate: endpoints[0].outcomeEndServiceDate,
      endpoints,
    });

    assert.equal(result.status, "partial");
    assert.equal(result.reason, "some_endpoints_unavailable");
    assert.equal(result.summary.readyEndpointCount, 6);
    assert.equal(result.summary.unavailableEndpointCount, 1);
    assert.equal(result.downsideSummary.readyEndpointCount, 6);
    assert.equal(result.downsideSummary.unavailableEndpointCount, 1);
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
    const result = buildSimulationHistoricalOutcomeValidation({
      explicitEndServiceDate: endpoints[0].outcomeEndServiceDate,
      endpoints,
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "all_endpoints_unavailable");
    assert.equal(result.rows.length, 7);
    assert.equal(result.summary.readyEndpointCount, 0);
    assert.equal(result.summary.bandCoveragePct, null);
    assert.equal(result.downsideSummary.meanPredictedLossProbabilityPct, null);
  });

  it("requires one explicit exact seven-date endpoint set", () => {
    const endpoints = readyEndpoints();
    const missingExplicit = buildSimulationHistoricalOutcomeValidation({
      explicitEndServiceDate: null,
      endpoints,
    });
    const missingRow = buildSimulationHistoricalOutcomeValidation({
      explicitEndServiceDate: endpoints[0].outcomeEndServiceDate,
      endpoints: endpoints.slice(0, 6),
    });
    const reordered = buildSimulationHistoricalOutcomeValidation({
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
    const result = buildSimulationHistoricalOutcomeValidation({
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
    assert.equal(
      SIMULATION_DOWNSIDE_OUTCOME_VALIDATION_POLICY.calibrationPassFail,
      "forbidden",
    );
    assert.equal(
      SIMULATION_DOWNSIDE_OUTCOME_VALIDATION_POLICY.modelRanking,
      "forbidden",
    );
    assert.doesNotMatch(
      serialized,
      /bestEndpoint|selectedEndpoint|owner|holding|targetWeight|orderAuthority/,
    );
  });
});

function readyEndpoints(horizon = 63) {
  return Array.from({ length: 7 }, (_, index) => {
    const outcomeEndServiceDate = shiftDate("2026-07-09", -index);
    return {
      outcomeEndServiceDate,
      matrix: zeroMatrix(outcomeEndServiceDate, [], horizon),
    };
  });
}

function zeroMatrix(outcomeEndServiceDate, changedRows = [], horizon = 63) {
  const returnStepCount = 90 + horizon;
  return readyJointMatrix({
    endServiceDate: outcomeEndServiceDate,
    override: new Map([
      ...Array.from({ length: returnStepCount }, (_, index) => [index, [0, 0]]),
      ...changedRows,
    ]),
    returnStepCount,
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
