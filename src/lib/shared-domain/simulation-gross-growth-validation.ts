import {
  hashStationaryBootstrapDrawPlan,
  validateAndHashReadyReturnMatrix,
} from "./simulation-stationary-bootstrap-serialization.ts";
import {
  STATIONARY_BOOTSTRAP_POLICY,
  isUint32,
} from "./simulation-stationary-bootstrap-policy.ts";
import type {
  StationaryBootstrapDraw,
  StationaryBootstrapPath,
} from "./simulation-stationary-bootstrap-types.ts";
import type {
  SimulationGrossGrowthBlocker,
  SimulationGrossGrowthBlockerReason,
  SimulationGrossGrowthInput,
  ValidatedSimulationGrossGrowthInput,
} from "./simulation-gross-growth-types.ts";

export function validateSimulationGrossGrowthInput(
  input: SimulationGrossGrowthInput,
): {
  validated: ValidatedSimulationGrossGrowthInput | null;
  blockers: readonly SimulationGrossGrowthBlocker[];
} {
  const matrixResult = validateAndHashReadyReturnMatrix(input.matrix);
  if (!matrixResult.canonical) {
    return blocked(
      matrixResult.blockers.map((item) =>
        item.reason === "input_matrix_shape_invalid"
          ? "input_matrix_shape_invalid"
          : "input_matrix_not_ready",
      ),
    );
  }

  const canonical = matrixResult.canonical;
  const plan = input.drawPlan;
  if (
    !plan ||
    plan.status !== "ready" ||
    !isExpectedPolicy(plan.policy) ||
    !Array.isArray(plan.blockers) ||
    plan.blockers.length !== 0 ||
    !Array.isArray(plan.paths)
  ) {
    return blocked(["input_draw_plan_not_ready"]);
  }

  const blockers: SimulationGrossGrowthBlockerReason[] = [];
  if (plan.inputMatrixHash !== canonical.inputMatrixHash) {
    blockers.push("input_matrix_hash_mismatch");
  }

  const metadataValid =
    typeof plan.inputMatrixHash === "string" &&
    typeof plan.drawPlanHash === "string" &&
    isUint32(plan.seed) &&
    isPositiveSafeInteger(plan.expectedBlockLength) &&
    plan.expectedBlockLength <= canonical.sourceRowCount &&
    plan.restartProbability === 1 / plan.expectedBlockLength &&
    isPositiveSafeInteger(plan.horizon) &&
    isPositiveSafeInteger(plan.pathCount) &&
    plan.sourceRowCount === canonical.sourceRowCount &&
    plan.instrumentCount === canonical.instrumentCount &&
    Number.isSafeInteger(plan.totalPlannedDraws) &&
    plan.totalPlannedDraws === plan.horizon * plan.pathCount &&
    plan.totalPlannedDraws <= STATIONARY_BOOTSTRAP_POLICY.maxPlannedDraws &&
    plan.paths.length === plan.pathCount;

  const pathsValid =
    metadataValid &&
    plan.paths.every((path: StationaryBootstrapPath, pathIndex: number) => {
      if (
        !path ||
        path.pathIndex !== pathIndex ||
        !Array.isArray(path.draws) ||
        path.draws.length !== plan.horizon
      ) {
        return false;
      }

      return path.draws.every(
        (draw: StationaryBootstrapDraw, drawIndex: number) => {
          if (
            !draw ||
            draw.stepIndex !== drawIndex ||
            !Number.isSafeInteger(draw.sourceRowIndex) ||
            draw.sourceRowIndex < 0 ||
            draw.sourceRowIndex >= canonical.sourceRowCount ||
            typeof draw.blockStart !== "boolean"
          ) {
            return false;
          }

          const sourceRow = canonical.rows[draw.sourceRowIndex];
          if (
            draw.previousServiceDate !== sourceRow.previousServiceDate ||
            draw.serviceDate !== sourceRow.serviceDate ||
            (drawIndex === 0 && draw.blockStart !== true)
          ) {
            return false;
          }

          if (drawIndex === 0 || draw.blockStart) return true;
          const previousDraw = path.draws[drawIndex - 1];
          return (
            draw.sourceRowIndex ===
            (previousDraw.sourceRowIndex + 1) % canonical.sourceRowCount
          );
        },
      );
    });

  if (!metadataValid || !pathsValid) {
    blockers.push("input_draw_plan_shape_invalid");
  } else {
    const recalculatedHash = hashStationaryBootstrapDrawPlan({
      inputMatrixHash: plan.inputMatrixHash,
      seed: plan.seed,
      expectedBlockLength: plan.expectedBlockLength,
      horizon: plan.horizon,
      pathCount: plan.pathCount,
      paths: plan.paths,
    });
    if (recalculatedHash !== plan.drawPlanHash) {
      blockers.push("input_draw_plan_hash_mismatch");
    }
  }

  const sortedBlockers = sortBlockers(blockers);
  if (sortedBlockers.length > 0 || !metadataValid || !pathsValid) {
    return { validated: null, blockers: sortedBlockers };
  }

  return {
    validated: Object.freeze({
      inputMatrixHash: canonical.inputMatrixHash,
      drawPlanHash: plan.drawPlanHash,
      instrumentKeys: Object.freeze(
        input.matrix.instruments.map((item) => item.instrumentKey),
      ),
      rows: Object.freeze(
        input.matrix.matrix.map((row) =>
          Object.freeze({
            previousServiceDate: row.previousServiceDate,
            serviceDate: row.serviceDate,
            values: Object.freeze(
              row.cells.map((cell) => cell.value as number),
            ),
          }),
        ),
      ),
      horizon: plan.horizon,
      pathCount: plan.pathCount,
      paths: Object.freeze(
        plan.paths.map((path: StationaryBootstrapPath) =>
          Object.freeze({
            pathIndex: path.pathIndex,
            draws: Object.freeze(
              path.draws.map((draw: StationaryBootstrapDraw) =>
                Object.freeze({
                  stepIndex: draw.stepIndex,
                  sourceRowIndex: draw.sourceRowIndex,
                  previousServiceDate: draw.previousServiceDate,
                  serviceDate: draw.serviceDate,
                  blockStart: draw.blockStart,
                }),
              ),
            ),
          }),
        ),
      ),
    }),
    blockers: Object.freeze([]),
  };
}

function isExpectedPolicy(
  policy: SimulationGrossGrowthInput["drawPlan"]["policy"],
) {
  return (
    policy?.version === STATIONARY_BOOTSTRAP_POLICY.version &&
    policy.inputMatrixVersion ===
      STATIONARY_BOOTSTRAP_POLICY.inputMatrixVersion &&
    policy.samplingUnit === STATIONARY_BOOTSTRAP_POLICY.samplingUnit &&
    policy.startIndex === STATIONARY_BOOTSTRAP_POLICY.startIndex &&
    policy.restartProbability ===
      STATIONARY_BOOTSTRAP_POLICY.restartProbability &&
    policy.continuation === STATIONARY_BOOTSTRAP_POLICY.continuation &&
    policy.prng === STATIONARY_BOOTSTRAP_POLICY.prng &&
    policy.seedSource === STATIONARY_BOOTSTRAP_POLICY.seedSource &&
    policy.productionDefaults ===
      STATIONARY_BOOTSTRAP_POLICY.productionDefaults &&
    policy.outputKind === STATIONARY_BOOTSTRAP_POLICY.outputKind &&
    policy.maxPlannedDraws === STATIONARY_BOOTSTRAP_POLICY.maxPlannedDraws
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function blocked(reasons: readonly SimulationGrossGrowthBlockerReason[]) {
  return { validated: null, blockers: sortBlockers(reasons) };
}

function sortBlockers(
  reasons: readonly SimulationGrossGrowthBlockerReason[],
) {
  return Object.freeze(
    [...new Set(reasons)]
      .sort()
      .map((reason) => Object.freeze({ reason })),
  );
}
