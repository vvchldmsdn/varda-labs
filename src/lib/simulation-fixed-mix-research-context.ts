import type { SimulationReturnMatrixResult } from "./simulation-return-matrix-types.ts";
import {
  prepareSimulationResearchPaths,
  type SimulationResearchPreparationBlockerReason,
} from "./simulation-research-execution-core.ts";
import {
  SIMULATION_RESEARCH_HORIZON_POLICY,
  type SimulationResearchHorizon,
} from "./simulation-research-horizon.ts";

export const FIXED_MIX_INSTRUMENTS = Object.freeze([
  Object.freeze({ market: "korea", currency: "KRW", ticker: "069500" }),
  Object.freeze({ market: "us", currency: "USD", ticker: "VOO" }),
] as const);

export const FIXED_MIX_RESEARCH_SIMULATION_POLICY = Object.freeze({
  version: "explicit_fixed_mix_joint_research_simulation_v2",
  admission:
    "valid_explicit_weight_selection_end_query_and_complete_joint_matrix_only",
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
  jointSampling: "paired_cross_market_rows_same_draw_plan",
  samplePathCount: 12,
  portfolioPath: "initial_fixed_weight_buy_and_hold_without_rebalancing",
  displayBasis: "normalized_index_100",
  weightUnit: "integer_basis_points",
  weightTotalBps: 10_000,
  persistence: "forbidden",
  accountBinding: "forbidden",
  recommendation: "forbidden",
  optimizer: "forbidden",
  interpretation: "research_distribution_not_forecast",
} as const);

export type FixedMixResearchContext = ReturnType<
  typeof prepareFixedMixResearchContext
>;

export type ReadyFixedMixResearchContext = Extract<
  FixedMixResearchContext,
  { status: "ready" }
>;

export type FixedMixResearchContextBlockerReason =
  | "explicit_end_required"
  | "invalid_horizon_selection"
  | "input_matrix_unavailable"
  | "input_matrix_shape_mismatch"
  | SimulationResearchPreparationBlockerReason;

export function prepareFixedMixResearchContext(input: {
  explicitEndServiceDate: string | null;
  matrix: SimulationReturnMatrixResult | null;
  horizon?: SimulationResearchHorizon | null;
}) {
  const horizon =
    input.horizon === undefined
      ? SIMULATION_RESEARCH_HORIZON_POLICY.defaultHorizon
      : input.horizon;
  if (!input.explicitEndServiceDate) {
    return blockedContext("explicit_end_required");
  }
  if (horizon === null) {
    return blockedContext("invalid_horizon_selection");
  }
  if (!input.matrix || input.matrix.status !== "ready") {
    return blockedContext("input_matrix_unavailable");
  }

  const matrix = input.matrix;
  const matrixEndServiceDate = matrix.requestedServiceDates.at(-1) ?? null;
  if (
    matrix.matrix.length !==
      FIXED_MIX_RESEARCH_SIMULATION_POLICY.sourceReturnStepCount ||
    matrixEndServiceDate !== input.explicitEndServiceDate ||
    !sameInstrumentUniverse(matrix)
  ) {
    return blockedContext("input_matrix_shape_mismatch");
  }

  const prepared = prepareSimulationResearchPaths({
    matrix,
    seed: FIXED_MIX_RESEARCH_SIMULATION_POLICY.seed,
    expectedBlockLength:
      FIXED_MIX_RESEARCH_SIMULATION_POLICY.expectedBlockLength,
    horizon,
    pathCount: FIXED_MIX_RESEARCH_SIMULATION_POLICY.pathCount,
  });
  if (prepared.status !== "ready") {
    return blockedContext(prepared.reason);
  }

  return Object.freeze({
    status: "ready" as const,
    reason: null,
    prepared,
    source: Object.freeze({
      endServiceDate: input.explicitEndServiceDate,
      returnStepCount: matrix.matrix.length,
      pairedInstrumentCount: matrix.instruments.length,
      firstServiceDate: matrix.requestedServiceDates[0] ?? null,
      lastServiceDate: matrixEndServiceDate,
    }),
  });
}

export function buildFixedMixResearchWeights(
  kodexWeightBps: number,
  vooWeightBps: number,
) {
  return Object.freeze([
    Object.freeze({
      ...FIXED_MIX_INSTRUMENTS[0],
      weightBps: kodexWeightBps,
    }),
    Object.freeze({
      ...FIXED_MIX_INSTRUMENTS[1],
      weightBps: vooWeightBps,
    }),
  ] as const);
}

function sameInstrumentUniverse(matrix: SimulationReturnMatrixResult) {
  return (
    matrix.instruments.length === FIXED_MIX_INSTRUMENTS.length &&
    matrix.instruments.every((instrument, index) => {
      const expected = FIXED_MIX_INSTRUMENTS[index];
      return (
        expected !== undefined &&
        instrument.market === expected.market &&
        instrument.currency === expected.currency &&
        instrument.ticker === expected.ticker
      );
    })
  );
}

function blockedContext(reason: FixedMixResearchContextBlockerReason) {
  return Object.freeze({
    status: "unavailable" as const,
    reason,
    prepared: null,
    source: null,
  });
}
