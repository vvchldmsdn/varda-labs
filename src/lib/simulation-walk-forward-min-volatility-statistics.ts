import { SIMULATION_WALK_FORWARD_MIN_VOLATILITY_POLICY } from "./simulation-walk-forward-min-volatility-policy.ts";
import type { SimulationReturnMatrixRow } from "./simulation-return-matrix-types.ts";
import { estimateTwoAssetMinimumVariance } from "./two-asset-minimum-variance.ts";

export type WalkForwardEstimatedWeights = Readonly<{
  kodexWeightBps: number;
  vooWeightBps: number;
  estimatedAnnualizedVolatilityPct: number;
}>;

export function estimateWalkForwardMinimumVolatilityWeights(
  rows: readonly SimulationReturnMatrixRow[],
): WalkForwardEstimatedWeights | null {
  const policy = SIMULATION_WALK_FORWARD_MIN_VOLATILITY_POLICY;
  if (rows.length !== policy.trainWindowStepCount) return null;
  const kodexReturns = rows.map((row) => readWalkForwardReturn(row, 0));
  const vooReturns = rows.map((row) => readWalkForwardReturn(row, 1));
  if (
    kodexReturns.some((value) => value === null) ||
    vooReturns.some((value) => value === null)
  ) {
    return null;
  }

  const estimate = estimateTwoAssetMinimumVariance({
    leftReturns: kodexReturns as number[],
    rightReturns: vooReturns as number[],
    covarianceShrinkage: policy.covarianceShrinkage,
    varianceFloor: policy.varianceFloor,
    annualizationFactor: policy.annualizationFactor,
  });
  if (!estimate) return null;
  return Object.freeze({
    kodexWeightBps: estimate.leftWeightBps,
    vooWeightBps: estimate.rightWeightBps,
    estimatedAnnualizedVolatilityPct:
      estimate.estimatedAnnualizedVolatilityPct,
  });
}

export function annualizeWalkForwardVolatility(values: readonly number[]) {
  if (values.length < 2) return null;
  const mean = neumaierSum(values) / values.length;
  const variance =
    neumaierSum(values.map((value) => (value - mean) ** 2)) /
    (values.length - 1);
  const result =
    Math.sqrt(Math.max(0, variance)) *
    Math.sqrt(
      SIMULATION_WALK_FORWARD_MIN_VOLATILITY_POLICY.annualizationFactor,
    ) *
    100;
  return Number.isFinite(result) ? result : null;
}

export function calculateWalkForwardMaxDrawdownPct(
  values: readonly number[],
) {
  let peak = values[0] ?? 0;
  let maximum = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    if (peak > 0) maximum = Math.max(maximum, (peak - value) / peak);
  }
  return maximum * 100;
}

export function readWalkForwardReturn(
  row: SimulationReturnMatrixRow,
  index: number,
) {
  const value = row.cells[index]?.value;
  return typeof value === "number" && Number.isFinite(value) && value > -1
    ? value
    : null;
}

function neumaierSum(values: readonly number[]) {
  let sum = 0;
  let compensation = 0;
  for (const value of values) {
    const next = sum + value;
    compensation +=
      Math.abs(sum) >= Math.abs(value)
        ? sum - next + value
        : value - next + sum;
    sum = next;
  }
  return sum + compensation;
}
