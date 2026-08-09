import {
  arithmeticMean,
  sampleCovarianceMatrix,
  sampleVariance,
} from "./portfolio-risk-statistics.ts";

export type InvestmentLabOptimizerObjective =
  | "highest_return"
  | "minimum_volatility"
  | "minimum_drawdown"
  | "maximum_sharpe";

export type InvestmentLabOptimizerTrainingMetrics = Readonly<{
  terminalReturn: number;
  annualizedVolatility: number;
  maximumDrawdown: number;
  annualizedSharpe: number | null;
}>;

export type InvestmentLabOptimizerCandidate = Readonly<{
  objective: InvestmentLabOptimizerObjective;
  weights: readonly number[];
  metrics: InvestmentLabOptimizerTrainingMetrics;
  searchMethod:
    | "bounded_terminal_return_exact"
    | "shrunk_covariance_warm_start_and_deterministic_refinement"
    | "deterministic_low_discrepancy_and_coordinate_refinement";
}>;

const ANNUALIZATION_FACTOR = 252;
const CANDIDATE_SAMPLE_COUNT = 1_024;
const COVARIANCE_SHRINKAGE = 0.1;
const VARIANCE_FLOOR = 1e-12;
const SIMPLEX_TOLERANCE = 1e-12;

export function estimateInvestmentLabOptimizerCandidates(input: Readonly<{
  growthSeries: readonly (readonly number[])[];
  currentWeights: readonly number[];
  maximumWeight: number;
}>): readonly InvestmentLabOptimizerCandidate[] | null {
  const instrumentCount = input.growthSeries.length;
  const pointCount = input.growthSeries[0]?.length ?? 0;
  if (
    instrumentCount < 2 ||
    instrumentCount > 20 ||
    pointCount < 3 ||
    input.currentWeights.length !== instrumentCount ||
    !Number.isFinite(input.maximumWeight) ||
    input.maximumWeight <= 0 ||
    input.maximumWeight > 1 ||
    instrumentCount * input.maximumWeight < 1 - SIMPLEX_TOLERANCE ||
    input.growthSeries.some(
      (series) =>
        series.length !== pointCount ||
        series.some((value) => !Number.isFinite(value) || value <= 0),
    )
  ) {
    return null;
  }

  const normalizedGrowth = input.growthSeries.map((series) => {
    const initial = series[0];
    return series.map((value) => value / initial);
  });
  const returnSeries = normalizedGrowth.map((series) =>
    series.slice(1).map((value, index) => value / series[index] - 1),
  );
  if (
    returnSeries.some((series) =>
      series.some((value) => !Number.isFinite(value) || value <= -1),
    )
  ) {
    return null;
  }

  const equalWeight = Array.from(
    { length: instrumentCount },
    () => 1 / instrumentCount,
  );
  const currentWeight = projectCappedSimplex(
    input.currentWeights,
    input.maximumWeight,
  );
  const highestReturnWeight = terminalReturnMaximizer(
    normalizedGrowth,
    input.maximumWeight,
  );
  const minimumVarianceWeight = projectedMinimumVariance(
    returnSeries,
    input.maximumWeight,
  );
  if (!currentWeight || !highestReturnWeight || !minimumVarianceWeight) {
    return null;
  }

  const candidates = new Map<string, readonly number[]>();
  addCandidate(candidates, equalWeight);
  addCandidate(candidates, currentWeight);
  addCandidate(candidates, highestReturnWeight);
  addCandidate(candidates, minimumVarianceWeight);
  const primes = firstPrimes(instrumentCount);
  for (let sample = 1; sample <= CANDIDATE_SAMPLE_COUNT; sample += 1) {
    const raw = primes.map((prime, index) => {
      const value = Math.max(halton(sample + index * 17, prime), 1e-12);
      return -Math.log(value);
    });
    const projected = projectCappedSimplex(raw, input.maximumWeight);
    if (projected) addCandidate(candidates, projected);
  }

  const scored = [...candidates.values()].flatMap((weights) => {
    const metrics = trainingMetrics(normalizedGrowth, weights);
    return metrics ? [{ weights, metrics }] : [];
  });
  if (scored.length === 0) return null;

  const seeds = new Map<InvestmentLabOptimizerObjective, readonly number[]>([
    ["highest_return", highestReturnWeight],
    ["minimum_volatility", pickBest(scored, "minimum_volatility").weights],
    ["minimum_drawdown", pickBest(scored, "minimum_drawdown").weights],
    ["maximum_sharpe", pickBest(scored, "maximum_sharpe").weights],
  ]);
  const objectives: readonly InvestmentLabOptimizerObjective[] = [
    "highest_return",
    "minimum_volatility",
    "minimum_drawdown",
    "maximum_sharpe",
  ];

  return Object.freeze(
    objectives.map((objective) => {
      const refined =
        objective === "highest_return"
          ? [...seeds.get(objective)!]
          : refineByCoordinateTransfer({
              objective,
              seed: seeds.get(objective)!,
              growthSeries: normalizedGrowth,
              maximumWeight: input.maximumWeight,
            });
      const metrics = trainingMetrics(normalizedGrowth, refined)!;
      return Object.freeze({
        objective,
        weights: Object.freeze(refined),
        metrics,
        searchMethod:
          objective === "highest_return"
            ? "bounded_terminal_return_exact"
            : objective === "minimum_volatility"
              ? "shrunk_covariance_warm_start_and_deterministic_refinement"
              : "deterministic_low_discrepancy_and_coordinate_refinement",
      });
    }),
  );
}

export function evaluateInvestmentLabOptimizerTrainingMetrics(input: Readonly<{
  growthSeries: readonly (readonly number[])[];
  weights: readonly number[];
}>) {
  if (
    input.growthSeries.length === 0 ||
    input.weights.length !== input.growthSeries.length ||
    input.weights.some((weight) => !Number.isFinite(weight) || weight < 0) ||
    Math.abs(compensatedSum(input.weights) - 1) > 1e-8
  ) {
    return null;
  }
  return trainingMetrics(input.growthSeries, input.weights);
}

function projectedMinimumVariance(
  returnSeries: readonly (readonly number[])[],
  maximumWeight: number,
) {
  const covariance = sampleCovarianceMatrix(
    returnSeries.map((series) => [...series]),
  );
  const shrunk = covariance.map((row, rowIndex) =>
    row.map((value, columnIndex) => {
      const diagonal = rowIndex === columnIndex ? value : 0;
      const estimate =
        value * (1 - COVARIANCE_SHRINKAGE) +
        diagonal * COVARIANCE_SHRINKAGE;
      return rowIndex === columnIndex
        ? Math.max(VARIANCE_FLOOR, estimate)
        : estimate;
    }),
  );
  if (shrunk.some((row) => row.some((value) => !Number.isFinite(value)))) {
    return null;
  }
  const instrumentCount = shrunk.length;
  let weights = Array.from(
    { length: instrumentCount },
    () => 1 / instrumentCount,
  );
  const rowNorm = Math.max(
    ...shrunk.map((row) => row.reduce((sum, value) => sum + Math.abs(value), 0)),
    VARIANCE_FLOOR,
  );
  const step = 1 / (2 * rowNorm);

  for (let iteration = 0; iteration < 5_000; iteration += 1) {
    const gradient = shrunk.map(
      (row) =>
        2 *
        row.reduce(
          (sum, value, index) => sum + value * weights[index],
          0,
        ),
    );
    const projected = projectCappedSimplex(
      weights.map((weight, index) => weight - step * gradient[index]),
      maximumWeight,
    );
    if (!projected) return null;
    const delta = projected.reduce(
      (sum, value, index) => sum + Math.abs(value - weights[index]),
      0,
    );
    weights = projected;
    if (delta < 1e-11) break;
  }
  return weights;
}

function terminalReturnMaximizer(
  growthSeries: readonly (readonly number[])[],
  maximumWeight: number,
) {
  const order = growthSeries
    .map((series, index) => ({ index, terminal: series.at(-1)! }))
    .sort((left, right) => right.terminal - left.terminal || left.index - right.index);
  const weights = Array.from({ length: growthSeries.length }, () => 0);
  let remaining = 1;
  for (const row of order) {
    const allocation = Math.min(maximumWeight, remaining);
    weights[row.index] = allocation;
    remaining -= allocation;
    if (remaining <= SIMPLEX_TOLERANCE) break;
  }
  return remaining <= SIMPLEX_TOLERANCE ? weights : null;
}

function refineByCoordinateTransfer(input: Readonly<{
  objective: InvestmentLabOptimizerObjective;
  seed: readonly number[];
  growthSeries: readonly (readonly number[])[];
  maximumWeight: number;
}>) {
  let bestWeights = [...input.seed];
  let bestMetrics = trainingMetrics(input.growthSeries, bestWeights)!;
  for (const step of [0.02, 0.01, 0.005]) {
    let improved = true;
    let passes = 0;
    while (improved && passes < 8) {
      improved = false;
      passes += 1;
      for (let donor = 0; donor < bestWeights.length; donor += 1) {
        for (let receiver = 0; receiver < bestWeights.length; receiver += 1) {
          if (donor === receiver) continue;
          const transfer = Math.min(
            step,
            bestWeights[donor],
            input.maximumWeight - bestWeights[receiver],
          );
          if (transfer <= SIMPLEX_TOLERANCE) continue;
          const candidate = [...bestWeights];
          candidate[donor] -= transfer;
          candidate[receiver] += transfer;
          const metrics = trainingMetrics(input.growthSeries, candidate);
          if (
            metrics &&
            better(
              { weights: candidate, metrics },
              { weights: bestWeights, metrics: bestMetrics },
              input.objective,
            )
          ) {
            bestWeights = candidate;
            bestMetrics = metrics;
            improved = true;
          }
        }
      }
    }
  }
  return bestWeights.map(cleanWeight);
}

function trainingMetrics(
  growthSeries: readonly (readonly number[])[],
  weights: readonly number[],
): InvestmentLabOptimizerTrainingMetrics | null {
  const pointCount = growthSeries[0]?.length ?? 0;
  const values = Array.from({ length: pointCount }, (_, pointIndex) =>
    compensatedSum(
      weights.map(
        (weight, instrumentIndex) =>
          weight * growthSeries[instrumentIndex][pointIndex],
      ),
    ),
  );
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  const returns = values.slice(1).map((value, index) => value / values[index] - 1);
  if (returns.length < 2 || returns.some((value) => !Number.isFinite(value))) {
    return null;
  }
  const mean = arithmeticMean(returns);
  const variance = sampleVariance(returns, mean);
  const annualizedVolatility = Math.sqrt(Math.max(0, variance) * ANNUALIZATION_FACTOR);
  const annualizedSharpe =
    variance <= VARIANCE_FLOOR
      ? null
      : (mean / Math.sqrt(variance)) * Math.sqrt(ANNUALIZATION_FACTOR);
  let peak = values[0];
  let maximumDrawdown = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    maximumDrawdown = Math.max(maximumDrawdown, 1 - value / peak);
  }
  if (
    !Number.isFinite(annualizedVolatility) ||
    !Number.isFinite(maximumDrawdown) ||
    (annualizedSharpe !== null && !Number.isFinite(annualizedSharpe))
  ) {
    return null;
  }
  return Object.freeze({
    terminalReturn: cleanZero(values.at(-1)! / values[0] - 1),
    annualizedVolatility: cleanZero(annualizedVolatility),
    maximumDrawdown: cleanZero(maximumDrawdown),
    annualizedSharpe: annualizedSharpe === null ? null : cleanZero(annualizedSharpe),
  });
}

function pickBest(
  candidates: readonly Readonly<{
    weights: readonly number[];
    metrics: InvestmentLabOptimizerTrainingMetrics;
  }>[],
  objective: InvestmentLabOptimizerObjective,
) {
  return candidates.reduce((best, candidate) =>
    better(candidate, best, objective) ? candidate : best,
  );
}

function better(
  candidate: Readonly<{
    weights: readonly number[];
    metrics: InvestmentLabOptimizerTrainingMetrics;
  }>,
  incumbent: Readonly<{
    weights: readonly number[];
    metrics: InvestmentLabOptimizerTrainingMetrics;
  }>,
  objective: InvestmentLabOptimizerObjective,
) {
  const candidateScore = objectiveScore(candidate.metrics, objective);
  const incumbentScore = objectiveScore(incumbent.metrics, objective);
  const difference = candidateScore - incumbentScore;
  if (Math.abs(difference) > 1e-12) return difference > 0;
  return lexicographicWeightCompare(candidate.weights, incumbent.weights) < 0;
}

function objectiveScore(
  metrics: InvestmentLabOptimizerTrainingMetrics,
  objective: InvestmentLabOptimizerObjective,
) {
  switch (objective) {
    case "highest_return":
      return metrics.terminalReturn;
    case "minimum_volatility":
      return -metrics.annualizedVolatility;
    case "minimum_drawdown":
      return -metrics.maximumDrawdown;
    case "maximum_sharpe":
      return metrics.annualizedSharpe ?? Number.NEGATIVE_INFINITY;
  }
}

function projectCappedSimplex(values: readonly number[], cap: number) {
  if (
    values.length === 0 ||
    values.some((value) => !Number.isFinite(value)) ||
    !Number.isFinite(cap) ||
    cap <= 0 ||
    values.length * cap < 1 - SIMPLEX_TOLERANCE
  ) {
    return null;
  }
  let lower = Math.min(...values.map((value) => value - cap));
  let upper = Math.max(...values);
  for (let iteration = 0; iteration < 120; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    const sum = values.reduce(
      (total, value) => total + Math.min(cap, Math.max(0, value - midpoint)),
      0,
    );
    if (sum > 1) lower = midpoint;
    else upper = midpoint;
  }
  const projected = values.map((value) =>
    Math.min(cap, Math.max(0, value - upper)),
  );
  let residual = 1 - compensatedSum(projected);
  for (let index = 0; index < projected.length && residual > 1e-10; index += 1) {
    const addition = Math.min(residual, cap - projected[index]);
    projected[index] += addition;
    residual -= addition;
  }
  for (let index = projected.length - 1; index >= 0 && residual < -1e-10; index -= 1) {
    const removal = Math.min(-residual, projected[index]);
    projected[index] -= removal;
    residual += removal;
  }
  return Math.abs(1 - compensatedSum(projected)) <= 1e-8
    ? projected.map(cleanWeight)
    : null;
}

function addCandidate(
  candidates: Map<string, readonly number[]>,
  weights: readonly number[],
) {
  const key = weights.map((weight) => weight.toFixed(10)).join(":");
  if (!candidates.has(key)) candidates.set(key, Object.freeze([...weights]));
}

function halton(index: number, base: number) {
  let result = 0;
  let fraction = 1 / base;
  let remaining = index;
  while (remaining > 0) {
    result += fraction * (remaining % base);
    remaining = Math.floor(remaining / base);
    fraction /= base;
  }
  return result;
}

function firstPrimes(count: number) {
  const primes: number[] = [];
  for (let candidate = 2; primes.length < count; candidate += 1) {
    if (primes.every((prime) => candidate % prime !== 0)) primes.push(candidate);
  }
  return primes;
}

function lexicographicWeightCompare(
  left: readonly number[],
  right: readonly number[],
) {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index];
    if (Math.abs(difference) > 1e-12) return difference < 0 ? -1 : 1;
  }
  return 0;
}

function compensatedSum(values: readonly number[]) {
  let total = 0;
  let compensation = 0;
  for (const value of values) {
    const next = total + value;
    compensation +=
      Math.abs(total) >= Math.abs(value)
        ? total - next + value
        : value - next + total;
    total = next;
  }
  return total + compensation;
}

function cleanWeight(value: number) {
  return Math.abs(value) <= 1e-12 ? 0 : value;
}

function cleanZero(value: number) {
  return Math.abs(value) <= 1e-12 ? 0 : value;
}
