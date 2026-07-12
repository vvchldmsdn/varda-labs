import { SIMULATION_TERMINAL_LOSS_PROBABILITY_POLICY } from "./simulation-terminal-loss-probability-policy.ts";
import type {
  SimulationTerminalLossProbabilityBlockedResult,
  SimulationTerminalLossProbabilityBlocker,
  SimulationTerminalLossProbabilityInput,
  SimulationTerminalLossProbabilityResult,
} from "./simulation-terminal-loss-probability-types.ts";
import { validateSimulationTerminalLossProbabilityInput } from "./simulation-terminal-loss-probability-validation.ts";

export type {
  SimulationTerminalLossProbabilityBlockedResult,
  SimulationTerminalLossProbabilityBlocker,
  SimulationTerminalLossProbabilityBlockerReason,
  SimulationTerminalLossProbabilityExpectedBinding,
  SimulationTerminalLossProbabilityInput,
  SimulationTerminalLossProbabilityReadyResult,
  SimulationTerminalLossProbabilityResult,
} from "./simulation-terminal-loss-probability-types.ts";
export {
  SIMULATION_TERMINAL_LOSS_PROBABILITY_BLOCKER_ORDER,
  SIMULATION_TERMINAL_LOSS_PROBABILITY_POLICY,
} from "./simulation-terminal-loss-probability-policy.ts";

export function calculateSimulationTerminalLossProbability(
  input: SimulationTerminalLossProbabilityInput,
): SimulationTerminalLossProbabilityResult {
  const validation = validateSimulationTerminalLossProbabilityInput(input);
  if (!validation.validated) return blockedResult(validation.blockers);

  const validated = validation.validated;
  let lossPathCount = 0;
  for (let pathIndex = 0; pathIndex < validated.pathCount; pathIndex += 1) {
    const terminalNav =
      validated.normalizedNav.paths[pathIndex].points[validated.horizon].nav;
    if (terminalNav < 1) lossPathCount += 1;
  }

  if (
    !Number.isSafeInteger(lossPathCount) ||
    lossPathCount < 0 ||
    lossPathCount > validated.pathCount
  ) {
    return blockedResult(
      singleBlocker("invalid_terminal_loss_count"),
    );
  }

  const lossProbability = lossPathCount / validated.pathCount;
  if (
    !Number.isFinite(lossProbability) ||
    lossProbability < 0 ||
    lossProbability > 1
  ) {
    return blockedResult(
      singleBlocker("invalid_terminal_loss_probability"),
    );
  }

  return Object.freeze({
    lossStatus: "ready",
    runtimeTrustStatus:
      SIMULATION_TERMINAL_LOSS_PROBABILITY_POLICY.runtimeTrustStatus,
    policy: SIMULATION_TERMINAL_LOSS_PROBABILITY_POLICY,
    scenarioId: validated.scenarioId,
    scenarioVersion: validated.scenarioVersion,
    scenarioVectorHash: validated.scenarioVectorHash,
    inputMatrixHash: validated.inputMatrixHash,
    drawPlanHash: validated.drawPlanHash,
    horizon: validated.horizon,
    pathCount: validated.pathCount,
    totalPointCount: validated.totalPointCount,
    lossPathCount,
    lossProbability,
    blockers: Object.freeze([]) as readonly [],
  });
}

function singleBlocker(
  reason:
    | "invalid_terminal_loss_count"
    | "invalid_terminal_loss_probability",
) {
  return Object.freeze([Object.freeze({ reason })]);
}

function blockedResult(
  blockers: readonly SimulationTerminalLossProbabilityBlocker[],
): SimulationTerminalLossProbabilityBlockedResult {
  return Object.freeze({
    lossStatus: "blocked",
    runtimeTrustStatus:
      SIMULATION_TERMINAL_LOSS_PROBABILITY_POLICY.runtimeTrustStatus,
    policy: SIMULATION_TERMINAL_LOSS_PROBABILITY_POLICY,
    scenarioId: null,
    scenarioVersion: null,
    scenarioVectorHash: null,
    inputMatrixHash: null,
    drawPlanHash: null,
    horizon: 0,
    pathCount: 0,
    totalPointCount: 0,
    lossPathCount: 0,
    lossProbability: null,
    blockers,
  });
}
