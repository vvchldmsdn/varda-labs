import type {
  SimulationGrossGrowthBlockerReason,
  SimulationGrossGrowthInput,
  SimulationGrossGrowthPath,
  SimulationGrossGrowthResult,
  ValidatedSimulationGrossGrowthInput,
} from "./simulation-gross-growth-types.ts";
import { validateSimulationGrossGrowthInput } from "./simulation-gross-growth-validation.ts";

export type {
  SimulationGrossGrowthBlocker,
  SimulationGrossGrowthBlockerReason,
  SimulationGrossGrowthFactor,
  SimulationGrossGrowthInput,
  SimulationGrossGrowthPath,
  SimulationGrossGrowthPoint,
  SimulationGrossGrowthResult,
} from "./simulation-gross-growth-types.ts";

export const SIMULATION_GROSS_GROWTH_POLICY = Object.freeze({
  version: "simulation_gross_growth_v1",
  inputMatrixVersion: "simulation_return_matrix_v1",
  inputDrawPlanVersion: "stationary_bootstrap_v1",
  baseline: "one_at_step_zero",
  compounding: "multiply_previous_by_one_plus_sampled_simple_return",
  resampling: "consume_draw_plan_without_resampling",
  outputKind: "per_instrument_gross_growth_factor_only",
  portfolioAggregation: "forbidden",
  distributionSummary: "forbidden",
  maxGrowthFactorCells: 1_000_000,
} as const);

export function materializeSimulationGrossGrowth(
  input: SimulationGrossGrowthInput,
): SimulationGrossGrowthResult {
  const validation = validateSimulationGrossGrowthInput(input);
  if (!validation.validated) {
    return blockedResult({
      inputMatrixHash: null,
      drawPlanHash: null,
      blockers: validation.blockers.map((item) => item.reason),
    });
  }

  const validated = validation.validated;
  const totalPointCount =
    validated.pathCount * (validated.horizon + 1);
  const totalGrowthFactorCells =
    totalPointCount * validated.instrumentKeys.length;
  if (
    !Number.isSafeInteger(totalPointCount) ||
    !Number.isSafeInteger(totalGrowthFactorCells) ||
    totalGrowthFactorCells >
      SIMULATION_GROSS_GROWTH_POLICY.maxGrowthFactorCells
  ) {
    return blockedResult({
      validated,
      totalPointCount,
      totalGrowthFactorCells,
      blockers: ["growth_output_too_large"],
    });
  }

  const materialized = materializePaths(validated);
  if (materialized.blocker) {
    return blockedResult({
      validated,
      totalPointCount,
      totalGrowthFactorCells,
      blockers: [materialized.blocker],
    });
  }

  return Object.freeze({
    status: "ready",
    policy: SIMULATION_GROSS_GROWTH_POLICY,
    inputMatrixHash: validated.inputMatrixHash,
    drawPlanHash: validated.drawPlanHash,
    instrumentKeys: validated.instrumentKeys,
    horizon: validated.horizon,
    pathCount: validated.pathCount,
    instrumentCount: validated.instrumentKeys.length,
    totalPointCount,
    totalGrowthFactorCells,
    paths: materialized.paths,
    blockers: Object.freeze([]),
  });
}

function materializePaths(validated: ValidatedSimulationGrossGrowthInput): {
  paths: readonly SimulationGrossGrowthPath[];
  blocker: SimulationGrossGrowthBlockerReason | null;
} {
  const paths: SimulationGrossGrowthPath[] = [];

  for (const path of validated.paths) {
    const cumulative = validated.instrumentKeys.map(() => 1);
    const points = [
      buildPoint({
        stepIndex: 0,
        drawStepIndex: null,
        sourceRowIndex: null,
        previousServiceDate: null,
        serviceDate: null,
        instrumentKeys: validated.instrumentKeys,
        values: cumulative,
      }),
    ];

    for (const draw of path.draws) {
      const sourceRow = validated.rows[draw.sourceRowIndex];
      for (let index = 0; index < cumulative.length; index += 1) {
        const sampledReturn = sourceRow.values[index];
        if (sampledReturn <= -1) {
          return { paths: Object.freeze([]), blocker: "invalid_sampled_return" };
        }
        const nextValue = cumulative[index] * (1 + sampledReturn);
        if (!Number.isFinite(nextValue) || nextValue < 0) {
          return { paths: Object.freeze([]), blocker: "invalid_growth_factor" };
        }
        cumulative[index] = nextValue;
      }

      points.push(
        buildPoint({
          stepIndex: draw.stepIndex + 1,
          drawStepIndex: draw.stepIndex,
          sourceRowIndex: draw.sourceRowIndex,
          previousServiceDate: draw.previousServiceDate,
          serviceDate: draw.serviceDate,
          instrumentKeys: validated.instrumentKeys,
          values: cumulative,
        }),
      );
    }

    paths.push(
      Object.freeze({
        pathIndex: path.pathIndex,
        points: Object.freeze(points),
      }),
    );
  }

  return { paths: Object.freeze(paths), blocker: null };
}

function buildPoint({
  stepIndex,
  drawStepIndex,
  sourceRowIndex,
  previousServiceDate,
  serviceDate,
  instrumentKeys,
  values,
}: {
  stepIndex: number;
  drawStepIndex: number | null;
  sourceRowIndex: number | null;
  previousServiceDate: string | null;
  serviceDate: string | null;
  instrumentKeys: readonly string[];
  values: readonly number[];
}) {
  return Object.freeze({
    stepIndex,
    drawStepIndex,
    sourceRowIndex,
    previousServiceDate,
    serviceDate,
    grossGrowthFactors: Object.freeze(
      instrumentKeys.map((instrumentKey, index) =>
        Object.freeze({ instrumentKey, value: values[index] }),
      ),
    ),
  });
}

function blockedResult({
  validated,
  inputMatrixHash = validated?.inputMatrixHash ?? null,
  drawPlanHash = validated?.drawPlanHash ?? null,
  totalPointCount = 0,
  totalGrowthFactorCells = 0,
  blockers,
}: {
  validated?: ValidatedSimulationGrossGrowthInput;
  inputMatrixHash?: string | null;
  drawPlanHash?: string | null;
  totalPointCount?: number;
  totalGrowthFactorCells?: number;
  blockers: readonly SimulationGrossGrowthBlockerReason[];
}): SimulationGrossGrowthResult {
  return Object.freeze({
    status: "blocked",
    policy: SIMULATION_GROSS_GROWTH_POLICY,
    inputMatrixHash,
    drawPlanHash,
    instrumentKeys: Object.freeze([]),
    horizon: validated?.horizon ?? 0,
    pathCount: validated?.pathCount ?? 0,
    instrumentCount: validated?.instrumentKeys.length ?? 0,
    totalPointCount: Number.isSafeInteger(totalPointCount)
      ? totalPointCount
      : 0,
    totalGrowthFactorCells: Number.isSafeInteger(totalGrowthFactorCells)
      ? totalGrowthFactorCells
      : 0,
    paths: Object.freeze([]),
    blockers: Object.freeze(
      [...new Set(blockers)]
        .sort()
        .map((reason) => Object.freeze({ reason })),
    ),
  });
}
