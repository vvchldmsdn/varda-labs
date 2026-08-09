import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SIMULATION_OWNER_CANDIDATE_COMPARISON_POLICY,
  buildSimulationOwnerCandidateComparison,
} from "../src/lib/simulation-owner-candidate-comparison.ts";
import {
  executeSimulationResearchPathsFromPrepared,
  prepareSimulationResearchPaths,
} from "../src/lib/simulation-research-execution-core.ts";
import { PRIVATE_OWNER_RAW_CLOSE_SIMULATION_RETURN_MATRIX_POLICY } from "../src/lib/simulation-return-matrix.ts";

describe("owner simulation minimum-volatility candidate comparison", () => {
  it("uses one prepared draw plan and enforces turnover, FX and concentration constraints", () => {
    const matrix = readyMatrix();
    const prepared = prepareSimulationResearchPaths({
      matrix,
      seed: 0x56415244,
      expectedBlockLength: 5,
      horizon: 63,
      pathCount: 500,
    });
    assert.equal(prepared.status, "ready");

    const currentWeights = weights([5_000, 2_500, 2_500]);
    const currentExecution = executeSimulationResearchPathsFromPrepared({
      prepared,
      scenarioId: "owner-current-all",
      scenarioVersion: "v1",
      weights: currentWeights,
      samplePathCount: 12,
    });
    assert.equal(currentExecution.status, "ready");

    const result = buildSimulationOwnerCandidateComparison({
      account: "all",
      prepared,
      currentExecution,
      currentWeights,
      samplePathCount: 12,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.pairing.status, "shared_prepared_paths_verified");
    assert.equal(
      result.pairing.inputMatrixHash,
      prepared.grossGrowth.inputMatrixHash,
    );
    assert.equal(
      result.pairing.drawPlanHash,
      prepared.grossGrowth.drawPlanHash,
    );
    assert.deepEqual(
      result.currentExecution.samplePaths.map((row) => row.pathIndex),
      result.candidateExecution.samplePaths.map((row) => row.pathIndex),
    );
    assert.equal(
      result.weights.reduce((sum, row) => sum + row.candidateWeightBps, 0),
      10_000,
    );
    assert.ok(
      result.weights.every(
        (row) =>
          row.candidateWeightBps <=
          result.constraints.maximumInstrumentWeightBps,
      ),
    );
    assert.ok(result.constraints.oneWayTurnoverBps <= 2_000);
    assert.ok(result.constraints.fxExposureChangeBps <= 1_000);
    assert.ok(
      result.training.candidateAnnualizedVolatilityPct <=
        result.training.currentAnnualizedVolatilityPct + 1e-10,
    );
    assert.equal(result.policy.recommendation, "forbidden");
    assert.equal(result.policy.persistence, "forbidden");
    assert.equal(result.policy.providerCalls, "forbidden");
  });

  it("is deterministic and keeps an explicit zero-cost research assumption", () => {
    const matrix = readyMatrix();
    const prepared = prepareSimulationResearchPaths({
      matrix,
      seed: 0x56415244,
      expectedBlockLength: 5,
      horizon: 63,
      pathCount: 500,
    });
    assert.equal(prepared.status, "ready");
    const currentWeights = weights([5_000, 2_500, 2_500]);
    const currentExecution = executeSimulationResearchPathsFromPrepared({
      prepared,
      scenarioId: "owner-current-all",
      scenarioVersion: "v1",
      weights: currentWeights,
      samplePathCount: 12,
    });
    assert.equal(currentExecution.status, "ready");

    const input = {
      account: "all",
      prepared,
      currentExecution,
      currentWeights,
      samplePathCount: 12,
    };
    const first = buildSimulationOwnerCandidateComparison(input);
    const second = buildSimulationOwnerCandidateComparison(input);

    assert.equal(first.status, "ready");
    assert.deepEqual(second, first);
    assert.equal(
      SIMULATION_OWNER_CANDIDATE_COMPARISON_POLICY.transactionCostBps,
      0,
    );
    assert.match(
      SIMULATION_OWNER_CANDIDATE_COMPARISON_POLICY.validation,
      /walk_forward/,
    );
  });

  it("leaves a one-instrument account on its current simulation without inventing a candidate", () => {
    const matrix = readyMatrix(1);
    const prepared = prepareSimulationResearchPaths({
      matrix,
      seed: 0x56415244,
      expectedBlockLength: 5,
      horizon: 63,
      pathCount: 500,
    });
    assert.equal(prepared.status, "ready");
    const currentWeights = weights([10_000]).slice(0, 1);
    const currentExecution = executeSimulationResearchPathsFromPrepared({
      prepared,
      scenarioId: "owner-current-irp",
      scenarioVersion: "v1",
      weights: currentWeights,
      samplePathCount: 12,
    });
    assert.equal(currentExecution.status, "ready");

    const result = buildSimulationOwnerCandidateComparison({
      account: "irp",
      prepared,
      currentExecution,
      currentWeights,
      samplePathCount: 12,
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "candidate_requires_two_instruments");
    assert.deepEqual(result.weights, []);
  });
});

function readyMatrix(instrumentCount = 3) {
  const requestedServiceDates = Array.from({ length: 91 }, (_, index) =>
    isoDate(index),
  );
  const allInstruments = [
    instrument("korea|KRW|AAA", "korea", "KRW", "AAA"),
    instrument("korea|KRW|BBB", "korea", "KRW", "BBB"),
    instrument("us|USD|CCC", "us", "USD", "CCC"),
  ];

  return build(allInstruments.slice(0, instrumentCount));

  function build(instruments) {
    const matrix = Array.from({ length: 90 }, (_, index) => ({
      previousServiceDate: requestedServiceDates[index],
      serviceDate: requestedServiceDates[index + 1],
      cells: instruments.map((row) => ({
        instrumentKey: row.instrumentKey,
        value: returnFor(row.ticker, index),
        previous: evidence(requestedServiceDates[index]),
        current: evidence(requestedServiceDates[index + 1]),
      })),
    }));
    const result = {
      status: "ready",
      policy: PRIVATE_OWNER_RAW_CLOSE_SIMULATION_RETURN_MATRIX_POLICY,
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
        totalCellCount: matrix.length * instruments.length,
        readyCellCount: matrix.length * instruments.length,
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
    return result;
  }
}

function weights(weightBps) {
  const instruments = [
    instrument("korea|KRW|AAA", "korea", "KRW", "AAA"),
    instrument("korea|KRW|BBB", "korea", "KRW", "BBB"),
    instrument("us|USD|CCC", "us", "USD", "CCC"),
  ];
  return instruments.map((row, index) => ({
    ...row,
    weightBps: weightBps[index],
  }));
}

function instrument(instrumentKey, market, currency, ticker) {
  return { instrumentKey, market, currency, ticker };
}

function returnFor(ticker, index) {
  if (ticker === "AAA") return index % 2 === 0 ? 0.035 : -0.03;
  if (ticker === "BBB") return 0.001 + (index % 3) * 0.0001;
  return index % 4 === 0 ? 0.012 : -0.002;
}

function evidence(date) {
  return {
    status: "ready",
    reason: null,
    sourcePriceDate: date,
    priceCarryDays: 0,
    sourceFxDate: date,
    fxCarryDays: 0,
  };
}

function isoDate(offset) {
  const date = new Date(Date.UTC(2026, 0, 1 + offset));
  return date.toISOString().slice(0, 10);
}
