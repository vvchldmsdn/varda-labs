import {
  evaluateEconomicStatePaths,
  type ReadyPreparedEconomicStatePaths,
} from "./simulation-economic-state-model.ts";
import type { buildSimulationOwnerEconomicResearch } from "./simulation-owner-economic-research.ts";
import { summarizeSimulationNavPaths } from "./simulation-nav-path-summary.ts";
import { searchSimulationOwnerOutcomeCandidatesFromTerminalGrowth } from "./simulation-owner-outcome-optimizer.ts";
import type { SimulationOwnerResearchWeight } from "./simulation-owner-constrained-min-volatility.ts";

export const SIMULATION_OWNER_ECONOMIC_CANDIDATE_POLICY = Object.freeze({
  version: "simulation_owner_economic_candidates_v1",
  pathAuthority: "one_prepared_economic_asset_growth_cube_for_all_weights",
  validation: "even_paths_search_odd_paths_confirmation_not_temporal_validation",
  commonRandomNumbers: "required",
  transactionCostBps: 0,
  taxBps: 0,
  recommendation: "forbidden",
  persistence: "forbidden",
  providerCalls: "forbidden",
  orderAuthority: "forbidden",
  fallback: "forbidden",
} as const);

type EconomicResearch = ReturnType<typeof buildSimulationOwnerEconomicResearch>;
export type SimulationOwnerEconomicCandidatesResult = ReturnType<typeof buildSimulationOwnerEconomicCandidates>;

export function buildSimulationOwnerEconomicCandidates(input: { economic: EconomicResearch }) {
  const economic = input.economic;
  const base = { account: economic.account, policy: SIMULATION_OWNER_ECONOMIC_CANDIDATE_POLICY };
  if (economic.status !== "ready") return unavailable(base, "economic_research_unavailable");
  const { prepared, executionWeights } = economic;
  if (!validPreparedIdentity(prepared, executionWeights)) return unavailable(base, "prepared_identity_mismatch");

  const currentExecution = summarizeEconomicWeights({
    prepared,
    weightBps: executionWeights.map((row) => row.weightBps),
    id: `owner-economic-current-${economic.account}`,
    name: "현재 비중",
  });
  if (!currentExecution) return unavailable(base, "current_summary_unavailable");
  const terminalFactors = Array.from({ length: prepared.pathCount }, (_, pathIndex) => ({
    pathIndex,
    factors: executionWeights.map((_, assetIndex) => prepared.assetGrowth[
      (pathIndex * (prepared.horizon + 1) + prepared.horizon) * executionWeights.length + assetIndex
    ]),
  }));
  const optimization = searchSimulationOwnerOutcomeCandidatesFromTerminalGrowth({
    instruments: executionWeights,
    currentWeights: executionWeights,
    terminalFactors,
  });
  const outcomeCandidates = optimization.status === "ready"
    ? optimization.candidates.flatMap((candidate) => {
        const execution = summarizeEconomicWeights({
          prepared,
          weightBps: candidate.weights.map((row) => row.candidateWeightBps),
          id: `owner-economic-${candidate.objective}-${economic.account}`,
          name: candidate.objective,
        });
        if (!execution) return [];
        return [Object.freeze({
          ...candidate,
          execution,
          deltas: Object.freeze({
            p10IndexPoints: execution.terminal.p10Index - currentExecution.terminal.p10Index,
            p50ReturnPctPoints: execution.terminal.p50ReturnPct - currentExecution.terminal.p50ReturnPct,
            lowerTailMeanReturnPctPoints: execution.terminal.lowerTailMeanReturnPct - currentExecution.terminal.lowerTailMeanReturnPct,
            lossProbabilityPctPoints: execution.terminal.lossProbabilityPct - currentExecution.terminal.lossProbabilityPct,
            maxDrawdownP90PctPoints: execution.terminal.maxDrawdownP90Pct - currentExecution.terminal.maxDrawdownP90Pct,
          }),
        })];
      })
    : [];
  return Object.freeze({
    ...base,
    status: "ready" as const,
    reason: null,
    currentExecution,
    candidateStatus: outcomeCandidates.length > 0 ? "ready" as const : "unavailable" as const,
    candidateReason: outcomeCandidates.length > 0 ? null : optimization.reason ?? "candidate_summary_unavailable",
    outcomeCandidates: Object.freeze(outcomeCandidates),
    pairing: Object.freeze({
      modelVersion: prepared.modelVersion,
      seed: prepared.seed,
      horizon: prepared.horizon,
      pathCount: prepared.pathCount,
      endServiceDate: economic.source.matrixEndServiceDate,
      stateAsOfServiceDate: economic.source.stateAsOfServiceDate,
    }),
  });
}

function summarizeEconomicWeights(input: {
  prepared: ReadyPreparedEconomicStatePaths;
  weightBps: readonly number[];
  id: string;
  name: string;
}) {
  const evaluated = evaluateEconomicStatePaths({
    prepared: input.prepared,
    weights: input.weightBps.map((value) => value / 10_000),
  });
  if (evaluated.status !== "ready") return null;
  const summary = summarizeSimulationNavPaths({
    paths: evaluated.paths,
    horizon: input.prepared.horizon,
    samplePathCount: 12,
  });
  if (summary.status !== "ready") return null;
  return Object.freeze({
    id: input.id,
    name: input.name,
    status: "ready" as const,
    assumptions: Object.freeze({ horizon: input.prepared.horizon, pathCount: input.prepared.pathCount }),
    terminal: summary.terminal,
    bands: summary.bands,
    samplePaths: summary.samplePaths,
  });
}

function validPreparedIdentity(prepared: ReadyPreparedEconomicStatePaths, weights: readonly SimulationOwnerResearchWeight[]) {
  if (prepared.status !== "ready" || prepared.pathCount !== 500 ||
    !Number.isSafeInteger(prepared.horizon) || prepared.horizon < 1 || prepared.horizon > 126 ||
    prepared.assetKeys.length !== weights.length || weights.length === 0 ||
    new Set(prepared.assetKeys).size !== prepared.assetKeys.length ||
    weights.reduce((sum, row) => sum + row.weightBps, 0) !== 10_000 ||
    weights.some((row, index) => row.instrumentKey !== prepared.assetKeys[index] ||
      !Number.isInteger(row.weightBps) || row.weightBps < 0) ||
    !(prepared.assetGrowth instanceof Float64Array) ||
    prepared.assetGrowth.length !== prepared.pathCount * (prepared.horizon + 1) * weights.length ||
    prepared.assetGrowth.some((value) => !Number.isFinite(value) || value <= 0)) return false;
  for (let path = 0; path < prepared.pathCount; path += 1) {
    for (let asset = 0; asset < weights.length; asset += 1) {
      if (prepared.assetGrowth[path * (prepared.horizon + 1) * weights.length + asset] !== 1) return false;
    }
  }
  return true;
}

function unavailable(base: { account: string; policy: typeof SIMULATION_OWNER_ECONOMIC_CANDIDATE_POLICY }, reason: string) {
  return Object.freeze({
    ...base,
    status: "unavailable" as const,
    reason,
    currentExecution: null,
    candidateStatus: "unavailable" as const,
    candidateReason: reason,
    outcomeCandidates: Object.freeze([]),
    pairing: null,
  });
}
