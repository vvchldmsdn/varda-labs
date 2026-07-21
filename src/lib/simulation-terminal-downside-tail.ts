import { SIMULATION_TERMINAL_DOWNSIDE_TAIL_POLICY } from "./simulation-terminal-downside-tail-policy.ts";
import type {
  SimulationTerminalDownsideTailBlockedResult,
  SimulationTerminalDownsideTailBlocker,
  SimulationTerminalDownsideTailInput,
  SimulationTerminalDownsideTailResult,
} from "./simulation-terminal-downside-tail-types.ts";
import { validateSimulationTerminalDownsideTailInput } from "./simulation-terminal-downside-tail-validation.ts";

export type {
  SimulationTerminalDownsideTailBlockedResult,
  SimulationTerminalDownsideTailBlocker,
  SimulationTerminalDownsideTailBlockerReason,
  SimulationTerminalDownsideTailInput,
  SimulationTerminalDownsideTailReadyResult,
  SimulationTerminalDownsideTailResult,
} from "./simulation-terminal-downside-tail-types.ts";
export {
  SIMULATION_TERMINAL_DOWNSIDE_TAIL_BLOCKER_ORDER,
  SIMULATION_TERMINAL_DOWNSIDE_TAIL_POLICY,
} from "./simulation-terminal-downside-tail-policy.ts";

export function summarizeSimulationTerminalDownsideTail(
  input: SimulationTerminalDownsideTailInput,
): SimulationTerminalDownsideTailResult {
  const validation = validateSimulationTerminalDownsideTailInput(input);
  if (!validation.terminalReturns) {
    return blockedResult(validation.blockers);
  }

  const sortedReturns = [...validation.terminalReturns].sort(
    (left, right) => left - right,
  );
  const p5TerminalReturn = type7Quantile(
    sortedReturns,
    SIMULATION_TERMINAL_DOWNSIDE_TAIL_POLICY.tailProbability,
  );
  if (p5TerminalReturn === null || p5TerminalReturn <= -1) {
    return blockedResult(singleBlocker("invalid_p5_return"));
  }

  const tailReturns = sortedReturns.slice(
    0,
    SIMULATION_TERMINAL_DOWNSIDE_TAIL_POLICY.tailPathCount,
  );
  const lowerTailMeanTerminalReturn =
    neumaierSum(tailReturns) /
    SIMULATION_TERMINAL_DOWNSIDE_TAIL_POLICY.tailPathCount;
  if (
    !Number.isFinite(lowerTailMeanTerminalReturn) ||
    lowerTailMeanTerminalReturn <= -1 ||
    lowerTailMeanTerminalReturn > p5TerminalReturn
  ) {
    return blockedResult(singleBlocker("invalid_tail_mean_return"));
  }

  return Object.freeze({
    summaryStatus: "ready",
    runtimeTrustStatus:
      SIMULATION_TERMINAL_DOWNSIDE_TAIL_POLICY.runtimeTrustStatus,
    policy: SIMULATION_TERMINAL_DOWNSIDE_TAIL_POLICY,
    pathCount: SIMULATION_TERMINAL_DOWNSIDE_TAIL_POLICY.requiredPathCount,
    tailPathCount: SIMULATION_TERMINAL_DOWNSIDE_TAIL_POLICY.tailPathCount,
    p5TerminalReturn: canonicalZero(p5TerminalReturn),
    lowerTailMeanTerminalReturn: canonicalZero(
      lowerTailMeanTerminalReturn,
    ),
    blockers: Object.freeze([]) as readonly [],
  });
}

function type7Quantile(sortedValues: readonly number[], probability: number) {
  const position = (sortedValues.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.min(lowerIndex + 1, sortedValues.length - 1);
  const fraction = position - lowerIndex;
  const lower = sortedValues[lowerIndex];
  const upper = sortedValues[upperIndex];
  const quantile = lower + (upper - lower) * fraction;
  return Number.isFinite(quantile) ? canonicalZero(quantile) : null;
}

function neumaierSum(values: readonly number[]) {
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

function canonicalZero(value: number) {
  return value === 0 ? 0 : value;
}

function singleBlocker(
  reason: "invalid_p5_return" | "invalid_tail_mean_return",
) {
  return Object.freeze([Object.freeze({ reason })]);
}

function blockedResult(
  blockers: readonly SimulationTerminalDownsideTailBlocker[],
): SimulationTerminalDownsideTailBlockedResult {
  return Object.freeze({
    summaryStatus: "blocked",
    runtimeTrustStatus:
      SIMULATION_TERMINAL_DOWNSIDE_TAIL_POLICY.runtimeTrustStatus,
    policy: SIMULATION_TERMINAL_DOWNSIDE_TAIL_POLICY,
    pathCount: 0,
    tailPathCount: 0,
    p5TerminalReturn: null,
    lowerTailMeanTerminalReturn: null,
    blockers,
  });
}
