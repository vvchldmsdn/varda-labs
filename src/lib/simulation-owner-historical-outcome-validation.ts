import { BASIS_POINT_TOTAL } from "./basis-point-allocation.ts";
import { isRiskDate, shiftRiskDate } from "./portfolio-risk-calendar.ts";
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
  SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY,
  type SimulationOwnerResearchExecutionResult,
} from "./simulation-owner-research-execution.ts";
import { executeSimulationResearchPaths } from "./simulation-research-execution-core.ts";
import type { SimulationReturnMatrixResult } from "./simulation-return-matrix-types.ts";

export const SIMULATION_OWNER_HISTORICAL_VALIDATION_POLICY = Object.freeze({
  version: "simulation_owner_current_composition_historical_validation_v1",
  trainingReturnStepCount: 90,
  outcomeReturnStepCount: 21,
  sourceReturnStepCount: 111,
  endpointCount: 7,
  endpointPolicy: "latest_common_end_and_previous_six_calendar_service_dates",
  compositionPolicy:
    "current_listed_subset_weights_applied_retrospectively_without_rebalancing",
  compositionDisclosure:
    "hindsight_current_composition_not_historical_holdings_or_trade_reconstruction",
  priceBasis: "stored_kis_raw_close_with_date_specific_fx",
  adjustmentPolicy: "corporate_actions_and_distributions_not_claimed",
  bootstrapModel: SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY.bootstrapModel,
  pathCount: SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY.pathCount,
  expectedBlockLength:
    SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY.expectedBlockLength,
  seed: SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY.seed,
  missingEndpointPolicy:
    "preserve_ready_rows_and_mark_only_missing_row_unavailable",
  automaticHorizonReduction: "forbidden",
  interpolation: "forbidden",
  providerCalls: "forbidden",
  persistence: "forbidden",
  recommendation: "forbidden",
  optimizer: "forbidden",
  orderAuthority: "forbidden",
  interpretation:
    "retrospective_short_horizon_quality_diagnostic_not_forecast_or_advice",
} as const);

export type SimulationOwnerHistoricalOutcomeValidationResult = ReturnType<
  typeof buildSimulationOwnerHistoricalOutcomeValidation
>;

export type SimulationOwnerHistoricalValidationEndpoint = Readonly<{
  outcomeEndServiceDate: string;
  matrix: SimulationReturnMatrixResult | null;
}>;

export function buildSimulationOwnerHistoricalValidationEndpointDates(
  endServiceDate: string,
) {
  if (!isRiskDate(endServiceDate)) return Object.freeze([] as string[]);
  return Object.freeze(
    Array.from(
      { length: SIMULATION_OWNER_HISTORICAL_VALIDATION_POLICY.endpointCount },
      (_, index) => shiftRiskDate(endServiceDate, -index),
    ),
  );
}

export function buildSimulationOwnerHistoricalOutcomeValidation(input: {
  execution: SimulationOwnerResearchExecutionResult;
  endpoints: readonly SimulationOwnerHistoricalValidationEndpoint[];
}) {
  const policy = SIMULATION_OWNER_HISTORICAL_VALIDATION_POLICY;
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
        weightsByKey,
      }),
    ),
  );
  const aggregate = summarizeSimulationHistoricalOutcomeRows(rows);

  return Object.freeze({
    ...base,
    status: aggregate.status,
    reason: aggregate.reason,
    latestOutcomeEndServiceDate:
      input.execution.endSelection.endServiceDate,
    weights: Object.freeze(
      input.execution.executionWeights.map((row) => Object.freeze({ ...row })),
    ),
    summary: aggregate.summary,
    downsideSummary: aggregate.downsideSummary,
    rows,
  });
}

function buildEndpointRow(input: {
  account: SimulationOwnerResearchExecutionResult["account"];
  endpoint: SimulationOwnerHistoricalValidationEndpoint;
  weightsByKey: ReadonlyMap<string, number>;
}) {
  const matrix = input.endpoint.matrix;
  if (!matrix || matrix.status !== "ready") {
    return unavailableSimulationHistoricalOutcomeRow(
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
    return unavailableSimulationHistoricalOutcomeRow(
      input.endpoint.outcomeEndServiceDate,
      "input_matrix_shape_mismatch",
    );
  }

  const policy = SIMULATION_OWNER_HISTORICAL_VALIDATION_POLICY;
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
  const execution = executeSimulationResearchPaths({
    matrix: trainingMatrix,
    scenarioId: `owner-current-${input.account}-historical-validation`,
    scenarioVersion: "v1",
    weights,
    seed: policy.seed,
    expectedBlockLength: policy.expectedBlockLength,
    horizon: policy.outcomeReturnStepCount,
    pathCount: policy.pathCount,
    samplePathCount: 1,
  });
  if (execution.status !== "ready") {
    return unavailableSimulationHistoricalOutcomeRow(
      input.endpoint.outcomeEndServiceDate,
      "simulation_unavailable",
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
    return unavailableSimulationHistoricalOutcomeRow(
      input.endpoint.outcomeEndServiceDate,
      "observed_path_unavailable",
    );
  }

  return buildSimulationHistoricalOutcomeReadyRow({
    outcomeEndServiceDate: input.endpoint.outcomeEndServiceDate,
    trainingEndServiceDate,
    outcomeStartServiceDate,
    trainingReturnStepCount: trainingMatrix.matrix.length,
    outcomeReturnStepCount: outcomeRows.length,
    predicted: {
      p10ReturnPct: execution.terminal.p10Index - 100,
      p50ReturnPct: execution.terminal.p50ReturnPct,
      p90ReturnPct: execution.terminal.p90Index - 100,
      lossProbabilityPct: execution.terminal.lossProbabilityPct,
      maxDrawdownP50Pct: execution.terminal.maxDrawdownP50Pct,
      maxDrawdownP90Pct: execution.terminal.maxDrawdownP90Pct,
    },
    observed,
  });
}

function isOwnerHistoricalValidationSourceMatrix(
  matrix: SimulationReturnMatrixResult,
  outcomeEndServiceDate: string,
  weightsByKey: ReadonlyMap<string, number>,
) {
  const policy = SIMULATION_OWNER_HISTORICAL_VALIDATION_POLICY;
  const matrixKeys = matrix.instruments.map((row) => row.instrumentKey);
  return (
    matrix.consumerStatus === "matrix_ready" &&
    matrix.blockers.length === 0 &&
    matrix.exclusions.length === 0 &&
    matrix.matrix.length === policy.sourceReturnStepCount &&
    matrix.requestedServiceDates.length === policy.sourceReturnStepCount + 1 &&
    matrix.requestedServiceDates.at(-1) === outcomeEndServiceDate &&
    matrixKeys.length === weightsByKey.size &&
    new Set(matrixKeys).size === matrixKeys.length &&
    matrixKeys.every((key) => weightsByKey.has(key)) &&
    matrixKeys.reduce((sum, key) => sum + (weightsByKey.get(key) ?? -1), 0) ===
      BASIS_POINT_TOTAL &&
    matrix.matrix.every(
      (row, index) =>
        row.previousServiceDate === matrix.requestedServiceDates[index] &&
        row.serviceDate === matrix.requestedServiceDates[index + 1] &&
        row.cells.length === matrixKeys.length &&
        row.cells.every(
          (cell, cellIndex) =>
            cell.instrumentKey === matrixKeys[cellIndex] &&
            typeof cell.value === "number" &&
            Number.isFinite(cell.value) &&
            cell.value > -1,
        ),
    )
  );
}

function unavailable(
  base: Readonly<{
    account: SimulationOwnerResearchExecutionResult["account"];
    policy: typeof SIMULATION_OWNER_HISTORICAL_VALIDATION_POLICY;
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
    rows: Object.freeze([]),
  });
}
