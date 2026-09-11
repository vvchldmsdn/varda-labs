import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSimulationOwnerEconomicResearch } from "../src/lib/simulation-owner-economic-research.ts";
import { evaluateEconomicStatePaths } from "../src/lib/simulation-economic-state-model.ts";
import { summarizeSimulationNavPaths } from "../src/lib/simulation-nav-path-summary.ts";
import { ownerWeights, readyOwnerMatrix } from "./support/simulation-owner-ready-matrix.mjs";
import { shiftRiskDate } from "../src/lib/portfolio-risk-calendar.ts";

describe("owner economic research input admission and summary", () => {
  it("uses current admitted levels, strict prior releases, correct units and the same 1000 paths", () => {
    const input = makeInput();
    const result = buildSimulationOwnerEconomicResearch({ ...input, includeDisplayPaths: true });
    assert.equal(result.status, "ready");
    assert.equal(result.source.alignedObservationCount, 89);
    assert.equal(result.assumptions.pathCount, 1000);
    assert.equal(result.prepared.horizon, 21);
    assert.equal(result.currentFactors.length, 3);
    const end = input.matrix.requestedServiceDates.at(-1);
    for (const factor of result.currentFactors) assert.ok(factor.releaseDate < end && factor.carryDays <= 7);
    const fx = input.factorRows.filter((row) => row.factorKey === "usdkrw" && row.releaseDate < end).at(-1);
    const yieldRow = input.factorRows.filter((row) => row.factorKey === "us_10y_yield" && row.releaseDate < end).at(-1);
    assert.equal(result.currentFactors[0].value, fx.value);
    assert.equal(result.currentFactors[0].transformedValue, Math.log(fx.value));
    assert.equal(result.currentFactors[1].value, yieldRow.value);
    assert.equal(result.currentFactors[1].unit, "percent");
    assert.equal(result.currentFactors[2].unit, "percentage_points");
    const evaluated = evaluateEconomicStatePaths({ prepared: result.prepared, weights: input.weights.map((row) => row.weightBps / 10_000) });
    const summary = summarizeSimulationNavPaths({ paths: evaluated.paths, horizon: 21, samplePathCount: 12 });
    assert.deepEqual(result.terminal, summary.terminal);
    assert.deepEqual(result.bands, summary.bands);
    assert.equal(result.displayPaths.pathCount, 1000);
    assert.equal(result.displayPaths.values.length, 22000);
    for (const pathIndex of [0, 499, 500, 999]) {
      for (const stepIndex of [0, 1, 21]) {
        assert.equal(result.displayPaths.values[pathIndex * 22 + stepIndex], Number((evaluated.paths[pathIndex][stepIndex] * 100).toPrecision(7)));
      }
    }
    const compact = buildSimulationOwnerEconomicResearch(input);
    assert.equal(compact.displayPaths, null);
    assert.deepEqual(compact.terminal, result.terminal);
    assert.equal(result.policy.pointInTimeAvailability, "not_established");
    assert.equal(result.policy.providerCalls, "forbidden");
  });

  it("admits negative yields as percentage levels and never divides rate changes by 100", () => {
    const input = makeInput();
    const series = input.matrix.requestedServiceDates.flatMap((date, i) => [
      row("usdkrw", date, 1300 * Math.exp(i * 0.001)),
      row("us_10y_yield", date, -0.7 + i * 0.01),
      row("us_10y2y_curve", date, -0.5 + i * 0.005),
    ]);
    const result = buildSimulationOwnerEconomicResearch({ ...input, factorRows: series });
    assert.equal(result.status, "ready");
    for (const [i, expected] of [0.001, 0.01, 0.005].entries()) {
      assert.ok(Math.abs(result.diagnostics.globalFactorMean[i] - expected) < 1e-12);
    }
  });

  it("blocks missing/stale current factors even when historical calibration is sufficient", () => {
    const input = makeInput();
    const end = input.matrix.requestedServiceDates.at(-1);
    const staleCutoff = shiftRiskDate(end, -8);
    const stale = input.factorRows.filter((row) => row.factorKey !== "us_10y_yield" || row.releaseDate <= staleCutoff);
    const result = buildSimulationOwnerEconomicResearch({ ...input, factorRows: stale });
    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "current_factor_state_stale");
    assert.equal(result.prepared, null);
    const missing = buildSimulationOwnerEconomicResearch({ ...input, factorRows: input.factorRows.filter((row) => row.factorKey !== "us_10y2y_curve") });
    assert.equal(missing.reason, "current_factor_state_missing");
    const freshReleaseOldObservation = stale.concat(row("us_10y_yield", shiftRiskDate(end, -1), 4));
    freshReleaseOldObservation.at(-1).factorDate = staleCutoff;
    assert.equal(buildSimulationOwnerEconomicResearch({ ...input, factorRows: freshReleaseOldObservation }).reason, "current_factor_state_stale");
  });

  it("excludes same-day/future releases and future matrix outcomes from a historical fold", () => {
    const input = makeInput();
    const asOf = input.matrix.requestedServiceDates[65];
    const original = buildSimulationOwnerEconomicResearch({ ...input, stateAsOfServiceDate: asOf });
    const amendedRows = input.factorRows.map((row) => row.releaseDate >= asOf ? { ...row, value: 999999 } : row);
    const amendedMatrix = { ...input.matrix, matrix: input.matrix.matrix.map((row) => row.serviceDate > asOf ? { ...row, cells: row.cells.map((cell) => ({ ...cell, value: 500 })) } : row) };
    const amended = buildSimulationOwnerEconomicResearch({ ...input, factorRows: amendedRows, matrix: amendedMatrix, stateAsOfServiceDate: asOf });
    assert.equal(original.status, "ready");
    assert.equal(original.source.alignedObservationCount, 64);
    assert.equal(original.source.lastAlignedServiceDate, asOf);
    assert.deepEqual(original.prepared.assetGrowth, amended.prepared.assetGrowth);
    assert.deepEqual(original.currentFactors, amended.currentFactors);
    assert.deepEqual(original.factorSources, amended.factorSources);
  });

  it("admits a fresh current level after the training end and changes the distribution", () => {
    const input = makeInput();
    const end = input.matrix.requestedServiceDates.at(-1);
    const asOf = shiftRiskDate(end, 2);
    const first = buildSimulationOwnerEconomicResearch({ ...input, stateAsOfServiceDate: asOf });
    const revised = input.factorRows.map((row) => row.releaseDate === end ? { ...row, value: row.factorKey === "usdkrw" ? row.value * 1.01 : row.value + 0.1 } : row);
    const second = buildSimulationOwnerEconomicResearch({ ...input, stateAsOfServiceDate: asOf, factorRows: revised });
    assert.equal(first.status, "ready");
    assert.equal(second.status, "ready");
    assert.deepEqual(first.exposures, second.exposures);
    assert.notDeepEqual(first.diagnostics.initialConditionalFactorMean, second.diagnostics.initialConditionalFactorMean);
    assert.notDeepEqual(first.prepared.assetGrowth, second.prepared.assetGrowth);
  });

  it("rejects identity, invalid evidence and insufficient training without invented outputs", () => {
    const input = makeInput();
    assert.equal(buildSimulationOwnerEconomicResearch({ ...input, ownerExecutionReady: false }).reason, "owner_research_unavailable");
    assert.equal(buildSimulationOwnerEconomicResearch({ ...input, weights: input.weights.map((row, i) => i === 0 ? { ...row, currency: "EUR" } : row) }).reason, "weight_identity_mismatch");
    assert.equal(buildSimulationOwnerEconomicResearch({ ...input, stateAsOfServiceDate: "2026-02-30" }).reason, "invalid_state_as_of_date");
    assert.equal(buildSimulationOwnerEconomicResearch({ ...input, factorRows: [{ ...input.factorRows[0], value: 0 }, ...input.factorRows.slice(1)] }).reason, "invalid_factor_evidence");
    assert.equal(buildSimulationOwnerEconomicResearch({ ...input, stateAsOfServiceDate: input.matrix.requestedServiceDates[40] }).reason, "insufficient_factor_overlap");
  });
});

function makeInput() {
  const matrix = readyOwnerMatrix();
  return { account: "all", matrix, weights: ownerWeights([5000, 2500, 2500]), horizon: 21, ownerExecutionReady: true,
    factorRows: matrix.requestedServiceDates.flatMap((date, i) => [
      row("usdkrw", date, 1300 + i * 0.7 + Math.sin(i / 5) * 4),
      row("us_10y_yield", date, 4 + Math.sin(i / 7) * 0.08),
      row("us_10y2y_curve", date, 0.2 + Math.cos(i / 9) * 0.04),
    ]),
  };
}
function row(factorKey, date, value) {
  return { factorKey, factorDate: date, periodEndDate: date, releaseDate: date, value, volatility20dPct: 1 };
}
