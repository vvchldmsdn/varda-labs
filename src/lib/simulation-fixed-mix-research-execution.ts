import type { SimulationReturnMatrixResult } from "./simulation-return-matrix-types.ts";
import {
  executeSimulationResearchPaths,
  type SimulationResearchExecutionBlockerReason,
} from "./simulation-research-execution-core.ts";

const FIXED_MIX_WEIGHTS = Object.freeze([
  Object.freeze({
    market: "korea",
    currency: "KRW",
    ticker: "069500",
    weightBps: 5_000,
  }),
  Object.freeze({
    market: "us",
    currency: "USD",
    ticker: "VOO",
    weightBps: 5_000,
  }),
] as const);

export const FIXED_MIX_RESEARCH_SIMULATION_POLICY = Object.freeze({
  version: "fixed_mix_joint_research_simulation_v1",
  admission: "explicit_end_query_and_complete_joint_matrix_only",
  sourceReturnStepCount: 90,
  horizon: 63,
  horizonLabel: "approximately_three_market_months",
  pathCount: 500,
  expectedBlockLength: 5,
  seed: 0x56415244,
  bootstrapModel: "stationary_bootstrap_unconditional_not_regime_conditioned",
  seedPolicy: "explicit_fixed_seed_for_reproducibility",
  jointSampling: "paired_cross_market_rows_same_draw_plan",
  samplePathCount: 12,
  portfolioPath: "initial_fixed_weight_buy_and_hold_without_rebalancing",
  displayBasis: "normalized_index_100",
  weights: FIXED_MIX_WEIGHTS,
  persistence: "forbidden",
  accountBinding: "forbidden",
  recommendation: "forbidden",
  optimizer: "forbidden",
  interpretation: "research_distribution_not_forecast",
} as const);

export type FixedMixResearchSimulationResult = ReturnType<
  typeof buildFixedMixResearchSimulation
>;

export function buildFixedMixResearchSimulation(input: {
  explicitEndServiceDate: string | null;
  matrix: SimulationReturnMatrixResult | null;
}) {
  const base = {
    id: "kodex200-voo-50-50" as const,
    name: "KODEX 200 50% + VOO 50%",
    policy: FIXED_MIX_RESEARCH_SIMULATION_POLICY,
    weights: FIXED_MIX_WEIGHTS,
    runtimeTrustStatus: "research_only" as const,
  };

  if (!input.explicitEndServiceDate) {
    return blockedResult(base, "explicit_end_required");
  }
  if (!input.matrix || input.matrix.status !== "ready") {
    return blockedResult(base, "input_matrix_unavailable");
  }

  const matrix = input.matrix;
  const matrixEndServiceDate = matrix.requestedServiceDates.at(-1) ?? null;
  if (
    matrix.matrix.length !==
      FIXED_MIX_RESEARCH_SIMULATION_POLICY.sourceReturnStepCount ||
    matrixEndServiceDate !== input.explicitEndServiceDate ||
    !sameInstrumentUniverse(matrix)
  ) {
    return blockedResult(base, "input_matrix_shape_mismatch");
  }

  const execution = executeSimulationResearchPaths({
    matrix,
    scenarioId: "research-kodex200-voo-50-50",
    scenarioVersion: "v1",
    weights: FIXED_MIX_WEIGHTS,
    seed: FIXED_MIX_RESEARCH_SIMULATION_POLICY.seed,
    expectedBlockLength:
      FIXED_MIX_RESEARCH_SIMULATION_POLICY.expectedBlockLength,
    horizon: FIXED_MIX_RESEARCH_SIMULATION_POLICY.horizon,
    pathCount: FIXED_MIX_RESEARCH_SIMULATION_POLICY.pathCount,
    samplePathCount: FIXED_MIX_RESEARCH_SIMULATION_POLICY.samplePathCount,
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
      pairedInstrumentCount: matrix.instruments.length,
      firstServiceDate: matrix.requestedServiceDates[0] ?? null,
      lastServiceDate: matrixEndServiceDate,
    }),
  });
}

function sameInstrumentUniverse(matrix: SimulationReturnMatrixResult) {
  return (
    matrix.instruments.length === FIXED_MIX_WEIGHTS.length &&
    matrix.instruments.every((instrument, index) => {
      const expected = FIXED_MIX_WEIGHTS[index];
      return (
        expected !== undefined &&
        instrument.market === expected.market &&
        instrument.currency === expected.currency &&
        instrument.ticker === expected.ticker
      );
    })
  );
}

type FixedMixResearchBlockerReason =
  | "explicit_end_required"
  | "input_matrix_unavailable"
  | "input_matrix_shape_mismatch"
  | SimulationResearchExecutionBlockerReason;

function blockedResult(
  base: {
    id: "kodex200-voo-50-50";
    name: string;
    policy: typeof FIXED_MIX_RESEARCH_SIMULATION_POLICY;
    weights: typeof FIXED_MIX_WEIGHTS;
    runtimeTrustStatus: "research_only";
  },
  reason: FixedMixResearchBlockerReason,
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
