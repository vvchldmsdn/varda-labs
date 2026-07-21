import { SIMULATION_WALK_FORWARD_MIN_VOLATILITY_POLICY } from "./simulation-walk-forward-min-volatility-policy.ts";
import {
  annualizeWalkForwardVolatility,
  calculateWalkForwardMaxDrawdownPct,
  readWalkForwardReturn,
} from "./simulation-walk-forward-min-volatility-statistics.ts";
import type { SimulationReturnMatrixRow } from "./simulation-return-matrix-types.ts";

export type WalkForwardMinimumVolatilityFold = Readonly<{
  foldIndex: number;
  trainStartServiceDate: string;
  trainEndServiceDate: string;
  testStartServiceDate: string;
  testEndServiceDate: string;
  trainStepCount: number;
  testStepCount: number;
  weights: readonly [
    Readonly<{ ticker: "069500"; weightBps: number }>,
    Readonly<{ ticker: "VOO"; weightBps: number }>,
  ];
  estimatedAnnualizedVolatilityPct: number;
}>;

export function buildWalkForwardOutOfSamplePath(input: {
  id: "walk_forward_minimum_volatility" | "equal_weight_same_cadence";
  label: string;
  matrixRows: readonly SimulationReturnMatrixRow[];
  folds: readonly WalkForwardMinimumVolatilityFold[];
  weightForFold: (fold: WalkForwardMinimumVolatilityFold) => number;
}) {
  const policy = SIMULATION_WALK_FORWARD_MIN_VOLATILITY_POLICY;
  const firstTestRow = input.matrixRows[policy.trainWindowStepCount];
  if (!firstTestRow) return null;

  let indexValue = 100;
  const points: Array<
    Readonly<{ stepIndex: number; serviceDate: string; indexValue: number }>
  > = [
    Object.freeze({
      stepIndex: 0,
      serviceDate: firstTestRow.previousServiceDate,
      indexValue,
    }),
  ];
  const observedReturns: number[] = [];

  for (const fold of input.folds) {
    const testStartIndex =
      policy.trainWindowStepCount + fold.foldIndex * policy.testWindowStepCount;
    const testRows = input.matrixRows.slice(
      testStartIndex,
      testStartIndex + policy.testWindowStepCount,
    );
    const kodexWeight = input.weightForFold(fold) / 10_000;
    let kodexSleeve = indexValue * kodexWeight;
    let vooSleeve = indexValue * (1 - kodexWeight);

    for (const row of testRows) {
      const kodexReturn = readWalkForwardReturn(row, 0);
      const vooReturn = readWalkForwardReturn(row, 1);
      if (kodexReturn === null || vooReturn === null) return null;
      const previousIndexValue = indexValue;
      kodexSleeve *= 1 + kodexReturn;
      vooSleeve *= 1 + vooReturn;
      indexValue = kodexSleeve + vooSleeve;
      if (!Number.isFinite(indexValue) || indexValue < 0) return null;
      observedReturns.push(indexValue / previousIndexValue - 1);
      points.push(
        Object.freeze({
          stepIndex: points.length,
          serviceDate: row.serviceDate,
          indexValue,
        }),
      );
    }
  }

  const annualizedVolatilityPct =
    annualizeWalkForwardVolatility(observedReturns);
  if (annualizedVolatilityPct === null) return null;
  return Object.freeze({
    id: input.id,
    label: input.label,
    points: Object.freeze(points),
    terminalIndex: indexValue,
    totalReturnPct: indexValue - 100,
    annualizedVolatilityPct,
    maxDrawdownPct: calculateWalkForwardMaxDrawdownPct(
      points.map((point) => point.indexValue),
    ),
  });
}
