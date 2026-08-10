import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSimulationOwnerFactorHistoricalValidation,
  SIMULATION_OWNER_FACTOR_HISTORICAL_VALIDATION_POLICY,
} from "../src/lib/simulation-owner-factor-historical-validation.ts";
import {
  buildSimulationOwnerHistoricalValidationEndpointDates,
  SIMULATION_OWNER_HISTORICAL_VALIDATION_POLICY,
} from "../src/lib/simulation-owner-historical-outcome-validation.ts";
import { PRIVATE_OWNER_RAW_CLOSE_SIMULATION_RETURN_MATRIX_POLICY } from "../src/lib/simulation-return-matrix.ts";
import { readyJointMatrix } from "./support/simulation-ready-joint-matrix.mjs";

describe("owner factor model historical validation", () => {
  it("evaluates the same seven non-overlapping 90-plus-21 windows as the bootstrap model", () => {
    const execution = readyExecution();
    const availableServiceDates = serviceDateAxis(
      execution.endSelection.endServiceDate,
    );
    const endpoints = readyEndpoints(
      execution.endSelection.endServiceDate,
      availableServiceDates,
    );
    const result = buildSimulationOwnerFactorHistoricalValidation({
      execution,
      availableServiceDates,
      endpoints,
      factorRows: factorRowsForEndpoints(endpoints),
    });

    assert.equal(result.status, "ready");
    assert.equal(result.rows.length, 7);
    assert.equal(result.summary.readyEndpointCount, 7);
    assert.ok(
      result.rows.every(
        (row) =>
          row.status === "ready" &&
          row.trainingReturnStepCount === 90 &&
          row.outcomeReturnStepCount === 21 &&
          row.factorAlignedObservationCount >= 45,
      ),
    );
  });

  it("keeps the other endpoint diagnostics when one source window is absent", () => {
    const execution = readyExecution();
    const availableServiceDates = serviceDateAxis(
      execution.endSelection.endServiceDate,
    );
    const endpoints = readyEndpoints(
      execution.endSelection.endServiceDate,
      availableServiceDates,
    );
    endpoints[3] = { ...endpoints[3], matrix: null };
    const result = buildSimulationOwnerFactorHistoricalValidation({
      execution,
      availableServiceDates,
      endpoints,
      factorRows: factorRowsForEndpoints(endpoints),
    });

    assert.equal(result.status, "partial");
    assert.equal(result.summary.readyEndpointCount, 6);
    assert.equal(result.rows[3].status, "unavailable");
    assert.equal(result.rows[3].reason, "input_matrix_unavailable");
  });

  it("does not let observations released after a training state alter its result", () => {
    const execution = readyExecution();
    const availableServiceDates = serviceDateAxis(
      execution.endSelection.endServiceDate,
    );
    const endpoints = readyEndpoints(
      execution.endSelection.endServiceDate,
      availableServiceDates,
    );
    const baseRows = factorRowsForEndpoints(endpoints);
    const first = buildSimulationOwnerFactorHistoricalValidation({
      execution,
      availableServiceDates,
      endpoints,
      factorRows: baseRows,
    });
    const withFutureRows = buildSimulationOwnerFactorHistoricalValidation({
      execution,
      availableServiceDates,
      endpoints,
      factorRows: [
        ...baseRows,
        factorRow("usdkrw", "2027-01-01", 99_999),
        factorRow("us_10y_yield", "2027-01-01", 99),
        factorRow("us_10y2y_curve", "2027-01-01", -99),
      ],
    });

    assert.deepEqual(withFutureRows.rows, first.rows);
  });

  it("pins the non-ranking, non-writing research boundary", () => {
    const policy = SIMULATION_OWNER_FACTOR_HISTORICAL_VALIDATION_POLICY;

    assert.equal(policy.factorVintageAuthority, "not_preserved");
    assert.equal(policy.overlappingOutcomeWindows, "forbidden_by_service_date_stride");
    assert.equal(policy.providerCalls, "forbidden");
    assert.equal(policy.persistence, "forbidden");
    assert.equal(policy.optimizer, "forbidden");
    assert.equal(policy.recommendation, "forbidden");
  });
});

function readyExecution() {
  return {
    status: "ready",
    account: "all",
    endSelection: {
      status: "valid",
      source: "latest_common_stored",
      endServiceDate: "2026-08-04",
    },
    coverage: {
      candidateCurrentValueKrw: 10_000,
      modeledCurrentValueKrw: 10_000,
      modeledCurrentValuePct: 100,
      modeledOriginalWeightBps: 10_000,
      omittedWeightBps: 0,
      manualHistoryWeightBps: 0,
      zeroWeightRowCount: 0,
      modeledInstrumentCount: 2,
      candidateInstrumentCount: 2,
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

function readyEndpoints(endServiceDate, availableServiceDates) {
  return buildSimulationOwnerHistoricalValidationEndpointDates(
    endServiceDate,
    availableServiceDates,
  ).map((outcomeEndServiceDate) => ({
      outcomeEndServiceDate,
      matrix: {
        ...readyJointMatrix({
          endServiceDate: outcomeEndServiceDate,
          returnStepCount:
            SIMULATION_OWNER_HISTORICAL_VALIDATION_POLICY.sourceReturnStepCount,
        }),
        policy: PRIVATE_OWNER_RAW_CLOSE_SIMULATION_RETURN_MATRIX_POLICY,
      },
    }));
}

function serviceDateAxis(
  endServiceDate,
  count =
    SIMULATION_OWNER_HISTORICAL_VALIDATION_POLICY.sourceReturnStepCount +
    SIMULATION_OWNER_HISTORICAL_VALIDATION_POLICY.outcomeReturnStepCount *
      (SIMULATION_OWNER_HISTORICAL_VALIDATION_POLICY.maximumEndpointCount - 1) +
    1,
) {
  const end = Date.parse(`${endServiceDate}T00:00:00.000Z`);
  return Array.from({ length: count }, (_, index) =>
    new Date(end - (count - index - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10),
  );
}

function factorRowsForEndpoints(endpoints) {
  const dates = new Set(
    endpoints.flatMap((endpoint) => endpoint.matrix?.requestedServiceDates ?? []),
  );
  return [...dates].sort().flatMap((date, index) => [
    factorRow("usdkrw", date, 1_300 + index * 0.7),
    factorRow("us_10y_yield", date, 4 + Math.sin(index / 7) * 0.08),
    factorRow("us_10y2y_curve", date, 0.2 + Math.cos(index / 9) * 0.04),
  ]);
}

function factorRow(factorKey, date, value) {
  return {
    factorKey,
    factorDate: date,
    periodEndDate: date,
    releaseDate: date,
    value,
    volatility20dPct: 1,
  };
}
