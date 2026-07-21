export type TwoAssetMinimumVarianceEstimate = Readonly<{
  leftWeightBps: number;
  rightWeightBps: number;
  estimatedAnnualizedVolatilityPct: number;
}>;

export function estimateTwoAssetMinimumVariance(input: Readonly<{
  leftReturns: readonly number[];
  rightReturns: readonly number[];
  covarianceShrinkage: number;
  varianceFloor: number;
  annualizationFactor: number;
  minimumComponentWeightBps?: number;
}>): TwoAssetMinimumVarianceEstimate | null {
  const minimumComponentWeightBps = input.minimumComponentWeightBps ?? 0;
  if (
    input.leftReturns.length < 2 ||
    input.leftReturns.length !== input.rightReturns.length ||
    !validReturns(input.leftReturns) ||
    !validReturns(input.rightReturns) ||
    !Number.isFinite(input.covarianceShrinkage) ||
    input.covarianceShrinkage < 0 ||
    input.covarianceShrinkage >= 1 ||
    !Number.isFinite(input.varianceFloor) ||
    input.varianceFloor <= 0 ||
    !Number.isFinite(input.annualizationFactor) ||
    input.annualizationFactor <= 0 ||
    !Number.isInteger(minimumComponentWeightBps) ||
    minimumComponentWeightBps < 0 ||
    minimumComponentWeightBps > 5_000
  ) {
    return null;
  }

  const leftMean = neumaierSum(input.leftReturns) / input.leftReturns.length;
  const rightMean = neumaierSum(input.rightReturns) / input.rightReturns.length;
  const denominator = input.leftReturns.length - 1;
  const leftVariance = Math.max(
    input.varianceFloor,
    neumaierSum(
      input.leftReturns.map((value) => (value - leftMean) ** 2),
    ) / denominator,
  );
  const rightVariance = Math.max(
    input.varianceFloor,
    neumaierSum(
      input.rightReturns.map((value) => (value - rightMean) ** 2),
    ) / denominator,
  );
  const rawCovariance =
    neumaierSum(
      input.leftReturns.map(
        (value, index) =>
          (value - leftMean) * (input.rightReturns[index] - rightMean),
      ),
    ) / denominator;
  const covarianceLimit = Math.sqrt(leftVariance * rightVariance);
  const boundedCovariance = Math.max(
    -covarianceLimit,
    Math.min(covarianceLimit, rawCovariance),
  );
  const shrunkCovariance =
    boundedCovariance * (1 - input.covarianceShrinkage);
  const weightDenominator =
    leftVariance + rightVariance - 2 * shrunkCovariance;
  const continuousLeftWeight =
    weightDenominator > Number.EPSILON
      ? (rightVariance - shrunkCovariance) / weightDenominator
      : 0.5;
  const unconstrainedLeftWeightBps = Math.round(
    Math.max(0, Math.min(1, continuousLeftWeight)) * 10_000,
  );
  const leftWeightBps = Math.max(
    minimumComponentWeightBps,
    Math.min(10_000 - minimumComponentWeightBps, unconstrainedLeftWeightBps),
  );
  const rightWeightBps = 10_000 - leftWeightBps;
  const leftWeight = leftWeightBps / 10_000;
  const rightWeight = rightWeightBps / 10_000;
  const estimatedVariance = Math.max(
    0,
    leftWeight ** 2 * leftVariance +
      rightWeight ** 2 * rightVariance +
      2 * leftWeight * rightWeight * shrunkCovariance,
  );
  const estimatedAnnualizedVolatilityPct =
    Math.sqrt(estimatedVariance) * Math.sqrt(input.annualizationFactor) * 100;

  if (!Number.isFinite(estimatedAnnualizedVolatilityPct)) return null;
  return Object.freeze({
    leftWeightBps,
    rightWeightBps,
    estimatedAnnualizedVolatilityPct,
  });
}

function validReturns(values: readonly number[]) {
  return values.every((value) => Number.isFinite(value) && value > -1);
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
