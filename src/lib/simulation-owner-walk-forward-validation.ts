import { evaluateInvestmentLabOptimizerTrainingMetrics } from "./investment-lab-preperiod-optimizer-math.ts";
import {
  buildSimulationOwnerConstrainedMinVolatility,
  buildSimulationOwnerGrowthSeries,
  SIMULATION_OWNER_CONSTRAINED_MIN_VOLATILITY_POLICY,
  type SimulationOwnerConstrainedMinVolatilityBlockerReason,
  type SimulationOwnerResearchWeight,
} from "./simulation-owner-constrained-min-volatility.ts";
import type { SimulationReturnMatrixResult } from "./simulation-return-matrix-types.ts";

export const SIMULATION_OWNER_WALK_FORWARD_VALIDATION_POLICY = Object.freeze({
  version: "simulation_owner_walk_forward_validation_v1",
  sourceReturnStepCount: 90,
  trainWindowStepCount: 60,
  testWindowStepCount: 10,
  foldCount: 3,
  trainWindowPolicy: "rolling_window_advanced_by_test_window",
  testWindowPolicy: "three_non_overlapping_chronological_windows",
  currentCompositionPolicy:
    "current_modeled_weights_applied_retrospectively_at_each_test_boundary",
  candidatePolicyVersion:
    SIMULATION_OWNER_CONSTRAINED_MIN_VOLATILITY_POLICY.version,
  candidatePolicy:
    "reestimate_constrained_minimum_volatility_from_preceding_train_rows_only",
  pathPolicy:
    "costless_rebalance_at_test_fold_boundary_buy_and_hold_within_fold",
  annualizationFactor: 252,
  transactionCostBps: 0,
  tax: "zero_research_assumption",
  persistence: "forbidden",
  providerCalls: "forbidden",
  recommendation: "forbidden",
  orderAuthority: "forbidden",
  interpretation:
    "retrospective_out_of_sample_diagnostic_not_forecast_or_advice",
} as const);

export type SimulationOwnerWalkForwardValidationBlockerReason =
  | "current_execution_unavailable"
  | "input_matrix_unavailable"
  | "input_matrix_shape_mismatch"
  | "test_outcome_calculation_failed"
  | "no_ready_folds"
  | SimulationOwnerConstrainedMinVolatilityBlockerReason;

export type SimulationOwnerWalkForwardValidationResult = ReturnType<
  typeof buildSimulationOwnerWalkForwardValidation
>;

export function buildSimulationOwnerWalkForwardValidation(input: {
  account: string;
  currentExecutionReady: boolean;
  matrix: SimulationReturnMatrixResult | null;
  currentWeights: readonly SimulationOwnerResearchWeight[];
}) {
  const base = {
    account: input.account,
    policy: SIMULATION_OWNER_WALK_FORWARD_VALIDATION_POLICY,
    runtimeTrustStatus: "tenant_scoped_read_only_research" as const,
  };
  if (!input.currentExecutionReady) {
    return unavailable(base, "current_execution_unavailable");
  }
  if (!input.matrix || input.matrix.status !== "ready") {
    return unavailable(base, "input_matrix_unavailable");
  }
  if (!hasExpectedShape(input.matrix, input.currentWeights)) {
    return unavailable(base, "input_matrix_shape_mismatch");
  }

  const matrix = input.matrix;
  const policy = SIMULATION_OWNER_WALK_FORWARD_VALIDATION_POLICY;
  const folds = Object.freeze(
    Array.from({ length: policy.foldCount }, (_, foldIndex) => {
      const testStartIndex =
        policy.trainWindowStepCount + foldIndex * policy.testWindowStepCount;
      const trainStartIndex = testStartIndex - policy.trainWindowStepCount;
      const trainRows = matrix.matrix.slice(
        trainStartIndex,
        testStartIndex,
      );
      const testRows = matrix.matrix.slice(
        testStartIndex,
        testStartIndex + policy.testWindowStepCount,
      );
      const dateRange = buildDateRange(foldIndex, trainRows, testRows);
      if (!dateRange) {
        return unavailableFold(foldIndex, "input_matrix_shape_mismatch");
      }

      const allocation = buildSimulationOwnerConstrainedMinVolatility({
        instruments: matrix.instruments,
        rows: trainRows,
        currentWeights: input.currentWeights,
      });
      if (allocation.status !== "ready") {
        return unavailableFold(foldIndex, allocation.reason, dateRange);
      }

      const testGrowthSeries = buildSimulationOwnerGrowthSeries({
        instruments: matrix.instruments,
        rows: testRows,
      });
      if (!testGrowthSeries) {
        return unavailableFold(
          foldIndex,
          "test_outcome_calculation_failed",
          dateRange,
        );
      }
      const currentMetrics = evaluateInvestmentLabOptimizerTrainingMetrics({
        growthSeries: testGrowthSeries,
        weights: input.currentWeights.map((row) => row.weightBps / 10_000),
      });
      const candidateMetrics = evaluateInvestmentLabOptimizerTrainingMetrics({
        growthSeries: testGrowthSeries,
        weights: allocation.weights.map((row) => row.weightBps / 10_000),
      });
      if (!currentMetrics || !candidateMetrics) {
        return unavailableFold(
          foldIndex,
          "test_outcome_calculation_failed",
          dateRange,
        );
      }

      const currentReturnPct = currentMetrics.terminalReturn * 100;
      const candidateReturnPct = candidateMetrics.terminalReturn * 100;
      const currentAnnualizedVolatilityPct =
        currentMetrics.annualizedVolatility * 100;
      const candidateAnnualizedVolatilityPct =
        candidateMetrics.annualizedVolatility * 100;
      const currentMaxDrawdownPct = currentMetrics.maximumDrawdown * 100;
      const candidateMaxDrawdownPct = candidateMetrics.maximumDrawdown * 100;

      return Object.freeze({
        ...dateRange,
        status: "ready" as const,
        reason: null,
        training: allocation.training,
        constraints: allocation.constraints,
        weights: Object.freeze(
          allocation.weights.map((candidate, index) =>
            Object.freeze({
              instrumentKey: candidate.instrumentKey,
              ticker: candidate.ticker,
              currentWeightBps: input.currentWeights[index].weightBps,
              candidateWeightBps: candidate.weightBps,
              changeBps:
                candidate.weightBps - input.currentWeights[index].weightBps,
            }),
          ),
        ),
        outcome: Object.freeze({
          currentReturnPct,
          candidateReturnPct,
          returnDeltaPctPoints: candidateReturnPct - currentReturnPct,
          currentAnnualizedVolatilityPct,
          candidateAnnualizedVolatilityPct,
          volatilityDeltaPctPoints:
            candidateAnnualizedVolatilityPct -
            currentAnnualizedVolatilityPct,
          currentMaxDrawdownPct,
          candidateMaxDrawdownPct,
          maxDrawdownDeltaPctPoints:
            candidateMaxDrawdownPct - currentMaxDrawdownPct,
          candidateLowerVolatility:
            candidateAnnualizedVolatilityPct <
            currentAnnualizedVolatilityPct - 1e-10,
          candidateHigherReturn:
            candidateReturnPct > currentReturnPct + 1e-10,
          candidateLowerMaxDrawdown:
            candidateMaxDrawdownPct < currentMaxDrawdownPct - 1e-10,
        }),
      });
    }),
  );

  const readyFolds = folds.filter((fold) => fold.status === "ready");
  if (readyFolds.length === 0) {
    return Object.freeze({
      ...base,
      status: "unavailable" as const,
      reason: "no_ready_folds" as const,
      source: buildSource(matrix),
      summary: emptySummary(folds.length),
      folds,
    });
  }

  const summary = Object.freeze({
    foldCount: folds.length,
    readyFoldCount: readyFolds.length,
    unavailableFoldCount: folds.length - readyFolds.length,
    comparableOutOfSampleStepCount:
      readyFolds.length * policy.testWindowStepCount,
    candidateLowerVolatilityFoldCount: readyFolds.filter(
      (fold) => fold.outcome.candidateLowerVolatility,
    ).length,
    candidateHigherReturnFoldCount: readyFolds.filter(
      (fold) => fold.outcome.candidateHigherReturn,
    ).length,
    candidateLowerMaxDrawdownFoldCount: readyFolds.filter(
      (fold) => fold.outcome.candidateLowerMaxDrawdown,
    ).length,
    meanVolatilityDeltaPctPoints: arithmeticMean(
      readyFolds.map((fold) => fold.outcome.volatilityDeltaPctPoints),
    ),
    meanReturnDeltaPctPoints: arithmeticMean(
      readyFolds.map((fold) => fold.outcome.returnDeltaPctPoints),
    ),
    compoundedCurrentReturnPct:
      compoundReturns(
        readyFolds.map((fold) => fold.outcome.currentReturnPct),
      ) * 100,
    compoundedCandidateReturnPct:
      compoundReturns(
        readyFolds.map((fold) => fold.outcome.candidateReturnPct),
      ) * 100,
  });

  return Object.freeze({
    ...base,
    status:
      readyFolds.length === folds.length
        ? ("ready" as const)
        : ("partial" as const),
    reason: null,
    source: buildSource(matrix),
    summary,
    folds,
  });
}

function hasExpectedShape(
  matrix: SimulationReturnMatrixResult,
  currentWeights: readonly SimulationOwnerResearchWeight[],
) {
  const policy = SIMULATION_OWNER_WALK_FORWARD_VALIDATION_POLICY;
  const instrumentKeys = matrix.instruments.map((row) => row.instrumentKey);
  return (
    matrix.consumerStatus === "matrix_ready" &&
    matrix.blockers.length === 0 &&
    matrix.exclusions.length === 0 &&
    matrix.matrix.length === policy.sourceReturnStepCount &&
    matrix.requestedServiceDates.length === policy.sourceReturnStepCount + 1 &&
    currentWeights.length === instrumentKeys.length &&
    currentWeights.reduce((sum, row) => sum + row.weightBps, 0) === 10_000 &&
    currentWeights.every(
      (row, index) =>
        row.instrumentKey === instrumentKeys[index] &&
        row.market === matrix.instruments[index]?.market &&
        row.currency === matrix.instruments[index]?.currency &&
        row.ticker === matrix.instruments[index]?.ticker,
    ) &&
    matrix.matrix.every(
      (row, rowIndex) =>
        row.previousServiceDate === matrix.requestedServiceDates[rowIndex] &&
        row.serviceDate === matrix.requestedServiceDates[rowIndex + 1] &&
        row.cells.length === instrumentKeys.length &&
        row.cells.every(
          (cell, cellIndex) =>
            cell.instrumentKey === instrumentKeys[cellIndex] &&
            typeof cell.value === "number" &&
            Number.isFinite(cell.value) &&
            cell.value > -1,
        ),
    )
  );
}

function buildDateRange(
  foldIndex: number,
  trainRows: SimulationReturnMatrixResult["matrix"],
  testRows: SimulationReturnMatrixResult["matrix"],
) {
  const firstTrainRow = trainRows[0];
  const lastTrainRow = trainRows.at(-1);
  const firstTestRow = testRows[0];
  const lastTestRow = testRows.at(-1);
  if (!firstTrainRow || !lastTrainRow || !firstTestRow || !lastTestRow) {
    return null;
  }
  return Object.freeze({
    foldIndex,
    trainStartServiceDate: firstTrainRow.previousServiceDate,
    trainEndServiceDate: lastTrainRow.serviceDate,
    testStartServiceDate: firstTestRow.previousServiceDate,
    testEndServiceDate: lastTestRow.serviceDate,
    trainStepCount: trainRows.length,
    testStepCount: testRows.length,
  });
}

function buildSource(matrix: SimulationReturnMatrixResult) {
  return Object.freeze({
    firstServiceDate: matrix.requestedServiceDates[0] ?? null,
    lastServiceDate: matrix.requestedServiceDates.at(-1) ?? null,
    sourceReturnStepCount: matrix.matrix.length,
  });
}

function unavailableFold(
  foldIndex: number,
  reason: SimulationOwnerWalkForwardValidationBlockerReason,
  dateRange: ReturnType<typeof buildDateRange> = null,
) {
  return Object.freeze({
    ...(dateRange ?? {
      foldIndex,
      trainStartServiceDate: null,
      trainEndServiceDate: null,
      testStartServiceDate: null,
      testEndServiceDate: null,
      trainStepCount: 0,
      testStepCount: 0,
    }),
    status: "unavailable" as const,
    reason,
    training: null,
    constraints: null,
    weights: Object.freeze([]),
    outcome: null,
  });
}

function emptySummary(foldCount: number) {
  return Object.freeze({
    foldCount,
    readyFoldCount: 0,
    unavailableFoldCount: foldCount,
    comparableOutOfSampleStepCount: 0,
    candidateLowerVolatilityFoldCount: 0,
    candidateHigherReturnFoldCount: 0,
    candidateLowerMaxDrawdownFoldCount: 0,
    meanVolatilityDeltaPctPoints: null,
    meanReturnDeltaPctPoints: null,
    compoundedCurrentReturnPct: null,
    compoundedCandidateReturnPct: null,
  });
}

function arithmeticMean(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function compoundReturns(returnPctValues: readonly number[]) {
  return returnPctValues.reduce(
    (growth, value) => growth * (1 + value / 100),
    1,
  ) - 1;
}

function unavailable(
  base: Readonly<{
    account: string;
    policy: typeof SIMULATION_OWNER_WALK_FORWARD_VALIDATION_POLICY;
    runtimeTrustStatus: "tenant_scoped_read_only_research";
  }>,
  reason: SimulationOwnerWalkForwardValidationBlockerReason,
) {
  return Object.freeze({
    ...base,
    status: "unavailable" as const,
    reason,
    source: null,
    summary: emptySummary(0),
    folds: Object.freeze([]),
  });
}
