import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SIMULATION_WALK_FORWARD_STABILITY_HISTORY_POLICY,
  buildSimulationWalkForwardStabilityHistory,
} from "../src/lib/simulation-walk-forward-stability-history.ts";
import { readyJointMatrix } from "./support/simulation-ready-joint-matrix.mjs";

describe("Walk-forward minimum-volatility stability history", () => {
  it("reuses the fixed v1 policy across seven exact overlapping endpoints", () => {
    const endpoints = readyEndpoints();
    const result = buildSimulationWalkForwardStabilityHistory({
      explicitEndServiceDate: endpoints[0].serviceDate,
      endpoints,
    });

    assert.equal(result.status, "ready");
    assert.equal(
      SIMULATION_WALK_FORWARD_STABILITY_HISTORY_POLICY.endpointCount,
      7,
    );
    assert.deepEqual(result.summary, {
      endpointCount: 7,
      readyEndpointCount: 7,
      unavailableEndpointCount: 0,
    });
    assert.deepEqual(
      result.rows.map((row) => row.serviceDate),
      endpoints.map((row) => row.serviceDate),
    );
    assert.ok(result.rows.every((row) => row.status === "ready"));
    assert.ok(result.rows.every((row) => row.foldKodexWeightBps.length === 3));
    assert.equal(
      result.policy.executionPolicy,
      "reuse_walk_forward_minimum_volatility_research_v1",
    );
    assert.equal(
      result.policy.overlapDisclosure,
      "overlapping_windows_not_independent_trials",
    );
  });

  it("preserves ready endpoint rows when one exact endpoint is unavailable", () => {
    const endpoints = readyEndpoints();
    endpoints[3] = {
      ...endpoints[3],
      matrix: { ...endpoints[3].matrix, status: "incomplete" },
    };
    const result = buildSimulationWalkForwardStabilityHistory({
      explicitEndServiceDate: endpoints[0].serviceDate,
      endpoints,
    });

    assert.equal(result.status, "partial");
    assert.equal(result.reason, "some_endpoints_unavailable");
    assert.equal(result.summary.readyEndpointCount, 6);
    assert.equal(result.summary.unavailableEndpointCount, 1);
    assert.equal(result.rows[3].status, "unavailable");
    assert.equal(result.rows[3].reason, "input_matrix_unavailable");
    assert.ok(result.rows[2].annualizedVolatilityPct !== null);
    assert.ok(result.rows[4].annualizedVolatilityPct !== null);
  });

  it("does not let one endpoint matrix change another endpoint result", () => {
    const leftEndpoints = readyEndpoints();
    const rightEndpoints = readyEndpoints();
    rightEndpoints[0] = {
      ...rightEndpoints[0],
      matrix: readyJointMatrix({
        endServiceDate: rightEndpoints[0].serviceDate,
        override: new Map([[60, [0.5, -0.2]]]),
      }),
    };
    const left = buildSimulationWalkForwardStabilityHistory({
      explicitEndServiceDate: leftEndpoints[0].serviceDate,
      endpoints: leftEndpoints,
    });
    const right = buildSimulationWalkForwardStabilityHistory({
      explicitEndServiceDate: rightEndpoints[0].serviceDate,
      endpoints: rightEndpoints,
    });

    assert.equal(left.status, "ready");
    assert.equal(right.status, "ready");
    assert.notEqual(
      left.rows[0].outOfSampleReturnPct,
      right.rows[0].outOfSampleReturnPct,
    );
    assert.deepEqual(left.rows.slice(1), right.rows.slice(1));
  });

  it("retains all exact endpoint rows when every matrix is unavailable", () => {
    const endpoints = readyEndpoints().map((endpoint) => ({
      ...endpoint,
      matrix: null,
    }));
    const result = buildSimulationWalkForwardStabilityHistory({
      explicitEndServiceDate: endpoints[0].serviceDate,
      endpoints,
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "all_endpoints_unavailable");
    assert.equal(result.rows.length, 7);
    assert.equal(result.summary.readyEndpointCount, 0);
    assert.equal(result.summary.unavailableEndpointCount, 7);
    assert.ok(result.rows.every((row) => row.status === "unavailable"));
  });

  it("requires an explicit exact seven-date endpoint set", () => {
    const endpoints = readyEndpoints();
    const missingExplicit = buildSimulationWalkForwardStabilityHistory({
      explicitEndServiceDate: null,
      endpoints,
    });
    const missingRow = buildSimulationWalkForwardStabilityHistory({
      explicitEndServiceDate: endpoints[0].serviceDate,
      endpoints: endpoints.slice(0, 6),
    });
    const reordered = buildSimulationWalkForwardStabilityHistory({
      explicitEndServiceDate: endpoints[0].serviceDate,
      endpoints: [...endpoints].reverse(),
    });

    assert.equal(missingExplicit.reason, "explicit_end_required");
    assert.equal(missingRow.reason, "endpoint_set_mismatch");
    assert.equal(reordered.reason, "endpoint_set_mismatch");
    assert.equal(missingRow.rows.length, 0);
  });

  it("keeps the diagnostic free of ranking and portfolio authority", () => {
    const endpoints = readyEndpoints();
    const result = buildSimulationWalkForwardStabilityHistory({
      explicitEndServiceDate: endpoints[0].serviceDate,
      endpoints,
    });
    const serialized = JSON.stringify(result);

    assert.equal(result.runtimeTrustStatus, "research_only");
    assert.equal(result.policy.endpointRanking, "forbidden");
    assert.equal(result.policy.hyperparameterSelection, "forbidden");
    assert.equal(result.policy.accountBinding, "forbidden");
    assert.equal(result.policy.recommendation, "forbidden");
    assert.doesNotMatch(
      serialized,
      /bestEndpoint|selectedEndpoint|owner|holding|targetWeight|orderAuthority/,
    );
  });
});

function readyEndpoints() {
  return Array.from({ length: 7 }, (_, index) => {
    const serviceDate = shiftDate("2025-04-10", -index);
    return {
      serviceDate,
      matrix: readyJointMatrix({ endServiceDate: serviceDate }),
    };
  });
}

function shiftDate(value, offset) {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return new Date(timestamp + offset * 86_400_000).toISOString().slice(0, 10);
}
