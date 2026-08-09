import {
  estimateCappedMinimumVarianceWeights,
  evaluateInvestmentLabOptimizerTrainingMetrics,
} from "./investment-lab-preperiod-optimizer-math.ts";
import {
  executeSimulationResearchPathsFromPrepared,
  type ReadyPreparedSimulationResearchPaths,
  type SimulationResearchExecutionBlockerReason,
  type SimulationResearchExecutionCoreResult,
} from "./simulation-research-execution-core.ts";

const BASIS_POINT_TOTAL = 10_000;

export const SIMULATION_OWNER_CANDIDATE_COMPARISON_POLICY = Object.freeze({
  version: "simulation_owner_minimum_volatility_candidate_v1",
  objective: "minimum_historical_volatility_with_shrunk_covariance",
  trainingEvidence: "same_aligned_90_return_rows_as_current_simulation",
  evaluation:
    "current_and_candidate_reuse_one_prepared_bootstrap_draw_plan_pathwise",
  commonRandomNumbers: "required",
  defaultMaximumInstrumentWeightBps: 3_500,
  existingConcentrationPolicy:
    "do_not_force_current_positions_below_their_existing_weight",
  maximumOneWayTurnoverBps: 2_000,
  maximumFxExposureChangeBps: 1_000,
  fxExposureDefinition: "non_KRW_modeled_weight",
  transactionCostBps: 0,
  transactionCostInterpretation: "explicit_zero_cost_research_assumption",
  longOnly: true,
  fullyInvested: true,
  persistence: "forbidden",
  providerCalls: "forbidden",
  recommendation: "forbidden",
  orderAuthority: "forbidden",
  validation:
    "in_sample_candidate_requires_separate_walk_forward_evidence_before_use",
} as const);

type ResearchWeight = Readonly<{
  instrumentKey: string;
  market: string;
  currency: string;
  ticker: string;
  weightBps: number;
}>;

type ReadyExecution = Extract<
  SimulationResearchExecutionCoreResult,
  { status: "ready" }
>;

type CurrentExecutionInput =
  | ReadyExecution
  | Readonly<{ status: "unavailable" }>;

export type SimulationOwnerCandidateComparisonResult = ReturnType<
  typeof buildSimulationOwnerCandidateComparison
>;

export type SimulationOwnerCandidateComparisonBlockerReason =
  | "current_execution_unavailable"
  | "candidate_requires_two_instruments"
  | "input_shape_mismatch"
  | "candidate_estimation_failed"
  | "candidate_not_lower_volatility"
  | "candidate_constraint_failed"
  | SimulationResearchExecutionBlockerReason;

export function buildSimulationOwnerCandidateComparison(input: {
  account: string;
  prepared: ReadyPreparedSimulationResearchPaths | null;
  currentExecution: CurrentExecutionInput;
  currentWeights: readonly ResearchWeight[];
  samplePathCount: number;
}) {
  const base = {
    account: input.account,
    policy: SIMULATION_OWNER_CANDIDATE_COMPARISON_POLICY,
    runtimeTrustStatus: "tenant_scoped_read_only_research" as const,
  };
  if (!input.prepared || input.currentExecution.status !== "ready") {
    return unavailable(base, "current_execution_unavailable");
  }

  const instruments = input.prepared.matrix.instruments;
  if (instruments.length < 2) {
    return unavailable(base, "candidate_requires_two_instruments");
  }
  if (!hasAlignedInput(input.prepared, input.currentWeights)) {
    return unavailable(base, "input_shape_mismatch");
  }

  const currentWeights = input.currentWeights.map(
    (row) => row.weightBps / BASIS_POINT_TOTAL,
  );
  const growthSeries = buildGrowthSeries(input.prepared);
  if (!growthSeries) {
    return unavailable(base, "input_shape_mismatch");
  }

  const maximumInstrumentWeightBps = Math.max(
    SIMULATION_OWNER_CANDIDATE_COMPARISON_POLICY.defaultMaximumInstrumentWeightBps,
    ...input.currentWeights.map((row) => row.weightBps),
  );
  const minimumVolatilityWeights = estimateCappedMinimumVarianceWeights({
    returnSeries: growthSeries.map((series) =>
      series.slice(1).map((value, index) => value / series[index] - 1),
    ),
    maximumWeight: maximumInstrumentWeightBps / BASIS_POINT_TOTAL,
  });
  if (!minimumVolatilityWeights) {
    return unavailable(base, "candidate_estimation_failed");
  }

  const blendRatio = resolveConstraintBlendRatio({
    instruments,
    currentWeights,
    targetWeights: minimumVolatilityWeights,
  });
  const blendedWeights = currentWeights.map(
    (weight, index) =>
      weight + blendRatio * (minimumVolatilityWeights[index] - weight),
  );
  const candidateWeightBps = roundCappedWeightsToBasisPoints({
    instrumentKeys: instruments.map((row) => row.instrumentKey),
    weights: blendedWeights,
    maximumWeightBps: maximumInstrumentWeightBps,
  });
  if (!candidateWeightBps) {
    return unavailable(base, "candidate_constraint_failed");
  }

  const candidateWeights = input.currentWeights.map((row, index) =>
    Object.freeze({
      ...row,
      weightBps: candidateWeightBps[index],
    }),
  );
  const oneWayTurnoverBps = calculateOneWayTurnoverBps(
    input.currentWeights,
    candidateWeights,
  );
  const currentFxExposureBps = calculateFxExposureBps(
    input.currentWeights,
  );
  const candidateFxExposureBps = calculateFxExposureBps(candidateWeights);
  const fxExposureChangeBps = Math.abs(
    candidateFxExposureBps - currentFxExposureBps,
  );
  if (
    oneWayTurnoverBps >
      SIMULATION_OWNER_CANDIDATE_COMPARISON_POLICY.maximumOneWayTurnoverBps ||
    fxExposureChangeBps >
      SIMULATION_OWNER_CANDIDATE_COMPARISON_POLICY.maximumFxExposureChangeBps ||
    candidateWeights.some(
      (row) =>
        row.weightBps < 0 || row.weightBps > maximumInstrumentWeightBps,
    ) ||
    candidateWeights.reduce((sum, row) => sum + row.weightBps, 0) !==
      BASIS_POINT_TOTAL
  ) {
    return unavailable(base, "candidate_constraint_failed");
  }

  const candidateExecution = executeSimulationResearchPathsFromPrepared({
    prepared: input.prepared,
    scenarioId: `owner-minimum-volatility-${input.account}`,
    scenarioVersion: "v1",
    weights: candidateWeights,
    samplePathCount: input.samplePathCount,
  });
  if (candidateExecution.status !== "ready") {
    return unavailable(base, candidateExecution.reason);
  }

  const candidateTrainingMetrics =
    evaluateInvestmentLabOptimizerTrainingMetrics({
      growthSeries,
      weights: candidateWeights.map(
        (row) => row.weightBps / BASIS_POINT_TOTAL,
      ),
    });
  const currentTrainingMetrics =
    evaluateInvestmentLabOptimizerTrainingMetrics({
      growthSeries,
      weights: currentWeights,
    });
  if (!candidateTrainingMetrics || !currentTrainingMetrics) {
    return unavailable(base, "candidate_estimation_failed");
  }
  if (
    candidateTrainingMetrics.annualizedVolatility >
    currentTrainingMetrics.annualizedVolatility + 1e-12
  ) {
    return unavailable(base, "candidate_not_lower_volatility");
  }

  return Object.freeze({
    ...base,
    status: "ready" as const,
    reason: null,
    pairing: Object.freeze({
      status: "shared_prepared_paths_verified" as const,
      inputMatrixHash: input.prepared.grossGrowth.inputMatrixHash,
      drawPlanHash: input.prepared.grossGrowth.drawPlanHash,
      pathCount: input.prepared.assumptions.pathCount,
      horizon: input.prepared.assumptions.horizon,
    }),
    constraints: Object.freeze({
      maximumInstrumentWeightBps,
      maximumOneWayTurnoverBps:
        SIMULATION_OWNER_CANDIDATE_COMPARISON_POLICY.maximumOneWayTurnoverBps,
      maximumFxExposureChangeBps:
        SIMULATION_OWNER_CANDIDATE_COMPARISON_POLICY.maximumFxExposureChangeBps,
      oneWayTurnoverBps,
      currentFxExposureBps,
      candidateFxExposureBps,
      fxExposureChangeBps,
      blendRatio,
    }),
    training: Object.freeze({
      returnObservationCount: input.prepared.matrix.matrix.length,
      currentAnnualizedVolatilityPct:
        currentTrainingMetrics.annualizedVolatility * 100,
      candidateAnnualizedVolatilityPct:
        candidateTrainingMetrics.annualizedVolatility * 100,
    }),
    currentExecution: input.currentExecution satisfies ReadyExecution,
    candidateExecution,
    weights: Object.freeze(
      candidateWeights.map((candidate, index) =>
        Object.freeze({
          instrumentKey: candidate.instrumentKey,
          market: candidate.market,
          currency: candidate.currency,
          ticker: candidate.ticker,
          currentWeightBps: input.currentWeights[index].weightBps,
          candidateWeightBps: candidate.weightBps,
          changeBps:
            candidate.weightBps - input.currentWeights[index].weightBps,
        }),
      ),
    ),
    deltas: Object.freeze({
      p10IndexPoints:
        candidateExecution.terminal.p10Index -
        input.currentExecution.terminal.p10Index,
      p50ReturnPctPoints:
        candidateExecution.terminal.p50ReturnPct -
        input.currentExecution.terminal.p50ReturnPct,
      lossProbabilityPctPoints:
        candidateExecution.terminal.lossProbabilityPct -
        input.currentExecution.terminal.lossProbabilityPct,
      maxDrawdownP90PctPoints:
        candidateExecution.terminal.maxDrawdownP90Pct -
        input.currentExecution.terminal.maxDrawdownP90Pct,
    }),
  });
}

function hasAlignedInput(
  prepared: ReadyPreparedSimulationResearchPaths,
  currentWeights: readonly ResearchWeight[],
) {
  return (
    currentWeights.length === prepared.matrix.instruments.length &&
    currentWeights.reduce((sum, row) => sum + row.weightBps, 0) ===
      BASIS_POINT_TOTAL &&
    currentWeights.every((row, index) => {
      const instrument = prepared.matrix.instruments[index];
      return (
        instrument !== undefined &&
        row.instrumentKey === instrument.instrumentKey &&
        row.market === instrument.market &&
        row.currency === instrument.currency &&
        row.ticker === instrument.ticker &&
        Number.isInteger(row.weightBps) &&
        row.weightBps >= 0
      );
    })
  );
}

function buildGrowthSeries(prepared: ReadyPreparedSimulationResearchPaths) {
  const rows = prepared.matrix.matrix;
  const instrumentCount = prepared.matrix.instruments.length;
  const series = Array.from({ length: instrumentCount }, () => [1]);
  for (const row of rows) {
    if (row.cells.length !== instrumentCount) return null;
    for (let index = 0; index < instrumentCount; index += 1) {
      const cell = row.cells[index];
      const previous = series[index].at(-1);
      if (
        !cell ||
        cell.instrumentKey !==
          prepared.matrix.instruments[index]?.instrumentKey ||
        typeof cell.value !== "number" ||
        !Number.isFinite(cell.value) ||
        cell.value <= -1 ||
        previous === undefined
      ) {
        return null;
      }
      series[index].push(previous * (1 + cell.value));
    }
  }
  return series;
}

function resolveConstraintBlendRatio(input: {
  instruments: ReadyPreparedSimulationResearchPaths["matrix"]["instruments"];
  currentWeights: readonly number[];
  targetWeights: readonly number[];
}) {
  const rawOneWayTurnoverBps =
    input.targetWeights.reduce(
      (sum, weight, index) =>
        sum + Math.max(0, weight - input.currentWeights[index]),
      0,
    ) * BASIS_POINT_TOTAL;
  const rawFxExposureChangeBps =
    Math.abs(
      input.targetWeights.reduce(
        (sum, weight, index) =>
          sum + (input.instruments[index]?.currency === "KRW" ? 0 : weight),
        0,
      ) -
        input.currentWeights.reduce(
          (sum, weight, index) =>
            sum +
            (input.instruments[index]?.currency === "KRW" ? 0 : weight),
          0,
        ),
    ) * BASIS_POINT_TOTAL;
  const turnoverRatio =
    rawOneWayTurnoverBps > 0
      ? (SIMULATION_OWNER_CANDIDATE_COMPARISON_POLICY.maximumOneWayTurnoverBps -
          1) /
        rawOneWayTurnoverBps
      : 1;
  const fxRatio =
    rawFxExposureChangeBps > 0
      ? (SIMULATION_OWNER_CANDIDATE_COMPARISON_POLICY.maximumFxExposureChangeBps -
          1) /
        rawFxExposureChangeBps
      : 1;
  return Math.max(0, Math.min(1, turnoverRatio, fxRatio));
}

function roundCappedWeightsToBasisPoints(input: {
  instrumentKeys: readonly string[];
  weights: readonly number[];
  maximumWeightBps: number;
}) {
  if (
    input.instrumentKeys.length !== input.weights.length ||
    input.weights.some((weight) => !Number.isFinite(weight) || weight < 0)
  ) {
    return null;
  }
  const rows = input.weights.map((weight, index) => {
    const exact = weight * BASIS_POINT_TOTAL;
    const floor = Math.min(input.maximumWeightBps, Math.floor(exact + 1e-9));
    return {
      index,
      key: input.instrumentKeys[index],
      weightBps: floor,
      remainder: exact - Math.floor(exact + 1e-9),
    };
  });
  let remaining =
    BASIS_POINT_TOTAL - rows.reduce((sum, row) => sum + row.weightBps, 0);
  const order = [...rows].sort(
    (left, right) =>
      right.remainder - left.remainder || asciiCompare(left.key, right.key),
  );
  while (remaining > 0) {
    let allocated = false;
    for (const row of order) {
      if (remaining === 0) break;
      if (row.weightBps >= input.maximumWeightBps) continue;
      row.weightBps += 1;
      remaining -= 1;
      allocated = true;
    }
    if (!allocated) return null;
  }
  return rows
    .sort((left, right) => left.index - right.index)
    .map((row) => row.weightBps);
}

function calculateOneWayTurnoverBps(
  currentWeights: readonly ResearchWeight[],
  candidateWeights: readonly ResearchWeight[],
) {
  return candidateWeights.reduce(
    (sum, row, index) =>
      sum + Math.max(0, row.weightBps - currentWeights[index].weightBps),
    0,
  );
}

function calculateFxExposureBps(weights: readonly ResearchWeight[]) {
  return weights.reduce(
    (sum, row) => sum + (row.currency === "KRW" ? 0 : row.weightBps),
    0,
  );
}

function asciiCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function unavailable(
  base: {
    account: string;
    policy: typeof SIMULATION_OWNER_CANDIDATE_COMPARISON_POLICY;
    runtimeTrustStatus: "tenant_scoped_read_only_research";
  },
  reason: SimulationOwnerCandidateComparisonBlockerReason,
) {
  return Object.freeze({
    ...base,
    status: "unavailable" as const,
    reason,
    pairing: null,
    constraints: null,
    training: null,
    currentExecution: null,
    candidateExecution: null,
    weights: Object.freeze([]),
    deltas: null,
  });
}
