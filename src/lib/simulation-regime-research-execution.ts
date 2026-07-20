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
  buildSimulationRegimeFactorState,
  type SimulationRegimeFactorReadinessSummary,
  type SimulationRegimeFactorStateBlockerReason,
} from "./simulation-regime-factor-state.ts";
import { validateAndHashReadyReturnMatrix } from "./simulation-stationary-bootstrap-serialization.ts";
import type { SimulationReturnMatrixResult } from "./simulation-return-matrix-types.ts";

const EXPECTED_INSTRUMENT_KEYS = Object.freeze([
  "korea|KRW|069500",
  "us|USD|VOO",
]);

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
    runtimeTrustStatus: "research_only" as const,
    selection: input.selection,
  });
  if (!input.explicitEndServiceDate) {
    return unavailable(base, "explicit_end_required", null, null);
  }
  if (!input.matrix || input.matrix.status !== "ready") {
    return unavailable(base, "input_matrix_unavailable", null, null);
  }

  const matrixValidation = validateAndHashReadyReturnMatrix(input.matrix);
  const matrixEndServiceDate = input.matrix.requestedServiceDates.at(-1) ?? null;
  const instrumentKeys = input.matrix.instruments.map(
    (instrument) => instrument.instrumentKey,
  );
  if (
    !matrixValidation.canonical ||
    input.matrix.matrix.length !==
      SIMULATION_REGIME_BOOTSTRAP_POLICY.sourceReturnStepCount ||
    matrixEndServiceDate !== input.explicitEndServiceDate ||
    !sameStrings(instrumentKeys, EXPECTED_INSTRUMENT_KEYS)
  ) {
    return unavailable(base, "input_matrix_shape_mismatch", null, null);
  }

  const factorState = buildSimulationRegimeFactorState({
    currentStateDate: input.explicitEndServiceDate,
    stateDates: input.matrix.matrix.map((row) => row.previousServiceDate),
    factorRows: input.factorRows,
  });
  const source = Object.freeze({
    endServiceDate: input.explicitEndServiceDate,
    returnStepCount: input.matrix.matrix.length,
    firstStateDate: input.matrix.matrix[0]?.previousServiceDate ?? null,
    lastReturnDate: matrixEndServiceDate,
  });
  if (factorState.status !== "ready") {
    return unavailable(base, factorState.reason, source, factorState.summary);
  }

  const validScenarios = buildValidScenarios(input.selection);
  const execution = executeSimulationRegimeBootstrap({
    matrix: input.matrix,
    factorState,
    scenarios: validScenarios,
  });
  if (execution.status !== "ready") {
    return unavailable(base, execution.reason, source, factorState.summary);
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
    source,
    readiness: factorState.summary,
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
  | "explicit_end_required"
  | "input_matrix_unavailable"
  | "input_matrix_shape_mismatch"
  | SimulationRegimeFactorStateBlockerReason
  | "invalid_return_matrix_values"
  | "draw_plan_blocked"
  | "scenario_execution_blocked";

function unavailable(
  base: Readonly<{
    policy: typeof SIMULATION_REGIME_BOOTSTRAP_POLICY;
    runtimeTrustStatus: "research_only";
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

function sameStrings(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
