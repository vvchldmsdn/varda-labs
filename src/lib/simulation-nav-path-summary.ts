import { summarizeSimulationTerminalDownsideTail } from "./simulation-terminal-downside-tail.ts";

export const SIMULATION_NAV_PATH_SUMMARY_POLICY = Object.freeze({
  version: "simulation_nav_path_summary_v1",
  requiredPathCount: 500,
  quantileMethod: "type_7",
  normalizedStartNav: 1,
  sampleSelection: "terminal_rank_stratified",
} as const);

export type SimulationNavPathSummaryResult = ReturnType<
  typeof summarizeSimulationNavPaths
>;

export function summarizeSimulationNavPaths(input: {
  paths: readonly (readonly number[])[];
  horizon: number;
  samplePathCount: number;
}) {
  if (
    input.paths.length !== SIMULATION_NAV_PATH_SUMMARY_POLICY.requiredPathCount ||
    !Number.isInteger(input.horizon) ||
    input.horizon <= 0 ||
    !Number.isInteger(input.samplePathCount) ||
    input.samplePathCount <= 0 ||
    input.samplePathCount > input.paths.length ||
    input.paths.some(
      (path) =>
        path.length !== input.horizon + 1 ||
        path[0] !== SIMULATION_NAV_PATH_SUMMARY_POLICY.normalizedStartNav ||
        path.some((value) => !Number.isFinite(value) || value <= 0),
    )
  ) {
    return blocked("invalid_path_shape");
  }

  const bands = [];
  for (let stepIndex = 0; stepIndex <= input.horizon; stepIndex += 1) {
    const values = input.paths
      .map((path) => path[stepIndex])
      .sort((left, right) => left - right);
    const p10 = type7Quantile(values, 0.1);
    const p50 = type7Quantile(values, 0.5);
    const p90 = type7Quantile(values, 0.9);
    if (
      p10 === null ||
      p50 === null ||
      p90 === null ||
      p10 > p50 ||
      p50 > p90
    ) {
      return blocked("invalid_quantile");
    }
    bands.push(
      Object.freeze({
        stepIndex,
        p10: p10 * 100,
        p50: p50 * 100,
        p90: p90 * 100,
      }),
    );
  }

  const terminalReturns = input.paths.map(
    (path) => path[input.horizon] - 1,
  );
  const tail = summarizeSimulationTerminalDownsideTail({ terminalReturns });
  if (tail.summaryStatus !== "ready") return blocked("invalid_tail_summary");

  const maxDrawdowns = input.paths
    .map(maxDrawdown)
    .sort((left, right) => left - right);
  const maxDrawdownP50 = type7Quantile(maxDrawdowns, 0.5);
  const maxDrawdownP90 = type7Quantile(maxDrawdowns, 0.9);
  if (maxDrawdownP50 === null || maxDrawdownP90 === null) {
    return blocked("invalid_drawdown_summary");
  }

  const terminalBand = bands[input.horizon];
  const rankedPathIndexes = input.paths
    .map((path, pathIndex) => ({ pathIndex, terminalNav: path[input.horizon] }))
    .sort(
      (left, right) =>
        left.terminalNav - right.terminalNav || left.pathIndex - right.pathIndex,
    )
    .map((row) => row.pathIndex);
  const samplePaths = Array.from(
    { length: input.samplePathCount },
    (_, sampleIndex) => {
      const rankIndex = Math.min(
        rankedPathIndexes.length - 1,
        Math.floor(
          ((sampleIndex + 0.5) * rankedPathIndexes.length) /
            input.samplePathCount,
        ),
      );
      const pathIndex = rankedPathIndexes[rankIndex];
      return Object.freeze({
        pathIndex,
        points: Object.freeze(
          input.paths[pathIndex].map((nav, stepIndex) =>
            Object.freeze({ stepIndex, indexValue: nav * 100 }),
          ),
        ),
      });
    },
  );

  return Object.freeze({
    status: "ready" as const,
    reason: null,
    policy: SIMULATION_NAV_PATH_SUMMARY_POLICY,
    terminal: Object.freeze({
      p10Index: terminalBand.p10,
      p50Index: terminalBand.p50,
      p90Index: terminalBand.p90,
      p50ReturnPct: terminalBand.p50 - 100,
      p5ReturnPct: tail.p5TerminalReturn * 100,
      lowerTailMeanReturnPct: tail.lowerTailMeanTerminalReturn * 100,
      lossProbabilityPct:
        (terminalReturns.filter((value) => value < 0).length /
          terminalReturns.length) *
        100,
      maxDrawdownP50Pct: maxDrawdownP50 * 100,
      maxDrawdownP90Pct: maxDrawdownP90 * 100,
    }),
    bands: Object.freeze(bands),
    samplePaths: Object.freeze(samplePaths),
  });
}

function maxDrawdown(path: readonly number[]) {
  let peak = path[0];
  let result = 0;
  for (const nav of path) {
    peak = Math.max(peak, nav);
    result = Math.max(result, 1 - nav / peak);
  }
  return result;
}

function type7Quantile(sortedValues: readonly number[], probability: number) {
  if (sortedValues.length === 0) return null;
  const position = (sortedValues.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.min(lowerIndex + 1, sortedValues.length - 1);
  const fraction = position - lowerIndex;
  const value =
    sortedValues[lowerIndex] +
    (sortedValues[upperIndex] - sortedValues[lowerIndex]) * fraction;
  return Number.isFinite(value) ? value : null;
}

function blocked(
  reason:
    | "invalid_path_shape"
    | "invalid_quantile"
    | "invalid_tail_summary"
    | "invalid_drawdown_summary",
) {
  return Object.freeze({
    status: "unavailable" as const,
    reason,
    policy: SIMULATION_NAV_PATH_SUMMARY_POLICY,
    terminal: null,
    bands: Object.freeze([]),
    samplePaths: Object.freeze([]),
  });
}
