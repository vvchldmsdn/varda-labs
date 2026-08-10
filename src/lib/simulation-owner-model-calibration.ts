import type { SimulationOwnerFactorHistoricalValidationResult } from "./simulation-owner-factor-historical-validation.ts";
import {
  SIMULATION_OWNER_HISTORICAL_VALIDATION_POLICY,
  type SimulationOwnerHistoricalOutcomeValidationResult,
} from "./simulation-owner-historical-outcome-validation.ts";

export const SIMULATION_OWNER_MODEL_CALIBRATION_POLICY = Object.freeze({
  version: "simulation_owner_model_calibration_v2",
  maximumEndpointCount:
    SIMULATION_OWNER_HISTORICAL_VALIDATION_POLICY.maximumEndpointCount,
  pairing:
    "same_account_weights_endpoint_training_window_outcome_window_and_observed_path",
  centralEstimateMetric: "mean_absolute_p50_error_percentage_points",
  intervalMetric: "p10_p90_empirical_coverage",
  lossProbabilityMetric: "brier_score",
  drawdownMetric: "mean_absolute_p50_drawdown_error_percentage_points",
  outcomeWindowOverlap: "forbidden_by_service_date_stride",
  statisticalConfidence: "not_established",
  modelSelection: "forbidden",
  probabilityAveraging: "forbidden",
  persistence: "forbidden",
  providerCalls: "forbidden",
  recommendation: "forbidden",
  optimizer: "forbidden",
  orderAuthority: "forbidden",
  interpretation:
    "retrospective_error_diagnostic_on_non_overlapping_short_windows_not_model_ranking",
} as const);

export type SimulationOwnerModelCalibrationResult = ReturnType<
  typeof buildSimulationOwnerModelCalibration
>;

export function buildSimulationOwnerModelCalibration(input: {
  bootstrap: SimulationOwnerHistoricalOutcomeValidationResult;
  factor: SimulationOwnerFactorHistoricalValidationResult;
}) {
  const base = Object.freeze({
    id: `owner-model-calibration-${input.bootstrap.account}`,
    account: input.bootstrap.account,
    policy: SIMULATION_OWNER_MODEL_CALIBRATION_POLICY,
    sourceStatuses: Object.freeze({
      bootstrap: input.bootstrap.status,
      factor: input.factor.status,
    }),
  });

  if (input.bootstrap.account !== input.factor.account) {
    return unavailable(base, "account_mismatch");
  }
  if (!sameWeights(input.bootstrap.weights, input.factor.weights)) {
    return unavailable(base, "weight_identity_mismatch");
  }
  if (
    input.bootstrap.rows.length !== input.factor.rows.length ||
    input.bootstrap.rows.some(
      (row, index) =>
        row.outcomeEndServiceDate !==
        input.factor.rows[index]?.outcomeEndServiceDate,
    )
  ) {
    return unavailable(base, "endpoint_identity_mismatch");
  }

  const rows = Object.freeze(
    input.bootstrap.rows.map((bootstrap, index) =>
      pairEndpoint(bootstrap, input.factor.rows[index]),
    ),
  );
  const readyRows = rows.filter((row) => row.status === "ready");
  const pairedEndpointCount = readyRows.length;
  const status =
    pairedEndpointCount === rows.length
      ? ("ready" as const)
      : pairedEndpointCount > 0
        ? ("partial" as const)
        : ("unavailable" as const);
  const bootstrapSummary = summarizeModel(
    readyRows.map((row) => row.bootstrap),
  );
  const factorSummary = summarizeModel(
    readyRows.map((row) => row.factor),
  );
  const effectiveNonOverlappingWindowCount = countNonOverlappingWindows(
    readyRows,
  );

  return Object.freeze({
    ...base,
    status,
    reason:
      status === "ready"
        ? null
        : status === "partial"
          ? ("some_endpoints_unavailable" as const)
          : ("no_paired_endpoints" as const),
    weights: Object.freeze(
      input.bootstrap.weights.map((row) => Object.freeze({ ...row })),
    ),
    summary: Object.freeze({
      endpointCount: rows.length,
      pairedEndpointCount,
      unavailableEndpointCount: rows.length - pairedEndpointCount,
      effectiveNonOverlappingWindowCount,
      overlappingPairedEndpointCount: Math.max(
        0,
        pairedEndpointCount - effectiveNonOverlappingWindowCount,
      ),
      bootstrap: bootstrapSummary,
      factor: factorSummary,
      deltas: Object.freeze({
        factorMinusBootstrapMeanAbsoluteP50ErrorPctPoints:
          nullableDifference(
            factorSummary.meanAbsoluteP50ErrorPctPoints,
            bootstrapSummary.meanAbsoluteP50ErrorPctPoints,
          ),
        factorMinusBootstrapBandCoveragePctPoints: nullableDifference(
          factorSummary.bandCoveragePct,
          bootstrapSummary.bandCoveragePct,
        ),
        factorMinusBootstrapLossBrierScore: nullableDifference(
          factorSummary.lossBrierScore,
          bootstrapSummary.lossBrierScore,
        ),
        factorMinusBootstrapMeanAbsoluteMddP50ErrorPctPoints:
          nullableDifference(
            factorSummary.meanAbsoluteMddP50ErrorPctPoints,
            bootstrapSummary.meanAbsoluteMddP50ErrorPctPoints,
          ),
      }),
    }),
    rows,
  });
}

function pairEndpoint(
  bootstrap: SimulationOwnerHistoricalOutcomeValidationResult["rows"][number],
  factor: SimulationOwnerFactorHistoricalValidationResult["rows"][number] | undefined,
) {
  const outcomeEndServiceDate = bootstrap.outcomeEndServiceDate;
  if (!factor || factor.outcomeEndServiceDate !== outcomeEndServiceDate) {
    return unavailableRow(
      outcomeEndServiceDate,
      "endpoint_identity_mismatch",
      bootstrap.status,
      factor?.status ?? "missing",
    );
  }
  if (bootstrap.status !== "ready" || factor.status !== "ready") {
    return unavailableRow(
      outcomeEndServiceDate,
      "source_endpoint_unavailable",
      bootstrap.status,
      factor.status,
    );
  }
  if (
    bootstrap.trainingEndServiceDate !== factor.trainingEndServiceDate ||
    bootstrap.outcomeStartServiceDate !== factor.outcomeStartServiceDate ||
    bootstrap.trainingReturnStepCount !== factor.trainingReturnStepCount ||
    bootstrap.outcomeReturnStepCount !== factor.outcomeReturnStepCount
  ) {
    return unavailableRow(
      outcomeEndServiceDate,
      "window_identity_mismatch",
      bootstrap.status,
      factor.status,
    );
  }
  if (
    !nearlyEqual(bootstrap.actualReturnPct, factor.actualReturnPct) ||
    bootstrap.actualTerminalLoss !== factor.actualTerminalLoss ||
    !nearlyEqual(bootstrap.actualMaxDrawdownPct, factor.actualMaxDrawdownPct)
  ) {
    return unavailableRow(
      outcomeEndServiceDate,
      "observed_outcome_mismatch",
      bootstrap.status,
      factor.status,
    );
  }

  return Object.freeze({
    outcomeEndServiceDate,
    status: "ready" as const,
    reason: null,
    trainingEndServiceDate: bootstrap.trainingEndServiceDate,
    outcomeStartServiceDate: bootstrap.outcomeStartServiceDate,
    outcomeReturnStepCount: bootstrap.outcomeReturnStepCount,
    actual: Object.freeze({
      returnPct: bootstrap.actualReturnPct,
      terminalLoss: bootstrap.actualTerminalLoss,
      maxDrawdownPct: bootstrap.actualMaxDrawdownPct,
    }),
    bootstrap: projectModel(bootstrap),
    factor: Object.freeze({
      ...projectModel(factor),
      alignedObservationCount: factor.factorAlignedObservationCount,
      observationCoveragePct: factor.factorObservationCoveragePct,
    }),
  });
}

function projectModel(
  row:
    | Extract<
        SimulationOwnerHistoricalOutcomeValidationResult["rows"][number],
        { status: "ready" }
      >
    | Extract<
        SimulationOwnerFactorHistoricalValidationResult["rows"][number],
        { status: "ready" }
      >,
) {
  return Object.freeze({
    predictedP10ReturnPct: row.predictedP10ReturnPct,
    predictedP50ReturnPct: row.predictedP50ReturnPct,
    predictedP90ReturnPct: row.predictedP90ReturnPct,
    absoluteP50ErrorPctPoints: row.absoluteP50ErrorPctPoints,
    inP10P90Band: row.inP10P90Band,
    predictedLossProbabilityPct: row.predictedLossProbabilityPct,
    lossBrierScore: brierScore(
      row.predictedLossProbabilityPct,
      row.actualTerminalLoss,
    ),
    predictedMaxDrawdownP50Pct: row.predictedMaxDrawdownP50Pct,
    absoluteMddP50ErrorPctPoints: row.absoluteMddP50ErrorPctPoints,
  });
}

function summarizeModel(
  rows: readonly Readonly<{
    absoluteP50ErrorPctPoints: number;
    inP10P90Band: boolean;
    lossBrierScore: number;
    absoluteMddP50ErrorPctPoints: number;
  }>[],
) {
  if (rows.length === 0) {
    return Object.freeze({
      endpointCount: 0,
      meanAbsoluteP50ErrorPctPoints: null,
      bandHitCount: 0,
      bandCoveragePct: null,
      lossBrierScore: null,
      meanAbsoluteMddP50ErrorPctPoints: null,
    });
  }
  const bandHitCount = rows.filter((row) => row.inP10P90Band).length;
  return Object.freeze({
    endpointCount: rows.length,
    meanAbsoluteP50ErrorPctPoints: compensatedMean(
      rows.map((row) => row.absoluteP50ErrorPctPoints),
    ),
    bandHitCount,
    bandCoveragePct: (bandHitCount / rows.length) * 100,
    lossBrierScore: compensatedMean(
      rows.map((row) => row.lossBrierScore),
    ),
    meanAbsoluteMddP50ErrorPctPoints: compensatedMean(
      rows.map((row) => row.absoluteMddP50ErrorPctPoints),
    ),
  });
}

function unavailableRow(
  outcomeEndServiceDate: string,
  reason:
    | "endpoint_identity_mismatch"
    | "source_endpoint_unavailable"
    | "window_identity_mismatch"
    | "observed_outcome_mismatch",
  bootstrapStatus: "ready" | "unavailable",
  factorStatus: "ready" | "unavailable" | "missing",
) {
  return Object.freeze({
    outcomeEndServiceDate,
    status: "unavailable" as const,
    reason,
    trainingEndServiceDate: null,
    outcomeStartServiceDate: null,
    outcomeReturnStepCount: null,
    actual: null,
    bootstrap: null,
    factor: null,
    sourceStatuses: Object.freeze({ bootstrap: bootstrapStatus, factor: factorStatus }),
  });
}

function countNonOverlappingWindows(
  rows: readonly Readonly<{
    outcomeStartServiceDate: string;
    outcomeEndServiceDate: string;
  }>[],
) {
  const sorted = [...rows].sort((left, right) =>
    left.outcomeEndServiceDate.localeCompare(right.outcomeEndServiceDate),
  );
  let count = 0;
  let lastEnd: string | null = null;
  for (const row of sorted) {
    if (lastEnd === null || row.outcomeStartServiceDate >= lastEnd) {
      count += 1;
      lastEnd = row.outcomeEndServiceDate;
    }
  }
  return count;
}

function sameWeights(
  left: SimulationOwnerHistoricalOutcomeValidationResult["weights"],
  right: SimulationOwnerFactorHistoricalValidationResult["weights"],
) {
  return (
    left.length === right.length &&
    left.every((row, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        row.instrumentKey === other.instrumentKey &&
        row.market === other.market &&
        row.currency === other.currency &&
        row.ticker === other.ticker &&
        row.weightBps === other.weightBps
      );
    })
  );
}

function brierScore(probabilityPct: number, actual: boolean) {
  const probability = probabilityPct / 100;
  return (probability - (actual ? 1 : 0)) ** 2;
}

function nullableDifference(left: number | null, right: number | null) {
  return left === null || right === null ? null : left - right;
}

function nearlyEqual(left: number, right: number) {
  return Math.abs(left - right) <= 1e-10;
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

function unavailable<T extends Readonly<Record<string, unknown>>>(
  base: T,
  reason:
    | "account_mismatch"
    | "weight_identity_mismatch"
    | "endpoint_identity_mismatch",
) {
  return Object.freeze({
    ...base,
    status: "unavailable" as const,
    reason,
    weights: Object.freeze([]),
    summary: Object.freeze({
      endpointCount: 0,
      pairedEndpointCount: 0,
      unavailableEndpointCount: 0,
      effectiveNonOverlappingWindowCount: 0,
      overlappingPairedEndpointCount: 0,
      bootstrap: summarizeModel([]),
      factor: summarizeModel([]),
      deltas: Object.freeze({
        factorMinusBootstrapMeanAbsoluteP50ErrorPctPoints: null,
        factorMinusBootstrapBandCoveragePctPoints: null,
        factorMinusBootstrapLossBrierScore: null,
        factorMinusBootstrapMeanAbsoluteMddP50ErrorPctPoints: null,
      }),
    }),
    rows: Object.freeze([]),
  });
}
