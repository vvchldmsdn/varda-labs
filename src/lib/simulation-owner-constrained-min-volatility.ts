import {
  estimateCappedMinimumVarianceWeights,
  evaluateInvestmentLabOptimizerTrainingMetrics,
} from "./investment-lab-preperiod-optimizer-math.ts";
import { BASIS_POINT_TOTAL } from "./basis-point-allocation.ts";
import type {
  SimulationReturnMatrixInstrument,
  SimulationReturnMatrixRow,
} from "./simulation-return-matrix-types.ts";

export const SIMULATION_OWNER_CONSTRAINED_MIN_VOLATILITY_POLICY =
  Object.freeze({
    version: "simulation_owner_constrained_minimum_volatility_v1",
    objective: "minimum_historical_volatility_with_shrunk_covariance",
    defaultMaximumInstrumentWeightBps: 3_500,
    existingConcentrationPolicy:
      "do_not_force_current_positions_below_their_existing_weight",
    maximumOneWayTurnoverBps: 2_000,
    maximumFxExposureChangeBps: 1_000,
    fxExposureDefinition: "non_KRW_modeled_weight",
    longOnly: true,
    fullyInvested: true,
  } as const);

export type SimulationOwnerResearchWeight = Readonly<{
  instrumentKey: string;
  market: string;
  currency: string;
  ticker: string;
  weightBps: number;
}>;

export type SimulationOwnerConstrainedMinVolatilityBlockerReason =
  | "candidate_requires_two_instruments"
  | "input_shape_mismatch"
  | "candidate_estimation_failed"
  | "candidate_not_lower_volatility"
  | "candidate_constraint_failed";

export type SimulationOwnerConstrainedMinVolatilityResult = ReturnType<
  typeof buildSimulationOwnerConstrainedMinVolatility
>;

export function buildSimulationOwnerConstrainedMinVolatility(input: {
  instruments: readonly SimulationReturnMatrixInstrument[];
  rows: readonly SimulationReturnMatrixRow[];
  currentWeights: readonly SimulationOwnerResearchWeight[];
}) {
  const base = {
    policy: SIMULATION_OWNER_CONSTRAINED_MIN_VOLATILITY_POLICY,
  };
  if (input.instruments.length < 2) {
    return unavailable(base, "candidate_requires_two_instruments");
  }
  if (!hasAlignedInput(input)) {
    return unavailable(base, "input_shape_mismatch");
  }

  const growthSeries = buildSimulationOwnerGrowthSeries({
    instruments: input.instruments,
    rows: input.rows,
  });
  if (!growthSeries) {
    return unavailable(base, "input_shape_mismatch");
  }

  const currentWeights = input.currentWeights.map(
    (row) => row.weightBps / BASIS_POINT_TOTAL,
  );
  const maximumInstrumentWeightBps = Math.max(
    SIMULATION_OWNER_CONSTRAINED_MIN_VOLATILITY_POLICY.defaultMaximumInstrumentWeightBps,
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
    instruments: input.instruments,
    currentWeights,
    targetWeights: minimumVolatilityWeights,
  });
  const blendedWeights = currentWeights.map(
    (weight, index) =>
      weight + blendRatio * (minimumVolatilityWeights[index] - weight),
  );
  const candidateWeightBps = roundCappedWeightsToBasisPoints({
    instrumentKeys: input.instruments.map((row) => row.instrumentKey),
    weights: blendedWeights,
    maximumWeightBps: maximumInstrumentWeightBps,
  });
  if (!candidateWeightBps) {
    return unavailable(base, "candidate_constraint_failed");
  }

  const candidateWeights = Object.freeze(
    input.currentWeights.map((row, index) =>
      Object.freeze({
        ...row,
        weightBps: candidateWeightBps[index],
      }),
    ),
  );
  const oneWayTurnoverBps = calculateOneWayTurnoverBps(
    input.currentWeights,
    candidateWeights,
  );
  const currentFxExposureBps = calculateFxExposureBps(input.currentWeights);
  const candidateFxExposureBps = calculateFxExposureBps(candidateWeights);
  const fxExposureChangeBps = Math.abs(
    candidateFxExposureBps - currentFxExposureBps,
  );
  if (
    oneWayTurnoverBps >
      SIMULATION_OWNER_CONSTRAINED_MIN_VOLATILITY_POLICY.maximumOneWayTurnoverBps ||
    fxExposureChangeBps >
      SIMULATION_OWNER_CONSTRAINED_MIN_VOLATILITY_POLICY.maximumFxExposureChangeBps ||
    candidateWeights.some(
      (row) =>
        row.weightBps < 0 || row.weightBps > maximumInstrumentWeightBps,
    ) ||
    candidateWeights.reduce((sum, row) => sum + row.weightBps, 0) !==
      BASIS_POINT_TOTAL
  ) {
    return unavailable(base, "candidate_constraint_failed");
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
    weights: candidateWeights,
    constraints: Object.freeze({
      maximumInstrumentWeightBps,
      maximumOneWayTurnoverBps:
        SIMULATION_OWNER_CONSTRAINED_MIN_VOLATILITY_POLICY.maximumOneWayTurnoverBps,
      maximumFxExposureChangeBps:
        SIMULATION_OWNER_CONSTRAINED_MIN_VOLATILITY_POLICY.maximumFxExposureChangeBps,
      oneWayTurnoverBps,
      currentFxExposureBps,
      candidateFxExposureBps,
      fxExposureChangeBps,
      blendRatio,
    }),
    training: Object.freeze({
      returnObservationCount: input.rows.length,
      currentAnnualizedVolatilityPct:
        currentTrainingMetrics.annualizedVolatility * 100,
      candidateAnnualizedVolatilityPct:
        candidateTrainingMetrics.annualizedVolatility * 100,
    }),
  });
}

export function buildSimulationOwnerGrowthSeries(input: {
  instruments: readonly SimulationReturnMatrixInstrument[];
  rows: readonly SimulationReturnMatrixRow[];
}) {
  if (input.instruments.length === 0 || input.rows.length === 0) return null;
  const series = Array.from({ length: input.instruments.length }, () => [1]);
  for (const row of input.rows) {
    if (row.cells.length !== input.instruments.length) return null;
    for (let index = 0; index < input.instruments.length; index += 1) {
      const cell = row.cells[index];
      const previous = series[index].at(-1);
      if (
        !cell ||
        cell.instrumentKey !== input.instruments[index]?.instrumentKey ||
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
  return Object.freeze(series.map((row) => Object.freeze(row)));
}

function hasAlignedInput(input: {
  instruments: readonly SimulationReturnMatrixInstrument[];
  rows: readonly SimulationReturnMatrixRow[];
  currentWeights: readonly SimulationOwnerResearchWeight[];
}) {
  return (
    input.rows.length >= 2 &&
    input.currentWeights.length === input.instruments.length &&
    input.currentWeights.reduce((sum, row) => sum + row.weightBps, 0) ===
      BASIS_POINT_TOTAL &&
    input.currentWeights.every((row, index) => {
      const instrument = input.instruments[index];
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

function resolveConstraintBlendRatio(input: {
  instruments: readonly SimulationReturnMatrixInstrument[];
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
      ? (SIMULATION_OWNER_CONSTRAINED_MIN_VOLATILITY_POLICY.maximumOneWayTurnoverBps -
          1) /
        rawOneWayTurnoverBps
      : 1;
  const fxRatio =
    rawFxExposureChangeBps > 0
      ? (SIMULATION_OWNER_CONSTRAINED_MIN_VOLATILITY_POLICY.maximumFxExposureChangeBps -
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
  currentWeights: readonly SimulationOwnerResearchWeight[],
  candidateWeights: readonly SimulationOwnerResearchWeight[],
) {
  return candidateWeights.reduce(
    (sum, row, index) =>
      sum + Math.max(0, row.weightBps - currentWeights[index].weightBps),
    0,
  );
}

function calculateFxExposureBps(
  weights: readonly SimulationOwnerResearchWeight[],
) {
  return weights.reduce(
    (sum, row) => sum + (row.currency === "KRW" ? 0 : row.weightBps),
    0,
  );
}

function asciiCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function unavailable(
  base: Readonly<{
    policy: typeof SIMULATION_OWNER_CONSTRAINED_MIN_VOLATILITY_POLICY;
  }>,
  reason: SimulationOwnerConstrainedMinVolatilityBlockerReason,
) {
  return Object.freeze({
    ...base,
    status: "unavailable" as const,
    reason,
    weights: Object.freeze([]),
    constraints: null,
    training: null,
  });
}
