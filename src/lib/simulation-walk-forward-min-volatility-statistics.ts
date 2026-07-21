import { SIMULATION_WALK_FORWARD_MIN_VOLATILITY_POLICY } from "./simulation-walk-forward-min-volatility-policy.ts";
import type { SimulationReturnMatrixRow } from "./simulation-return-matrix-types.ts";

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

  const kodex = kodexReturns as number[];
  const voo = vooReturns as number[];
  const kodexMean = neumaierSum(kodex) / kodex.length;
  const vooMean = neumaierSum(voo) / voo.length;
  const denominator = kodex.length - 1;
  const kodexVariance = Math.max(
    policy.varianceFloor,
    neumaierSum(kodex.map((value) => (value - kodexMean) ** 2)) /
      denominator,
  );
  const vooVariance = Math.max(
    policy.varianceFloor,
    neumaierSum(voo.map((value) => (value - vooMean) ** 2)) / denominator,
  );
  const rawCovariance =
    neumaierSum(
      kodex.map(
        (value, index) =>
          (value - kodexMean) * ((voo[index] ?? vooMean) - vooMean),
      ),
    ) / denominator;
  const covarianceLimit = Math.sqrt(kodexVariance * vooVariance);
  const boundedCovariance = Math.max(
    -covarianceLimit,
    Math.min(covarianceLimit, rawCovariance),
  );
  const shrunkCovariance =
    boundedCovariance * (1 - policy.covarianceShrinkage);
  const weightDenominator =
    kodexVariance + vooVariance - 2 * shrunkCovariance;
  const continuousKodexWeight =
    weightDenominator > Number.EPSILON
      ? (vooVariance - shrunkCovariance) / weightDenominator
      : 0.5;
  const kodexWeightBps = Math.round(
    Math.max(0, Math.min(1, continuousKodexWeight)) * 10_000,
  );
  const vooWeightBps = 10_000 - kodexWeightBps;
  const kodexWeight = kodexWeightBps / 10_000;
  const vooWeight = vooWeightBps / 10_000;
  const estimatedVariance = Math.max(
    0,
    kodexWeight ** 2 * kodexVariance +
      vooWeight ** 2 * vooVariance +
      2 * kodexWeight * vooWeight * shrunkCovariance,
  );
  const estimatedAnnualizedVolatilityPct =
    Math.sqrt(estimatedVariance) * Math.sqrt(policy.annualizationFactor) * 100;

  if (!Number.isFinite(estimatedAnnualizedVolatilityPct)) return null;
  return Object.freeze({
    kodexWeightBps,
    vooWeightBps,
    estimatedAnnualizedVolatilityPct,
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
