import type { SimulationNormalizedNavResult } from "./simulation-normalized-nav-types.ts";
import type { SimulationSpaghettiPathSamplePolicy } from "./simulation-spaghetti-path-sampling-policy.ts";

export type SimulationSpaghettiPathSampleBlockerReason =
  | "input_nav_not_ready"
  | "input_nav_runtime_trust_invalid"
  | "input_nav_policy_mismatch"
  | "expected_binding_invalid"
  | "scenario_vector_hash_mismatch"
  | "input_matrix_hash_mismatch"
  | "draw_plan_hash_mismatch"
  | "input_nav_shape_invalid"
  | "input_nav_too_large"
  | "invalid_nav"
  | "sample_count_invalid"
  | "sample_count_exceeds_path_count"
  | "sample_count_exceeds_limit"
  | "sample_output_too_large"
  | "invalid_selection";

export type SimulationSpaghettiPathSampleBlocker = Readonly<{
  reason: SimulationSpaghettiPathSampleBlockerReason;
}>;

export type SimulationSpaghettiPathSampleExpectedBinding = Readonly<{
  expectedScenarioVectorHash: string;
  expectedInputMatrixHash: string;
  expectedDrawPlanHash: string;
}>;

export type SimulationSpaghettiPathSampleInput = Readonly<{
  normalizedNav: SimulationNormalizedNavResult;
  expectedBinding: SimulationSpaghettiPathSampleExpectedBinding;
  sampleCount: number;
}>;

export type SimulationSpaghettiPathSamplePoint = Readonly<{
  stepIndex: number;
  nav: number;
}>;

export type SimulationSpaghettiPathSamplePath = Readonly<{
  pathIndex: number;
  points: readonly SimulationSpaghettiPathSamplePoint[];
}>;

export type SimulationSpaghettiPathSampleReadyResult = Readonly<{
  sampleStatus: "ready";
  runtimeTrustStatus: "not_established";
  policy: SimulationSpaghettiPathSamplePolicy;
  scenarioId: string;
  scenarioVersion: string;
  scenarioVectorHash: string;
  inputMatrixHash: string;
  drawPlanHash: string;
  horizon: number;
  inputPathCount: number;
  selectedPathCount: number;
  totalInputPointCount: number;
  totalOutputPointCount: number;
  selectedPaths: readonly SimulationSpaghettiPathSamplePath[];
  blockers: readonly [];
}>;

export type SimulationSpaghettiPathSampleBlockedResult = Readonly<{
  sampleStatus: "blocked";
  runtimeTrustStatus: "not_established";
  policy: SimulationSpaghettiPathSamplePolicy;
  scenarioId: null;
  scenarioVersion: null;
  scenarioVectorHash: null;
  inputMatrixHash: null;
  drawPlanHash: null;
  horizon: 0;
  inputPathCount: 0;
  selectedPathCount: 0;
  totalInputPointCount: 0;
  totalOutputPointCount: 0;
  selectedPaths: readonly [];
  blockers: readonly SimulationSpaghettiPathSampleBlocker[];
}>;

export type SimulationSpaghettiPathSampleResult =
  | SimulationSpaghettiPathSampleReadyResult
  | SimulationSpaghettiPathSampleBlockedResult;

export type ValidatedSimulationSpaghettiPathSampleInput = Readonly<{
  normalizedNav: SimulationNormalizedNavResult;
  scenarioId: string;
  scenarioVersion: string;
  scenarioVectorHash: string;
  inputMatrixHash: string;
  drawPlanHash: string;
  horizon: number;
  inputPathCount: number;
  sampleCount: number;
  totalInputPointCount: number;
  totalOutputPointCount: number;
  selectedPathIndices: readonly number[];
}>;

export type SimulationSpaghettiPathSampleValidationResult = Readonly<{
  validated: ValidatedSimulationSpaghettiPathSampleInput | null;
  blockers: readonly SimulationSpaghettiPathSampleBlocker[];
}>;
