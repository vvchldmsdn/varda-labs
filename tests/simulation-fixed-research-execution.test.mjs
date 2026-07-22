import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FIXED_RESEARCH_SIMULATION_POLICY,
  buildFixedResearchSimulation,
} from "../src/lib/simulation-fixed-research-execution.ts";
import { SIMULATION_RETURN_MATRIX_POLICY } from "../src/lib/simulation-return-matrix.ts";

describe("Fixed single-instrument research simulation", () => {
  it("runs a deterministic read-only research distribution from an exact 90-row matrix", () => {
    const matrix = readyMatrix();
    const endServiceDate = matrix.requestedServiceDates.at(-1);
    const left = buildFixedResearchSimulation({
      id: "kodex200",
      name: "KODEX 200",
      ticker: "069500",
      explicitEndServiceDate: endServiceDate,
      matrix,
    });
    const right = buildFixedResearchSimulation({
      id: "kodex200",
      name: "KODEX 200",
      ticker: "069500",
      explicitEndServiceDate: endServiceDate,
      matrix,
    });

    assert.equal(left.status, "ready");
    assert.deepEqual(right, left);
    assert.equal(left.runtimeTrustStatus, "research_only");
    assert.equal(
      left.source.returnStepCount,
      FIXED_RESEARCH_SIMULATION_POLICY.sourceReturnStepCount,
    );
    assert.equal(left.assumptions.horizon, 63);
    assert.equal(left.assumptions.pathCount, 500);
    assert.equal(left.bands.length, 64);
    assert.equal(left.samplePaths.length, 12);
    assert.equal(left.samplePaths[0].points.length, 64);
    assert.equal(left.bands[0].p10, 100);
    assert.equal(left.bands[0].p50, 100);
    assert.equal(left.bands[0].p90, 100);
    assert.ok(left.bands.every((band) => band.p10 <= band.p50));
    assert.ok(left.bands.every((band) => band.p50 <= band.p90));
    assert.ok(Number.isFinite(left.terminal.lossProbabilityPct));
    assert.ok(Number.isFinite(left.terminal.p5ReturnPct));
    assert.ok(Number.isFinite(left.terminal.lowerTailMeanReturnPct));
    assert.ok(
      left.terminal.lowerTailMeanReturnPct <= left.terminal.p5ReturnPct,
    );
    assert.ok(Number.isFinite(left.terminal.maxDrawdownP90Pct));
    assert.doesNotMatch(JSON.stringify(left), /sha256:|inputMatrixHash|drawPlanHash/);
  });

  it("reuses the same 90-row input policy for the approved 126-step horizon", () => {
    const matrix = readyMatrix();
    const result = buildFixedResearchSimulation({
      id: "kodex200",
      name: "KODEX 200",
      ticker: "069500",
      explicitEndServiceDate: matrix.requestedServiceDates.at(-1),
      horizon: 126,
      matrix,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.source.returnStepCount, 90);
    assert.equal(result.assumptions.horizon, 126);
    assert.equal(result.bands.length, 127);
    assert.equal(result.samplePaths[0].points.length, 127);
  });

  it("does not silently replace an invalid horizon", () => {
    const matrix = readyMatrix();
    const result = buildFixedResearchSimulation({
      id: "kodex200",
      name: "KODEX 200",
      ticker: "069500",
      explicitEndServiceDate: matrix.requestedServiceDates.at(-1),
      horizon: null,
      matrix,
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "invalid_horizon_selection");
  });

  it("requires an explicit end date rather than silently rolling back", () => {
    const result = buildFixedResearchSimulation({
      id: "kodex200",
      name: "KODEX 200",
      ticker: "069500",
      explicitEndServiceDate: null,
      matrix: readyMatrix(),
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "explicit_end_required");
    assert.deepEqual(result.bands, []);
  });

  it("keeps one unavailable input from becoming a partial stochastic path", () => {
    const matrix = readyMatrix();
    const unavailable = {
      ...matrix,
      status: "incomplete",
      consumerStatus: "blocked_incomplete_matrix",
    };
    const result = buildFixedResearchSimulation({
      id: "kodex200",
      name: "KODEX 200",
      ticker: "069500",
      explicitEndServiceDate: matrix.requestedServiceDates.at(-1),
      matrix: unavailable,
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "input_matrix_unavailable");
    assert.deepEqual(result.samplePaths, []);
  });

  it("rejects a shorter matrix even when its internal status says ready", () => {
    const matrix = readyMatrix({ returnStepCount: 89 });
    const result = buildFixedResearchSimulation({
      id: "kodex200",
      name: "KODEX 200",
      ticker: "069500",
      explicitEndServiceDate: matrix.requestedServiceDates.at(-1),
      matrix,
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "input_matrix_shape_mismatch");
  });
});

function readyMatrix({ returnStepCount = 90 } = {}) {
  const requestedServiceDates = Array.from(
    { length: returnStepCount + 1 },
    (_, index) => isoDate(index),
  );
  const instrumentKey = "korea|KRW|069500";
  const matrix = Array.from({ length: returnStepCount }, (_, index) => ({
    previousServiceDate: requestedServiceDates[index],
    serviceDate: requestedServiceDates[index + 1],
    cells: [
      {
        instrumentKey,
        value: 0.001 + ((index % 7) - 3) * 0.002,
        previous: evidence(requestedServiceDates[index]),
        current: evidence(requestedServiceDates[index + 1]),
      },
    ],
  }));

  return {
    status: "ready",
    policy: SIMULATION_RETURN_MATRIX_POLICY,
    requestedServiceDates,
    instruments: [
      { instrumentKey, market: "korea", currency: "KRW", ticker: "069500" },
    ],
    exclusions: [],
    matrix,
    summary: {
      requestedInstrumentCount: 1,
      includedInstrumentCount: 1,
      excludedInstrumentCount: 0,
      requestedServiceDateCount: requestedServiceDates.length,
      matrixRowCount: matrix.length,
      totalCellCount: matrix.length,
      readyCellCount: matrix.length,
      incompleteCellCount: 0,
      coveragePct: 100,
    },
    sourceSummary: {
      acceptedPriceRows: requestedServiceDates.length,
      acceptedFxRows: 0,
      ignoredOutOfWindowPriceRows: 0,
      ignoredOutOfWindowFxRows: 0,
    },
    consumerStatus: "matrix_ready",
    blockers: [],
  };
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

function isoDate(offset) {
  const date = new Date(Date.UTC(2025, 0, 1 + offset));
  return date.toISOString().slice(0, 10);
}
