import type { KodexVooFixedMixSelection } from "./kodex-voo-fixed-mix-selection.ts";
import type { SimulationReturnMatrixResult } from "./simulation-return-matrix-types.ts";
import {
  executeSimulationResearchPaths,
  type SimulationResearchExecutionBlockerReason,
} from "./simulation-research-execution-core.ts";

const FIXED_MIX_INSTRUMENTS = Object.freeze([
  Object.freeze({ market: "korea", currency: "KRW", ticker: "069500" }),
  Object.freeze({ market: "us", currency: "USD", ticker: "VOO" }),
] as const);

export const FIXED_MIX_RESEARCH_SIMULATION_POLICY = Object.freeze({
  version: "explicit_fixed_mix_joint_research_simulation_v2",
  admission:
    "valid_explicit_weight_selection_end_query_and_complete_joint_matrix_only",
  sourceReturnStepCount: 90,
  horizon: 63,
  horizonLabel: "approximately_three_market_months",
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

export type FixedMixResearchSimulationResult = ReturnType<
  typeof buildFixedMixResearchSimulation
>;

export function buildFixedMixResearchSimulation(input: {
  explicitEndServiceDate: string | null;
  matrix: SimulationReturnMatrixResult | null;
  selection: KodexVooFixedMixSelection;
}) {
  if (
    input.selection.status === "invalid" ||
    input.selection.kodexWeightPct === null ||
    input.selection.vooWeightPct === null ||
    input.selection.kodexWeightBps === null ||
    input.selection.vooWeightBps === null
  ) {
    return blockedResult(
      baseResult(input.selection, null),
      "invalid_weight_selection",
    );
  }

  const weights = buildWeights(
    input.selection.kodexWeightBps,
    input.selection.vooWeightBps,
  );
  const base = {
    ...baseResult(input.selection, weights),
    name: `KODEX 200 ${input.selection.kodexWeightPct}% + VOO ${input.selection.vooWeightPct}%`,
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
    scenarioId: "research-kodex200-voo-explicit-mix",
    scenarioVersion: `v2-${input.selection.kodexWeightBps}-${input.selection.vooWeightBps}`,
    weights,
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

type FixedMixResearchBlockerReason =
  | "invalid_weight_selection"
  | "explicit_end_required"
  | "input_matrix_unavailable"
  | "input_matrix_shape_mismatch"
  | SimulationResearchExecutionBlockerReason;

function blockedResult<
  TWeights extends ReturnType<typeof buildWeights> | null,
>(
  base: {
    id: "kodex200-voo-explicit-mix";
    name: string;
    policy: typeof FIXED_MIX_RESEARCH_SIMULATION_POLICY;
    selection: KodexVooFixedMixSelection;
    weights: TWeights;
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

function baseResult<TWeights extends ReturnType<typeof buildWeights> | null>(
  selection: KodexVooFixedMixSelection,
  weights: TWeights,
) {
  return {
    id: "kodex200-voo-explicit-mix" as const,
    name: "KODEX 200 + VOO 명시 비중",
    policy: FIXED_MIX_RESEARCH_SIMULATION_POLICY,
    selection,
    weights,
    runtimeTrustStatus: "research_only" as const,
  };
}

function buildWeights(kodexWeightBps: number, vooWeightBps: number) {
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
