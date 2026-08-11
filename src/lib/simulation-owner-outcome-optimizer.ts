import type { ReadyPreparedSimulationResearchPaths } from "./simulation-research-execution-core.ts";
import {
  SIMULATION_OWNER_CONSTRAINED_MIN_VOLATILITY_POLICY,
  type SimulationOwnerResearchWeight,
} from "./simulation-owner-constrained-min-volatility.ts";

export const SIMULATION_OWNER_OUTCOME_OPTIMIZER_POLICY = Object.freeze({
  version: "simulation_owner_outcome_candidate_search_v1",
  objectives: Object.freeze([
    "median_growth",
    "downside_floor",
    "balanced_growth_defense",
  ] as const),
  pathPartition: "even_path_search_odd_path_confirmation",
  coordinateTransferStepsBps: Object.freeze([500, 250, 100] as const),
  maximumPassesPerStep: 4,
  minimumPartitionPathCount: 10,
  commonRandomNumbers: "required",
  persistence: "forbidden",
  providerCalls: "forbidden",
  recommendation: "forbidden",
  orderAuthority: "forbidden",
  interpretation:
    "deterministic_constrained_research_candidates_confirmed_on_held_out_bootstrap_paths",
} as const);

export type SimulationOwnerOutcomeObjective =
  (typeof SIMULATION_OWNER_OUTCOME_OPTIMIZER_POLICY.objectives)[number];

export type SimulationOwnerOutcomeMetrics = Readonly<{
  meanReturnPct: number;
  p10ReturnPct: number;
  p50ReturnPct: number;
  lowerTailMeanReturnPct: number;
  lossProbabilityPct: number;
}>;

export type SimulationOwnerOutcomeOptimizerResult = ReturnType<
  typeof buildSimulationOwnerOutcomeCandidates
>;

type TerminalFactorRow = readonly number[];
type TerminalFactorEvidence = Readonly<{
  pathIndex: number;
  factors: TerminalFactorRow;
}>;

const BASIS_POINT_TOTAL = 10_000;
const SCORE_EPSILON = 1e-12;

export function buildSimulationOwnerOutcomeCandidates(input: {
  prepared: ReadyPreparedSimulationResearchPaths;
  currentWeights: readonly SimulationOwnerResearchWeight[];
}) {
  const base = {
    policy: SIMULATION_OWNER_OUTCOME_OPTIMIZER_POLICY,
  };
  const validated = validateInput(input);
  if (!validated) return unavailable(base, "input_shape_mismatch");

  const searchRows = validated.terminalFactors
    .filter((row) => row.pathIndex % 2 === 0)
    .map((row) => row.factors);
  const confirmationRows = validated.terminalFactors
    .filter((row) => row.pathIndex % 2 === 1)
    .map((row) => row.factors);
  if (
    searchRows.length <
      SIMULATION_OWNER_OUTCOME_OPTIMIZER_POLICY.minimumPartitionPathCount ||
    confirmationRows.length <
      SIMULATION_OWNER_OUTCOME_OPTIMIZER_POLICY.minimumPartitionPathCount
  ) {
    return unavailable(base, "insufficient_partition_paths");
  }

  const currentWeightBps = input.currentWeights.map((row) => row.weightBps);
  const currentSearchMetrics = evaluateTerminalOutcomes({
    terminalFactors: searchRows,
    weightBps: currentWeightBps,
  });
  const currentConfirmationMetrics = evaluateTerminalOutcomes({
    terminalFactors: confirmationRows,
    weightBps: currentWeightBps,
  });
  if (!currentSearchMetrics || !currentConfirmationMetrics) {
    return unavailable(base, "outcome_evaluation_failed");
  }

  const maximumInstrumentWeightBps = Math.max(
    SIMULATION_OWNER_CONSTRAINED_MIN_VOLATILITY_POLICY.defaultMaximumInstrumentWeightBps,
    ...currentWeightBps,
  );
  const candidates = SIMULATION_OWNER_OUTCOME_OPTIMIZER_POLICY.objectives.flatMap(
    (objective) => {
      const candidateWeightBps = searchCandidate({
        objective,
        terminalFactors: searchRows,
        currentWeights: input.currentWeights,
        maximumInstrumentWeightBps,
      });
      if (!candidateWeightBps || arraysEqual(candidateWeightBps, currentWeightBps)) {
        return [];
      }

      const searchMetrics = evaluateTerminalOutcomes({
        terminalFactors: searchRows,
        weightBps: candidateWeightBps,
      });
      const confirmationMetrics = evaluateTerminalOutcomes({
        terminalFactors: confirmationRows,
        weightBps: candidateWeightBps,
      });
      if (!searchMetrics || !confirmationMetrics) return [];

      const searchImprovementPctPoints =
        objectiveScore(searchMetrics, objective) -
        objectiveScore(currentSearchMetrics, objective);
      const confirmationImprovementPctPoints =
        objectiveScore(confirmationMetrics, objective) -
        objectiveScore(currentConfirmationMetrics, objective);
      if (
        searchImprovementPctPoints <= SCORE_EPSILON ||
        confirmationImprovementPctPoints <= SCORE_EPSILON
      ) {
        return [];
      }

      const constraints = evaluateConstraints({
        currentWeights: input.currentWeights,
        candidateWeightBps,
        maximumInstrumentWeightBps,
      });
      if (!constraints.valid) return [];

      return [
        Object.freeze({
          objective,
          weights: Object.freeze(
            input.currentWeights.map((row, index) =>
              Object.freeze({
                ...row,
                currentWeightBps: row.weightBps,
                candidateWeightBps: candidateWeightBps[index],
                changeBps: candidateWeightBps[index] - row.weightBps,
              }),
            ),
          ),
          constraints: constraints.evidence,
          search: Object.freeze({
            pathCount: searchRows.length,
            current: currentSearchMetrics,
            candidate: searchMetrics,
            objectiveImprovementPctPoints: searchImprovementPctPoints,
          }),
          confirmation: Object.freeze({
            pathCount: confirmationRows.length,
            current: currentConfirmationMetrics,
            candidate: confirmationMetrics,
            objectiveImprovementPctPoints: confirmationImprovementPctPoints,
          }),
        }),
      ];
    },
  );

  if (candidates.length === 0) {
    return unavailable(base, "no_confirmed_candidate");
  }

  return Object.freeze({
    ...base,
    status: "ready" as const,
    reason: null,
    current: Object.freeze({
      search: currentSearchMetrics,
      confirmation: currentConfirmationMetrics,
    }),
    candidates: Object.freeze(candidates),
  });
}

function searchCandidate(input: {
  objective: SimulationOwnerOutcomeObjective;
  terminalFactors: readonly TerminalFactorRow[];
  currentWeights: readonly SimulationOwnerResearchWeight[];
  maximumInstrumentWeightBps: number;
}) {
  let bestWeights = input.currentWeights.map((row) => row.weightBps);
  let bestMetrics = evaluateTerminalOutcomes({
    terminalFactors: input.terminalFactors,
    weightBps: bestWeights,
  });
  if (!bestMetrics) return null;

  for (const stepBps of
    SIMULATION_OWNER_OUTCOME_OPTIMIZER_POLICY.coordinateTransferStepsBps) {
    for (
      let pass = 0;
      pass < SIMULATION_OWNER_OUTCOME_OPTIMIZER_POLICY.maximumPassesPerStep;
      pass += 1
    ) {
      const incumbentScore = objectiveScore(bestMetrics, input.objective);
      let nextWeights: readonly number[] | null = null;
      let nextMetrics: SimulationOwnerOutcomeMetrics | null = null;

      for (let donor = 0; donor < bestWeights.length; donor += 1) {
        if (bestWeights[donor] < stepBps) continue;
        for (let receiver = 0; receiver < bestWeights.length; receiver += 1) {
          if (donor === receiver) continue;
          const candidate = [...bestWeights];
          candidate[donor] -= stepBps;
          candidate[receiver] += stepBps;
          const constraints = evaluateConstraints({
            currentWeights: input.currentWeights,
            candidateWeightBps: candidate,
            maximumInstrumentWeightBps: input.maximumInstrumentWeightBps,
          });
          if (!constraints.valid) continue;

          const metrics = evaluateTerminalOutcomes({
            terminalFactors: input.terminalFactors,
            weightBps: candidate,
          });
          if (!metrics) continue;
          const score = objectiveScore(metrics, input.objective);
          const nextScore = nextMetrics
            ? objectiveScore(nextMetrics, input.objective)
            : Number.NEGATIVE_INFINITY;
          if (
            score > incumbentScore + SCORE_EPSILON &&
            (score > nextScore + SCORE_EPSILON ||
              (Math.abs(score - nextScore) <= SCORE_EPSILON &&
                nextWeights !== null &&
                lexicographicCompare(candidate, nextWeights) < 0))
          ) {
            nextWeights = candidate;
            nextMetrics = metrics;
          }
        }
      }

      if (!nextWeights || !nextMetrics) break;
      bestWeights = [...nextWeights];
      bestMetrics = nextMetrics;
    }
  }

  return Object.freeze(bestWeights);
}

function evaluateTerminalOutcomes(input: {
  terminalFactors: readonly TerminalFactorRow[];
  weightBps: readonly number[];
}): SimulationOwnerOutcomeMetrics | null {
  if (
    input.terminalFactors.length === 0 ||
    input.weightBps.length === 0 ||
    input.weightBps.reduce((sum, value) => sum + value, 0) !== BASIS_POINT_TOTAL
  ) {
    return null;
  }
  const returns = input.terminalFactors
    .map((factors) => {
      if (factors.length !== input.weightBps.length) return Number.NaN;
      const nav = compensatedSum(
        factors.map(
          (factor, index) =>
            factor * (input.weightBps[index] / BASIS_POINT_TOTAL),
        ),
      );
      return nav - 1;
    })
    .sort((left, right) => left - right);
  if (returns.some((value) => !Number.isFinite(value))) return null;

  const p10 = type7Quantile(returns, 0.1);
  const p50 = type7Quantile(returns, 0.5);
  if (p10 === null || p50 === null) return null;
  const lowerTailCount = Math.max(1, Math.ceil(returns.length * 0.05));
  const lowerTailMean =
    compensatedSum(returns.slice(0, lowerTailCount)) / lowerTailCount;

  return Object.freeze({
    meanReturnPct: (compensatedSum(returns) / returns.length) * 100,
    p10ReturnPct: p10 * 100,
    p50ReturnPct: p50 * 100,
    lowerTailMeanReturnPct: lowerTailMean * 100,
    lossProbabilityPct:
      (returns.filter((value) => value < 0).length / returns.length) * 100,
  });
}

function objectiveScore(
  metrics: SimulationOwnerOutcomeMetrics,
  objective: SimulationOwnerOutcomeObjective,
) {
  switch (objective) {
    case "median_growth":
      return metrics.p50ReturnPct;
    case "downside_floor":
      return metrics.p10ReturnPct;
    case "balanced_growth_defense":
      return (metrics.p50ReturnPct + metrics.p10ReturnPct) / 2;
  }
}

function validateInput(input: {
  prepared: ReadyPreparedSimulationResearchPaths;
  currentWeights: readonly SimulationOwnerResearchWeight[];
}) {
  const instruments = input.prepared.matrix.instruments;
  const grossGrowth = input.prepared.grossGrowth;
  if (
    instruments.length < 2 ||
    grossGrowth.status !== "ready" ||
    input.currentWeights.length !== instruments.length ||
    input.currentWeights.reduce((sum, row) => sum + row.weightBps, 0) !==
      BASIS_POINT_TOTAL ||
    input.currentWeights.some((row, index) => {
      const instrument = instruments[index];
      return (
        !instrument ||
        row.instrumentKey !== instrument.instrumentKey ||
        row.market !== instrument.market ||
        row.currency !== instrument.currency ||
        row.ticker !== instrument.ticker ||
        !Number.isInteger(row.weightBps) ||
        row.weightBps < 0
      );
    })
  ) {
    return null;
  }

  const terminalFactors = grossGrowth.paths.map((path) => {
    const point = path.points.at(-1);
    if (
      !point ||
      point.grossGrowthFactors.length !== instruments.length ||
      point.grossGrowthFactors.some(
        (factor, index) =>
          factor.instrumentKey !== instruments[index]?.instrumentKey ||
          !Number.isFinite(factor.value) ||
          factor.value <= 0,
      )
    ) {
      return null;
    }
    return Object.freeze({
      pathIndex: path.pathIndex,
      factors: Object.freeze(
        point.grossGrowthFactors.map((factor) => factor.value),
      ),
    });
  });
  return terminalFactors.some((row) => row === null)
    ? null
    : Object.freeze({
        terminalFactors: Object.freeze(
          terminalFactors as TerminalFactorEvidence[],
        ),
      });
}

function evaluateConstraints(input: {
  currentWeights: readonly SimulationOwnerResearchWeight[];
  candidateWeightBps: readonly number[];
  maximumInstrumentWeightBps: number;
}) {
  const currentFxExposureBps = input.currentWeights.reduce(
    (sum, row) => sum + (row.currency === "KRW" ? 0 : row.weightBps),
    0,
  );
  const candidateFxExposureBps = input.candidateWeightBps.reduce(
    (sum, weightBps, index) =>
      sum + (input.currentWeights[index]?.currency === "KRW" ? 0 : weightBps),
    0,
  );
  const oneWayTurnoverBps = input.candidateWeightBps.reduce(
    (sum, weightBps, index) =>
      sum + Math.max(0, weightBps - input.currentWeights[index].weightBps),
    0,
  );
  const fxExposureChangeBps = Math.abs(
    candidateFxExposureBps - currentFxExposureBps,
  );
  const valid =
    input.candidateWeightBps.length === input.currentWeights.length &&
    input.candidateWeightBps.reduce((sum, value) => sum + value, 0) ===
      BASIS_POINT_TOTAL &&
    input.candidateWeightBps.every(
      (value) =>
        Number.isInteger(value) &&
        value >= 0 &&
        value <= input.maximumInstrumentWeightBps,
    ) &&
    oneWayTurnoverBps <=
      SIMULATION_OWNER_CONSTRAINED_MIN_VOLATILITY_POLICY.maximumOneWayTurnoverBps &&
    fxExposureChangeBps <=
      SIMULATION_OWNER_CONSTRAINED_MIN_VOLATILITY_POLICY.maximumFxExposureChangeBps;

  return Object.freeze({
    valid,
    evidence: Object.freeze({
      maximumInstrumentWeightBps: input.maximumInstrumentWeightBps,
      maximumOneWayTurnoverBps:
        SIMULATION_OWNER_CONSTRAINED_MIN_VOLATILITY_POLICY.maximumOneWayTurnoverBps,
      maximumFxExposureChangeBps:
        SIMULATION_OWNER_CONSTRAINED_MIN_VOLATILITY_POLICY.maximumFxExposureChangeBps,
      oneWayTurnoverBps,
      currentFxExposureBps,
      candidateFxExposureBps,
      fxExposureChangeBps,
    }),
  });
}

function type7Quantile(sortedValues: readonly number[], probability: number) {
  if (sortedValues.length === 0) return null;
  const position = (sortedValues.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.min(lowerIndex + 1, sortedValues.length - 1);
  const fraction = position - lowerIndex;
  return (
    sortedValues[lowerIndex] +
    (sortedValues[upperIndex] - sortedValues[lowerIndex]) * fraction
  );
}

function compensatedSum(values: readonly number[]) {
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

function arraysEqual(left: readonly number[], right: readonly number[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function lexicographicCompare(left: readonly number[], right: readonly number[]) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function unavailable(
  base: Readonly<{
    policy: typeof SIMULATION_OWNER_OUTCOME_OPTIMIZER_POLICY;
  }>,
  reason:
    | "input_shape_mismatch"
    | "insufficient_partition_paths"
    | "outcome_evaluation_failed"
    | "no_confirmed_candidate",
) {
  return Object.freeze({
    ...base,
    status: "unavailable" as const,
    reason,
    current: null,
    candidates: Object.freeze([]),
  });
}
