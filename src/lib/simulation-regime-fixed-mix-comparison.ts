import type {
  SimulationRegimeScenarioInput,
  SimulationRegimeScenarioResult,
} from "./simulation-regime-bootstrap.ts";

const REGIME_FIXED_MIX_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "regime-kodex200-25-voo-75",
    name: "KODEX 200 25% + VOO 75%",
    kodexWeightPct: 25,
    vooWeightPct: 75,
    weightsBps: Object.freeze([2_500, 7_500]),
  }),
  Object.freeze({
    id: "regime-kodex200-50-voo-50",
    name: "KODEX 200 50% + VOO 50%",
    kodexWeightPct: 50,
    vooWeightPct: 50,
    weightsBps: Object.freeze([5_000, 5_000]),
  }),
  Object.freeze({
    id: "regime-kodex200-75-voo-25",
    name: "KODEX 200 75% + VOO 25%",
    kodexWeightPct: 75,
    vooWeightPct: 25,
    weightsBps: Object.freeze([7_500, 2_500]),
  }),
] as const);

export const SIMULATION_REGIME_FIXED_MIX_COMPARISON_POLICY = Object.freeze({
  version: "regime_fixed_mix_shared_draw_comparison_v1",
  scenarios: "kodex25_50_75_complements_with_voo",
  executionBinding: "single_regime_bootstrap_engine_invocation",
  sharedRegimeState: "same_factor_state_and_neighbor_set",
  sharedDrawPlan: "same_source_row_sequence_for_each_path_and_step",
  portfolioPath: "initial_fixed_weight_buy_and_hold_without_rebalancing",
  chartScale: "shared_across_all_three_scenarios",
  ordering: "ascending_kodex_weight_not_performance_rank",
  ranking: "forbidden",
  recommendation: "forbidden",
  stationaryComparison: "forbidden",
  accountBinding: "forbidden",
  currentHoldingsBinding: "forbidden",
  persistence: "forbidden",
  interpretation: "retrospective_parallel_research_not_preference",
} as const);

export type SimulationRegimeFixedMixComparisonResult = ReturnType<
  typeof buildSimulationRegimeFixedMixComparison
>;

export function buildSimulationRegimeFixedMixScenarioInputs() {
  return Object.freeze(
    REGIME_FIXED_MIX_DEFINITIONS.map(
      (definition): SimulationRegimeScenarioInput =>
        Object.freeze({
          id: definition.id,
          name: definition.name,
          weightsBps: definition.weightsBps,
        }),
    ),
  );
}

export function isSimulationRegimeFixedMixPreset(
  kodexWeightBps: number | null,
) {
  return REGIME_FIXED_MIX_DEFINITIONS.some(
    (definition) => definition.weightsBps[0] === kodexWeightBps,
  );
}

export function buildSimulationRegimeFixedMixComparison(input: {
  scenarios: readonly SimulationRegimeScenarioResult[];
  pathCount: number;
  horizon: number;
}) {
  const scenarios = [];
  for (const definition of REGIME_FIXED_MIX_DEFINITIONS) {
    const scenario = input.scenarios.find(
      (candidate) => candidate.id === definition.id,
    );
    if (!scenario || scenario.status !== "ready") {
      return unavailableComparison("shared_scenario_unavailable");
    }
    if (
      !sameNumbers(scenario.weightsBps, definition.weightsBps) ||
      scenario.assumptions.pathCount !== input.pathCount ||
      scenario.assumptions.horizon !== input.horizon ||
      scenario.bands.length !== input.horizon + 1
    ) {
      return unavailableComparison("shared_execution_mismatch");
    }
    scenarios.push(
      Object.freeze({
        ...scenario,
        kodexWeightPct: definition.kodexWeightPct,
        vooWeightPct: definition.vooWeightPct,
      }),
    );
  }

  return Object.freeze({
    status: "ready" as const,
    reason: null,
    policy: SIMULATION_REGIME_FIXED_MIX_COMPARISON_POLICY,
    pairing: Object.freeze({
      status: "shared_regime_state_and_draw_plan_verified" as const,
      scenarioCount: scenarios.length,
      pathCount: input.pathCount,
      horizon: input.horizon,
    }),
    scenarios: Object.freeze(scenarios),
  });
}

export function unavailableSimulationRegimeFixedMixComparison() {
  return unavailableComparison("regime_research_unavailable");
}

function unavailableComparison(
  reason:
    | "regime_research_unavailable"
    | "shared_scenario_unavailable"
    | "shared_execution_mismatch",
) {
  return Object.freeze({
    status: "unavailable" as const,
    reason,
    policy: SIMULATION_REGIME_FIXED_MIX_COMPARISON_POLICY,
    pairing: null,
    scenarios: Object.freeze([]),
  });
}

function sameNumbers(left: readonly number[], right: readonly number[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
