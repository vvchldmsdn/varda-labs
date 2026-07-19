import { resolveKodexVooFixedMixSelection } from "./kodex-voo-fixed-mix-selection.ts";
import {
  buildFixedMixResearchSimulationFromContext,
  type FixedMixResearchSimulationResult,
} from "./simulation-fixed-mix-research-execution.ts";
import {
  FIXED_MIX_RESEARCH_SIMULATION_POLICY,
  prepareFixedMixResearchContext,
  type FixedMixResearchContext,
  type FixedMixResearchContextBlockerReason,
} from "./simulation-fixed-mix-research-context.ts";
import type { SimulationReturnMatrixResult } from "./simulation-return-matrix-types.ts";
import type { SimulationResearchExecutionBlockerReason } from "./simulation-research-execution-core.ts";

const PRESET_KODEX_WEIGHTS_PCT = Object.freeze([25, 50, 75] as const);

export const FIXED_MIX_RESEARCH_COMPARISON_POLICY = Object.freeze({
  version: "fixed_mix_shared_pathwise_comparison_v1",
  scenarios: "kodex25_50_75_complements_with_voo",
  sharedSampling:
    "single_prepared_draw_plan_and_gross_growth_reused_pathwise",
  commonRandomNumbers: "same_source_row_sequence_for_each_path_and_step",
  chartScale: "shared_across_all_scenarios",
  ordering: "ascending_kodex_weight_not_performance_rank",
  ranking: "forbidden",
  recommendation: "forbidden",
  optimizer: "forbidden",
  persistence: "forbidden",
  interpretation: "parallel_research_evidence_not_preference",
} as const);

export type FixedMixResearchComparisonResult = ReturnType<
  typeof buildFixedMixResearchComparison
>;

type ReadyExecution = Extract<
  FixedMixResearchSimulationResult,
  { status: "ready" }
>;

export function buildFixedMixResearchComparison(input: {
  explicitEndServiceDate: string | null;
  matrix: SimulationReturnMatrixResult | null;
}) {
  return buildFixedMixResearchComparisonFromContext(
    prepareFixedMixResearchContext(input),
  );
}

export function buildFixedMixResearchComparisonFromContext(
  context: FixedMixResearchContext,
) {
  if (context.status !== "ready") {
    return blockedComparison(context.reason);
  }

  const executions = PRESET_KODEX_WEIGHTS_PCT.map((kodexWeightPct) => {
    const selection = resolveKodexVooFixedMixSelection(
      String(kodexWeightPct),
    );
    return Object.freeze({
      id: `kodex-${kodexWeightPct}-voo-${100 - kodexWeightPct}`,
      kodexWeightPct,
      vooWeightPct: 100 - kodexWeightPct,
      execution: buildFixedMixResearchSimulationFromContext({
        context,
        selection,
      }),
    });
  });
  const firstUnavailable = executions.find(
    (scenario) => scenario.execution.status !== "ready",
  );
  if (
    firstUnavailable &&
    firstUnavailable.execution.status !== "ready"
  ) {
    return blockedComparison(firstUnavailable.execution.reason);
  }

  const scenarios = executions.flatMap((scenario) =>
    scenario.execution.status === "ready"
      ? [
          Object.freeze({
            ...scenario,
            execution: scenario.execution satisfies ReadyExecution,
          }),
        ]
      : [],
  );

  return Object.freeze({
    status: "ready" as const,
    reason: null,
    runtimeTrustStatus: "research_only" as const,
    policy: FIXED_MIX_RESEARCH_COMPARISON_POLICY,
    executionPolicy: FIXED_MIX_RESEARCH_SIMULATION_POLICY,
    source: context.source,
    pairing: Object.freeze({
      status: "shared_pathwise_draw_verified" as const,
      scenarioCount: scenarios.length,
      pathCount: context.prepared.assumptions.pathCount,
      horizon: context.prepared.assumptions.horizon,
    }),
    scenarios: Object.freeze(scenarios),
  });
}

type ComparisonBlockerReason =
  | FixedMixResearchContextBlockerReason
  | SimulationResearchExecutionBlockerReason
  | "invalid_weight_selection";

function blockedComparison(reason: ComparisonBlockerReason) {
  return Object.freeze({
    status: "unavailable" as const,
    reason,
    runtimeTrustStatus: "research_only" as const,
    policy: FIXED_MIX_RESEARCH_COMPARISON_POLICY,
    executionPolicy: FIXED_MIX_RESEARCH_SIMULATION_POLICY,
    source: null,
    pairing: null,
    scenarios: Object.freeze([]),
  });
}
