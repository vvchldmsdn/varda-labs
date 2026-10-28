import { SIMULATION_PATH_MAX_DRAWDOWN_POLICY } from "./simulation-path-max-drawdown-policy.ts";
import type {
  SimulationPathMaxDrawdownBlockedResult,
  SimulationPathMaxDrawdownBlocker,
  SimulationPathMaxDrawdownInput,
  SimulationPathMaxDrawdownResult,
  SimulationPathMaxDrawdownRow,
} from "./simulation-path-max-drawdown-types.ts";
import { validateSimulationPathMaxDrawdownInput } from "./simulation-path-max-drawdown-validation.ts";

export type {
  SimulationPathMaxDrawdownBlockedResult,
  SimulationPathMaxDrawdownBlocker,
  SimulationPathMaxDrawdownBlockerReason,
  SimulationPathMaxDrawdownExpectedBinding,
  SimulationPathMaxDrawdownInput,
  SimulationPathMaxDrawdownReadyResult,
  SimulationPathMaxDrawdownResult,
  SimulationPathMaxDrawdownRow,
} from "./simulation-path-max-drawdown-types.ts";
export {
  SIMULATION_PATH_MAX_DRAWDOWN_BLOCKER_ORDER,
  SIMULATION_PATH_MAX_DRAWDOWN_POLICY,
} from "./simulation-path-max-drawdown-policy.ts";

export function calculateSimulationPathMaxDrawdowns(
  input: SimulationPathMaxDrawdownInput,
): SimulationPathMaxDrawdownResult {
  const validation = validateSimulationPathMaxDrawdownInput(input);
  if (!validation.validated) return blockedResult(validation.blockers);

  const validated = validation.validated;
  const pathDrawdowns = new Array<SimulationPathMaxDrawdownRow>(
    validated.pathCount,
  );

  for (let pathIndex = 0; pathIndex < validated.pathCount; pathIndex += 1) {
    const path = validated.normalizedNav.paths[pathIndex];
    let runningPeak = 1;
    let maxDrawdown = 0;

    for (let stepIndex = 0; stepIndex <= validated.horizon; stepIndex += 1) {
      const nav = path.points[stepIndex].nav;
      runningPeak = Math.max(runningPeak, nav);
      const peakRatio = nav / runningPeak;
      const drawdown = 1 - peakRatio;

      if (
        !Number.isFinite(runningPeak) ||
        runningPeak <= 0 ||
        !Number.isFinite(peakRatio) ||
        peakRatio <= 0 ||
        peakRatio > 1 ||
        !Number.isFinite(drawdown) ||
        drawdown < 0 ||
        drawdown >= 1
      ) {
        return invalidDrawdownResult();
      }

      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }

    const canonicalMaxDrawdown = maxDrawdown === 0 ? 0 : maxDrawdown;
    if (
      !Number.isFinite(canonicalMaxDrawdown) ||
      canonicalMaxDrawdown < 0 ||
      canonicalMaxDrawdown >= 1 ||
      Object.is(canonicalMaxDrawdown, -0)
    ) {
      return invalidDrawdownResult();
    }

    pathDrawdowns[pathIndex] = Object.freeze({
      pathIndex,
      maxDrawdown: canonicalMaxDrawdown,
    });
  }

  if (
    pathDrawdowns.length !== validated.pathCount ||
    pathDrawdowns.length > validated.derivedMaxPathDrawdownRows
  ) {
    return invalidDrawdownResult();
  }

  return Object.freeze({
    drawdownStatus: "ready",
    runtimeTrustStatus:
      SIMULATION_PATH_MAX_DRAWDOWN_POLICY.runtimeTrustStatus,
    policy: SIMULATION_PATH_MAX_DRAWDOWN_POLICY,
    scenarioId: validated.scenarioId,
    scenarioVersion: validated.scenarioVersion,
    scenarioVectorHash: validated.scenarioVectorHash,
    inputMatrixHash: validated.inputMatrixHash,
    drawPlanHash: validated.drawPlanHash,
    horizon: validated.horizon,
    pathCount: validated.pathCount,
    totalPointCount: validated.totalPointCount,
    pathDrawdowns: Object.freeze(pathDrawdowns),
    blockers: Object.freeze([]) as readonly [],
  });
}

function invalidDrawdownResult() {
  return blockedResult(
    Object.freeze([Object.freeze({ reason: "invalid_drawdown" })]),
  );
}

function blockedResult(
  blockers: readonly SimulationPathMaxDrawdownBlocker[],
): SimulationPathMaxDrawdownBlockedResult {
  return Object.freeze({
    drawdownStatus: "blocked",
    runtimeTrustStatus:
      SIMULATION_PATH_MAX_DRAWDOWN_POLICY.runtimeTrustStatus,
    policy: SIMULATION_PATH_MAX_DRAWDOWN_POLICY,
    scenarioId: null,
    scenarioVersion: null,
    scenarioVectorHash: null,
    inputMatrixHash: null,
    drawPlanHash: null,
    horizon: 0,
    pathCount: 0,
    totalPointCount: 0,
    pathDrawdowns: Object.freeze([]) as readonly [],
    blockers,
  });
}
