import {
  SIMULATION_NORMALIZED_NAV_POLICY,
} from "./simulation-normalized-nav-policy.ts";
import type {
  SimulationNormalizedNavBlockerReason,
  SimulationNormalizedNavPath,
  SimulationNormalizedNavPoint,
  SimulationNormalizedNavResult,
  ValidatedSimulationNormalizedNavInput,
} from "./simulation-normalized-nav-types.ts";
import { validateSimulationNormalizedNavInput } from "./simulation-normalized-nav-validation.ts";

export type {
  SimulationNormalizedNavBlocker,
  SimulationNormalizedNavBlockerReason,
  SimulationNormalizedNavExpectedBinding,
  SimulationNormalizedNavInput,
  SimulationNormalizedNavPath,
  SimulationNormalizedNavPoint,
  SimulationNormalizedNavResult,
  SimulationNormalizedNavScenarioEvidence,
} from "./simulation-normalized-nav-types.ts";
export { SIMULATION_NORMALIZED_NAV_POLICY } from "./simulation-normalized-nav-policy.ts";

export function materializeSimulationNormalizedNav(
  input: Parameters<typeof validateSimulationNormalizedNavInput>[0],
): SimulationNormalizedNavResult {
  const validation = validateSimulationNormalizedNavInput(input);
  if (!validation.validated) {
    return blockedResult({
      blockers: validation.blockers.map((blocker) => blocker.reason),
    });
  }

  const materialized = materializePaths(validation.validated);
  if (materialized.blocker) {
    return blockedResult({
      validated: validation.validated,
      blockers: [materialized.blocker],
    });
  }

  const validated = validation.validated;
  return Object.freeze({
    calculationStatus: "ready",
    runtimeTrustStatus: SIMULATION_NORMALIZED_NAV_POLICY.runtimeTrustStatus,
    policy: SIMULATION_NORMALIZED_NAV_POLICY,
    scenarioId: validated.scenarioId,
    scenarioVersion: validated.scenarioVersion,
    scenarioVectorHash: validated.scenarioVectorHash,
    inputMatrixHash: validated.grossGrowth.inputMatrixHash,
    drawPlanHash: validated.grossGrowth.drawPlanHash,
    horizon: validated.grossGrowth.horizon,
    pathCount: validated.grossGrowth.pathCount,
    totalPointCount: validated.totalPointCount,
    totalNavCells: validated.totalNavCells,
    paths: materialized.paths,
    blockers: Object.freeze([]),
  });
}

function materializePaths(validated: ValidatedSimulationNormalizedNavInput): {
  paths: readonly SimulationNormalizedNavPath[];
  blocker: SimulationNormalizedNavBlockerReason | null;
} {
  const paths: SimulationNormalizedNavPath[] = [];

  for (const sourcePath of validated.grossGrowth.paths) {
    const points: SimulationNormalizedNavPoint[] = [];
    for (const sourcePoint of sourcePath.points) {
      let nav = 1;
      if (sourcePoint.stepIndex !== 0) {
        const calculated = calculateWeightedNav(
          sourcePoint.grossGrowthFactors.map((factor) => factor.value),
          validated.weightsBps,
        );
        if (calculated.blocker) {
          return { paths: Object.freeze([]), blocker: calculated.blocker };
        }
        nav = calculated.nav;
      }

      points.push(
        Object.freeze({
          stepIndex: sourcePoint.stepIndex,
          drawStepIndex: sourcePoint.drawStepIndex,
          sourceRowIndex: sourcePoint.sourceRowIndex,
          previousServiceDate: sourcePoint.previousServiceDate,
          serviceDate: sourcePoint.serviceDate,
          nav,
        }),
      );
    }
    paths.push(
      Object.freeze({
        pathIndex: sourcePath.pathIndex,
        points: Object.freeze(points),
      }),
    );
  }

  return { paths: Object.freeze(paths), blocker: null };
}

function calculateWeightedNav(
  grossGrowthFactors: readonly number[],
  weightsBps: readonly number[],
):
  | { nav: number; blocker: null }
  | { nav: 0; blocker: SimulationNormalizedNavBlockerReason } {
  let sum = 0;
  let compensation = 0;

  for (let index = 0; index < grossGrowthFactors.length; index += 1) {
    const term = (weightsBps[index] / 10_000) * grossGrowthFactors[index];
    if (!Number.isFinite(term)) {
      return { nav: 0, blocker: "invalid_weighted_term" };
    }

    const next = sum + term;
    if (!Number.isFinite(next)) {
      return { nav: 0, blocker: "invalid_weighted_term" };
    }

    const correction =
      Math.abs(sum) >= Math.abs(term)
        ? (sum - next) + term
        : (term - next) + sum;
    const nextCompensation = compensation + correction;
    if (!Number.isFinite(correction) || !Number.isFinite(nextCompensation)) {
      return { nav: 0, blocker: "invalid_weighted_term" };
    }

    sum = next;
    compensation = nextCompensation;
  }

  const nav = sum + compensation;
  if (!Number.isFinite(nav) || nav <= 0) {
    return { nav: 0, blocker: "invalid_nav" };
  }
  return { nav, blocker: null };
}

function blockedResult(input: {
  validated?: ValidatedSimulationNormalizedNavInput;
  blockers: readonly SimulationNormalizedNavBlockerReason[];
}): SimulationNormalizedNavResult {
  const validated = input.validated;
  return Object.freeze({
    calculationStatus: "blocked",
    runtimeTrustStatus: SIMULATION_NORMALIZED_NAV_POLICY.runtimeTrustStatus,
    policy: SIMULATION_NORMALIZED_NAV_POLICY,
    scenarioId: validated?.scenarioId ?? null,
    scenarioVersion: validated?.scenarioVersion ?? null,
    scenarioVectorHash: validated?.scenarioVectorHash ?? null,
    inputMatrixHash: validated?.grossGrowth.inputMatrixHash ?? null,
    drawPlanHash: validated?.grossGrowth.drawPlanHash ?? null,
    horizon: validated?.grossGrowth.horizon ?? 0,
    pathCount: validated?.grossGrowth.pathCount ?? 0,
    totalPointCount: validated?.totalPointCount ?? 0,
    totalNavCells: validated?.totalNavCells ?? 0,
    paths: Object.freeze([]),
    blockers: Object.freeze(
      input.blockers.map((reason) => Object.freeze({ reason })),
    ),
  });
}
