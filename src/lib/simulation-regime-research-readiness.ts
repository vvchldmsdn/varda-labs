import {
  SIMULATION_REGIME_BOOTSTRAP_POLICY,
  type SimulationRegimeFactorObservation,
} from "./simulation-regime-bootstrap-policy.ts";
import {
  buildSimulationRegimeFactorState,
  type ReadySimulationRegimeFactorState,
  type SimulationRegimeFactorReadinessSummary,
  type SimulationRegimeFactorStateBlockerReason,
} from "./simulation-regime-factor-state.ts";
import { validateAndHashReadyReturnMatrix } from "./simulation-stationary-bootstrap-serialization.ts";
import type { SimulationReturnMatrixResult } from "./simulation-return-matrix-types.ts";

const EXPECTED_INSTRUMENT_KEYS = Object.freeze([
  "korea|KRW|069500",
  "us|USD|VOO",
]);

export type SimulationRegimeResearchReadinessBlockerReason =
  | "explicit_end_required"
  | "input_matrix_unavailable"
  | "input_matrix_shape_mismatch"
  | SimulationRegimeFactorStateBlockerReason;

export type SimulationRegimeResearchReadinessResult = ReturnType<
  typeof inspectSimulationRegimeResearchReadiness
>;

export function inspectSimulationRegimeResearchReadiness(input: {
  explicitEndServiceDate: string | null;
  matrix: SimulationReturnMatrixResult | null;
  factorRows: readonly SimulationRegimeFactorObservation[];
}) {
  if (!input.explicitEndServiceDate) {
    return unavailable("explicit_end_required", null, null);
  }
  if (!input.matrix || input.matrix.status !== "ready") {
    return unavailable("input_matrix_unavailable", null, null);
  }

  const matrixValidation = validateAndHashReadyReturnMatrix(input.matrix);
  const matrixEndServiceDate = input.matrix.requestedServiceDates.at(-1) ?? null;
  const instrumentKeys = input.matrix.instruments.map(
    (instrument) => instrument.instrumentKey,
  );
  const source = Object.freeze({
    endServiceDate: input.explicitEndServiceDate,
    returnStepCount: input.matrix.matrix.length,
    firstStateDate: input.matrix.matrix[0]?.previousServiceDate ?? null,
    lastReturnDate: matrixEndServiceDate,
  });

  if (
    !matrixValidation.canonical ||
    input.matrix.matrix.length !==
      SIMULATION_REGIME_BOOTSTRAP_POLICY.sourceReturnStepCount ||
    matrixEndServiceDate !== input.explicitEndServiceDate ||
    !sameStrings(instrumentKeys, EXPECTED_INSTRUMENT_KEYS)
  ) {
    return unavailable("input_matrix_shape_mismatch", source, null);
  }

  const factorState = buildSimulationRegimeFactorState({
    currentStateDate: input.explicitEndServiceDate,
    stateDates: input.matrix.matrix.map((row) => row.previousServiceDate),
    factorRows: input.factorRows,
  });
  if (factorState.status !== "ready") {
    return unavailable(factorState.reason, source, factorState.summary);
  }

  return Object.freeze({
    status: "research_ready" as const,
    reason: null,
    source,
    readiness: factorState.summary,
    factorState,
    pointInTime: SIMULATION_REGIME_BOOTSTRAP_POLICY.pointInTimeEvidence,
  });
}

function unavailable(
  reason: SimulationRegimeResearchReadinessBlockerReason,
  source: Readonly<{
    endServiceDate: string;
    returnStepCount: number;
    firstStateDate: string | null;
    lastReturnDate: string | null;
  }> | null,
  readiness: SimulationRegimeFactorReadinessSummary | null,
) {
  return Object.freeze({
    status: "unavailable" as const,
    reason,
    source,
    readiness,
    factorState: null as ReadySimulationRegimeFactorState | null,
    pointInTime: SIMULATION_REGIME_BOOTSTRAP_POLICY.pointInTimeEvidence,
  });
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
