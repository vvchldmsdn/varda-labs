import { createMulberry32 } from "./simulation-prng.ts";
import { SIMULATION_REGIME_BOOTSTRAP_POLICY } from "./simulation-regime-bootstrap-policy.ts";
import type { ReadySimulationRegimeFactorState } from "./simulation-regime-factor-state.ts";
import type { SimulationReturnMatrixResult } from "./simulation-return-matrix-types.ts";

export type SimulationRegimeScenarioInput = Readonly<{
  id: string;
  name: string;
  weightsBps: readonly number[];
}>;

export type SimulationRegimeScenarioResult = ReturnType<
  typeof executeScenario
>;

export type SimulationRegimeBootstrapEngineResult = ReturnType<
  typeof executeSimulationRegimeBootstrap
>;

export function executeSimulationRegimeBootstrap(input: {
  matrix: SimulationReturnMatrixResult;
  factorState: ReadySimulationRegimeFactorState;
  scenarios: readonly SimulationRegimeScenarioInput[];
}) {
  const returns = input.matrix.matrix.map((row) =>
    row.cells.map((cell) => cell.value),
  );
  if (
    returns.length !==
      SIMULATION_REGIME_BOOTSTRAP_POLICY.sourceReturnStepCount ||
    returns.some((row) =>
      row.some(
        (value) =>
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          value <= -1,
      ),
    )
  ) {
    return blockedEngine("invalid_return_matrix_values");
  }

  const drawPlan = buildDrawPlan({
    sourceRowCount: returns.length,
    neighbors: input.factorState.neighbors,
  });
  if (!drawPlan) return blockedEngine("draw_plan_blocked");

  const scenarios = input.scenarios.map((scenario) =>
    executeScenario({
      scenario,
      returns: returns as readonly (readonly number[])[],
      drawPlan,
      instrumentCount: input.matrix.instruments.length,
    }),
  );
  if (scenarios.some((scenario) => scenario.status !== "ready")) {
    return blockedEngine("scenario_execution_blocked");
  }

  return Object.freeze({
    status: "ready" as const,
    reason: null,
    policy: SIMULATION_REGIME_BOOTSTRAP_POLICY,
    assumptions: Object.freeze({
      horizon: SIMULATION_REGIME_BOOTSTRAP_POLICY.horizon,
      pathCount: SIMULATION_REGIME_BOOTSTRAP_POLICY.pathCount,
      minimumBlockLength:
        SIMULATION_REGIME_BOOTSTRAP_POLICY.minimumBlockLength,
      maximumBlockLength:
        SIMULATION_REGIME_BOOTSTRAP_POLICY.maximumBlockLength,
      selectedNeighborCount: input.factorState.neighbors.length,
      seed: SIMULATION_REGIME_BOOTSTRAP_POLICY.seed,
      normalizedStartIndex: 100,
    }),
    scenarios: Object.freeze(scenarios),
  });
}

function buildDrawPlan(input: {
  sourceRowCount: number;
  neighbors: ReadySimulationRegimeFactorState["neighbors"];
}) {
  const totalWeight = input.neighbors.reduce(
    (sum, neighbor) => sum + neighbor.weight,
    0,
  );
  if (
    input.neighbors.length <
      SIMULATION_REGIME_BOOTSTRAP_POLICY.minimumCandidateRows ||
    !Number.isFinite(totalWeight) ||
    totalWeight <= 0
  ) {
    return null;
  }

  const random = createMulberry32(SIMULATION_REGIME_BOOTSTRAP_POLICY.seed);
  const paths: (readonly number[])[] = [];
  for (
    let pathIndex = 0;
    pathIndex < SIMULATION_REGIME_BOOTSTRAP_POLICY.pathCount;
    pathIndex += 1
  ) {
    const draws: number[] = [];
    while (draws.length < SIMULATION_REGIME_BOOTSTRAP_POLICY.horizon) {
      const start = weightedNeighborIndex(
        input.neighbors,
        totalWeight,
        random(),
      );
      const requestedBlockLength = randomIntegerInclusive(
        SIMULATION_REGIME_BOOTSTRAP_POLICY.minimumBlockLength,
        SIMULATION_REGIME_BOOTSTRAP_POLICY.maximumBlockLength,
        random(),
      );
      const blockLength = Math.min(
        requestedBlockLength,
        input.sourceRowCount - start,
        SIMULATION_REGIME_BOOTSTRAP_POLICY.horizon - draws.length,
      );
      if (blockLength <= 0) return null;
      for (let offset = 0; offset < blockLength; offset += 1) {
        draws.push(start + offset);
      }
    }
    paths.push(Object.freeze(draws));
  }
  return Object.freeze(paths);
}

function executeScenario(input: {
  scenario: SimulationRegimeScenarioInput;
  returns: readonly (readonly number[])[];
  drawPlan: readonly (readonly number[])[];
  instrumentCount: number;
}) {
  const weights = input.scenario.weightsBps;
  if (
    weights.length !== input.instrumentCount ||
    weights.some(
      (weight) => !Number.isSafeInteger(weight) || weight < 0 || weight > 10_000,
    ) ||
    weights.reduce((sum, weight) => sum + weight, 0) !== 10_000
  ) {
    return blockedScenario(input.scenario, "invalid_scenario_weights");
  }

  const normalizedWeights = weights.map((weight) => weight / 10_000);
  const navPaths: number[][] = [];
  for (const draws of input.drawPlan) {
    const growth = normalizedWeights.map(() => 1);
    const nav = [1];
    for (const sourceRowIndex of draws) {
      const sampledReturns = input.returns[sourceRowIndex];
      if (!sampledReturns || sampledReturns.length !== input.instrumentCount) {
        return blockedScenario(input.scenario, "invalid_draw_source");
      }
      for (
        let instrumentIndex = 0;
        instrumentIndex < growth.length;
        instrumentIndex += 1
      ) {
        growth[instrumentIndex] *= 1 + sampledReturns[instrumentIndex];
        if (!Number.isFinite(growth[instrumentIndex]) || growth[instrumentIndex] <= 0) {
          return blockedScenario(input.scenario, "invalid_growth_path");
        }
      }
      const value = compensatedWeightedSum(growth, normalizedWeights);
      if (!Number.isFinite(value) || value <= 0) {
        return blockedScenario(input.scenario, "invalid_growth_path");
      }
      nav.push(value);
    }
    navPaths.push(nav);
  }

  const bands = Object.freeze(
    Array.from(
      { length: SIMULATION_REGIME_BOOTSTRAP_POLICY.horizon + 1 },
      (_, stepIndex) => {
        const values = navPaths
          .map((path) => path[stepIndex])
          .sort((left, right) => left - right);
        return Object.freeze({
          stepIndex,
          p10: type7Quantile(values, 0.1) * 100,
          p50: type7Quantile(values, 0.5) * 100,
          p90: type7Quantile(values, 0.9) * 100,
        });
      },
    ),
  );
  const terminalValues = navPaths
    .map((path) => path.at(-1) as number)
    .sort((left, right) => left - right);
  const drawdowns = navPaths
    .map(maxDrawdown)
    .sort((left, right) => left - right);
  const samplePathIndices = stratifiedTerminalPathIndices(
    navPaths,
    SIMULATION_REGIME_BOOTSTRAP_POLICY.samplePathCount,
  );

  return Object.freeze({
    status: "ready" as const,
    reason: null,
    id: input.scenario.id,
    name: input.scenario.name,
    weightsBps: Object.freeze([...weights]),
    assumptions: Object.freeze({
      horizon: SIMULATION_REGIME_BOOTSTRAP_POLICY.horizon,
      pathCount: SIMULATION_REGIME_BOOTSTRAP_POLICY.pathCount,
    }),
    terminal: Object.freeze({
      p10Index: type7Quantile(terminalValues, 0.1) * 100,
      p50Index: type7Quantile(terminalValues, 0.5) * 100,
      p90Index: type7Quantile(terminalValues, 0.9) * 100,
      p50ReturnPct: (type7Quantile(terminalValues, 0.5) - 1) * 100,
      lossProbabilityPct:
        (terminalValues.filter((value) => value < 1).length /
          terminalValues.length) *
        100,
      maxDrawdownP50Pct: type7Quantile(drawdowns, 0.5) * 100,
      maxDrawdownP90Pct: type7Quantile(drawdowns, 0.9) * 100,
    }),
    bands,
    samplePaths: Object.freeze(
      samplePathIndices.map((pathIndex) =>
        Object.freeze({
          pathIndex,
          points: Object.freeze(
            navPaths[pathIndex].map((value, stepIndex) =>
              Object.freeze({
                stepIndex,
                indexValue: value * 100,
              }),
            ),
          ),
        }),
      ),
    ),
  });
}

function weightedNeighborIndex(
  neighbors: ReadySimulationRegimeFactorState["neighbors"],
  totalWeight: number,
  randomValue: number,
) {
  const threshold = randomValue * totalWeight;
  let cumulative = 0;
  for (const neighbor of neighbors) {
    cumulative += neighbor.weight;
    if (threshold < cumulative) return neighbor.sourceRowIndex;
  }
  return neighbors.at(-1)!.sourceRowIndex;
}

function randomIntegerInclusive(minimum: number, maximum: number, value: number) {
  return minimum + Math.floor(value * (maximum - minimum + 1));
}

function compensatedWeightedSum(
  growth: readonly number[],
  weights: readonly number[],
) {
  let sum = 0;
  let compensation = 0;
  for (let index = 0; index < growth.length; index += 1) {
    const term = growth[index] * weights[index];
    const adjusted = term - compensation;
    const next = sum + adjusted;
    compensation = next - sum - adjusted;
    sum = next;
  }
  return sum;
}

function maxDrawdown(path: readonly number[]) {
  let peak = path[0];
  let maximum = 0;
  for (const value of path) {
    peak = Math.max(peak, value);
    maximum = Math.max(maximum, 1 - value / peak);
  }
  return maximum;
}

function stratifiedTerminalPathIndices(
  paths: readonly (readonly number[])[],
  sampleCount: number,
) {
  const ranked = paths
    .map((path, pathIndex) => ({ pathIndex, terminal: path.at(-1) as number }))
    .sort(
      (left, right) =>
        left.terminal - right.terminal || left.pathIndex - right.pathIndex,
    );
  return Object.freeze(
    Array.from({ length: sampleCount }, (_, sampleIndex) => {
      const rank = Math.round(
        (sampleIndex * (ranked.length - 1)) / (sampleCount - 1),
      );
      return ranked[rank].pathIndex;
    }),
  );
}

function type7Quantile(sortedValues: readonly number[], probability: number) {
  const position = (sortedValues.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.min(lowerIndex + 1, sortedValues.length - 1);
  const fraction = position - lowerIndex;
  return (
    sortedValues[lowerIndex] +
    (sortedValues[upperIndex] - sortedValues[lowerIndex]) * fraction
  );
}

function blockedEngine(
  reason:
    | "invalid_return_matrix_values"
    | "draw_plan_blocked"
    | "scenario_execution_blocked",
) {
  return Object.freeze({
    status: "unavailable" as const,
    reason,
    policy: SIMULATION_REGIME_BOOTSTRAP_POLICY,
    assumptions: null,
    scenarios: Object.freeze([]),
  });
}

function blockedScenario(
  scenario: SimulationRegimeScenarioInput,
  reason:
    | "invalid_scenario_weights"
    | "invalid_draw_source"
    | "invalid_growth_path",
) {
  return Object.freeze({
    status: "unavailable" as const,
    reason,
    id: scenario.id,
    name: scenario.name,
    weightsBps: Object.freeze([...scenario.weightsBps]),
    assumptions: null,
    terminal: null,
    bands: Object.freeze([]),
    samplePaths: Object.freeze([]),
  });
}
