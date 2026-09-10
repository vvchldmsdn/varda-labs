import { createMulberry32 } from "./simulation-prng.ts";
import {
  choleskyWithJitter, correlatedNormal, createStandardNormal, dot,
  normalizedEwmaWeights, shrinkOffDiagonal, solveCholesky,
  weightedCovariance, weightedCrossCovariance, weightedMean,
} from "./simulation-factor-residual-model.ts";

/** This is a conditional research distribution, not a validated forecast.
 * Units: x = [log(KRW per USD), US 10Y percentage level, curve percentage points].
 * Training pairs are (previousFactorState, next factorChanges); no look-ahead state.
 * The local mean is recomputed at every simulated state. Covariances and betas are
 * fitted once, not re-estimated in a small local neighborhood. All portfolio
 * evaluations must reuse assetGrowth: KRW returns already contain FX effects.
 */
export const SIMULATION_ECONOMIC_STATE_MODEL_POLICY = Object.freeze({
  version: "simulation_economic_state_conditional_mean_v1",
  factorKeys: Object.freeze(["usdkrw", "us_10y_yield", "us_10y2y_curve"] as const),
  minimumObservationCount: 45,
  maximumObservationCount: 90,
  maximumAssetCount: 64,
  maximumHorizon: 126,
  maximumPathCount: 500,
  ewmaDecay: 0.97,
  factorCovarianceOffDiagonalShrinkage: 0.15,
  residualCovarianceOffDiagonalShrinkage: 0.25,
  regressionRidgeScale: 1e-6,
  studentTDegreesOfFreedom: 7,
  kernelBandwidth: 1,
  maximumLocalBlend: 0.5,
  fullBlendEffectiveSampleSize: 20,
  supportDistanceScale: 2,
  robustScale: "median_absolute_deviation_times_1_4826_then_sample_sd",
  conditioning: "sequential_state_local_mean_fixed_global_covariance",
  factorShockDistribution: "covariance_scaled_student_t",
  residualShockDistribution: "correlated_gaussian_independent_of_factor_innovation",
  covarianceShrinkageTarget: "same_diagonal_zero_off_diagonal",
  portfolioPath: "gross_normalized_buy_and_hold_no_rebalancing",
  extrapolationDefinition: "nearest_training_state_robust_rms_distance_above_2",
  pointInTimeAvailability: "not_established",
  vintageAuthority: "not_established",
  interpretation: "conditional_research_distribution_not_validated_forecast",
  fallback: "forbidden",
} as const);

export type EconomicFactorState = readonly [number, number, number];
export type EconomicStateObservation = Readonly<{
  previousFactorState: EconomicFactorState;
  factorChanges: EconomicFactorState;
  assetLogReturns: readonly number[];
}>;

/** Server computation only. Never pass these buffers to client components.
 * Offsets are ((pathIndex * (horizon + 1) + stepIndex) * columns + column).
 * assetGrowth is cumulative growth (step zero = 1), not daily simple returns.
 * factorStates contains transformed levels, not display levels or changes.
 * Buffers are exclusively owned by the result and consumers must not mutate them.
 */
export type ReadyPreparedEconomicStatePaths = Readonly<{
  status: "ready";
  modelVersion: typeof SIMULATION_ECONOMIC_STATE_MODEL_POLICY.version;
  assetKeys: readonly string[];
  factorKeys: typeof SIMULATION_ECONOMIC_STATE_MODEL_POLICY.factorKeys;
  horizon: number;
  pathCount: number;
  seed: number;
  assetGrowth: Float64Array;
  factorStates: Float64Array;
}>;

export type EconomicStateModelInput = Readonly<{
  assetKeys: readonly string[];
  observations: readonly EconomicStateObservation[];
  initialFactorState: EconomicFactorState;
  horizon: number;
  pathCount: number;
  seed: number;
}>;
export type EconomicStateModelResult = ReturnType<typeof simulateEconomicStateModel>;
export type ReadyEconomicStateModel = Extract<EconomicStateModelResult, { status: "ready" }>;

export function simulateEconomicStateModel(input: EconomicStateModelInput) {
  const policy = SIMULATION_ECONOMIC_STATE_MODEL_POLICY;
  const assetCount = input.assetKeys.length;
  if (
    assetCount < 1 || assetCount > policy.maximumAssetCount ||
    new Set(input.assetKeys).size !== assetCount ||
    input.assetKeys.some((key) => typeof key !== "string" || key.trim() === "") ||
    !validState(input.initialFactorState) ||
    !Number.isInteger(input.horizon) || input.horizon < 1 || input.horizon > policy.maximumHorizon ||
    !Number.isInteger(input.pathCount) || input.pathCount < 1 || input.pathCount > policy.maximumPathCount ||
    !Number.isSafeInteger(input.seed) ||
    input.observations.length > policy.maximumObservationCount ||
    input.observations.some((row) =>
      !validState(row.previousFactorState) || !validState(row.factorChanges) ||
      row.assetLogReturns.length !== assetCount || row.assetLogReturns.some((v) => !Number.isFinite(v)))
  ) return blocked("invalid_input");
  if (input.observations.length < policy.minimumObservationCount) return blocked("insufficient_observations");
  if (!Number.isFinite(Math.exp(input.initialFactorState[0])) || Math.exp(input.initialFactorState[0]) <= 0) {
    return blocked("invalid_input");
  }

  const ewma = normalizedEwmaWeights(input.observations.length, policy.ewmaDecay);
  const assetRows = input.observations.map((row) => row.assetLogReturns);
  const factorRows = input.observations.map((row) => row.factorChanges);
  const assetMean = weightedMean(assetRows, ewma, assetCount);
  const factorMean = weightedMean(factorRows, ewma, 3);
  const assetCovariance = weightedCovariance(assetRows, assetMean, ewma);
  const factorCovariance = shrinkOffDiagonal(
    weightedCovariance(factorRows, factorMean, ewma), policy.factorCovarianceOffDiagonalShrinkage,
  );
  const cross = weightedCrossCovariance(assetRows, assetMean, factorRows, factorMean, ewma);
  const regressionRidge = Math.max(...factorCovariance.map((row, i) => row[i]), 1e-12) * policy.regressionRidgeScale;
  const regressionCholesky = choleskyWithJitter(factorCovariance.map((row, i) => row.map((v, j) => i === j ? v + regressionRidge : v)));
  if (!regressionCholesky) return blocked("factor_covariance_not_positive_definite");
  const betas = cross.map((row) => solveCholesky(regressionCholesky.lower, row));
  const intercepts = assetMean.map((mean, i) => mean - dot(betas[i], factorMean));
  const residualRows = input.observations.map((row) => row.assetLogReturns.map(
    (value, i) => value - intercepts[i] - dot(betas[i], row.factorChanges),
  ));
  const residualMean = weightedMean(residualRows, ewma, assetCount);
  const residualCovariance = shrinkOffDiagonal(
    weightedCovariance(residualRows, residualMean, ewma), policy.residualCovarianceOffDiagonalShrinkage,
  );
  const factorCholesky = choleskyWithJitter(factorCovariance);
  const residualCholesky = choleskyWithJitter(residualCovariance);
  if (!factorCholesky) return blocked("factor_covariance_not_positive_definite");
  if (!residualCholesky) return blocked("residual_covariance_not_positive_definite");

  const conditioning = prepareConditioning(input.observations, ewma, factorMean);
  const initialCondition = conditionalMean(conditioning, input.initialFactorState);
  const pathStride = input.horizon + 1;
  const assetGrowth = new Float64Array(input.pathCount * pathStride * assetCount);
  const factorStates = new Float64Array(input.pathCount * pathStride * 3);
  const nextNormal = createStandardNormal(createMulberry32(input.seed));
  let extrapolatedStepCount = 0;
  let blendSum = 0;
  let minimumEffectiveSampleSize = Number.POSITIVE_INFINITY;
  for (let pathIndex = 0; pathIndex < input.pathCount; pathIndex += 1) {
    const state: number[] = [...input.initialFactorState];
    const growth = new Array<number>(assetCount).fill(1);
    assetGrowth.set(growth, pathIndex * pathStride * assetCount);
    factorStates.set(state, pathIndex * pathStride * 3);
    for (let step = 1; step <= input.horizon; step += 1) {
      const condition = conditionalMean(conditioning, state);
      if (condition.supportDistance > policy.supportDistanceScale) extrapolatedStepCount += 1;
      blendSum += condition.localBlend;
      minimumEffectiveSampleSize = Math.min(minimumEffectiveSampleSize, condition.effectiveSampleSize);
      const normal = correlatedNormal(factorCholesky.lower, nextNormal);
      let chiSquare = 0;
      for (let draw = 0; draw < policy.studentTDegreesOfFreedom; draw += 1) chiSquare += nextNormal() ** 2;
      if (!Number.isFinite(chiSquare) || chiSquare <= 0) return blocked("simulation_nonfinite");
      const scale = Math.sqrt((policy.studentTDegreesOfFreedom - 2) / chiSquare);
      const change = normal.map((value, i) => condition.mean[i] + value * scale);
      const residual = correlatedNormal(residualCholesky.lower, nextNormal);
      for (let factor = 0; factor < 3; factor += 1) state[factor] += change[factor];
      if (!state.every(Number.isFinite) || !Number.isFinite(Math.exp(state[0])) || Math.exp(state[0]) <= 0) {
        return blocked("simulation_nonfinite");
      }
      for (let asset = 0; asset < assetCount; asset += 1) {
        growth[asset] *= Math.exp(intercepts[asset] + dot(betas[asset], change) + residual[asset]);
        if (!Number.isFinite(growth[asset]) || growth[asset] <= 0) return blocked("simulation_nonfinite");
      }
      const point = pathIndex * pathStride + step;
      assetGrowth.set(growth, point * assetCount);
      factorStates.set(state, point * 3);
    }
  }
  const prepared: ReadyPreparedEconomicStatePaths = Object.freeze({
    status: "ready", modelVersion: policy.version,
    assetKeys: Object.freeze([...input.assetKeys]), factorKeys: policy.factorKeys,
    horizon: input.horizon, pathCount: input.pathCount, seed: input.seed, assetGrowth, factorStates,
  });
  const exposures = input.assetKeys.map((assetKey, i) => {
    const variance = assetCovariance[i][i];
    return Object.freeze({
      assetKey, intercept: intercepts[i], betas: Object.freeze(betas[i]),
      standardizedBetas: Object.freeze(betas[i].map((beta, j) => variance > 0 ? beta * Math.sqrt(Math.max(0, factorCovariance[j][j]) / variance) : 0)),
      rSquared: variance > 0 ? 1 - Math.max(0, residualCovariance[i][i]) / variance : 0,
    });
  });
  return Object.freeze({
    status: "ready" as const, reason: null, policy, prepared,
    factorBands: summarizeEconomicFactorBands(prepared),
    exposures: Object.freeze(exposures),
    diagnostics: Object.freeze({
      observationCount: input.observations.length, assetCount, factorCount: 3,
      initialEffectiveSampleSize: initialCondition.effectiveSampleSize,
      initialSupportDistance: initialCondition.supportDistance,
      initialLocalBlend: initialCondition.localBlend,
      initialConditionalFactorMean: Object.freeze(initialCondition.mean),
      globalFactorMean: Object.freeze(factorMean),
      robustStateScales: Object.freeze(conditioning.scales),
      extrapolatedStepCount,
      simulatedStepCount: input.pathCount * input.horizon,
      extrapolatedStepsPct: 100 * extrapolatedStepCount / (input.pathCount * input.horizon),
      meanLocalBlend: blendSum / (input.pathCount * input.horizon), minimumEffectiveSampleSize,
      conditioning: policy.conditioning, regressionRidge,
      regressionCholeskyJitter: regressionCholesky.jitter,
      factorCholeskyJitter: factorCholesky.jitter,
      residualCholeskyJitter: residualCholesky.jitter,
      factorCovariance: Object.freeze(factorCovariance.map((row) => Object.freeze(row))),
      residualCovariance: Object.freeze(residualCovariance.map((row) => Object.freeze(row))),
    }),
  });
}

/** Evaluate a candidate by reweighting the exact same cumulative asset paths. */
export function evaluateEconomicStatePaths(input: {
  prepared: ReadyPreparedEconomicStatePaths;
  weights: readonly number[];
  horizon?: number;
}) {
  const { prepared, weights } = input;
  const count = prepared.assetKeys.length;
  const horizon = input.horizon ?? prepared.horizon;
  if (
    prepared.status !== "ready" || prepared.modelVersion !== SIMULATION_ECONOMIC_STATE_MODEL_POLICY.version ||
    count < 1 || count > 64 || new Set(prepared.assetKeys).size !== count ||
    !Number.isInteger(prepared.pathCount) || prepared.pathCount < 1 || prepared.pathCount > 500 ||
    !Number.isInteger(prepared.horizon) || prepared.horizon < 1 || prepared.horizon > 126 ||
    !Number.isInteger(horizon) || horizon < 1 || horizon > prepared.horizon ||
    weights.length !== count || weights.some((v) => !Number.isFinite(v) || v < 0) ||
    Math.abs(weights.reduce((s, v) => s + v, 0) - 1) > 1e-10 ||
    prepared.assetGrowth.length !== prepared.pathCount * (prepared.horizon + 1) * count
  ) return Object.freeze({ status: "unavailable" as const, reason: "invalid_input" as const, paths: Object.freeze([]) });
  const paths: number[][] = [];
  for (let pathIndex = 0; pathIndex < prepared.pathCount; pathIndex += 1) {
    const path: number[] = [];
    for (let step = 0; step <= horizon; step += 1) {
      const offset = (pathIndex * (prepared.horizon + 1) + step) * count;
      let nav = 0;
      for (let asset = 0; asset < count; asset += 1) {
        const value = prepared.assetGrowth[offset + asset];
        if (!Number.isFinite(value) || value <= 0 || (step === 0 && value !== 1)) {
          return Object.freeze({ status: "unavailable" as const, reason: "invalid_path" as const, paths: Object.freeze([]) });
        }
        nav += weights[asset] * value;
      }
      if (!Number.isFinite(nav) || nav <= 0) return Object.freeze({ status: "unavailable" as const, reason: "invalid_path" as const, paths: Object.freeze([]) });
      path.push(step === 0 ? 1 : nav);
    }
    paths.push(path);
  }
  return Object.freeze({ status: "ready" as const, reason: null, paths: Object.freeze(paths.map((path) => Object.freeze(path))) });
}

function prepareConditioning(rows: readonly EconomicStateObservation[], ewma: readonly number[], globalMean: readonly number[]) {
  const centers = [0, 1, 2].map((j) => quantile(rows.map((row) => row.previousFactorState[j]).sort((a, b) => a - b), 0.5));
  const scales = centers.map((center, j) => {
    const values = rows.map((row) => row.previousFactorState[j]);
    const mad = quantile(values.map((v) => Math.abs(v - center)).sort((a, b) => a - b), 0.5) * 1.4826;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1));
    return mad > 1e-12 ? mad : Math.max(sd, Math.max(1, Math.abs(center)) * 1e-8);
  });
  return { rows, ewma, globalMean, centers, scales,
    states: rows.map((row) => row.previousFactorState.map((v, j) => (v - centers[j]) / scales[j])),
  };
}

function conditionalMean(model: ReturnType<typeof prepareConditioning>, state: readonly number[]) {
  const policy = SIMULATION_ECONOMIC_STATE_MODEL_POLICY;
  const normalized = state.map((v, j) => (v - model.centers[j]) / model.scales[j]);
  const distances = model.states.map((row) => row.reduce((sum, v, j) => sum + (v - normalized[j]) ** 2, 0) / 3);
  const minimumDistanceSquared = Math.min(...distances);
  // Subtract the nearest exponent before normalization to avoid distant-state underflow.
  const weights = distances.map((distance, i) => model.ewma[i] * Math.exp(-0.5 * (distance - minimumDistanceSquared) / policy.kernelBandwidth ** 2));
  const total = weights.reduce((sum, v) => sum + v, 0);
  let sumSquares = 0;
  const localMean = [0, 0, 0];
  for (let i = 0; i < weights.length; i += 1) {
    const weight = weights[i] / total;
    sumSquares += weight ** 2;
    for (let j = 0; j < 3; j += 1) localMean[j] += weight * model.rows[i].factorChanges[j];
  }
  const effectiveSampleSize = 1 / sumSquares;
  const supportDistance = Math.sqrt(minimumDistanceSquared);
  const localBlend = policy.maximumLocalBlend * Math.min(1, Math.max(0, (effectiveSampleSize - 1) / (policy.fullBlendEffectiveSampleSize - 1))) * Math.exp(-0.5 * (supportDistance / policy.supportDistanceScale) ** 2);
  return { effectiveSampleSize, supportDistance, localBlend,
    mean: model.globalMean.map((mean, j) => mean + localBlend * (localMean[j] - mean)),
  };
}

function summarizeEconomicFactorBands(prepared: ReadyPreparedEconomicStatePaths) {
  return Object.freeze(prepared.factorKeys.map((factorKey, factorIndex) => Object.freeze({
    factorKey,
    unit: factorIndex === 0 ? "KRW_per_USD" as const : factorIndex === 1 ? "percent" as const : "percentage_points" as const,
    points: Object.freeze(Array.from({ length: prepared.horizon + 1 }, (_, stepIndex) => {
      const values = Array.from({ length: prepared.pathCount }, (_, pathIndex) => {
        const value = prepared.factorStates[(pathIndex * (prepared.horizon + 1) + stepIndex) * 3 + factorIndex];
        return factorIndex === 0 ? Math.exp(value) : value;
      }).sort((a, b) => a - b);
      return Object.freeze({ stepIndex, p10: quantile(values, 0.1), p50: quantile(values, 0.5), p90: quantile(values, 0.9) });
    })),
  })));
}

function quantile(sorted: readonly number[], p: number) {
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  return sorted[lower] + (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) * (position - lower);
}

function validState(values: readonly number[]) {
  return values.length === 3 && values.every(Number.isFinite);
}

function blocked(reason: "invalid_input" | "insufficient_observations" | "factor_covariance_not_positive_definite" | "residual_covariance_not_positive_definite" | "simulation_nonfinite") {
  return Object.freeze({ status: "unavailable" as const, reason, policy: SIMULATION_ECONOMIC_STATE_MODEL_POLICY,
    prepared: null, factorBands: Object.freeze([]), diagnostics: null, exposures: Object.freeze([]),
  });
}
