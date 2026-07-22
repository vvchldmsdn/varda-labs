import { FIXED_MIX_INSTRUMENTS } from "./simulation-fixed-mix-research-context.ts";
import {
  createSimulationFanBandValidationPolicy,
} from "./simulation-fan-band-validation-policy.ts";
import type {
  SimulationReturnMatrixResult,
  SimulationReturnMatrixRow,
} from "./simulation-return-matrix-types.ts";
import { buildStationaryBootstrapDrawPlan } from "./simulation-stationary-bootstrap.ts";
import {
  SIMULATION_RESEARCH_HORIZON_POLICY,
  type SimulationResearchHorizon,
} from "./simulation-research-horizon.ts";

const EQUAL_WEIGHTS_BPS = Object.freeze([5_000, 5_000]);

export function calculatePredictedHistoricalOutcome(
  matrix: SimulationReturnMatrixResult,
  horizon: SimulationResearchHorizon =
    SIMULATION_RESEARCH_HORIZON_POLICY.defaultHorizon,
) {
  const policy = createSimulationFanBandValidationPolicy(horizon);
  const drawPlan = buildStationaryBootstrapDrawPlan({
    matrix,
    seed: policy.seed,
    expectedBlockLength: policy.expectedBlockLength,
    horizon: policy.outcomeReturnStepCount,
    pathCount: policy.pathCount,
  });
  if (drawPlan.status !== "ready") return null;

  const terminalReturns: number[] = [];
  const maxDrawdowns: number[] = [];
  let lossPathCount = 0;

  for (const path of drawPlan.paths) {
    const cumulative = FIXED_MIX_INSTRUMENTS.map(() => 1);
    let runningPeak = 1;
    let maxDrawdown = 0;
    let terminalNav = 1;

    for (const draw of path.draws) {
      const sourceRow = matrix.matrix[draw.sourceRowIndex];
      if (!sourceRow) return null;
      for (let index = 0; index < cumulative.length; index += 1) {
        const sampledReturn = sourceRow.cells[index]?.value;
        if (
          typeof sampledReturn !== "number" ||
          !Number.isFinite(sampledReturn) ||
          sampledReturn <= -1
        ) {
          return null;
        }
        const next = cumulative[index] * (1 + sampledReturn);
        if (!Number.isFinite(next) || next <= 0) return null;
        cumulative[index] = next;
      }

      const pathNav = compensatedWeightedSum(cumulative, EQUAL_WEIGHTS_BPS);
      if (pathNav === null) return null;
      terminalNav = pathNav;
      runningPeak = Math.max(runningPeak, pathNav);
      const drawdown = 1 - pathNav / runningPeak;
      if (!isValidDrawdown(drawdown)) return null;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }

    if (terminalNav < 1) lossPathCount += 1;
    terminalReturns.push(terminalNav - 1);
    maxDrawdowns.push(maxDrawdown);
  }

  terminalReturns.sort((left, right) => left - right);
  maxDrawdowns.sort((left, right) => left - right);
  const p10Return = type7Quantile(terminalReturns, 0.1);
  const p50Return = type7Quantile(terminalReturns, 0.5);
  const p90Return = type7Quantile(terminalReturns, 0.9);
  const maxDrawdownP50 = type7Quantile(maxDrawdowns, 0.5);
  const maxDrawdownP90 = type7Quantile(maxDrawdowns, 0.9);
  if (
    p10Return === null ||
    p50Return === null ||
    p90Return === null ||
    maxDrawdownP50 === null ||
    maxDrawdownP90 === null
  ) {
    return null;
  }

  return Object.freeze({
    p10ReturnPct: p10Return * 100,
    p50ReturnPct: p50Return * 100,
    p90ReturnPct: p90Return * 100,
    lossProbabilityPct: (lossPathCount / terminalReturns.length) * 100,
    maxDrawdownP50Pct: maxDrawdownP50 * 100,
    maxDrawdownP90Pct: maxDrawdownP90 * 100,
  });
}

export function calculateObservedHistoricalOutcome(
  rows: readonly SimulationReturnMatrixRow[],
) {
  if (rows.length === 0) return null;
  const cumulative = FIXED_MIX_INSTRUMENTS.map(() => 1);
  let runningPeak = 1;
  let maxDrawdown = 0;
  let terminalNav = 1;

  for (const row of rows) {
    for (let index = 0; index < cumulative.length; index += 1) {
      const value = row.cells[index]?.value;
      if (typeof value !== "number" || !Number.isFinite(value) || value <= -1) {
        return null;
      }
      const next = cumulative[index] * (1 + value);
      if (!Number.isFinite(next) || next <= 0) return null;
      cumulative[index] = next;
    }

    const pathNav = compensatedWeightedSum(cumulative, EQUAL_WEIGHTS_BPS);
    if (pathNav === null) return null;
    terminalNav = pathNav;
    runningPeak = Math.max(runningPeak, pathNav);
    const drawdown = 1 - pathNav / runningPeak;
    if (!isValidDrawdown(drawdown)) return null;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  }

  return Object.freeze({
    terminalNav,
    terminalReturnPct: (terminalNav - 1) * 100,
    terminalLoss: terminalNav < 1,
    maxDrawdownPct: maxDrawdown * 100,
  });
}

function compensatedWeightedSum(
  values: readonly number[],
  weightsBps: readonly number[],
) {
  if (values.length === 0 || values.length !== weightsBps.length) return null;
  const weightedValues: number[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const weightBps = weightsBps[index];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      typeof weightBps !== "number" ||
      !Number.isSafeInteger(weightBps) ||
      weightBps < 0
    ) {
      return null;
    }
    weightedValues.push(value * (weightBps / 10_000));
  }
  const result = neumaierSum(weightedValues);
  return Number.isFinite(result) && result > 0 ? result : null;
}

function isValidDrawdown(value: number) {
  return Number.isFinite(value) && value >= 0 && value < 1;
}

function neumaierSum(values: readonly number[]) {
  let sum = 0;
  let compensation = 0;
  for (const term of values) {
    const next = sum + term;
    const correction =
      Math.abs(sum) >= Math.abs(term)
        ? (sum - next) + term
        : (term - next) + sum;
    sum = next;
    compensation += correction;
  }
  return sum + compensation;
}

function type7Quantile(sortedValues: readonly number[], probability: number) {
  if (
    sortedValues.length === 0 ||
    !Number.isFinite(probability) ||
    probability < 0 ||
    probability > 1
  ) {
    return null;
  }
  if (sortedValues.length === 1) {
    const only = sortedValues[0];
    return typeof only === "number" && Number.isFinite(only) ? only : null;
  }
  const position = (sortedValues.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sortedValues[lowerIndex];
  const upper = sortedValues[upperIndex];
  if (
    lower === undefined ||
    upper === undefined ||
    !Number.isFinite(lower) ||
    !Number.isFinite(upper)
  ) {
    return null;
  }
  const quantile = lower + (upper - lower) * (position - lowerIndex);
  return Number.isFinite(quantile) ? quantile : null;
}
