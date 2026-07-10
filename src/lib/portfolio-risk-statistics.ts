import type { PortfolioRiskMetric } from "./portfolio-risk-types.ts";

export const ZERO_VARIANCE_EPSILON = 1e-18;
const NEGATIVE_VARIANCE_RELATIVE_EPSILON = 1e-12;

export function arithmeticMean(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function sampleCovarianceMatrix(series: readonly number[][]) {
  const means = series.map(arithmeticMean);
  const observations = series[0]?.length ?? 0;
  return series.map((left, leftIndex) =>
    series.map((right, rightIndex) => {
      let sum = 0;
      for (let index = 0; index < observations; index += 1) {
        sum +=
          (left[index] - means[leftIndex]) *
          (right[index] - means[rightIndex]);
      }
      return sum / (observations - 1);
    }),
  );
}

export function standardDeviations(covariance: readonly number[][]) {
  return covariance.map((row, index) =>
    Math.sqrt(Math.max(row[index], 0)),
  );
}

export function correlationMatrixFromCovariance(
  covariance: readonly number[][],
  deviations: readonly number[],
) {
  return covariance.map((row, rowIndex) =>
    row.map((value, columnIndex) => {
      const leftVariance = covariance[rowIndex][rowIndex];
      const rightVariance = covariance[columnIndex][columnIndex];
      if (
        leftVariance <= ZERO_VARIANCE_EPSILON ||
        rightVariance <= ZERO_VARIANCE_EPSILON
      ) {
        return null;
      }
      return clampCorrelation(
        value / (deviations[rowIndex] * deviations[columnIndex]),
      );
    }),
  );
}

export function weightedAveragePairCorrelation(
  matrix: readonly (readonly (number | null)[])[],
  weights: readonly number[],
): PortfolioRiskMetric {
  let weightedSum = 0;
  let weightSum = 0;

  for (let left = 0; left < weights.length; left += 1) {
    for (let right = left + 1; right < weights.length; right += 1) {
      const pairWeight = weights[left] * weights[right];
      if (!(pairWeight > 0)) continue;
      const correlation = matrix[left][right];
      if (correlation === null) {
        return { value: null, reason: "undefined_pair_correlation" };
      }
      weightedSum += pairWeight * correlation;
      weightSum += pairWeight;
    }
  }

  return weightSum > 0
    ? { value: weightedSum / weightSum, reason: null }
    : { value: null, reason: "no_positive_weight_pairs" };
}

export function weightedSeries(
  series: readonly number[][],
  weights: readonly number[],
) {
  const observations = series[0]?.length ?? 0;
  return Array.from({ length: observations }, (_, observationIndex) =>
    weights.reduce(
      (sum, weight, instrumentIndex) =>
        sum + weight * series[instrumentIndex][observationIndex],
      0,
    ),
  );
}

export function matrixVectorProduct(
  matrix: readonly number[][],
  vector: readonly number[],
) {
  return matrix.map((row) =>
    row.reduce((sum, value, index) => sum + value * vector[index], 0),
  );
}

export function safePortfolioVariance(
  covariance: readonly number[][],
  weights: readonly number[],
) {
  let variance = 0;
  let absoluteScale = 0;
  for (let left = 0; left < weights.length; left += 1) {
    for (let right = 0; right < weights.length; right += 1) {
      const term = weights[left] * weights[right] * covariance[left][right];
      variance += term;
      absoluteScale += Math.abs(term);
    }
  }

  const epsilon = Math.max(
    ZERO_VARIANCE_EPSILON,
    absoluteScale * NEGATIVE_VARIANCE_RELATIVE_EPSILON,
  );
  if (variance < -epsilon) return null;
  return Math.max(variance, 0);
}

export function annualizedSharpe({
  returns,
  dailyRiskFreeRate,
  annualizationFactor,
}: {
  returns: readonly number[];
  dailyRiskFreeRate: number;
  annualizationFactor: number;
}): PortfolioRiskMetric {
  if (returns.length < 2) {
    return { value: null, reason: "insufficient_observations" };
  }
  const mean = arithmeticMean(returns);
  const variance = sampleVariance(returns, mean);
  if (variance <= ZERO_VARIANCE_EPSILON) {
    return { value: null, reason: "zero_variance" };
  }
  return {
    value:
      ((mean - dailyRiskFreeRate) / Math.sqrt(variance)) *
      Math.sqrt(annualizationFactor),
    reason: null,
  };
}

export function sampleVariance(values: readonly number[], mean?: number) {
  if (values.length < 2) return 0;
  const center = mean ?? arithmeticMean(values);
  return (
    values.reduce((sum, value) => sum + (value - center) ** 2, 0) /
    (values.length - 1)
  );
}

function clampCorrelation(value: number) {
  return Math.max(-1, Math.min(1, value));
}
