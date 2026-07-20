import type { KodexVooFixedMixSelection } from "./kodex-voo-fixed-mix-selection.ts";
import {
  executeSimulationRegimeBootstrap,
  type SimulationRegimeScenarioInput,
} from "./simulation-regime-bootstrap.ts";
import {
  SIMULATION_REGIME_BOOTSTRAP_POLICY,
  type SimulationRegimeFactorObservation,
} from "./simulation-regime-bootstrap-policy.ts";
import type { SimulationRegimeFactorReadinessSummary } from "./simulation-regime-factor-state.ts";
import {
  inspectSimulationRegimeResearchReadiness,
  type SimulationRegimeResearchReadinessBlockerReason,
} from "./simulation-regime-research-readiness.ts";
import type { SimulationReturnMatrixResult } from "./simulation-return-matrix-types.ts";

export type SimulationRegimeResearchResult = ReturnType<
  typeof buildSimulationRegimeResearch
>;

export function buildSimulationRegimeResearch(input: {
  explicitEndServiceDate: string | null;
  matrix: SimulationReturnMatrixResult | null;
  factorRows: readonly SimulationRegimeFactorObservation[];
  selection: KodexVooFixedMixSelection;
}) {
  const base = Object.freeze({
    policy: SIMULATION_REGIME_BOOTSTRAP_POLICY,
    runtimeTrustStatus: "retrospective_research_only" as const,
    pointInTime: SIMULATION_REGIME_BOOTSTRAP_POLICY.pointInTimeEvidence,
    selection: input.selection,
  });
  const inspection = inspectSimulationRegimeResearchReadiness({
    explicitEndServiceDate: input.explicitEndServiceDate,
    matrix: input.matrix,
    factorRows: input.factorRows,
  });
  if (inspection.status !== "research_ready") {
    return unavailable(
      base,
      inspection.reason,
      inspection.source,
      inspection.readiness,
    );
  }

  const validScenarios = buildValidScenarios(input.selection);
  const execution = executeSimulationRegimeBootstrap({
    matrix: input.matrix!,
    factorState: inspection.factorState,
    scenarios: validScenarios,
  });
  if (execution.status !== "ready") {
    return unavailable(
      base,
      execution.reason,
      inspection.source,
      inspection.readiness,
    );
  }

  const scenarios = [
    ...execution.scenarios,
    ...(input.selection.status === "invalid"
      ? [invalidMixScenario()]
      : []),
  ];
  const readyScenarioCount = scenarios.filter(
    (scenario) => scenario.status === "ready",
  ).length;

  return Object.freeze({
    ...base,
    status: "ready" as const,
    reason: null,
    source: inspection.source,
    readiness: inspection.readiness,
    assumptions: execution.assumptions,
    scenarios: Object.freeze(scenarios),
    summary: Object.freeze({
      scenarioCount: scenarios.length,
      readyScenarioCount,
      unavailableScenarioCount: scenarios.length - readyScenarioCount,
    }),
  });
}

function buildValidScenarios(selection: KodexVooFixedMixSelection) {
  const scenarios: SimulationRegimeScenarioInput[] = [
    Object.freeze({
      id: "regime-kodex200-100",
      name: "KODEX 200 100%",
      weightsBps: Object.freeze([10_000, 0]),
    }),
    Object.freeze({
      id: "regime-voo-100",
      name: "VOO 100%",
      weightsBps: Object.freeze([0, 10_000]),
    }),
  ];
  if (
    selection.status !== "invalid" &&
    selection.kodexWeightBps !== null &&
    selection.vooWeightBps !== null &&
    selection.kodexWeightPct !== null &&
    selection.vooWeightPct !== null
  ) {
    scenarios.push(
      Object.freeze({
        id: "regime-kodex200-voo-explicit-mix",
        name: `KODEX 200 ${selection.kodexWeightPct}% + VOO ${selection.vooWeightPct}%`,
        weightsBps: Object.freeze([
          selection.kodexWeightBps,
          selection.vooWeightBps,
        ]),
      }),
    );
  }
  return Object.freeze(scenarios);
}

function invalidMixScenario() {
  return Object.freeze({
    status: "unavailable" as const,
    reason: "invalid_weight_selection" as const,
    id: "regime-kodex200-voo-explicit-mix",
    name: "KODEX 200 + VOO 명시 비중",
    weightsBps: Object.freeze([]),
    assumptions: null,
    terminal: null,
    bands: Object.freeze([]),
    samplePaths: Object.freeze([]),
  });
}

type RegimeResearchBlockerReason =
  | SimulationRegimeResearchReadinessBlockerReason
  | "invalid_return_matrix_values"
  | "draw_plan_blocked"
  | "scenario_execution_blocked";

function unavailable(
  base: Readonly<{
    policy: typeof SIMULATION_REGIME_BOOTSTRAP_POLICY;
    runtimeTrustStatus: "retrospective_research_only";
    pointInTime: typeof SIMULATION_REGIME_BOOTSTRAP_POLICY.pointInTimeEvidence;
    selection: KodexVooFixedMixSelection;
  }>,
  reason: RegimeResearchBlockerReason,
  source: Readonly<{
    endServiceDate: string;
    returnStepCount: number;
    firstStateDate: string | null;
    lastReturnDate: string | null;
  }> | null,
  readiness: SimulationRegimeFactorReadinessSummary | null,
) {
  return Object.freeze({
    ...base,
    status: "unavailable" as const,
    reason,
    source,
    readiness,
    assumptions: null,
    scenarios: Object.freeze([]),
    summary: Object.freeze({
      scenarioCount: 3,
      readyScenarioCount: 0,
      unavailableScenarioCount: 3,
    }),
  });
}
