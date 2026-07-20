import type { KodexVooFixedMixSelection } from "./kodex-voo-fixed-mix-selection.ts";
import {
  executeSimulationRegimeBootstrap,
  type SimulationRegimeScenarioInput,
} from "./simulation-regime-bootstrap.ts";
import {
  SIMULATION_REGIME_BOOTSTRAP_POLICY,
  type SimulationRegimeFactorObservation,
} from "./simulation-regime-bootstrap-policy.ts";
import {
  buildSimulationRegimeFixedMixComparison,
  buildSimulationRegimeFixedMixScenarioInputs,
  isSimulationRegimeFixedMixPreset,
  unavailableSimulationRegimeFixedMixComparison,
} from "./simulation-regime-fixed-mix-comparison.ts";
import type { SimulationRegimeFactorReadinessSummary } from "./simulation-regime-factor-state.ts";
import {
  inspectSimulationRegimeResearchReadiness,
  type SimulationRegimeResearchReadinessBlockerReason,
} from "./simulation-regime-research-readiness.ts";
import type { SimulationReturnMatrixResult } from "./simulation-return-matrix-types.ts";

export type SimulationRegimeResearchResult = ReturnType<
  typeof buildSimulationRegimeResearch
>;

const REGIME_REFERENCE_SCENARIOS = Object.freeze([
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
] satisfies readonly SimulationRegimeScenarioInput[]);

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

  const customScenario = buildCustomScenario(input.selection);
  const engineScenarios = Object.freeze([
    ...REGIME_REFERENCE_SCENARIOS,
    ...buildSimulationRegimeFixedMixScenarioInputs(),
    ...(customScenario ? [customScenario] : []),
  ]);
  const execution = executeSimulationRegimeBootstrap({
    matrix: input.matrix!,
    factorState: inspection.factorState,
    scenarios: engineScenarios,
  });
  if (execution.status !== "ready") {
    return unavailable(
      base,
      execution.reason,
      inspection.source,
      inspection.readiness,
    );
  }

  const referenceScenarios = REGIME_REFERENCE_SCENARIOS.flatMap((definition) => {
    const scenario = execution.scenarios.find(
      (candidate) => candidate.id === definition.id,
    );
    return scenario?.status === "ready" ? [scenario] : [];
  });
  if (referenceScenarios.length !== REGIME_REFERENCE_SCENARIOS.length) {
    return unavailable(
      base,
      "scenario_execution_blocked",
      inspection.source,
      inspection.readiness,
    );
  }

  const explicitScenario = buildExplicitScenarioResult({
    selection: input.selection,
    executionScenarios: execution.scenarios,
  });
  if (explicitScenario.status === "blocked") {
    return unavailable(
      base,
      "scenario_execution_blocked",
      inspection.source,
      inspection.readiness,
    );
  }

  const scenarios = Object.freeze([
    ...referenceScenarios,
    ...(explicitScenario.scenario ? [explicitScenario.scenario] : []),
  ]);
  const fixedMixComparison = buildSimulationRegimeFixedMixComparison({
    scenarios: execution.scenarios,
    pathCount: execution.assumptions.pathCount,
    horizon: execution.assumptions.horizon,
  });
  const allScenarios = [...scenarios, ...fixedMixComparison.scenarios];
  const readyScenarioCount = allScenarios.filter(
    (scenario) => scenario.status === "ready",
  ).length;
  const scenarioCount =
    scenarios.length +
    (fixedMixComparison.status === "ready"
      ? fixedMixComparison.scenarios.length
      : 3);

  return Object.freeze({
    ...base,
    status: "ready" as const,
    reason: null,
    source: inspection.source,
    readiness: inspection.readiness,
    assumptions: execution.assumptions,
    scenarios,
    fixedMixComparison,
    summary: Object.freeze({
      scenarioCount,
      readyScenarioCount,
      unavailableScenarioCount: scenarioCount - readyScenarioCount,
    }),
  });
}

function buildCustomScenario(selection: KodexVooFixedMixSelection) {
  if (
    selection.status !== "invalid" &&
    selection.kodexWeightBps !== null &&
    selection.vooWeightBps !== null &&
    selection.kodexWeightPct !== null &&
    selection.vooWeightPct !== null &&
    !isSimulationRegimeFixedMixPreset(selection.kodexWeightBps)
  ) {
    return Object.freeze({
      id: "regime-kodex200-voo-explicit-mix",
      name: `KODEX 200 ${selection.kodexWeightPct}% + VOO ${selection.vooWeightPct}%`,
      weightsBps: Object.freeze([
        selection.kodexWeightBps,
        selection.vooWeightBps,
      ]),
    } satisfies SimulationRegimeScenarioInput);
  }
  return null;
}

function buildExplicitScenarioResult(input: {
  selection: KodexVooFixedMixSelection;
  executionScenarios: ReturnType<
    typeof executeSimulationRegimeBootstrap
  >["scenarios"];
}) {
  if (input.selection.status === "invalid") {
    return Object.freeze({
      status: "resolved" as const,
      scenario: invalidMixScenario(),
    });
  }
  if (
    input.selection.kodexWeightBps === null ||
    isSimulationRegimeFixedMixPreset(input.selection.kodexWeightBps)
  ) {
    return Object.freeze({ status: "resolved" as const, scenario: null });
  }
  const scenario = input.executionScenarios.find(
    (candidate) => candidate.id === "regime-kodex200-voo-explicit-mix",
  );
  if (!scenario || scenario.status !== "ready") {
    return Object.freeze({ status: "blocked" as const, scenario: null });
  }
  return Object.freeze({ status: "resolved" as const, scenario });
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
  const scenarioCount =
    5 +
    (base.selection.status === "invalid" ||
    (base.selection.kodexWeightBps !== null &&
      !isSimulationRegimeFixedMixPreset(base.selection.kodexWeightBps))
      ? 1
      : 0);
  return Object.freeze({
    ...base,
    status: "unavailable" as const,
    reason,
    source,
    readiness,
    assumptions: null,
    scenarios: Object.freeze([]),
    fixedMixComparison: unavailableSimulationRegimeFixedMixComparison(),
    summary: Object.freeze({
      scenarioCount,
      readyScenarioCount: 0,
      unavailableScenarioCount: scenarioCount,
    }),
  });
}
