import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveKodexVooFixedMixSelection } from "../src/lib/kodex-voo-fixed-mix-selection.ts";
import { buildSimulationRegimeResearch } from "../src/lib/simulation-regime-research-execution.ts";
import { buildSimulationRegimeReadinessHistory } from "../src/lib/simulation-regime-readiness-history.ts";
import { SIMULATION_RETURN_MATRIX_POLICY } from "../src/lib/simulation-return-matrix.ts";

describe("Regime bootstrap research execution", () => {
  it("runs deterministic references and three fixed mixes from one regime execution", () => {
    const matrix = readyMatrix();
    const input = {
      explicitEndServiceDate: matrix.requestedServiceDates.at(-1),
      matrix,
      factorRows: factorRows(matrix.requestedServiceDates.at(-1)),
      selection: resolveKodexVooFixedMixSelection("50"),
    };
    const left = buildSimulationRegimeResearch(input);
    const right = buildSimulationRegimeResearch(input);

    assert.equal(left.status, "ready");
    assert.deepEqual(right, left);
    assert.equal(left.policy.version, "regime_bootstrap_research_v2");
    assert.equal(left.runtimeTrustStatus, "retrospective_research_only");
    assert.equal(left.pointInTime.status, "not_established");
    assert.equal(
      left.readiness.factors[0].currentReleaseDate,
      shiftDate(input.explicitEndServiceDate, -1),
    );
    assert.equal(
      left.readiness.factors[0].availabilityTimestampStatus,
      "not_preserved",
    );
    assert.equal(left.readiness.alignedRowCount, 120);
    assert.equal(left.readiness.selectedNeighborCount, 40);
    assert.equal(left.readiness.informativeFeatureCount, 6);
    assert.equal(left.summary.scenarioCount, 5);
    assert.equal(left.summary.readyScenarioCount, 5);
    assert.equal(left.assumptions.horizon, 63);
    assert.equal(left.assumptions.pathCount, 500);
    assert.equal(left.scenarios.length, 2);
    assert.equal(left.scenarios[0].status, "ready");
    assert.deepEqual(left.scenarios[0].weightsBps, [10_000, 0]);
    assert.deepEqual(left.scenarios[1].weightsBps, [0, 10_000]);
    assert.equal(left.fixedMixComparison.status, "ready");
    assert.equal(
      left.fixedMixComparison.policy.executionBinding,
      "single_regime_bootstrap_engine_invocation",
    );
    assert.equal(
      left.fixedMixComparison.pairing.status,
      "shared_regime_state_and_draw_plan_verified",
    );
    assert.equal(left.fixedMixComparison.pairing.scenarioCount, 3);
    assert.deepEqual(
      left.fixedMixComparison.scenarios.map((scenario) => scenario.weightsBps),
      [
        [2_500, 7_500],
        [5_000, 5_000],
        [7_500, 2_500],
      ],
    );
    assert.equal(left.scenarios[0].bands.length, 64);
    assert.equal(left.scenarios[0].samplePaths.length, 12);
    assert.equal(left.scenarios[0].bands[0].p50, 100);
    assert.ok(
      [...left.scenarios, ...left.fixedMixComparison.scenarios].every(
        (scenario) =>
          scenario.status === "ready" &&
          scenario.bands.every(
            (band) => band.p10 <= band.p50 && band.p50 <= band.p90,
          ),
      ),
    );
    assert.doesNotMatch(
      JSON.stringify(left),
      /inputMatrixHash|drawPlanHash|scenarioVectorHash|approvedVector|accountId/,
    );
  });

  it("blocks only the stale regime model instead of falling back to stationary sampling", () => {
    const matrix = readyMatrix();
    const endServiceDate = matrix.requestedServiceDates.at(-1);
    const staleCutoff = shiftDate(endServiceDate, -8);
    const result = buildSimulationRegimeResearch({
      explicitEndServiceDate: endServiceDate,
      matrix,
      factorRows: factorRows(staleCutoff),
      selection: resolveKodexVooFixedMixSelection(undefined),
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "current_factor_state_stale");
    assert.deepEqual(result.scenarios, []);
    assert.equal(result.fixedMixComparison.status, "unavailable");
    assert.equal(result.policy.fallback, "forbidden");
    assert.ok(result.readiness.eligibleCandidateRowCount > 0);
  });

  it("does not use a factor row before its release date", () => {
    const matrix = readyMatrix();
    const endServiceDate = matrix.requestedServiceDates.at(-1);
    const rows = factorRows(endServiceDate)
      .filter(
        (row) => row.factorDate >= matrix.requestedServiceDates[0],
      )
      .map((row) => ({
        ...row,
        releaseDate: shiftDate(row.releaseDate, 1),
      }));
    const result = buildSimulationRegimeResearch({
      explicitEndServiceDate: endServiceDate,
      matrix,
      factorRows: rows,
      selection: resolveKodexVooFixedMixSelection(undefined),
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "insufficient_aligned_regime_rows");
    assert.equal(result.readiness.alignedRowCount, 118);
  });

  it("keeps references and preset comparisons when only the custom query is invalid", () => {
    const matrix = readyMatrix();
    const endServiceDate = matrix.requestedServiceDates.at(-1);
    const result = buildSimulationRegimeResearch({
      explicitEndServiceDate: endServiceDate,
      matrix,
      factorRows: factorRows(endServiceDate),
      selection: resolveKodexVooFixedMixSelection("100"),
    });

    assert.equal(result.status, "ready");
    assert.equal(result.summary.readyScenarioCount, 5);
    assert.equal(result.summary.unavailableScenarioCount, 1);
    assert.equal(result.fixedMixComparison.status, "ready");
    assert.equal(result.scenarios[2].status, "unavailable");
    assert.equal(result.scenarios[2].reason, "invalid_weight_selection");
  });

  it("adds a non-preset custom mix without changing the preset comparison", () => {
    const matrix = readyMatrix();
    const endServiceDate = matrix.requestedServiceDates.at(-1);
    const result = buildSimulationRegimeResearch({
      explicitEndServiceDate: endServiceDate,
      matrix,
      factorRows: factorRows(endServiceDate),
      selection: resolveKodexVooFixedMixSelection("40"),
    });

    assert.equal(result.status, "ready");
    assert.equal(result.summary.scenarioCount, 6);
    assert.equal(result.summary.readyScenarioCount, 6);
    assert.deepEqual(result.scenarios[2].weightsBps, [4_000, 6_000]);
    assert.equal(result.fixedMixComparison.scenarios.length, 3);
  });

  it("rejects a shorter matrix even when it claims to be ready", () => {
    const matrix = readyMatrix({ returnStepCount: 119 });
    const endServiceDate = matrix.requestedServiceDates.at(-1);
    const result = buildSimulationRegimeResearch({
      explicitEndServiceDate: endServiceDate,
      matrix,
      factorRows: factorRows(endServiceDate),
      selection: resolveKodexVooFixedMixSelection(undefined),
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "input_matrix_shape_mismatch");
  });

  it("requires an explicit end date and performs no implicit latest-date execution", () => {
    const result = buildSimulationRegimeResearch({
      explicitEndServiceDate: null,
      matrix: readyMatrix(),
      factorRows: [],
      selection: resolveKodexVooFixedMixSelection(undefined),
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "explicit_end_required");
  });

  it("keeps retrospective readiness separate from strict point-in-time safe dates", () => {
    const matrix = readyMatrix();
    const endServiceDate = matrix.requestedServiceDates.at(-1);
    const history = buildSimulationRegimeReadinessHistory({
      selectedEndServiceDate: endServiceDate,
      candidates: [
        { serviceDate: endServiceDate, matrix },
        { serviceDate: shiftDate(endServiceDate, -1), matrix: null },
      ],
      factorRows: factorRows(endServiceDate),
    });

    assert.equal(history.summary.inspectedDateCount, 2);
    assert.equal(history.summary.retrospectiveReadyDateCount, 1);
    assert.equal(history.summary.pointInTimeSafeDateCount, 0);
    assert.deepEqual(history.safeEndServiceDates, []);
    assert.equal(history.entries[0].retrospectiveStatus, "research_ready");
    assert.equal(history.entries[0].pointInTimeStatus, "not_established");
    assert.equal(history.entries[1].reason, "input_matrix_unavailable");
    assert.equal(history.policy.automaticEndpointRollback, "forbidden");
  });
});

function readyMatrix({ returnStepCount = 120 } = {}) {
  const requestedServiceDates = Array.from(
    { length: returnStepCount + 1 },
    (_, index) => shiftDate("2025-01-01", index),
  );
  const instruments = [
    {
      instrumentKey: "korea|KRW|069500",
      market: "korea",
      currency: "KRW",
      ticker: "069500",
    },
    {
      instrumentKey: "us|USD|VOO",
      market: "us",
      currency: "USD",
      ticker: "VOO",
    },
  ];
  const matrix = Array.from({ length: returnStepCount }, (_, index) => ({
    previousServiceDate: requestedServiceDates[index],
    serviceDate: requestedServiceDates[index + 1],
    cells: instruments.map((instrument, instrumentIndex) => ({
      instrumentKey: instrument.instrumentKey,
      value:
        0.0004 +
        Math.sin((index + instrumentIndex * 3) / 7) * 0.008 +
        Math.cos((index + instrumentIndex) / 13) * 0.003,
      previous: evidence(requestedServiceDates[index]),
      current: evidence(requestedServiceDates[index + 1]),
    })),
  }));
  const totalCellCount = matrix.length * instruments.length;

  return {
    status: "ready",
    policy: SIMULATION_RETURN_MATRIX_POLICY,
    requestedServiceDates,
    instruments,
    exclusions: [],
    matrix,
    summary: {
      requestedInstrumentCount: instruments.length,
      includedInstrumentCount: instruments.length,
      excludedInstrumentCount: 0,
      requestedServiceDateCount: requestedServiceDates.length,
      matrixRowCount: matrix.length,
      totalCellCount,
      readyCellCount: totalCellCount,
      incompleteCellCount: 0,
      coveragePct: 100,
    },
    sourceSummary: {
      acceptedPriceRows: requestedServiceDates.length * instruments.length,
      acceptedFxRows: requestedServiceDates.length,
      ignoredOutOfWindowPriceRows: 0,
      ignoredOutOfWindowFxRows: 0,
    },
    consumerStatus: "matrix_ready",
    blockers: [],
  };
}

function factorRows(endServiceDate) {
  const firstDate = "2024-12-20";
  const dayCount = dateDistance(firstDate, endServiceDate) + 1;
  const keys = ["usdkrw", "us_10y_yield", "us_10y2y_curve"];
  return Array.from({ length: dayCount }, (_, dayIndex) =>
    keys.map((factorKey, factorIndex) => {
      const date = shiftDate(firstDate, dayIndex);
      return {
        factorKey,
        factorDate: date,
        periodEndDate: date,
        releaseDate: date,
        value:
          100 +
          factorIndex * 25 +
          dayIndex * (0.02 + factorIndex * 0.01) +
          Math.sin((dayIndex + factorIndex * 4) / 9) * 2,
        volatility20dPct:
          4 +
          factorIndex +
          Math.cos((dayIndex + factorIndex * 5) / 11) * 0.7,
      };
    }),
  ).flat();
}

function evidence(date) {
  return {
    status: "ready",
    reason: null,
    sourcePriceDate: date,
    priceCarryDays: 0,
    sourceFxDate: null,
    fxCarryDays: null,
  };
}

function shiftDate(date, deltaDays) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + deltaDays);
  return value.toISOString().slice(0, 10);
}

function dateDistance(earlier, later) {
  return Math.round(
    (new Date(`${later}T00:00:00.000Z`) -
      new Date(`${earlier}T00:00:00.000Z`)) /
      86_400_000,
  );
}
