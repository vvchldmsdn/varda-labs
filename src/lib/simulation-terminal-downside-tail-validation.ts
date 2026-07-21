import {
  SIMULATION_TERMINAL_DOWNSIDE_TAIL_BLOCKER_ORDER,
  SIMULATION_TERMINAL_DOWNSIDE_TAIL_POLICY,
} from "./simulation-terminal-downside-tail-policy.ts";
import type {
  SimulationTerminalDownsideTailBlocker,
  SimulationTerminalDownsideTailBlockerReason,
  SimulationTerminalDownsideTailInput,
  SimulationTerminalDownsideTailValidationResult,
} from "./simulation-terminal-downside-tail-types.ts";

export function validateSimulationTerminalDownsideTailInput(
  input: SimulationTerminalDownsideTailInput,
): SimulationTerminalDownsideTailValidationResult {
  const reasons = new Set<SimulationTerminalDownsideTailBlockerReason>();
  const value: unknown = input;

  if (!isRecord(value) || !Array.isArray(value.terminalReturns)) {
    reasons.add("invalid_input_shape");
    return blocked(reasons);
  }

  if (
    value.terminalReturns.length !==
    SIMULATION_TERMINAL_DOWNSIDE_TAIL_POLICY.requiredPathCount
  ) {
    reasons.add("invalid_path_count");
  }
  if (
    value.terminalReturns.some(
      (terminalReturn) =>
        typeof terminalReturn !== "number" ||
        !Number.isFinite(terminalReturn) ||
        terminalReturn <= -1,
    )
  ) {
    reasons.add("invalid_terminal_return");
  }

  if (reasons.size > 0) return blocked(reasons);

  return Object.freeze({
    terminalReturns: value.terminalReturns as readonly number[],
    blockers: Object.freeze([]),
  });
}

function blocked(
  reasons: ReadonlySet<SimulationTerminalDownsideTailBlockerReason>,
): SimulationTerminalDownsideTailValidationResult {
  return Object.freeze({
    terminalReturns: null,
    blockers: orderBlockers(reasons),
  });
}

function orderBlockers(
  reasons: ReadonlySet<SimulationTerminalDownsideTailBlockerReason>,
): readonly SimulationTerminalDownsideTailBlocker[] {
  return Object.freeze(
    SIMULATION_TERMINAL_DOWNSIDE_TAIL_BLOCKER_ORDER.filter((reason) =>
      reasons.has(reason),
    ).map((reason) => Object.freeze({ reason })),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
