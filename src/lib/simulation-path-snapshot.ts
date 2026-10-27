import type { buildSimulationOwnerEconomicResearch } from "./simulation-owner-economic-research.ts";
import type { SimulationOwnerResearchExecutionResult } from "./simulation-owner-research-execution.ts";
import type { PreparedSimulationResearchPaths } from "./simulation-research-execution-core.ts";
import { PATH_DETAIL_LIMITS, type PathSnapshot } from "./simulation-path-detail-store.ts";

/** Adapters only copy states produced by this very render's engine execution. */
export function economicPathSnapshot(result: ReturnType<typeof buildSimulationOwnerEconomicResearch>, baseline: SimulationOwnerResearchExecutionResult): PathSnapshot | null {
  if (result.status !== "ready" || !result.displayPaths || !result.prepared) return null;
  const p = result.prepared;
  const weights = new Map(result.executionWeights.map(row => [row.instrumentKey, row]));
  if (p.assetKeys.some(key => !weights.has(key))) return null;
  const names = new Map(baseline.instruments.map(row => [row.instrumentKey, row.name]));
  const factors = p.factorKeys.map(key => {
    const evidence = result.currentFactors.find(row => row.factorKey === key);
    return { key, label: evidence?.label ?? key, unit: key === "usdkrw" ? "KRW / USD" : key === "us_10y_yield" ? "%" : "pp", transform: key === "usdkrw" ? "log_level" : "level", observationDate: evidence?.factorDate ?? "", source: evidence?.source ?? "" };
  });
  return {
    model: "economic", modelVersion: p.modelVersion, currency: "KRW", seed: p.seed, horizon: p.horizon, pathCount: p.pathCount,
    provenance: JSON.stringify({ source: result.source, provenance: result.provenance, account: result.account }),
    coveragePct: baseline.coverage.modeledCurrentValuePct,
    assets: p.assetKeys.map(key => ({ key, label: names.get(key) ?? weights.get(key)!.ticker, weightBps: weights.get(key)!.weightBps })),
    growth: p.assetGrowth, chart: Float64Array.from(result.displayPaths.values), factors, states: p.factorStates,
    drawRows: new Int32Array(), blockStarts: new Uint8Array(), history: [],
  };
}

export function bootstrapPathSnapshot(execution: SimulationOwnerResearchExecutionResult, prepared: PreparedSimulationResearchPaths | undefined): PathSnapshot | null {
  if (execution.status !== "ready" || !execution.displayPaths || prepared?.status !== "ready") return null;
  const { pathCount, horizon } = prepared.assumptions;
  const keys = prepared.grossGrowth.instrumentKeys;
  if (keys.length > PATH_DETAIL_LIMITS.assets || horizon > PATH_DETAIL_LIMITS.horizon || pathCount > PATH_DETAIL_LIMITS.paths) return null;
  const weights = new Map(execution.executionWeights.map(row => [row.instrumentKey, row]));
  if (keys.some(key => !weights.has(key))) return null;
  const names = new Map(execution.instruments.map(row => [row.instrumentKey, row.name]));
  const growth = new Float64Array(pathCount * (horizon + 1) * keys.length);
  const drawRows = new Int32Array(pathCount * (horizon + 1)).fill(-1);
  const blockStarts = new Uint8Array(drawRows.length);
  for (const path of prepared.grossGrowth.paths) for (const point of path.points) {
    const row = path.pathIndex * (horizon + 1) + point.stepIndex;
    // Reject a different instrument ordering rather than pairing by array position.
    if (point.grossGrowthFactors.some((cell, column) => cell.instrumentKey !== keys[column])) return null;
    point.grossGrowthFactors.forEach((cell, column) => { growth[row * keys.length + column] = cell.value; });
    drawRows[row] = point.sourceRowIndex ?? -1;
  }
  for (const path of prepared.drawPlan.paths) for (const draw of path.draws) blockStarts[path.pathIndex * (horizon + 1) + draw.stepIndex + 1] = Number(draw.blockStart);
  const history = prepared.matrix.matrix.map(row => ({ from: row.previousServiceDate, to: row.serviceDate, returns: keys.map(key => row.cells.find(cell => cell.instrumentKey === key)?.value ?? NaN) }));
  return {
    model: "bootstrap", modelVersion: "stationary_bootstrap_buy_and_hold_v1", currency: "KRW", seed: prepared.assumptions.seed, horizon, pathCount,
    provenance: JSON.stringify({ input: prepared.grossGrowth.inputMatrixHash, draw: prepared.grossGrowth.drawPlanHash, account: execution.account, source: execution.source, assumptions: prepared.assumptions }),
    coveragePct: execution.coverage.modeledCurrentValuePct,
    assets: keys.map(key => ({ key, label: names.get(key) ?? weights.get(key)!.ticker, weightBps: weights.get(key)!.weightBps })),
    growth, chart: Float64Array.from(execution.displayPaths.values), factors: [], states: new Float64Array(), drawRows, blockStarts, history,
  };
}
