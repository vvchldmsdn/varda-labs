import type { SimulationReturnMatrixResult } from "./simulation-return-matrix-types.ts";
import type { StationaryBootstrapDrawPlanResult } from "./simulation-stationary-bootstrap-types.ts";

export type SimulationGrossGrowthBlockerReason =
  | "input_matrix_not_ready"
  | "input_matrix_shape_invalid"
  | "input_draw_plan_not_ready"
  | "input_matrix_hash_mismatch"
  | "input_draw_plan_shape_invalid"
  | "input_draw_plan_hash_mismatch"
  | "growth_output_too_large"
  | "invalid_sampled_return"
  | "invalid_growth_factor";

export type SimulationGrossGrowthBlocker = Readonly<{
  reason: SimulationGrossGrowthBlockerReason;
}>;

export type SimulationGrossGrowthFactor = Readonly<{
  instrumentKey: string;
  value: number;
}>;

export type SimulationGrossGrowthPoint = Readonly<{
  stepIndex: number;
  drawStepIndex: number | null;
  sourceRowIndex: number | null;
  previousServiceDate: string | null;
  serviceDate: string | null;
  grossGrowthFactors: readonly SimulationGrossGrowthFactor[];
}>;

export type SimulationGrossGrowthPath = Readonly<{
  pathIndex: number;
  points: readonly SimulationGrossGrowthPoint[];
}>;

export type SimulationGrossGrowthResult = Readonly<{
  status: "blocked" | "ready";
  policy: Readonly<{
    version: "simulation_gross_growth_v1";
    inputMatrixVersion: "simulation_return_matrix_v1";
    inputDrawPlanVersion: "stationary_bootstrap_v1";
    baseline: "one_at_step_zero";
    compounding: "multiply_previous_by_one_plus_sampled_simple_return";
    resampling: "consume_draw_plan_without_resampling";
    outputKind: "per_instrument_gross_growth_factor_only";
    portfolioAggregation: "forbidden";
    distributionSummary: "forbidden";
    maxGrowthFactorCells: 1_000_000;
  }>;
  inputMatrixHash: string | null;
  drawPlanHash: string | null;
  instrumentKeys: readonly string[];
  horizon: number;
  pathCount: number;
  instrumentCount: number;
  totalPointCount: number;
  totalGrowthFactorCells: number;
  paths: readonly SimulationGrossGrowthPath[];
  blockers: readonly SimulationGrossGrowthBlocker[];
}>;

export type SimulationGrossGrowthInput = Readonly<{
  matrix: SimulationReturnMatrixResult;
  drawPlan: StationaryBootstrapDrawPlanResult;
}>;

export type ValidatedSimulationGrossGrowthInput = Readonly<{
  inputMatrixHash: string;
  drawPlanHash: string;
  instrumentKeys: readonly string[];
  rows: readonly Readonly<{
    previousServiceDate: string;
    serviceDate: string;
    values: readonly number[];
  }>[];
  horizon: number;
  pathCount: number;
  paths: readonly Readonly<{
    pathIndex: number;
    draws: readonly Readonly<{
      stepIndex: number;
      sourceRowIndex: number;
      previousServiceDate: string;
      serviceDate: string;
      blockStart: boolean;
    }>[];
  }>[];
}>;
