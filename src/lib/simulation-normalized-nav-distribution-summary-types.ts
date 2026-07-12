import type { SimulationNormalizedNavResult } from "./simulation-normalized-nav-types.ts";
import type { SimulationNormalizedNavDistributionSummaryPolicy } from "./simulation-normalized-nav-distribution-summary-policy.ts";

export type SimulationNormalizedNavDistributionSummaryBlockerReason =
  | "input_nav_not_ready"
  | "input_nav_runtime_trust_invalid"
  | "input_nav_policy_mismatch"
  | "expected_binding_invalid"
  | "scenario_vector_hash_mismatch"
  | "input_matrix_hash_mismatch"
  | "draw_plan_hash_mismatch"
  | "input_nav_shape_invalid"
  | "summary_output_too_large"
  | "invalid_nav"
  | "invalid_quantile";

export type SimulationNormalizedNavDistributionSummaryBlocker = Readonly<{
  reason: SimulationNormalizedNavDistributionSummaryBlockerReason;
}>;

export type SimulationNormalizedNavDistributionSummaryExpectedBinding =
  Readonly<{
    expectedScenarioVectorHash: string;
    expectedInputMatrixHash: string;
    expectedDrawPlanHash: string;
  }>;

export type SimulationNormalizedNavDistributionSummaryInput = Readonly<{
  normalizedNav: SimulationNormalizedNavResult;
  expectedBinding: SimulationNormalizedNavDistributionSummaryExpectedBinding;
}>;

export type SimulationNormalizedNavDistributionBand = Readonly<{
  stepIndex: number;
  p10: number;
  p50: number;
  p90: number;
}>;

export type SimulationNormalizedNavDistributionSummaryReadyResult = Readonly<{
  summaryStatus: "ready";
  runtimeTrustStatus: "not_established";
  policy: SimulationNormalizedNavDistributionSummaryPolicy;
  scenarioId: string;
  scenarioVersion: string;
  scenarioVectorHash: string;
  inputMatrixHash: string;
  drawPlanHash: string;
  horizon: number;
  pathCount: number;
  totalPointCount: number;
  stepBands: readonly SimulationNormalizedNavDistributionBand[];
  terminalSummary: SimulationNormalizedNavDistributionBand;
  blockers: readonly [];
}>;

export type SimulationNormalizedNavDistributionSummaryBlockedResult =
  Readonly<{
    summaryStatus: "blocked";
    runtimeTrustStatus: "not_established";
    policy: SimulationNormalizedNavDistributionSummaryPolicy;
    scenarioId: null;
    scenarioVersion: null;
    scenarioVectorHash: null;
    inputMatrixHash: null;
    drawPlanHash: null;
    horizon: 0;
    pathCount: 0;
    totalPointCount: 0;
    stepBands: readonly [];
    terminalSummary: null;
    blockers: readonly SimulationNormalizedNavDistributionSummaryBlocker[];
  }>;

export type SimulationNormalizedNavDistributionSummaryResult =
  | SimulationNormalizedNavDistributionSummaryReadyResult
  | SimulationNormalizedNavDistributionSummaryBlockedResult;

export type ValidatedSimulationNormalizedNavDistributionSummaryInput =
  Readonly<{
    normalizedNav: SimulationNormalizedNavResult;
    scenarioId: string;
    scenarioVersion: string;
    scenarioVectorHash: string;
    inputMatrixHash: string;
    drawPlanHash: string;
    horizon: number;
    pathCount: number;
    totalPointCount: number;
  }>;

export type SimulationNormalizedNavDistributionSummaryValidationResult =
  Readonly<{
    validated: ValidatedSimulationNormalizedNavDistributionSummaryInput | null;
    blockers: readonly SimulationNormalizedNavDistributionSummaryBlocker[];
  }>;
