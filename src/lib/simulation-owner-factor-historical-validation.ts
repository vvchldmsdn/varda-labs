import {
  calculateWeightedObservedHistoricalOutcome,
} from "./simulation-historical-outcome-engine.ts";
import {
  buildSimulationHistoricalOutcomeReadyRow,
  summarizeSimulationHistoricalOutcomeRows,
  unavailableSimulationHistoricalOutcomeRow,
} from "./simulation-historical-outcome-comparison.ts";
import { sliceReadySimulationReturnMatrix } from "./simulation-historical-outcome-validation-matrix.ts";
import {
  buildSimulationOwnerHistoricalValidationEndpointDates,
  isOwnerHistoricalValidationSourceMatrix,
  SIMULATION_OWNER_HISTORICAL_VALIDATION_POLICY,
  type SimulationOwnerHistoricalValidationEndpoint,
} from "./simulation-owner-historical-outcome-validation.ts";
import {
  buildSimulationOwnerParametricFactorResearch,
  SIMULATION_OWNER_PARAMETRIC_FACTOR_POLICY,
} from "./simulation-owner-parametric-factor.ts";
import type { SimulationOwnerResearchExecutionResult } from "./simulation-owner-research-execution.ts";
import type { SimulationRegimeFactorObservation } from "./simulation-regime-bootstrap-policy.ts";

export const SIMULATION_OWNER_FACTOR_HISTORICAL_VALIDATION_POLICY =
  Object.freeze({
    version: "simulation_owner_factor_historical_validation_v1",
    trainingReturnStepCount:
      SIMULATION_OWNER_HISTORICAL_VALIDATION_POLICY.trainingReturnStepCount,
    outcomeReturnStepCount:
      SIMULATION_OWNER_HISTORICAL_VALIDATION_POLICY.outcomeReturnStepCount,
    sourceReturnStepCount:
      SIMULATION_OWNER_HISTORICAL_VALIDATION_POLICY.sourceReturnStepCount,
    endpointPolicy:
      "exact_owner_bootstrap_historical_validation_endpoint_set",
    factorModelVersion: SIMULATION_OWNER_PARAMETRIC_FACTOR_POLICY.version,
    compositionPolicy:
      "current_listed_subset_weights_applied_retrospectively_without_rebalancing",
    factorAvailabilityPolicy:
      "release_date_strictly_before_each_training_state_date",
    factorVintageAuthority: "not_preserved",
    overlappingOutcomeWindows: "acknowledged_not_independent",
    persistence: "forbidden",
    providerCalls: "forbidden",
    recommendation: "forbidden",
    optimizer: "forbidden",
    orderAuthority: "forbidden",
    interpretation:
      "retrospective_short_horizon_model_diagnostic_not_forecast_or_advice",
  } as const);

export type SimulationOwnerFactorHistoricalValidationResult = ReturnType<
  typeof buildSimulationOwnerFactorHistoricalValidation
>;

export function buildSimulationOwnerFactorHistoricalValidation(input: {
  execution: SimulationOwnerResearchExecutionResult;
  endpoints: readonly SimulationOwnerHistoricalValidationEndpoint[];
  factorRows: readonly SimulationRegimeFactorObservation[];
}) {
  const policy = SIMULATION_OWNER_FACTOR_HISTORICAL_VALIDATION_POLICY;
  const base = Object.freeze({
    account: input.execution.account,
    policy,
    runtimeTrustStatus: "tenant_scoped_read_only_research" as const,
    coverage: input.execution.coverage,
  });

  if (
    input.execution.status !== "ready" ||
    input.execution.endSelection.status !== "valid"
  ) {
    return unavailable(base, "owner_execution_unavailable");
  }

  const expectedDates = buildSimulationOwnerHistoricalValidationEndpointDates(
    input.execution.endSelection.endServiceDate,
  );
  if (
    input.endpoints.length !== expectedDates.length ||
    input.endpoints.some(
      (endpoint, index) => endpoint.outcomeEndServiceDate !== expectedDates[index],
    )
  ) {
    return unavailable(base, "endpoint_set_mismatch");
  }

  const weightsByKey = new Map(
    input.execution.executionWeights.map((row) => [
      row.instrumentKey,
      row.weightBps,
    ]),
  );
  const rows = Object.freeze(
    input.endpoints.map((endpoint) =>
      buildEndpointRow({
        account: input.execution.account,
        endpoint,
        factorRows: input.factorRows,
        weightsByKey,
      }),
    ),
  );
  const aggregate = summarizeSimulationHistoricalOutcomeRows(rows);
  const readyRows = rows.filter((row) => row.status === "ready");

  return Object.freeze({
    ...base,
    status: aggregate.status,
    reason: aggregate.reason,
    latestOutcomeEndServiceDate: input.execution.endSelection.endServiceDate,
    weights: Object.freeze(
      input.execution.executionWeights.map((row) => Object.freeze({ ...row })),
    ),
    summary: aggregate.summary,
    downsideSummary: aggregate.downsideSummary,
    factorSummary: Object.freeze({
      readyEndpointCount: readyRows.length,
      meanAlignedObservationCount:
        readyRows.length > 0
          ? compensatedMean(
              readyRows.map((row) => row.factorAlignedObservationCount),
            )
          : null,
      meanObservationCoveragePct:
        readyRows.length > 0
          ? compensatedMean(
              readyRows.map((row) => row.factorObservationCoveragePct),
            )
          : null,
    }),
    rows,
  });
}

function buildEndpointRow(input: {
  account: string;
  endpoint: SimulationOwnerHistoricalValidationEndpoint;
  factorRows: readonly SimulationRegimeFactorObservation[];
  weightsByKey: ReadonlyMap<string, number>;
}) {
  const matrix = input.endpoint.matrix;
  if (!matrix || matrix.status !== "ready") {
    return unavailableFactorRow(
      input.endpoint.outcomeEndServiceDate,
      "input_matrix_unavailable",
    );
  }
  if (
    !isOwnerHistoricalValidationSourceMatrix(
      matrix,
      input.endpoint.outcomeEndServiceDate,
      input.weightsByKey,
    )
  ) {
    return unavailableFactorRow(
      input.endpoint.outcomeEndServiceDate,
      "input_matrix_shape_mismatch",
    );
  }

  const policy = SIMULATION_OWNER_FACTOR_HISTORICAL_VALIDATION_POLICY;
  const trainingMatrix = sliceReadySimulationReturnMatrix(
    matrix,
    0,
    policy.trainingReturnStepCount,
  );
  const outcomeRows = matrix.matrix.slice(policy.trainingReturnStepCount);
  const weights = matrix.instruments.map((instrument) => ({
    ...instrument,
    weightBps: input.weightsByKey.get(instrument.instrumentKey) ?? -1,
  }));
  const model = buildSimulationOwnerParametricFactorResearch({
    account: input.account,
    matrix: trainingMatrix,
    weights,
    horizon: policy.outcomeReturnStepCount,
    factorRows: input.factorRows,
    ownerExecutionReady: true,
  });
  if (model.status !== "ready") {
    return unavailableFactorRow(
      input.endpoint.outcomeEndServiceDate,
      "factor_model_unavailable",
      model.reason,
      model.source.alignedObservationCount,
      model.source.factorGapRowCount,
    );
  }

  const observed = calculateWeightedObservedHistoricalOutcome(
    outcomeRows,
    weights.map((row) => row.weightBps),
  );
  const trainingEndServiceDate =
    trainingMatrix.requestedServiceDates.at(-1) ?? null;
  const outcomeStartServiceDate = outcomeRows[0]?.serviceDate ?? null;
  if (!observed || !trainingEndServiceDate || !outcomeStartServiceDate) {
    return unavailableFactorRow(
      input.endpoint.outcomeEndServiceDate,
      "observed_path_unavailable",
    );
  }

  const ready = buildSimulationHistoricalOutcomeReadyRow({
    outcomeEndServiceDate: input.endpoint.outcomeEndServiceDate,
    trainingEndServiceDate,
    outcomeStartServiceDate,
    trainingReturnStepCount: trainingMatrix.matrix.length,
    outcomeReturnStepCount: outcomeRows.length,
    predicted: {
      p10ReturnPct: model.terminal.p10Index - 100,
      p50ReturnPct: model.terminal.p50ReturnPct,
      p90ReturnPct: model.terminal.p90Index - 100,
      lossProbabilityPct: model.terminal.lossProbabilityPct,
      maxDrawdownP50Pct: model.terminal.maxDrawdownP50Pct,
      maxDrawdownP90Pct: model.terminal.maxDrawdownP90Pct,
    },
    observed,
  });
  return Object.freeze({
    ...ready,
    factorModelReason: null,
    factorAlignedObservationCount: model.source.alignedObservationCount,
    factorGapRowCount: model.source.factorGapRowCount,
    factorObservationCoveragePct:
      model.source.matrixRowCount > 0
        ? (model.source.alignedObservationCount / model.source.matrixRowCount) *
          100
        : 0,
  });
}

function unavailableFactorRow(
  outcomeEndServiceDate: string,
  reason:
    | "input_matrix_unavailable"
    | "input_matrix_shape_mismatch"
    | "factor_model_unavailable"
    | "observed_path_unavailable",
  factorModelReason: string | null = null,
  factorAlignedObservationCount = 0,
  factorGapRowCount = 0,
) {
  return Object.freeze({
    ...unavailableSimulationHistoricalOutcomeRow(
      outcomeEndServiceDate,
      reason,
    ),
    factorModelReason,
    factorAlignedObservationCount,
    factorGapRowCount,
    factorObservationCoveragePct: null,
  });
}

function unavailable(
  base: Readonly<{
    account: string;
    policy: typeof SIMULATION_OWNER_FACTOR_HISTORICAL_VALIDATION_POLICY;
    runtimeTrustStatus: "tenant_scoped_read_only_research";
    coverage: SimulationOwnerResearchExecutionResult["coverage"];
  }>,
  reason: "owner_execution_unavailable" | "endpoint_set_mismatch",
) {
  return Object.freeze({
    ...base,
    status: "unavailable" as const,
    reason,
    latestOutcomeEndServiceDate: null,
    weights: Object.freeze([]),
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
    factorSummary: Object.freeze({
      readyEndpointCount: 0,
      meanAlignedObservationCount: null,
      meanObservationCoveragePct: null,
    }),
    rows: Object.freeze([]),
  });
}

function compensatedMean(values: readonly number[]) {
  let sum = 0;
  let compensation = 0;
  for (const value of values) {
    const next = sum + value;
    const correction =
      Math.abs(sum) >= Math.abs(value)
        ? (sum - next) + value
        : (value - next) + sum;
    sum = next;
    compensation += correction;
  }
  return (sum + compensation) / values.length;
}
