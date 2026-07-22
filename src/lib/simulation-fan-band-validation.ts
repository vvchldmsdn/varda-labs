import { isRiskDate, shiftRiskDate } from "./portfolio-risk-calendar.ts";
import { SIMULATION_FAN_BAND_VALIDATION_POLICY } from "./simulation-fan-band-validation-policy.ts";
import {
  calculateFanBandObservedTerminalNav,
  calculateFanBandPredictedTerminalReturns,
} from "./simulation-fan-band-terminal.ts";
import {
  isFanBandValidationSourceMatrix,
  sliceReadySimulationReturnMatrix,
} from "./simulation-fan-band-validation-matrix.ts";
import type { SimulationReturnMatrixResult } from "./simulation-return-matrix-types.ts";

export { SIMULATION_FAN_BAND_VALIDATION_POLICY } from "./simulation-fan-band-validation-policy.ts";

export type SimulationFanBandValidationHistoryResult = ReturnType<
  typeof buildSimulationFanBandValidationHistory
>;

export type SimulationFanBandValidationHistoryReason =
  | "explicit_end_required"
  | "endpoint_set_mismatch"
  | "some_endpoints_unavailable"
  | "all_endpoints_unavailable";

type Endpoint = Readonly<{
  outcomeEndServiceDate: string;
  matrix: SimulationReturnMatrixResult | null;
}>;

type RowBlockerReason =
  | "input_matrix_unavailable"
  | "input_matrix_shape_mismatch"
  | "simulation_unavailable"
  | "observed_path_unavailable";

export function buildSimulationFanBandValidationHistory(input: {
  explicitEndServiceDate: string | null;
  endpoints: readonly Endpoint[];
}) {
  if (!input.explicitEndServiceDate) {
    return unavailable("explicit_end_required");
  }
  if (!isExpectedEndpointSet(input.explicitEndServiceDate, input.endpoints)) {
    return unavailable("endpoint_set_mismatch");
  }

  const rows = Object.freeze(input.endpoints.map(buildEndpointRow));
  const readyRows = rows.filter((row) => row.status === "ready");
  const readyEndpointCount = readyRows.length;
  const unavailableEndpointCount = rows.length - readyEndpointCount;
  const bandHitCount = readyRows.filter((row) => row.inP10P90Band).length;
  const status =
    readyEndpointCount === rows.length
      ? ("ready" as const)
      : readyEndpointCount > 0
        ? ("partial" as const)
        : ("unavailable" as const);
  const reason =
    status === "ready"
      ? null
      : status === "partial"
        ? ("some_endpoints_unavailable" as const)
        : ("all_endpoints_unavailable" as const);

  return Object.freeze({
    status,
    reason,
    runtimeTrustStatus: "research_only" as const,
    policy: SIMULATION_FAN_BAND_VALIDATION_POLICY,
    summary: Object.freeze({
      endpointCount: rows.length,
      readyEndpointCount,
      unavailableEndpointCount,
      bandHitCount,
      bandCoveragePct:
        readyEndpointCount > 0
          ? (bandHitCount / readyEndpointCount) * 100
          : null,
      meanAbsoluteP50ErrorPctPoints:
        readyEndpointCount > 0
          ? compensatedMean(
              readyRows.map((row) => row.absoluteP50ErrorPctPoints),
            )
          : null,
    }),
    rows,
  });
}

function buildEndpointRow(endpoint: Endpoint) {
  const base = {
    outcomeEndServiceDate: endpoint.outcomeEndServiceDate,
  };
  const matrix = endpoint.matrix;
  if (!matrix || matrix.status !== "ready") {
    return blockedRow(base, "input_matrix_unavailable");
  }
  if (!isFanBandValidationSourceMatrix(matrix, endpoint.outcomeEndServiceDate)) {
    return blockedRow(base, "input_matrix_shape_mismatch");
  }

  const policy = SIMULATION_FAN_BAND_VALIDATION_POLICY;
  const trainingMatrix = sliceReadySimulationReturnMatrix(
    matrix,
    0,
    policy.trainingReturnStepCount,
  );
  const outcomeRows = matrix.matrix.slice(policy.trainingReturnStepCount);
  const trainingEndServiceDate =
    trainingMatrix.requestedServiceDates.at(-1) ?? null;
  const outcomeStartServiceDate = outcomeRows[0]?.serviceDate ?? null;
  if (!trainingEndServiceDate || !outcomeStartServiceDate) {
    return blockedRow(base, "input_matrix_shape_mismatch");
  }

  const predicted = calculateFanBandPredictedTerminalReturns(trainingMatrix);
  if (!predicted) {
    return blockedRow(base, "simulation_unavailable");
  }

  const observedTerminalNav = calculateFanBandObservedTerminalNav(outcomeRows);
  if (observedTerminalNav === null) {
    return blockedRow(base, "observed_path_unavailable");
  }

  const actualReturnPct = (observedTerminalNav - 1) * 100;
  const predictedP10ReturnPct = predicted.p10ReturnPct;
  const predictedP50ReturnPct = predicted.p50ReturnPct;
  const predictedP90ReturnPct = predicted.p90ReturnPct;
  const signedP50ErrorPctPoints =
    actualReturnPct - predictedP50ReturnPct;

  return Object.freeze({
    ...base,
    status: "ready" as const,
    reason: null,
    trainingEndServiceDate,
    outcomeStartServiceDate,
    trainingReturnStepCount: trainingMatrix.matrix.length,
    outcomeReturnStepCount: outcomeRows.length,
    predictedP10ReturnPct,
    predictedP50ReturnPct,
    predictedP90ReturnPct,
    actualReturnPct,
    inP10P90Band:
      actualReturnPct >= predictedP10ReturnPct &&
      actualReturnPct <= predictedP90ReturnPct,
    signedP50ErrorPctPoints,
    absoluteP50ErrorPctPoints: Math.abs(signedP50ErrorPctPoints),
  });
}

function neumaierSum(values: readonly number[]) {
  let sum = 0;
  let compensation = 0;
  for (const term of values) {
    const next = sum + term;
    const correction =
      Math.abs(sum) >= Math.abs(term)
        ? (sum - next) + term
        : (term - next) + sum;
    sum = next;
    compensation += correction;
  }
  return sum + compensation;
}

function compensatedMean(values: readonly number[]) {
  return neumaierSum(values) / values.length;
}

function isExpectedEndpointSet(
  explicitEndServiceDate: string,
  endpoints: readonly Endpoint[],
) {
  const policy = SIMULATION_FAN_BAND_VALIDATION_POLICY;
  return (
    isRiskDate(explicitEndServiceDate) &&
    endpoints.length === policy.endpointCount &&
    endpoints.every(
      (endpoint, index) =>
        endpoint.outcomeEndServiceDate ===
        shiftRiskDate(explicitEndServiceDate, -index),
    )
  );
}

function blockedRow(
  base: Readonly<{ outcomeEndServiceDate: string }>,
  reason: RowBlockerReason,
) {
  return Object.freeze({
    ...base,
    status: "unavailable" as const,
    reason,
    trainingEndServiceDate: null,
    outcomeStartServiceDate: null,
    trainingReturnStepCount: null,
    outcomeReturnStepCount: null,
    predictedP10ReturnPct: null,
    predictedP50ReturnPct: null,
    predictedP90ReturnPct: null,
    actualReturnPct: null,
    inP10P90Band: null,
    signedP50ErrorPctPoints: null,
    absoluteP50ErrorPctPoints: null,
  });
}

function unavailable(reason: SimulationFanBandValidationHistoryReason) {
  return Object.freeze({
    status: "unavailable" as const,
    reason,
    runtimeTrustStatus: "research_only" as const,
    policy: SIMULATION_FAN_BAND_VALIDATION_POLICY,
    summary: Object.freeze({
      endpointCount: 0,
      readyEndpointCount: 0,
      unavailableEndpointCount: 0,
      bandHitCount: 0,
      bandCoveragePct: null,
      meanAbsoluteP50ErrorPctPoints: null,
    }),
    rows: Object.freeze([]),
  });
}
