import { isRiskDate, shiftRiskDate } from "./portfolio-risk-calendar.ts";
import {
  createSimulationDownsideOutcomeValidationPolicy,
} from "./simulation-downside-outcome-validation-policy.ts";
import {
  createSimulationFanBandValidationPolicy,
  type SimulationFanBandValidationPolicy,
} from "./simulation-fan-band-validation-policy.ts";
import {
  calculateObservedHistoricalOutcome,
  calculatePredictedHistoricalOutcome,
} from "./simulation-historical-outcome-engine.ts";
import {
  buildSimulationHistoricalOutcomeReadyRow,
  summarizeSimulationHistoricalOutcomeRows,
  unavailableSimulationHistoricalOutcomeRow,
} from "./simulation-historical-outcome-comparison.ts";
import {
  isHistoricalOutcomeValidationSourceMatrix,
  sliceReadySimulationReturnMatrix,
} from "./simulation-historical-outcome-validation-matrix.ts";
import {
  SIMULATION_RESEARCH_HORIZON_POLICY,
  type SimulationResearchHorizon,
} from "./simulation-research-horizon.ts";
import type { SimulationReturnMatrixResult } from "./simulation-return-matrix-types.ts";

export { SIMULATION_FAN_BAND_VALIDATION_POLICY } from "./simulation-fan-band-validation-policy.ts";
export { SIMULATION_DOWNSIDE_OUTCOME_VALIDATION_POLICY } from "./simulation-downside-outcome-validation-policy.ts";

export type SimulationHistoricalOutcomeValidationResult = ReturnType<
  typeof buildSimulationHistoricalOutcomeValidation
>;

export type SimulationHistoricalOutcomeValidationReason =
  | "invalid_horizon_selection"
  | "explicit_end_required"
  | "endpoint_set_mismatch"
  | "some_endpoints_unavailable"
  | "all_endpoints_unavailable";

type Endpoint = Readonly<{
  outcomeEndServiceDate: string;
  matrix: SimulationReturnMatrixResult | null;
}>;

export function buildSimulationHistoricalOutcomeValidation(input: {
  explicitEndServiceDate: string | null;
  endpoints: readonly Endpoint[];
  horizon?: SimulationResearchHorizon | null;
}) {
  const horizon =
    input.horizon === undefined
      ? SIMULATION_RESEARCH_HORIZON_POLICY.defaultHorizon
      : input.horizon;
  if (horizon === null) {
    return unavailable("invalid_horizon_selection", null);
  }
  const policy = createSimulationFanBandValidationPolicy(horizon);
  const downsidePolicy =
    createSimulationDownsideOutcomeValidationPolicy(policy);
  if (!input.explicitEndServiceDate) {
    return unavailable("explicit_end_required", policy);
  }
  if (
    !isExpectedEndpointSet(
      input.explicitEndServiceDate,
      input.endpoints,
      policy,
    )
  ) {
    return unavailable("endpoint_set_mismatch", policy);
  }

  const rows = Object.freeze(
    input.endpoints.map((endpoint) => buildEndpointRow(endpoint, policy)),
  );
  const aggregate = summarizeSimulationHistoricalOutcomeRows(rows);

  return Object.freeze({
    status: aggregate.status,
    reason: aggregate.reason,
    runtimeTrustStatus: "research_only" as const,
    horizon,
    policy,
    downsidePolicy,
    summary: aggregate.summary,
    downsideSummary: aggregate.downsideSummary,
    rows,
  });
}

function buildEndpointRow(
  endpoint: Endpoint,
  policy: SimulationFanBandValidationPolicy,
) {
  const base = {
    outcomeEndServiceDate: endpoint.outcomeEndServiceDate,
  };
  const matrix = endpoint.matrix;
  if (!matrix || matrix.status !== "ready") {
    return unavailableSimulationHistoricalOutcomeRow(
      base.outcomeEndServiceDate,
      "input_matrix_unavailable",
    );
  }
  if (
    !isHistoricalOutcomeValidationSourceMatrix(
      matrix,
      endpoint.outcomeEndServiceDate,
      policy,
    )
  ) {
    return unavailableSimulationHistoricalOutcomeRow(
      base.outcomeEndServiceDate,
      "input_matrix_shape_mismatch",
    );
  }

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
    return unavailableSimulationHistoricalOutcomeRow(
      base.outcomeEndServiceDate,
      "input_matrix_shape_mismatch",
    );
  }

  const predicted = calculatePredictedHistoricalOutcome(
    trainingMatrix,
    policy.outcomeReturnStepCount,
  );
  if (!predicted) {
    return unavailableSimulationHistoricalOutcomeRow(
      base.outcomeEndServiceDate,
      "simulation_unavailable",
    );
  }

  const observed = calculateObservedHistoricalOutcome(outcomeRows);
  if (!observed) {
    return unavailableSimulationHistoricalOutcomeRow(
      base.outcomeEndServiceDate,
      "observed_path_unavailable",
    );
  }

  return buildSimulationHistoricalOutcomeReadyRow({
    outcomeEndServiceDate: base.outcomeEndServiceDate,
    trainingEndServiceDate,
    outcomeStartServiceDate,
    trainingReturnStepCount: trainingMatrix.matrix.length,
    outcomeReturnStepCount: outcomeRows.length,
    predicted,
    observed,
  });
}

function isExpectedEndpointSet(
  explicitEndServiceDate: string,
  endpoints: readonly Endpoint[],
  policy: SimulationFanBandValidationPolicy,
) {
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

function unavailable(
  reason: SimulationHistoricalOutcomeValidationReason,
  policy: SimulationFanBandValidationPolicy | null,
) {
  return Object.freeze({
    status: "unavailable" as const,
    reason,
    runtimeTrustStatus: "research_only" as const,
    horizon: policy?.outcomeReturnStepCount ?? null,
    policy,
    downsidePolicy: policy
      ? createSimulationDownsideOutcomeValidationPolicy(policy)
      : null,
    summary: Object.freeze({
      endpointCount: 0,
      readyEndpointCount: 0,
      unavailableEndpointCount: 0,
      bandHitCount: 0,
      bandCoveragePct: null,
      meanAbsoluteP50ErrorPctPoints: null,
    }),
    downsideSummary: Object.freeze({
      readyEndpointCount: 0,
      unavailableEndpointCount: 0,
      meanPredictedLossProbabilityPct: null,
      actualLossEndpointCount: 0,
      actualWithinPredictedMddP90Count: 0,
      meanAbsoluteMddP50ErrorPctPoints: null,
    }),
    rows: Object.freeze([]),
  });
}
