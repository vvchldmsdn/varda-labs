import { isRiskDate, shiftRiskDate } from "./portfolio-risk-calendar.ts";
import {
  buildSimulationHistoricalOutcomeReadyRow,
  summarizeSimulationHistoricalOutcomeRows,
  unavailableSimulationHistoricalOutcomeRow,
} from "./simulation-historical-outcome-comparison.ts";
import { calculateObservedHistoricalOutcome } from "./simulation-historical-outcome-engine.ts";
import {
  isHistoricalOutcomeValidationSourceMatrix,
  sliceReadySimulationReturnMatrix,
} from "./simulation-historical-outcome-validation-matrix.ts";
import {
  executeSimulationRegimeBootstrap,
  type SimulationRegimeScenarioInput,
} from "./simulation-regime-bootstrap.ts";
import {
  SIMULATION_REGIME_BOOTSTRAP_POLICY,
  type SimulationRegimeFactorObservation,
} from "./simulation-regime-bootstrap-policy.ts";
import {
  inspectSimulationRegimeResearchReadiness,
  type SimulationRegimeResearchReadinessBlockerReason,
} from "./simulation-regime-research-readiness.ts";
import type { SimulationReturnMatrixResult } from "./simulation-return-matrix-types.ts";

export const SIMULATION_REGIME_HISTORICAL_OUTCOME_VALIDATION_POLICY =
  Object.freeze({
    version: "regime_bootstrap_historical_outcome_validation_v1",
    engineVersion: SIMULATION_REGIME_BOOTSTRAP_POLICY.version,
    endpointCount: 7,
    trainingReturnStepCount:
      SIMULATION_REGIME_BOOTSTRAP_POLICY.sourceReturnStepCount,
    outcomeReturnStepCount: SIMULATION_REGIME_BOOTSTRAP_POLICY.horizon,
    sourceReturnStepCount:
      SIMULATION_REGIME_BOOTSTRAP_POLICY.sourceReturnStepCount +
      SIMULATION_REGIME_BOOTSTRAP_POLICY.horizon,
    scenario: Object.freeze({
      id: "regime-historical-equal-mix",
      name: "KODEX 200 50% + VOO 50%",
      weightsBps: Object.freeze([5_000, 5_000]),
    }),
    resultRole: "retrospective_research_only",
    pointInTimeStatus: "not_established",
    factorTemporalRule:
      "release_date_strictly_before_research_origin_without_available_at_or_vintage",
    overlappingEndpoints: "descriptive_not_independent",
    calibrationDecision: "forbidden",
    modelRanking: "forbidden",
    stationaryFallback: "forbidden",
    accountBinding: "forbidden",
    currentHoldingsBinding: "forbidden",
    providerBackfill: "forbidden",
    recommendation: "forbidden",
    optimizer: "forbidden",
    persistence: "forbidden",
  } as const);

export type SimulationRegimeHistoricalOutcomeValidationResult = ReturnType<
  typeof buildSimulationRegimeHistoricalOutcomeValidation
>;

export type SimulationRegimeHistoricalOutcomeValidationReason =
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
  | SimulationRegimeResearchReadinessBlockerReason
  | "invalid_return_matrix_values"
  | "draw_plan_blocked"
  | "scenario_execution_blocked"
  | "observed_path_unavailable";

const VALIDATION_SCENARIO = Object.freeze({
  ...SIMULATION_REGIME_HISTORICAL_OUTCOME_VALIDATION_POLICY.scenario,
} satisfies SimulationRegimeScenarioInput);

export function buildSimulationRegimeHistoricalOutcomeValidation(input: {
  explicitEndServiceDate: string | null;
  endpoints: readonly Endpoint[];
  factorRows: readonly SimulationRegimeFactorObservation[];
}) {
  const policy = SIMULATION_REGIME_HISTORICAL_OUTCOME_VALIDATION_POLICY;
  if (!input.explicitEndServiceDate) {
    return unavailable("explicit_end_required");
  }
  if (
    !isExpectedEndpointSet(
      input.explicitEndServiceDate,
      input.endpoints,
    )
  ) {
    return unavailable("endpoint_set_mismatch");
  }

  const rows = Object.freeze(
    input.endpoints.map((endpoint) =>
      buildEndpointRow(endpoint, input.factorRows),
    ),
  );
  const aggregate = summarizeSimulationHistoricalOutcomeRows(rows);

  return Object.freeze({
    status: aggregate.status,
    reason: aggregate.reason,
    runtimeTrustStatus: policy.resultRole,
    pointInTimeStatus: policy.pointInTimeStatus,
    policy,
    summary: aggregate.summary,
    downsideSummary: aggregate.downsideSummary,
    rows,
  });
}

function buildEndpointRow(
  endpoint: Endpoint,
  factorRows: readonly SimulationRegimeFactorObservation[],
) {
  const outcomeEndServiceDate = endpoint.outcomeEndServiceDate;
  const matrix = endpoint.matrix;
  if (!matrix || matrix.status !== "ready") {
    return blockedRow(
      outcomeEndServiceDate,
      "input_matrix_unavailable",
    );
  }
  if (
    !isHistoricalOutcomeValidationSourceMatrix(
      matrix,
      outcomeEndServiceDate,
      SIMULATION_REGIME_HISTORICAL_OUTCOME_VALIDATION_POLICY,
    )
  ) {
    return blockedRow(
      outcomeEndServiceDate,
      "input_matrix_shape_mismatch",
    );
  }

  const trainingMatrix = sliceReadySimulationReturnMatrix(
    matrix,
    0,
    SIMULATION_REGIME_HISTORICAL_OUTCOME_VALIDATION_POLICY
      .trainingReturnStepCount,
  );
  const outcomeRows = matrix.matrix.slice(
    SIMULATION_REGIME_HISTORICAL_OUTCOME_VALIDATION_POLICY
      .trainingReturnStepCount,
  );
  const researchOriginServiceDate =
    trainingMatrix.requestedServiceDates.at(-1) ?? null;
  const outcomeStartServiceDate =
    outcomeRows[0]?.serviceDate ?? null;
  if (!researchOriginServiceDate || !outcomeStartServiceDate) {
    return blockedRow(
      outcomeEndServiceDate,
      "input_matrix_shape_mismatch",
    );
  }

  const inspection = inspectSimulationRegimeResearchReadiness({
    explicitEndServiceDate: researchOriginServiceDate,
    matrix: trainingMatrix,
    factorRows,
  });
  if (inspection.status !== "research_ready") {
    return blockedRow(outcomeEndServiceDate, inspection.reason);
  }

  const execution = executeSimulationRegimeBootstrap({
    matrix: trainingMatrix,
    factorState: inspection.factorState,
    scenarios: Object.freeze([VALIDATION_SCENARIO]),
  });
  if (execution.status !== "ready") {
    return blockedRow(outcomeEndServiceDate, execution.reason);
  }
  const scenario = execution.scenarios[0];
  if (scenario?.status !== "ready" || !scenario.terminal) {
    return blockedRow(
      outcomeEndServiceDate,
      "scenario_execution_blocked",
    );
  }

  const observed = calculateObservedHistoricalOutcome(outcomeRows);
  if (!observed) {
    return blockedRow(
      outcomeEndServiceDate,
      "observed_path_unavailable",
    );
  }

  const comparison = buildSimulationHistoricalOutcomeReadyRow({
    outcomeEndServiceDate,
    trainingEndServiceDate: researchOriginServiceDate,
    outcomeStartServiceDate,
    trainingReturnStepCount: trainingMatrix.matrix.length,
    outcomeReturnStepCount: outcomeRows.length,
    predicted: {
      p10ReturnPct: scenario.terminal.p10Index - 100,
      p50ReturnPct: scenario.terminal.p50ReturnPct,
      p90ReturnPct: scenario.terminal.p90Index - 100,
      lossProbabilityPct: scenario.terminal.lossProbabilityPct,
      maxDrawdownP50Pct: scenario.terminal.maxDrawdownP50Pct,
      maxDrawdownP90Pct: scenario.terminal.maxDrawdownP90Pct,
    },
    observed,
  });

  return Object.freeze({
    ...comparison,
    pointInTimeStatus:
      SIMULATION_REGIME_HISTORICAL_OUTCOME_VALIDATION_POLICY
        .pointInTimeStatus,
    factorReleaseDates: Object.freeze(
      inspection.readiness.factors.map((factor) =>
        Object.freeze({
          factorKey: factor.factorKey,
          releaseDate: factor.currentReleaseDate,
        }),
      ),
    ),
  });
}

function blockedRow(
  outcomeEndServiceDate: string,
  reason: RowBlockerReason,
) {
  return Object.freeze({
    ...unavailableSimulationHistoricalOutcomeRow(
      outcomeEndServiceDate,
      reason,
    ),
    pointInTimeStatus:
      SIMULATION_REGIME_HISTORICAL_OUTCOME_VALIDATION_POLICY
        .pointInTimeStatus,
    factorReleaseDates: null,
  });
}

function isExpectedEndpointSet(
  explicitEndServiceDate: string,
  endpoints: readonly Endpoint[],
) {
  if (
    !isRiskDate(explicitEndServiceDate) ||
    endpoints.length !==
      SIMULATION_REGIME_HISTORICAL_OUTCOME_VALIDATION_POLICY
        .endpointCount
  ) {
    return false;
  }
  return endpoints.every(
    (endpoint, index) =>
      endpoint.outcomeEndServiceDate ===
      shiftRiskDate(explicitEndServiceDate, -index),
  );
}

function unavailable(
  reason: SimulationRegimeHistoricalOutcomeValidationReason,
) {
  return Object.freeze({
    status: "unavailable" as const,
    reason,
    runtimeTrustStatus:
      SIMULATION_REGIME_HISTORICAL_OUTCOME_VALIDATION_POLICY
        .resultRole,
    pointInTimeStatus:
      SIMULATION_REGIME_HISTORICAL_OUTCOME_VALIDATION_POLICY
        .pointInTimeStatus,
    policy: SIMULATION_REGIME_HISTORICAL_OUTCOME_VALIDATION_POLICY,
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
