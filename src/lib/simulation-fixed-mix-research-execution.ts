import type { KodexVooFixedMixSelection } from "./kodex-voo-fixed-mix-selection.ts";
import type { SimulationReturnMatrixResult } from "./simulation-return-matrix-types.ts";
import {
  buildFixedMixResearchWeights,
  FIXED_MIX_RESEARCH_SIMULATION_POLICY,
  prepareFixedMixResearchContext,
  type FixedMixResearchContext,
  type FixedMixResearchContextBlockerReason,
} from "./simulation-fixed-mix-research-context.ts";
import {
  executeSimulationResearchPathsFromPrepared,
  type SimulationResearchExecutionBlockerReason,
} from "./simulation-research-execution-core.ts";
import type { SimulationResearchHorizon } from "./simulation-research-horizon.ts";

export { FIXED_MIX_RESEARCH_SIMULATION_POLICY } from "./simulation-fixed-mix-research-context.ts";

export type FixedMixResearchSimulationResult = ReturnType<
  typeof buildFixedMixResearchSimulation
>;

export function buildFixedMixResearchSimulation(input: {
  explicitEndServiceDate: string | null;
  matrix: SimulationReturnMatrixResult | null;
  selection: KodexVooFixedMixSelection;
  horizon?: SimulationResearchHorizon | null;
}) {
  const context =
    input.selection.status === "invalid"
      ? null
      : prepareFixedMixResearchContext(input);

  return buildFixedMixResearchSimulationFromContext({
    context,
    selection: input.selection,
  });
}

export function buildFixedMixResearchSimulationFromContext(input: {
  context: FixedMixResearchContext | null;
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

  const weights = buildFixedMixResearchWeights(
    input.selection.kodexWeightBps,
    input.selection.vooWeightBps,
  );
  const base = {
    ...baseResult(input.selection, weights),
    name: `KODEX 200 ${input.selection.kodexWeightPct}% + VOO ${input.selection.vooWeightPct}%`,
  };

  if (!input.context || input.context.status !== "ready") {
    return blockedResult(
      base,
      input.context?.reason ?? "input_matrix_unavailable",
    );
  }

  const execution = executeSimulationResearchPathsFromPrepared({
    prepared: input.context.prepared,
    scenarioId: "research-kodex200-voo-explicit-mix",
    scenarioVersion: `v2-${input.selection.kodexWeightBps}-${input.selection.vooWeightBps}`,
    weights,
    samplePathCount: FIXED_MIX_RESEARCH_SIMULATION_POLICY.samplePathCount,
  });
  if (execution.status !== "ready") {
    return blockedResult(base, execution.reason);
  }

  return Object.freeze({
    ...base,
    ...execution,
    source: input.context.source,
  });
}

type FixedMixResearchBlockerReason =
  | "invalid_weight_selection"
  | FixedMixResearchContextBlockerReason
  | SimulationResearchExecutionBlockerReason;

function blockedResult<
  TWeights extends ReturnType<typeof buildFixedMixResearchWeights> | null,
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

function baseResult<
  TWeights extends ReturnType<typeof buildFixedMixResearchWeights> | null,
>(
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
