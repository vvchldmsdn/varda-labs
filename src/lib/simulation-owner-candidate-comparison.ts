import {
  buildSimulationOwnerConstrainedMinVolatility,
  SIMULATION_OWNER_CONSTRAINED_MIN_VOLATILITY_POLICY,
  type SimulationOwnerResearchWeight,
} from "./simulation-owner-constrained-min-volatility.ts";
import {
  executeSimulationResearchPathsFromPrepared,
  type ReadyPreparedSimulationResearchPaths,
  type SimulationResearchExecutionBlockerReason,
  type SimulationResearchExecutionCoreResult,
} from "./simulation-research-execution-core.ts";

export const SIMULATION_OWNER_CANDIDATE_COMPARISON_POLICY = Object.freeze({
  ...SIMULATION_OWNER_CONSTRAINED_MIN_VOLATILITY_POLICY,
  version: "simulation_owner_minimum_volatility_candidate_v1",
  trainingEvidence: "same_aligned_90_return_rows_as_current_simulation",
  evaluation:
    "current_and_candidate_reuse_one_prepared_bootstrap_draw_plan_pathwise",
  commonRandomNumbers: "required",
  transactionCostBps: 0,
  transactionCostInterpretation: "explicit_zero_cost_research_assumption",
  persistence: "forbidden",
  providerCalls: "forbidden",
  recommendation: "forbidden",
  orderAuthority: "forbidden",
  validation:
    "in_sample_candidate_requires_separate_walk_forward_evidence_before_use",
} as const);

type ReadyExecution = Extract<
  SimulationResearchExecutionCoreResult,
  { status: "ready" }
>;

type CurrentExecutionInput =
  | ReadyExecution
  | Readonly<{ status: "unavailable" }>;

export type SimulationOwnerCandidateComparisonResult = ReturnType<
  typeof buildSimulationOwnerCandidateComparison
>;

export type SimulationOwnerCandidateComparisonBlockerReason =
  | "current_execution_unavailable"
  | "candidate_requires_two_instruments"
  | "input_shape_mismatch"
  | "candidate_estimation_failed"
  | "candidate_not_lower_volatility"
  | "candidate_constraint_failed"
  | SimulationResearchExecutionBlockerReason;

export function buildSimulationOwnerCandidateComparison(input: {
  account: string;
  prepared: ReadyPreparedSimulationResearchPaths | null;
  currentExecution: CurrentExecutionInput;
  currentWeights: readonly SimulationOwnerResearchWeight[];
  samplePathCount: number;
}) {
  const base = {
    account: input.account,
    policy: SIMULATION_OWNER_CANDIDATE_COMPARISON_POLICY,
    runtimeTrustStatus: "tenant_scoped_read_only_research" as const,
  };
  if (!input.prepared || input.currentExecution.status !== "ready") {
    return unavailable(base, "current_execution_unavailable");
  }

  const allocation = buildSimulationOwnerConstrainedMinVolatility({
    instruments: input.prepared.matrix.instruments,
    rows: input.prepared.matrix.matrix,
    currentWeights: input.currentWeights,
  });
  if (allocation.status !== "ready") {
    return unavailable(base, allocation.reason);
  }
  const candidateWeights = allocation.weights;

  const candidateExecution = executeSimulationResearchPathsFromPrepared({
    prepared: input.prepared,
    scenarioId: `owner-minimum-volatility-${input.account}`,
    scenarioVersion: "v1",
    weights: candidateWeights,
    samplePathCount: input.samplePathCount,
  });
  if (candidateExecution.status !== "ready") {
    return unavailable(base, candidateExecution.reason);
  }

  return Object.freeze({
    ...base,
    status: "ready" as const,
    reason: null,
    pairing: Object.freeze({
      status: "shared_prepared_paths_verified" as const,
      inputMatrixHash: input.prepared.grossGrowth.inputMatrixHash,
      drawPlanHash: input.prepared.grossGrowth.drawPlanHash,
      pathCount: input.prepared.assumptions.pathCount,
      horizon: input.prepared.assumptions.horizon,
    }),
    constraints: allocation.constraints,
    training: allocation.training,
    currentExecution: input.currentExecution satisfies ReadyExecution,
    candidateExecution,
    weights: Object.freeze(
      candidateWeights.map((candidate, index) =>
        Object.freeze({
          instrumentKey: candidate.instrumentKey,
          market: candidate.market,
          currency: candidate.currency,
          ticker: candidate.ticker,
          currentWeightBps: input.currentWeights[index].weightBps,
          candidateWeightBps: candidate.weightBps,
          changeBps:
            candidate.weightBps - input.currentWeights[index].weightBps,
        }),
      ),
    ),
    deltas: Object.freeze({
      p10IndexPoints:
        candidateExecution.terminal.p10Index -
        input.currentExecution.terminal.p10Index,
      p50ReturnPctPoints:
        candidateExecution.terminal.p50ReturnPct -
        input.currentExecution.terminal.p50ReturnPct,
      lossProbabilityPctPoints:
        candidateExecution.terminal.lossProbabilityPct -
        input.currentExecution.terminal.lossProbabilityPct,
      maxDrawdownP90PctPoints:
        candidateExecution.terminal.maxDrawdownP90Pct -
        input.currentExecution.terminal.maxDrawdownP90Pct,
    }),
  });
}

function unavailable(
  base: {
    account: string;
    policy: typeof SIMULATION_OWNER_CANDIDATE_COMPARISON_POLICY;
    runtimeTrustStatus: "tenant_scoped_read_only_research";
  },
  reason: SimulationOwnerCandidateComparisonBlockerReason,
) {
  return Object.freeze({
    ...base,
    status: "unavailable" as const,
    reason,
    pairing: null,
    constraints: null,
    training: null,
    currentExecution: null,
    candidateExecution: null,
    weights: Object.freeze([]),
    deltas: null,
  });
}
