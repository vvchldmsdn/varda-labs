import { createMulberry32 } from "./simulation-prng.ts";

export const SIMULATION_FACTOR_RESIDUAL_MODEL_POLICY = Object.freeze({
  version: "simulation_factor_residual_monte_carlo_v1",
  minimumObservationCount: 45,
  ewmaDecay: 0.97,
  factorCovarianceOffDiagonalShrinkage: 0.15,
  residualCovarianceOffDiagonalShrinkage: 0.25,
  regressionRidgeScale: 1e-6,
  studentTDegreesOfFreedom: 7,
  factorShockDistribution: "covariance_scaled_student_t",
  residualShockDistribution: "multivariate_normal",
  portfolioPath: "gross_normalized_buy_and_hold_no_rebalancing",
  fallback: "forbidden",
} as const);

export type SimulationFactorResidualModelResult = ReturnType<
  typeof simulateFactorResidualModel
>;

export function simulateFactorResidualModel(input: {
  assetKeys: readonly string[];
  factorKeys: readonly string[];
  observations: readonly Readonly<{
    assetLogReturns: readonly number[];
    factorChanges: readonly number[];
  }>[];
  weights: readonly number[];
  horizon: number;
  pathCount: number;
  seed: number;
}) {
  const assetCount = input.assetKeys.length;
  const factorCount = input.factorKeys.length;
  if (
    assetCount === 0 ||
    assetCount > 64 ||
    factorCount === 0 ||
    factorCount > 16 ||
    new Set(input.assetKeys).size !== assetCount ||
    new Set(input.factorKeys).size !== factorCount ||
    input.weights.length !== assetCount ||
    input.weights.some((value) => !Number.isFinite(value) || value < 0) ||
    Math.abs(input.weights.reduce((sum, value) => sum + value, 0) - 1) >
      1e-10 ||
    !Number.isInteger(input.horizon) ||
    input.horizon <= 0 ||
    !Number.isInteger(input.pathCount) ||
    input.pathCount <= 0 ||
    !Number.isInteger(input.seed)
  ) {
    return blocked("invalid_input");
  }
  if (
    input.observations.length <
    SIMULATION_FACTOR_RESIDUAL_MODEL_POLICY.minimumObservationCount
  ) {
    return blocked("insufficient_observations");
  }
  if (
    input.observations.some(
      (row) =>
        row.assetLogReturns.length !== assetCount ||
        row.factorChanges.length !== factorCount ||
        row.assetLogReturns.some((value) => !Number.isFinite(value)) ||
        row.factorChanges.some((value) => !Number.isFinite(value)),
    )
  ) {
    return blocked("invalid_input");
  }

  const ewmaWeights = normalizedEwmaWeights(
    input.observations.length,
    SIMULATION_FACTOR_RESIDUAL_MODEL_POLICY.ewmaDecay,
  );
  const assetRows = input.observations.map((row) => row.assetLogReturns);
  const factorRows = input.observations.map((row) => row.factorChanges);
  const assetMean = weightedMean(assetRows, ewmaWeights, assetCount);
  const factorMean = weightedMean(factorRows, ewmaWeights, factorCount);
  const assetCovariance = weightedCovariance(
    assetRows,
    assetMean,
    ewmaWeights,
  );
  const factorCovariance = shrinkOffDiagonal(
    weightedCovariance(factorRows, factorMean, ewmaWeights),
    SIMULATION_FACTOR_RESIDUAL_MODEL_POLICY.factorCovarianceOffDiagonalShrinkage,
  );
  const assetFactorCovariance = weightedCrossCovariance(
    assetRows,
    assetMean,
    factorRows,
    factorMean,
    ewmaWeights,
  );
  const factorVarianceScale = Math.max(
    ...factorCovariance.map((row, index) => row[index]),
    1e-12,
  );
  const regressionRidge =
    factorVarianceScale *
    SIMULATION_FACTOR_RESIDUAL_MODEL_POLICY.regressionRidgeScale;
  const regressionCovariance = factorCovariance.map((row, rowIndex) =>
    row.map((value, columnIndex) =>
      rowIndex === columnIndex ? value + regressionRidge : value,
    ),
  );
  const regressionCholesky = choleskyWithJitter(regressionCovariance);
  if (!regressionCholesky) return blocked("factor_covariance_not_positive_definite");

  const betas = assetFactorCovariance.map((row) =>
    solveCholesky(regressionCholesky.lower, row),
  );
  const intercepts = assetMean.map(
    (mean, assetIndex) => mean - dot(betas[assetIndex], factorMean),
  );
  const residualRows = input.observations.map((row) =>
    row.assetLogReturns.map(
      (assetReturn, assetIndex) =>
        assetReturn -
        intercepts[assetIndex] -
        dot(betas[assetIndex], row.factorChanges),
    ),
  );
  const residualMean = weightedMean(residualRows, ewmaWeights, assetCount);
  const centeredResidualRows = residualRows.map((row) =>
    row.map((value, index) => value - residualMean[index]),
  );
  const residualCovariance = shrinkOffDiagonal(
    weightedCovariance(
      centeredResidualRows,
      new Array(assetCount).fill(0),
      ewmaWeights,
    ),
    SIMULATION_FACTOR_RESIDUAL_MODEL_POLICY.residualCovarianceOffDiagonalShrinkage,
  );
  const factorCholesky = choleskyWithJitter(factorCovariance);
  const residualCholesky = choleskyWithJitter(residualCovariance);
  if (!factorCholesky) return blocked("factor_covariance_not_positive_definite");
  if (!residualCholesky) {
    return blocked("residual_covariance_not_positive_definite");
  }

  const nextRandom = createMulberry32(input.seed);
  const nextNormal = createStandardNormal(nextRandom);
  const paths: number[][] = [];
  const degreesOfFreedom =
    SIMULATION_FACTOR_RESIDUAL_MODEL_POLICY.studentTDegreesOfFreedom;
  for (let pathIndex = 0; pathIndex < input.pathCount; pathIndex += 1) {
    const cumulativeAssetGrowth = new Array(assetCount).fill(1);
    const navPath = new Array<number>(input.horizon + 1);
    navPath[0] = 1;
    for (let stepIndex = 1; stepIndex <= input.horizon; stepIndex += 1) {
      const factorNormal = correlatedNormal(
        factorCholesky.lower,
        nextNormal,
      );
      let chiSquare = 0;
      for (let index = 0; index < degreesOfFreedom; index += 1) {
        const draw = nextNormal();
        chiSquare += draw * draw;
      }
      if (!Number.isFinite(chiSquare) || chiSquare <= 0) {
        return blocked("simulation_nonfinite");
      }
      const studentScale = Math.sqrt((degreesOfFreedom - 2) / chiSquare);
      const factorShock = factorNormal.map(
        (value, index) => factorMean[index] + value * studentScale,
      );
      const residualShock = correlatedNormal(
        residualCholesky.lower,
        nextNormal,
      );
      for (let assetIndex = 0; assetIndex < assetCount; assetIndex += 1) {
        const logReturn =
          intercepts[assetIndex] +
          dot(betas[assetIndex], factorShock) +
          residualShock[assetIndex];
        const growth = Math.exp(logReturn);
        cumulativeAssetGrowth[assetIndex] *= growth;
        if (
          !Number.isFinite(growth) ||
          growth <= 0 ||
          !Number.isFinite(cumulativeAssetGrowth[assetIndex]) ||
          cumulativeAssetGrowth[assetIndex] <= 0
        ) {
          return blocked("simulation_nonfinite");
        }
      }
      const nav = dot(input.weights, cumulativeAssetGrowth);
      if (!Number.isFinite(nav) || nav <= 0) {
        return blocked("simulation_nonfinite");
      }
      navPath[stepIndex] = nav;
    }
    paths.push(navPath);
  }

  const exposures = input.assetKeys.map((assetKey, assetIndex) => {
    const assetStd = Math.sqrt(Math.max(assetCovariance[assetIndex][assetIndex], 0));
    const standardizedBetas = betas[assetIndex].map((beta, factorIndex) => {
      const factorStd = Math.sqrt(
        Math.max(factorCovariance[factorIndex][factorIndex], 0),
      );
      return assetStd > 0 ? (beta * factorStd) / assetStd : 0;
    });
    const residualVariance = residualCovariance[assetIndex][assetIndex];
    const assetVariance = assetCovariance[assetIndex][assetIndex];
    return Object.freeze({
      assetKey,
      intercept: intercepts[assetIndex],
      betas: Object.freeze([...betas[assetIndex]]),
      standardizedBetas: Object.freeze(standardizedBetas),
      rSquared:
        assetVariance > 0
          ? 1 - Math.max(residualVariance, 0) / assetVariance
          : 0,
    });
  });

  return Object.freeze({
    status: "ready" as const,
    reason: null,
    policy: SIMULATION_FACTOR_RESIDUAL_MODEL_POLICY,
    paths: Object.freeze(paths.map((path) => Object.freeze(path))),
    diagnostics: Object.freeze({
      observationCount: input.observations.length,
      assetCount,
      factorCount,
      regressionRidge,
      regressionCholeskyJitter: regressionCholesky.jitter,
      factorCholeskyJitter: factorCholesky.jitter,
      residualCholeskyJitter: residualCholesky.jitter,
    }),
    exposures: Object.freeze(exposures),
  });
}

function normalizedEwmaWeights(count: number, decay: number) {
  const weights = Array.from(
    { length: count },
    (_, index) => decay ** (count - index - 1),
  );
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((value) => value / total);
}

function weightedMean(
  rows: readonly (readonly number[])[],
  weights: readonly number[],
  columnCount: number,
) {
  const means = new Array(columnCount).fill(0);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      means[columnIndex] += rows[rowIndex][columnIndex] * weights[rowIndex];
    }
  }
  return means;
}

function weightedCovariance(
  rows: readonly (readonly number[])[],
  means: readonly number[],
  weights: readonly number[],
) {
  const correction = 1 - weights.reduce((sum, value) => sum + value * value, 0);
  const covariance = Array.from({ length: means.length }, () =>
    new Array(means.length).fill(0),
  );
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    for (let left = 0; left < means.length; left += 1) {
      const leftCentered = rows[rowIndex][left] - means[left];
      for (let right = 0; right <= left; right += 1) {
        covariance[left][right] +=
          weights[rowIndex] *
          leftCentered *
          (rows[rowIndex][right] - means[right]);
      }
    }
  }
  for (let left = 0; left < means.length; left += 1) {
    for (let right = 0; right <= left; right += 1) {
      const value = covariance[left][right] / correction;
      covariance[left][right] = value;
      covariance[right][left] = value;
    }
  }
  return covariance;
}

function weightedCrossCovariance(
  leftRows: readonly (readonly number[])[],
  leftMeans: readonly number[],
  rightRows: readonly (readonly number[])[],
  rightMeans: readonly number[],
  weights: readonly number[],
) {
  const correction = 1 - weights.reduce((sum, value) => sum + value * value, 0);
  return leftMeans.map((leftMean, leftIndex) =>
    rightMeans.map((rightMean, rightIndex) => {
      let sum = 0;
      for (let rowIndex = 0; rowIndex < leftRows.length; rowIndex += 1) {
        sum +=
          weights[rowIndex] *
          (leftRows[rowIndex][leftIndex] - leftMean) *
          (rightRows[rowIndex][rightIndex] - rightMean);
      }
      return sum / correction;
    }),
  );
}

function shrinkOffDiagonal(matrix: readonly (readonly number[])[], intensity: number) {
  return matrix.map((row, rowIndex) =>
    row.map((value, columnIndex) =>
      rowIndex === columnIndex ? value : value * (1 - intensity),
    ),
  );
}

function choleskyWithJitter(matrix: readonly (readonly number[])[]) {
  const scale = Math.max(
    ...matrix.map((row, index) => Math.abs(row[index])),
    1e-12,
  );
  for (const multiplier of [0, 1e-12, 1e-10, 1e-8, 1e-6]) {
    const jitter = scale * multiplier;
    const lower = cholesky(
      matrix.map((row, rowIndex) =>
        row.map((value, columnIndex) =>
          rowIndex === columnIndex ? value + jitter : value,
        ),
      ),
    );
    if (lower) return Object.freeze({ lower, jitter });
  }
  return null;
}

function cholesky(matrix: readonly (readonly number[])[]) {
  const lower = Array.from({ length: matrix.length }, () =>
    new Array(matrix.length).fill(0),
  );
  for (let row = 0; row < matrix.length; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      let sum = matrix[row][column];
      for (let index = 0; index < column; index += 1) {
        sum -= lower[row][index] * lower[column][index];
      }
      if (row === column) {
        if (!Number.isFinite(sum) || sum <= 0) return null;
        lower[row][column] = Math.sqrt(sum);
      } else {
        lower[row][column] = sum / lower[column][column];
      }
    }
  }
  return lower;
}

function solveCholesky(lower: readonly (readonly number[])[], values: readonly number[]) {
  const intermediate = new Array(values.length).fill(0);
  for (let row = 0; row < values.length; row += 1) {
    let value = values[row];
    for (let column = 0; column < row; column += 1) {
      value -= lower[row][column] * intermediate[column];
    }
    intermediate[row] = value / lower[row][row];
  }
  const result = new Array(values.length).fill(0);
  for (let row = values.length - 1; row >= 0; row -= 1) {
    let value = intermediate[row];
    for (let column = row + 1; column < values.length; column += 1) {
      value -= lower[column][row] * result[column];
    }
    result[row] = value / lower[row][row];
  }
  return result;
}

function createStandardNormal(nextRandom: () => number) {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let first = 0;
    let second = 0;
    while (first <= Number.EPSILON) first = nextRandom();
    while (second <= Number.EPSILON) second = nextRandom();
    const magnitude = Math.sqrt(-2 * Math.log(first));
    const angle = 2 * Math.PI * second;
    spare = magnitude * Math.sin(angle);
    return magnitude * Math.cos(angle);
  };
}

function correlatedNormal(
  lower: readonly (readonly number[])[],
  nextNormal: () => number,
) {
  const independent = lower.map(() => nextNormal());
  return lower.map((row, rowIndex) => {
    let value = 0;
    for (let column = 0; column <= rowIndex; column += 1) {
      value += row[column] * independent[column];
    }
    return value;
  });
}

function dot(left: readonly number[], right: readonly number[]) {
  let sum = 0;
  let compensation = 0;
  for (let index = 0; index < left.length; index += 1) {
    const value = left[index] * right[index];
    const next = sum + value;
    compensation +=
      Math.abs(sum) >= Math.abs(value)
        ? sum - next + value
        : value - next + sum;
    sum = next;
  }
  return sum + compensation;
}

function blocked(
  reason:
    | "invalid_input"
    | "insufficient_observations"
    | "factor_covariance_not_positive_definite"
    | "residual_covariance_not_positive_definite"
    | "simulation_nonfinite",
) {
  return Object.freeze({
    status: "unavailable" as const,
    reason,
    policy: SIMULATION_FACTOR_RESIDUAL_MODEL_POLICY,
    paths: Object.freeze([]),
    diagnostics: null,
    exposures: Object.freeze([]),
  });
}
