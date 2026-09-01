import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSimulationOwnerParametricFactorResearch,
  SIMULATION_OWNER_PARAMETRIC_FACTOR_POLICY,
} from "../src/lib/simulation-owner-parametric-factor.ts";
import {
  ownerWeights,
  readyOwnerMatrix,
} from "./support/simulation-owner-ready-matrix.mjs";

describe("owner-scoped parametric factor research", () => {
  it("builds a separate account-scoped 500-path result", () => {
    const matrix = readyOwnerMatrix();
    const result = buildSimulationOwnerParametricFactorResearch({
      account: "all",
      matrix,
      weights: ownerWeights([5_000, 2_500, 2_500]),
      horizon: 63,
      factorRows: factorRows(matrix.requestedServiceDates),
      ownerExecutionReady: true,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.account, "all");
    assert.equal(result.assumptions.pathCount, 500);
    assert.equal(result.samplePaths.length, 12);
    assert.equal(result.bands.length, 64);
    assert.equal(result.source.alignedObservationCount, 89);
    assert.equal(result.source.factorGapRowCount, 1);
    assert.equal(result.exposures.length, 3);
    assert.equal(result.factorSources.length, 3);
    assert.deepEqual(
      result.executionWeights.map(({ instrumentKey, weightBps }) => ({
        instrumentKey,
        weightBps,
      })),
      ownerWeights([5_000, 2_500, 2_500]).map(
        ({ instrumentKey, weightBps }) => ({ instrumentKey, weightBps }),
      ),
    );
    assert.equal(result.policy.providerCalls, "forbidden");
    assert.equal(result.policy.persistence, "forbidden");
    assert.equal(result.policy.optimizer, "forbidden");
    assert.equal(result.policy.recommendation, "forbidden");
  });

  it("allows a one-instrument account without inventing an optimizer candidate", () => {
    const matrix = readyOwnerMatrix({ instrumentCount: 1 });
    const result = buildSimulationOwnerParametricFactorResearch({
      account: "irp",
      matrix,
      weights: ownerWeights([10_000], 1),
      horizon: 63,
      factorRows: factorRows(matrix.requestedServiceDates),
      ownerExecutionReady: true,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.exposures.length, 1);
    assert.equal(result.policy.optimizer, "forbidden");
  });

  it("keeps only this model unavailable when factor overlap is insufficient", () => {
    const matrix = readyOwnerMatrix();
    const result = buildSimulationOwnerParametricFactorResearch({
      account: "brokerage",
      matrix,
      weights: ownerWeights([5_000, 2_500, 2_500]),
      horizon: 63,
      factorRows: factorRows(matrix.requestedServiceDates.slice(0, 20)),
      ownerExecutionReady: true,
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "insufficient_factor_overlap");
    assert.ok(result.source.alignedObservationCount < 45);
    assert.equal(result.remediation.code, "refresh_core_market_factor_history");
    assert.equal(result.remediation.requiredAlignedObservationCount, 45);
    assert.equal(
      result.remediation.observationShortfall,
      45 - result.source.alignedObservationCount,
    );
    assert.equal(result.bands.length, 0);
    assert.equal(result.policy.fallback, "forbidden");
  });

  it("pins the retrospective point-in-time limitation", () => {
    assert.equal(
      SIMULATION_OWNER_PARAMETRIC_FACTOR_POLICY.pointInTimeAvailability,
      "not_established",
    );
    assert.equal(
      SIMULATION_OWNER_PARAMETRIC_FACTOR_POLICY.vintageAuthority,
      "not_established",
    );
    assert.equal(
      SIMULATION_OWNER_PARAMETRIC_FACTOR_POLICY.interpretation,
      "retrospective_research_distribution_not_forecast",
    );
  });
});

function factorRows(dates) {
  return dates.flatMap((date, index) => [
    row("usdkrw", date, 1_300 + index * 0.7),
    row("us_10y_yield", date, 4 + Math.sin(index / 7) * 0.08),
    row("us_10y2y_curve", date, 0.2 + Math.cos(index / 9) * 0.04),
  ]);
}

function row(factorKey, date, value) {
  return {
    factorKey,
    factorDate: date,
    periodEndDate: date,
    releaseDate: date,
    value,
    volatility20dPct: 1,
  };
}
