import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSimulationOwnerEconomicValidation } from "../src/lib/simulation-owner-economic-validation.ts";
import { buildSimulationOwnerHistoricalValidationEndpointDates } from "../src/lib/simulation-owner-historical-outcome-validation.ts";
import { PRIVATE_OWNER_RAW_CLOSE_SIMULATION_RETURN_MATRIX_POLICY } from "../src/lib/simulation-return-matrix.ts";
import { readyJointMatrix } from "./support/simulation-ready-joint-matrix.mjs";

describe("economic model and candidate temporal validation", () => {
  it("uses at most three non-overlapping 90→21 folds and compares both model distributions", () => {
    const result = buildSimulationOwnerEconomicValidation(fixture());
    assert.equal(result.status, "ready");
    assert.equal(result.rows.length, 3);
    assert.equal(result.summary.pairedModelEndpointCount, 3);
    assert.ok(result.rows.every((row) => row.source.trainingReturnStepCount === 90 && row.source.outcomeReturnStepCount === 21));
    for (const row of result.rows) {
      assert.equal(row.source.stateAsOfServiceDate, row.trainingEndServiceDate);
      assert.ok(row.trainingEndServiceDate < row.outcomeStartServiceDate);
      assert.equal(row.models.baseline.actualReturnPct, row.models.economic.actualReturnPct);
      assert.ok(row.models.economic.lossBrierScore >= 0 && row.models.economic.lossBrierScore <= 1);
      assert.ok(row.models.baseline.lossBrierScore >= 0 && row.models.baseline.lossBrierScore <= 1);
    }
    const chronological = [...result.rows].reverse();
    assert.ok(chronological.slice(1).every((row, i) => row.outcomeStartServiceDate > chronological[i].outcomeEndServiceDate));
  });

  it("keeps fitted predictions and selected weights invariant to future releases and observed test returns", () => {
    const input = fixture();
    const first = buildSimulationOwnerEconomicValidation(input);
    const endpoint = input.endpoints[0];
    const changed = {
      ...input,
      factorRows: [...input.factorRows, ...factorRows(["2027-01-01"])],
      endpoints: [{ ...endpoint, matrix: { ...endpoint.matrix, matrix: endpoint.matrix.matrix.map((row, index) => index < 90 ? row : {
        ...row, cells: row.cells.map((cell, asset) => ({ ...cell, value: asset === 0 ? .04 : -.03 })),
      }) } }, ...input.endpoints.slice(1)],
    };
    const second = buildSimulationOwnerEconomicValidation(changed);
    assert.equal(first.rows[0].status, "ready");
    assert.equal(second.rows[0].status, "ready");
    assert.equal(second.rows[0].models.economic.predictedP50ReturnPct, first.rows[0].models.economic.predictedP50ReturnPct);
    assert.equal(second.rows[0].models.baseline.predictedP50ReturnPct, first.rows[0].models.baseline.predictedP50ReturnPct);
    assert.ok(first.rows[0].candidates.length > 0, "training data should produce a confirmed candidate");
    assert.deepEqual(second.rows[0].candidates.map((row) => row.weights), first.rows[0].candidates.map((row) => row.weights));
    assert.notEqual(second.rows[0].currentObserved.terminalReturnPct, first.rows[0].currentObserved.terminalReturnPct);
    assert.ok(second.rows[0].candidates.some((row) => row.actualReturnDeltaPctPoints < 0), "retain candidates even when actual out-of-sample performance worsens");
    assert.deepEqual(second.rows.slice(1), first.rows.slice(1));
  });

  it("preserves other folds when one is missing and rejects mismatched dates or metadata", () => {
    const input = fixture();
    const partial = buildSimulationOwnerEconomicValidation({ ...input, endpoints: input.endpoints.map((row, i) => i === 1 ? { ...row, matrix: null } : row) });
    assert.equal(partial.status, "partial");
    assert.equal(partial.summary.readyEndpointCount, 2);
    const mismatch = buildSimulationOwnerEconomicValidation({ ...input, endpoints: [...input.endpoints].reverse() });
    assert.equal(mismatch.reason, "endpoint_set_mismatch");
    const changed = structuredClone(input);
    changed.endpoints[0].matrix.instruments[0].currency = "USD";
    const identity = buildSimulationOwnerEconomicValidation(changed);
    assert.equal(identity.rows[0].reason, "input_matrix_shape_mismatch");
  });

  it("does not manufacture observed validation for a short history", () => {
    const input = fixture();
    const result = buildSimulationOwnerEconomicValidation({ ...input, availableServiceDates: input.availableServiceDates.slice(-92), endpoints: [] });
    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "insufficient_history");
    assert.equal(result.summary.economic.bandCoveragePct, null);
    assert.equal(result.summary.baseline.meanLossBrierScore, null);
    assert.deepEqual(result.rows, []);
  });
});

function fixture() {
  const end = Date.parse("2026-08-04T00:00:00Z");
  const availableServiceDates = Array.from({ length: 238 }, (_, i) => new Date(end - (237 - i) * 86400000).toISOString().slice(0, 10));
  const endpointDates = buildSimulationOwnerHistoricalValidationEndpointDates("2026-08-04", availableServiceDates);
  const endpoints = endpointDates.map((outcomeEndServiceDate) => ({
    outcomeEndServiceDate,
    matrix: {
      ...readyJointMatrix({ endServiceDate: outcomeEndServiceDate, returnStepCount: 111,
        override: new Map(Array.from({ length: 111 }, (_, i) => [i, [-.001 + Math.sin(i) * .0005, .002 + Math.cos(i) * .0005]])),
      }),
      policy: PRIVATE_OWNER_RAW_CLOSE_SIMULATION_RETURN_MATRIX_POLICY,
    },
  }));
  const execution = {
    status: "ready", account: "all",
    endSelection: { status: "valid", endServiceDate: "2026-08-04" },
    executionWeights: endpoints[0].matrix.instruments.map((row, i) => ({ ...row, weightBps: i === 0 ? 6000 : 4000 })),
  };
  return { execution, availableServiceDates, endpoints, factorRows: factorRows(availableServiceDates) };
}

function factorRows(dates) {
  return dates.flatMap((date, i) => [
    ["usdkrw", 1300 + i * .4 + Math.sin(i / 7) * 3],
    ["us_10y_yield", 4 + Math.sin(i / 9) * .08],
    ["us_10y2y_curve", .2 + Math.cos(i / 11) * .04],
  ].map(([factorKey, value]) => ({ factorKey, factorDate: date, periodEndDate: date, releaseDate: date, value, volatility20dPct: 1 })));
}
