import { FIXED_MIX_INSTRUMENTS } from "./simulation-fixed-mix-research-context.ts";
import { SIMULATION_FAN_BAND_VALIDATION_POLICY } from "./simulation-fan-band-validation-policy.ts";
import type {
  SimulationReturnMatrixResult,
  SimulationReturnMatrixRow,
} from "./simulation-return-matrix-types.ts";
import { buildStationaryBootstrapDrawPlan } from "./simulation-stationary-bootstrap.ts";

const EQUAL_WEIGHTS_BPS = Object.freeze([5_000, 5_000]);

export function calculateFanBandPredictedTerminalReturns(
  matrix: SimulationReturnMatrixResult,
) {
  const policy = SIMULATION_FAN_BAND_VALIDATION_POLICY;
  const drawPlan = buildStationaryBootstrapDrawPlan({
    matrix,
    seed: policy.seed,
    expectedBlockLength: policy.expectedBlockLength,
    horizon: policy.outcomeReturnStepCount,
    pathCount: policy.pathCount,
  });
  if (drawPlan.status !== "ready") return null;

  const terminalReturns: number[] = [];
  for (const path of drawPlan.paths) {
    const cumulative = FIXED_MIX_INSTRUMENTS.map(() => 1);
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
    }
    const terminalNav = compensatedWeightedSum(
      cumulative,
      EQUAL_WEIGHTS_BPS,
    );
    if (terminalNav === null) return null;
    terminalReturns.push(terminalNav - 1);
  }

  terminalReturns.sort((left, right) => left - right);
  return Object.freeze({
    p10ReturnPct: type7Quantile(terminalReturns, 0.1) * 100,
    p50ReturnPct: type7Quantile(terminalReturns, 0.5) * 100,
    p90ReturnPct: type7Quantile(terminalReturns, 0.9) * 100,
  });
}

export function calculateFanBandObservedTerminalNav(
  rows: readonly SimulationReturnMatrixRow[],
) {
  const cumulative = FIXED_MIX_INSTRUMENTS.map(() => 1);
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
  }
  return compensatedWeightedSum(cumulative, EQUAL_WEIGHTS_BPS);
}

function compensatedWeightedSum(
  values: readonly number[],
  weightsBps: readonly number[],
) {
  const result = neumaierSum(
    values.map((value, index) => value * (weightsBps[index] / 10_000)),
  );
  return Number.isFinite(result) && result > 0 ? result : null;
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
  if (sortedValues.length === 1) return sortedValues[0];
  const position = (sortedValues.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sortedValues[lowerIndex];
  const upper = sortedValues[upperIndex];
  if (lower === undefined || upper === undefined) return Number.NaN;
  return lower + (upper - lower) * (position - lowerIndex);
}
