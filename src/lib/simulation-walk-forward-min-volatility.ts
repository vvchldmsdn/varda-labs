import { FIXED_MIX_INSTRUMENTS } from "./simulation-fixed-mix-research-context.ts";
import {
  buildWalkForwardOutOfSamplePath,
  type WalkForwardMinimumVolatilityFold,
} from "./simulation-walk-forward-min-volatility-path.ts";
import { SIMULATION_WALK_FORWARD_MIN_VOLATILITY_POLICY } from "./simulation-walk-forward-min-volatility-policy.ts";
import { estimateWalkForwardMinimumVolatilityWeights } from "./simulation-walk-forward-min-volatility-statistics.ts";
import type {
  SimulationReturnMatrixResult,
  SimulationReturnMatrixRow,
} from "./simulation-return-matrix-types.ts";

export { SIMULATION_WALK_FORWARD_MIN_VOLATILITY_POLICY } from "./simulation-walk-forward-min-volatility-policy.ts";

export type SimulationWalkForwardMinimumVolatilityResult = ReturnType<
  typeof buildSimulationWalkForwardMinimumVolatility
>;

export type SimulationWalkForwardMinimumVolatilityBlockerReason =
  | "explicit_end_required"
  | "input_matrix_unavailable"
  | "input_matrix_shape_mismatch"
  | "invalid_return_value"
  | "estimation_failed";

export function buildSimulationWalkForwardMinimumVolatility(input: {
  explicitEndServiceDate: string | null;
  matrix: SimulationReturnMatrixResult | null;
}) {
  if (!input.explicitEndServiceDate) {
    return unavailable("explicit_end_required");
  }
  if (!input.matrix || input.matrix.status !== "ready") {
    return unavailable("input_matrix_unavailable");
  }
  if (!hasExpectedShape(input.matrix, input.explicitEndServiceDate)) {
    return unavailable("input_matrix_shape_mismatch");
  }
  if (!hasValidReturns(input.matrix.matrix)) {
    return unavailable("invalid_return_value");
  }

  const folds: WalkForwardMinimumVolatilityFold[] = [];
  const policy = SIMULATION_WALK_FORWARD_MIN_VOLATILITY_POLICY;
  for (let foldIndex = 0; foldIndex < policy.foldCount; foldIndex += 1) {
    const testStartIndex =
      policy.trainWindowStepCount + foldIndex * policy.testWindowStepCount;
    const trainStartIndex = testStartIndex - policy.trainWindowStepCount;
    const trainRows = input.matrix.matrix.slice(
      trainStartIndex,
      testStartIndex,
    );
    const testRows = input.matrix.matrix.slice(
      testStartIndex,
      testStartIndex + policy.testWindowStepCount,
    );
    const estimate = estimateWalkForwardMinimumVolatilityWeights(trainRows);
    const firstTrainRow = trainRows[0];
    const lastTrainRow = trainRows.at(-1);
    const firstTestRow = testRows[0];
    const lastTestRow = testRows.at(-1);
    if (
      !estimate ||
      !firstTrainRow ||
      !lastTrainRow ||
      !firstTestRow ||
      !lastTestRow
    ) {
      return unavailable("estimation_failed");
    }

    folds.push(
      Object.freeze({
        foldIndex,
        trainStartServiceDate: firstTrainRow.previousServiceDate,
        trainEndServiceDate: lastTrainRow.serviceDate,
        testStartServiceDate: firstTestRow.previousServiceDate,
        testEndServiceDate: lastTestRow.serviceDate,
        trainStepCount: trainRows.length,
        testStepCount: testRows.length,
        weights: Object.freeze([
          Object.freeze({
            ticker: "069500" as const,
            weightBps: estimate.kodexWeightBps,
          }),
          Object.freeze({
            ticker: "VOO" as const,
            weightBps: estimate.vooWeightBps,
          }),
        ] as const),
        estimatedAnnualizedVolatilityPct:
          estimate.estimatedAnnualizedVolatilityPct,
      }),
    );
  }

  const frozenFolds = Object.freeze(folds);
  const minimumVolatilityPath = buildWalkForwardOutOfSamplePath({
    id: "walk_forward_minimum_volatility",
    label: "워크포워드 최소변동성",
    matrixRows: input.matrix.matrix,
    folds: frozenFolds,
    weightForFold: (fold) => fold.weights[0].weightBps,
  });
  const equalWeightPath = buildWalkForwardOutOfSamplePath({
    id: "equal_weight_same_cadence",
    label: "동일 주기 50:50",
    matrixRows: input.matrix.matrix,
    folds: frozenFolds,
    weightForFold: () => 5_000,
  });
  if (!minimumVolatilityPath || !equalWeightPath) {
    return unavailable("estimation_failed");
  }

  return Object.freeze({
    status: "ready" as const,
    reason: null,
    runtimeTrustStatus: "research_only" as const,
    policy,
    source: Object.freeze({
      endServiceDate: input.explicitEndServiceDate,
      firstServiceDate: input.matrix.requestedServiceDates[0] ?? null,
      lastServiceDate: input.matrix.requestedServiceDates.at(-1) ?? null,
      sourceReturnStepCount: input.matrix.matrix.length,
      outOfSampleStepCount:
        policy.foldCount * policy.testWindowStepCount,
      foldCount: frozenFolds.length,
    }),
    folds: frozenFolds,
    paths: Object.freeze({
      minimumVolatility: minimumVolatilityPath,
      equalWeight: equalWeightPath,
    }),
    comparison: Object.freeze({
      terminalReturnDifferencePctPoints:
        minimumVolatilityPath.totalReturnPct - equalWeightPath.totalReturnPct,
      annualizedVolatilityDifferencePctPoints:
        minimumVolatilityPath.annualizedVolatilityPct -
        equalWeightPath.annualizedVolatilityPct,
      maxDrawdownDifferencePctPoints:
        minimumVolatilityPath.maxDrawdownPct - equalWeightPath.maxDrawdownPct,
    }),
  });
}

function hasExpectedShape(
  matrix: SimulationReturnMatrixResult,
  explicitEndServiceDate: string,
) {
  const policy = SIMULATION_WALK_FORWARD_MIN_VOLATILITY_POLICY;
  return (
    matrix.matrix.length === policy.sourceReturnStepCount &&
    matrix.requestedServiceDates.length === policy.sourceReturnStepCount + 1 &&
    matrix.requestedServiceDates.at(-1) === explicitEndServiceDate &&
    matrix.matrix.at(-1)?.serviceDate === explicitEndServiceDate &&
    matrix.instruments.length === FIXED_MIX_INSTRUMENTS.length &&
    matrix.instruments.every((instrument, index) => {
      const expected = FIXED_MIX_INSTRUMENTS[index];
      return (
        expected !== undefined &&
        instrument.market === expected.market &&
        instrument.currency === expected.currency &&
        instrument.ticker === expected.ticker
      );
    }) &&
    matrix.matrix.every(
      (row, index) =>
        row.cells.length === FIXED_MIX_INSTRUMENTS.length &&
        row.cells.every(
          (cell, cellIndex) =>
            cell.instrumentKey === matrix.instruments[cellIndex]?.instrumentKey,
        ) &&
        (index === 0 ||
          matrix.matrix[index - 1]?.serviceDate === row.previousServiceDate),
    )
  );
}

function hasValidReturns(rows: readonly SimulationReturnMatrixRow[]) {
  return rows.every((row) =>
    row.cells.every(
      (cell) =>
        typeof cell.value === "number" &&
        Number.isFinite(cell.value) &&
        cell.value > -1,
    ),
  );
}

function unavailable(reason: SimulationWalkForwardMinimumVolatilityBlockerReason) {
  return Object.freeze({
    status: "unavailable" as const,
    reason,
    runtimeTrustStatus: "research_only" as const,
    policy: SIMULATION_WALK_FORWARD_MIN_VOLATILITY_POLICY,
    source: null,
    folds: Object.freeze([]),
    paths: null,
    comparison: null,
  });
}
