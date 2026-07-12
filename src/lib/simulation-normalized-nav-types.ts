import type { SimulationGrossGrowthResult } from "./simulation-gross-growth-types.ts";
import type { SimulationNormalizedNavPolicy } from "./simulation-normalized-nav-policy.ts";
import type { SimulationScenarioVectorRow } from "./simulation-scenario-vector-review-serialization.ts";

export type SimulationNormalizedNavBlockerReason =
  | "input_gross_growth_not_ready"
  | "input_gross_growth_policy_mismatch"
  | "input_gross_growth_shape_invalid"
  | "input_gross_growth_hash_invalid"
  | "expected_execution_binding_invalid"
  | "input_matrix_hash_mismatch"
  | "draw_plan_hash_mismatch"
  | "scenario_policy_mismatch"
  | "scenario_metadata_invalid"
  | "scenario_vector_invalid"
  | "scenario_vector_not_canonical"
  | "scenario_vector_hash_mismatch"
  | "instrument_order_mismatch"
  | "nav_output_too_large"
  | "invalid_growth_factor"
  | "invalid_weighted_term"
  | "invalid_nav";

export type SimulationNormalizedNavBlocker = Readonly<{
  reason: SimulationNormalizedNavBlockerReason;
}>;

export type SimulationNormalizedNavScenarioEvidence = Readonly<{
  portfolioPathPolicyId: string;
  gate0ApprovalCommit: string;
  scenarioId: string;
  scenarioVersion: string;
  canonicalVector: readonly SimulationScenarioVectorRow[];
  scenarioVectorHash: string;
}>;

export type SimulationNormalizedNavExpectedBinding = Readonly<{
  expectedInputMatrixHash: string;
  expectedDrawPlanHash: string;
}>;

export type SimulationNormalizedNavInput = Readonly<{
  grossGrowth: SimulationGrossGrowthResult;
  scenarioVector: SimulationNormalizedNavScenarioEvidence;
  expectedBinding: SimulationNormalizedNavExpectedBinding;
}>;

export type SimulationNormalizedNavPoint = Readonly<{
  stepIndex: number;
  drawStepIndex: number | null;
  sourceRowIndex: number | null;
  previousServiceDate: string | null;
  serviceDate: string | null;
  nav: number;
}>;

export type SimulationNormalizedNavPath = Readonly<{
  pathIndex: number;
  points: readonly SimulationNormalizedNavPoint[];
}>;

export type SimulationNormalizedNavResult = Readonly<{
  calculationStatus: "blocked" | "ready";
  runtimeTrustStatus: "not_established";
  policy: SimulationNormalizedNavPolicy;
  scenarioId: string | null;
  scenarioVersion: string | null;
  scenarioVectorHash: string | null;
  inputMatrixHash: string | null;
  drawPlanHash: string | null;
  horizon: number;
  pathCount: number;
  totalPointCount: number;
  totalNavCells: number;
  paths: readonly SimulationNormalizedNavPath[];
  blockers: readonly SimulationNormalizedNavBlocker[];
}>;

export type ValidatedSimulationNormalizedNavInput = Readonly<{
  grossGrowth: SimulationGrossGrowthResult & Readonly<{
    status: "ready";
    inputMatrixHash: string;
    drawPlanHash: string;
  }>;
  scenarioId: string;
  scenarioVersion: string;
  scenarioVectorHash: string;
  weightsBps: readonly number[];
  totalPointCount: number;
  totalNavCells: number;
}>;

export type SimulationNormalizedNavValidationResult = Readonly<{
  validated: ValidatedSimulationNormalizedNavInput | null;
  blockers: readonly SimulationNormalizedNavBlocker[];
}>;
