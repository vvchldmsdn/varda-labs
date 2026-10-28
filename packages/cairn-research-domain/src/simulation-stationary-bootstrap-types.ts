import type { SimulationReturnMatrixResult } from "./simulation-return-matrix-types.ts";

export type StationaryBootstrapBlockerReason =
  | "input_matrix_not_ready"
  | "input_matrix_shape_invalid"
  | "invalid_seed"
  | "invalid_expected_block_length"
  | "invalid_horizon"
  | "invalid_path_count"
  | "draw_plan_too_large";

export type StationaryBootstrapBlocker = Readonly<{
  reason: StationaryBootstrapBlockerReason;
}>;

export type StationaryBootstrapDraw = Readonly<{
  stepIndex: number;
  sourceRowIndex: number;
  previousServiceDate: string;
  serviceDate: string;
  blockStart: boolean;
}>;

export type StationaryBootstrapPath = Readonly<{
  pathIndex: number;
  draws: readonly StationaryBootstrapDraw[];
}>;

export type StationaryBootstrapDrawPlanResult = Readonly<{
  status: "blocked" | "ready";
  policy: Readonly<{
    version: "stationary_bootstrap_v1";
    inputMatrixVersion: "simulation_return_matrix_v1";
    samplingUnit: "whole_return_row";
    startIndex: "uniform";
    restartProbability: "one_over_expected_block_length";
    continuation: "circular_next_index";
    prng: "mulberry32_v1";
    seedSource: "explicit_uint32_only";
    productionDefaults: "forbidden";
    outputKind: "draw_plan_only";
    maxPlannedDraws: 1_000_000;
  }>;
  inputMatrixHash: string | null;
  drawPlanHash: string | null;
  seed: number | null;
  expectedBlockLength: number | null;
  restartProbability: number | null;
  horizon: number | null;
  pathCount: number | null;
  sourceRowCount: number;
  instrumentCount: number;
  totalPlannedDraws: number;
  paths: readonly StationaryBootstrapPath[];
  blockers: readonly StationaryBootstrapBlocker[];
}>;

export type StationaryBootstrapDrawPlanInput = Readonly<{
  matrix: SimulationReturnMatrixResult;
  seed: number;
  expectedBlockLength: number;
  horizon: number;
  pathCount: number;
}>;

export type CanonicalReadyReturnMatrix = Readonly<{
  inputMatrixHash: string;
  sourceRowCount: number;
  instrumentCount: number;
  rows: readonly Readonly<{
    previousServiceDate: string;
    serviceDate: string;
  }>[];
}>;
