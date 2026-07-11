import { createMulberry32, isUint32 } from "./simulation-prng.ts";
import {
  hashStationaryBootstrapDrawPlan,
  validateAndHashReadyReturnMatrix,
} from "./simulation-stationary-bootstrap-serialization.ts";
import type {
  StationaryBootstrapBlocker,
  StationaryBootstrapDrawPlanInput,
  StationaryBootstrapDrawPlanResult,
  StationaryBootstrapPath,
} from "./simulation-stationary-bootstrap-types.ts";

export type {
  StationaryBootstrapBlocker,
  StationaryBootstrapDraw,
  StationaryBootstrapDrawPlanInput,
  StationaryBootstrapDrawPlanResult,
  StationaryBootstrapPath,
} from "./simulation-stationary-bootstrap-types.ts";

export const STATIONARY_BOOTSTRAP_POLICY = Object.freeze({
  version: "stationary_bootstrap_v1",
  inputMatrixVersion: "simulation_return_matrix_v1",
  samplingUnit: "whole_return_row",
  startIndex: "uniform",
  restartProbability: "one_over_expected_block_length",
  continuation: "circular_next_index",
  prng: "mulberry32_v1",
  seedSource: "explicit_uint32_only",
  productionDefaults: "forbidden",
  outputKind: "draw_plan_only",
  maxPlannedDraws: 1_000_000,
} as const);

export function buildStationaryBootstrapDrawPlan(
  input: StationaryBootstrapDrawPlanInput,
): StationaryBootstrapDrawPlanResult {
  const matrixResult = validateAndHashReadyReturnMatrix(input.matrix);
  const canonical = matrixResult.canonical;
  const blockers: StationaryBootstrapBlocker[] = [...matrixResult.blockers];
  const validSeed = isUint32(input.seed);
  const validBlockLength =
    Number.isSafeInteger(input.expectedBlockLength) &&
    input.expectedBlockLength > 0 &&
    (!canonical || input.expectedBlockLength <= canonical.sourceRowCount);
  const validHorizon =
    Number.isSafeInteger(input.horizon) && input.horizon > 0;
  const validPathCount =
    Number.isSafeInteger(input.pathCount) && input.pathCount > 0;

  if (!validSeed) blockers.push({ reason: "invalid_seed" });
  if (!validBlockLength) {
    blockers.push({ reason: "invalid_expected_block_length" });
  }
  if (!validHorizon) blockers.push({ reason: "invalid_horizon" });
  if (!validPathCount) blockers.push({ reason: "invalid_path_count" });

  const totalPlannedDraws =
    validHorizon && validPathCount ? input.horizon * input.pathCount : 0;
  if (
    validHorizon &&
    validPathCount &&
    (!Number.isSafeInteger(totalPlannedDraws) ||
      totalPlannedDraws > STATIONARY_BOOTSTRAP_POLICY.maxPlannedDraws)
  ) {
    blockers.push({ reason: "draw_plan_too_large" });
  }

  const sortedBlockers = sortBlockers(blockers);
  if (sortedBlockers.length > 0 || !canonical) {
    return blockedPlan({
      canonical,
      seed: validSeed ? input.seed : null,
      expectedBlockLength: validBlockLength
        ? input.expectedBlockLength
        : null,
      horizon: validHorizon ? input.horizon : null,
      pathCount: validPathCount ? input.pathCount : null,
      totalPlannedDraws:
        Number.isSafeInteger(totalPlannedDraws) ? totalPlannedDraws : 0,
      blockers: sortedBlockers,
    });
  }

  const restartProbability = 1 / input.expectedBlockLength;
  const random = createMulberry32(input.seed);
  const paths: StationaryBootstrapPath[] = [];

  for (let pathIndex = 0; pathIndex < input.pathCount; pathIndex += 1) {
    const draws = [];
    let sourceRowIndex = uniformIndex(random, canonical.sourceRowCount);

    for (let stepIndex = 0; stepIndex < input.horizon; stepIndex += 1) {
      let blockStart = stepIndex === 0;
      if (stepIndex > 0) {
        if (random() < restartProbability) {
          sourceRowIndex = uniformIndex(random, canonical.sourceRowCount);
          blockStart = true;
        } else {
          sourceRowIndex = (sourceRowIndex + 1) % canonical.sourceRowCount;
        }
      }
      const sourceRow = canonical.rows[sourceRowIndex];
      draws.push(
        Object.freeze({
          stepIndex,
          sourceRowIndex,
          previousServiceDate: sourceRow.previousServiceDate,
          serviceDate: sourceRow.serviceDate,
          blockStart,
        }),
      );
    }
    paths.push(
      Object.freeze({
        pathIndex,
        draws: Object.freeze(draws),
      }),
    );
  }

  const frozenPaths = Object.freeze(paths);
  const drawPlanHash = hashStationaryBootstrapDrawPlan({
    inputMatrixHash: canonical.inputMatrixHash,
    seed: input.seed,
    expectedBlockLength: input.expectedBlockLength,
    horizon: input.horizon,
    pathCount: input.pathCount,
    paths: frozenPaths,
  });

  return Object.freeze({
    status: "ready",
    policy: STATIONARY_BOOTSTRAP_POLICY,
    inputMatrixHash: canonical.inputMatrixHash,
    drawPlanHash,
    seed: input.seed,
    expectedBlockLength: input.expectedBlockLength,
    restartProbability,
    horizon: input.horizon,
    pathCount: input.pathCount,
    sourceRowCount: canonical.sourceRowCount,
    instrumentCount: canonical.instrumentCount,
    totalPlannedDraws,
    paths: frozenPaths,
    blockers: Object.freeze([]),
  });
}

function blockedPlan({
  canonical,
  seed,
  expectedBlockLength,
  horizon,
  pathCount,
  totalPlannedDraws,
  blockers,
}: {
  canonical: ReturnType<
    typeof validateAndHashReadyReturnMatrix
  >["canonical"];
  seed: number | null;
  expectedBlockLength: number | null;
  horizon: number | null;
  pathCount: number | null;
  totalPlannedDraws: number;
  blockers: readonly StationaryBootstrapBlocker[];
}): StationaryBootstrapDrawPlanResult {
  return Object.freeze({
    status: "blocked",
    policy: STATIONARY_BOOTSTRAP_POLICY,
    inputMatrixHash: canonical?.inputMatrixHash ?? null,
    drawPlanHash: null,
    seed,
    expectedBlockLength,
    restartProbability:
      expectedBlockLength !== null ? 1 / expectedBlockLength : null,
    horizon,
    pathCount,
    sourceRowCount: canonical?.sourceRowCount ?? 0,
    instrumentCount: canonical?.instrumentCount ?? 0,
    totalPlannedDraws,
    paths: Object.freeze([]),
    blockers: Object.freeze([...blockers]),
  });
}

function uniformIndex(random: () => number, length: number) {
  return Math.floor(random() * length);
}

function sortBlockers(blockers: readonly StationaryBootstrapBlocker[]) {
  return Object.freeze(
    [...new Set(blockers.map((blocker) => blocker.reason))]
      .sort()
      .map((reason) => Object.freeze({ reason })),
  );
}
