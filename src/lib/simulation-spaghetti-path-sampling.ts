import { SIMULATION_SPAGHETTI_PATH_SAMPLE_POLICY } from "./simulation-spaghetti-path-sampling-policy.ts";
import type {
  SimulationSpaghettiPathSampleBlockedResult,
  SimulationSpaghettiPathSampleBlocker,
  SimulationSpaghettiPathSampleInput,
  SimulationSpaghettiPathSamplePath,
  SimulationSpaghettiPathSampleResult,
} from "./simulation-spaghetti-path-sampling-types.ts";
import { validateSimulationSpaghettiPathSampleInput } from "./simulation-spaghetti-path-sampling-validation.ts";

export type {
  SimulationSpaghettiPathSampleBlockedResult,
  SimulationSpaghettiPathSampleBlocker,
  SimulationSpaghettiPathSampleBlockerReason,
  SimulationSpaghettiPathSampleExpectedBinding,
  SimulationSpaghettiPathSampleInput,
  SimulationSpaghettiPathSamplePath,
  SimulationSpaghettiPathSamplePoint,
  SimulationSpaghettiPathSampleReadyResult,
  SimulationSpaghettiPathSampleResult,
} from "./simulation-spaghetti-path-sampling-types.ts";
export {
  SIMULATION_SPAGHETTI_PATH_SAMPLE_BLOCKER_ORDER,
  SIMULATION_SPAGHETTI_PATH_SAMPLE_POLICY,
} from "./simulation-spaghetti-path-sampling-policy.ts";

export function sampleSimulationSpaghettiPaths(
  input: SimulationSpaghettiPathSampleInput,
): SimulationSpaghettiPathSampleResult {
  const validation = validateSimulationSpaghettiPathSampleInput(input);
  if (!validation.validated) return blockedResult(validation.blockers);

  const validated = validation.validated;
  const selectedPaths: SimulationSpaghettiPathSamplePath[] =
    validated.selectedPathIndices.map((pathIndex) => {
      const sourcePath = validated.normalizedNav.paths[pathIndex];
      const points = Object.freeze(
        sourcePath.points.map((point) =>
          Object.freeze({
            stepIndex: point.stepIndex,
            nav: point.nav,
          }),
        ),
      );
      return Object.freeze({ pathIndex, points });
    });

  return Object.freeze({
    sampleStatus: "ready",
    runtimeTrustStatus:
      SIMULATION_SPAGHETTI_PATH_SAMPLE_POLICY.runtimeTrustStatus,
    policy: SIMULATION_SPAGHETTI_PATH_SAMPLE_POLICY,
    scenarioId: validated.scenarioId,
    scenarioVersion: validated.scenarioVersion,
    scenarioVectorHash: validated.scenarioVectorHash,
    inputMatrixHash: validated.inputMatrixHash,
    drawPlanHash: validated.drawPlanHash,
    horizon: validated.horizon,
    inputPathCount: validated.inputPathCount,
    selectedPathCount: validated.sampleCount,
    totalInputPointCount: validated.totalInputPointCount,
    totalOutputPointCount: validated.totalOutputPointCount,
    selectedPaths: Object.freeze(selectedPaths),
    blockers: Object.freeze([]) as readonly [],
  });
}

function blockedResult(
  blockers: readonly SimulationSpaghettiPathSampleBlocker[],
): SimulationSpaghettiPathSampleBlockedResult {
  return Object.freeze({
    sampleStatus: "blocked",
    runtimeTrustStatus:
      SIMULATION_SPAGHETTI_PATH_SAMPLE_POLICY.runtimeTrustStatus,
    policy: SIMULATION_SPAGHETTI_PATH_SAMPLE_POLICY,
    scenarioId: null,
    scenarioVersion: null,
    scenarioVectorHash: null,
    inputMatrixHash: null,
    drawPlanHash: null,
    horizon: 0,
    inputPathCount: 0,
    selectedPathCount: 0,
    totalInputPointCount: 0,
    totalOutputPointCount: 0,
    selectedPaths: Object.freeze([]) as readonly [],
    blockers,
  });
}
