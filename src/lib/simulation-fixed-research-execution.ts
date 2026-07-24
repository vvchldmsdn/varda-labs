import type { SimulationReturnMatrixResult } from "./simulation-return-matrix-types.ts";
import {
  executeSimulationResearchPaths,
  type SimulationResearchExecutionBlockerReason,
} from "./simulation-research-execution-core.ts";
import {
  SIMULATION_RESEARCH_HORIZON_POLICY,
  type SimulationResearchHorizon,
} from "./simulation-research-horizon.ts";

export const FIXED_RESEARCH_SIMULATION_POLICY = Object.freeze({
  version: "fixed_single_instrument_research_simulation_v1",
  admission: "explicit_end_query_and_complete_matrix_only",
  sourceReturnStepCount: 90,
  horizonPolicyVersion: SIMULATION_RESEARCH_HORIZON_POLICY.version,
  allowedHorizons: SIMULATION_RESEARCH_HORIZON_POLICY.allowedHorizons,
  defaultHorizon: SIMULATION_RESEARCH_HORIZON_POLICY.defaultHorizon,
  pathCount: 500,
  expectedBlockLength: 5,
  seed: 0x56415244,
  bootstrapModel: "stationary_bootstrap_unconditional_not_regime_conditioned",
  seedPolicy:
    "deterministic_only_for_identical_matrix_engine_policy_and_seed",
  randomComparison: "common_random_numbers_across_instruments",
  samplePathCount: 12,
  portfolioPath: "single_instrument_buy_and_hold_10000bps",
  displayBasis: "normalized_index_100",
  persistence: "forbidden",
  accountBinding: "forbidden",
  recommendation: "forbidden",
  optimizer: "forbidden",
  interpretation: "research_distribution_not_forecast",
} as const);

export type FixedResearchSimulationId = "kodex200" | "voo";

export type FixedResearchSimulationResult = ReturnType<
  typeof buildFixedResearchSimulation
>;

export function buildFixedResearchSimulation(input: {
  id: FixedResearchSimulationId;
  name: string;
  ticker: string;
  explicitEndServiceDate: string | null;
  matrix: SimulationReturnMatrixResult | null;
  horizon?: SimulationResearchHorizon | null;
}) {
  const horizon =
    input.horizon === undefined
      ? SIMULATION_RESEARCH_HORIZON_POLICY.defaultHorizon
      : input.horizon;
  const base = {
    id: input.id,
    name: input.name,
    ticker: input.ticker,
    policy: FIXED_RESEARCH_SIMULATION_POLICY,
    runtimeTrustStatus: "research_only" as const,
  };

  if (!input.explicitEndServiceDate) {
    return blockedResult(base, "explicit_end_required");
  }
  if (horizon === null) {
    return blockedResult(base, "invalid_horizon_selection");
  }
  if (!input.matrix || input.matrix.status !== "ready") {
    return blockedResult(base, "input_matrix_unavailable");
  }

  const matrix = input.matrix;
  const instrument = matrix.instruments[0];
  const matrixEndServiceDate = matrix.requestedServiceDates.at(-1) ?? null;
  if (
    matrix.instruments.length !== 1 ||
    !instrument ||
    instrument.ticker !== input.ticker ||
    matrix.matrix.length !==
      FIXED_RESEARCH_SIMULATION_POLICY.sourceReturnStepCount ||
    matrixEndServiceDate !== input.explicitEndServiceDate
  ) {
    return blockedResult(base, "input_matrix_shape_mismatch");
  }

  const execution = executeSimulationResearchPaths({
    matrix,
    scenarioId: `research-single-${input.id}`,
    scenarioVersion: "v1",
    weights: [{ ...instrument, weightBps: 10_000 }],
    seed: FIXED_RESEARCH_SIMULATION_POLICY.seed,
    expectedBlockLength: FIXED_RESEARCH_SIMULATION_POLICY.expectedBlockLength,
    horizon,
    pathCount: FIXED_RESEARCH_SIMULATION_POLICY.pathCount,
    samplePathCount: FIXED_RESEARCH_SIMULATION_POLICY.samplePathCount,
  });
  if (execution.status !== "ready") {
    return blockedResult(base, execution.reason);
  }

  return Object.freeze({
    ...base,
    ...execution,
    source: Object.freeze({
      endServiceDate: input.explicitEndServiceDate,
      returnStepCount: matrix.matrix.length,
      firstServiceDate: matrix.requestedServiceDates[0] ?? null,
      lastServiceDate: matrixEndServiceDate,
    }),
  });
}

type FixedResearchBlockerReason =
  | "explicit_end_required"
  | "invalid_horizon_selection"
  | "input_matrix_unavailable"
  | "input_matrix_shape_mismatch"
  | SimulationResearchExecutionBlockerReason;

function blockedResult(
  base: {
    id: FixedResearchSimulationId;
    name: string;
    ticker: string;
    policy: typeof FIXED_RESEARCH_SIMULATION_POLICY;
    runtimeTrustStatus: "research_only";
  },
  reason: FixedResearchBlockerReason,
) {
  return Object.freeze({
    ...base,
    status: "unavailable" as const,
    reason,
    source: null,
    assumptions: null,
    terminal: null,
    bands: Object.freeze([]),
    samplePaths: Object.freeze([]),
  });
}
