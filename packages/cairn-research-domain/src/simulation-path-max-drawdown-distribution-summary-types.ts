import type { SimulationPathMaxDrawdownDistributionSummaryPolicy } from "./simulation-path-max-drawdown-distribution-summary-policy.ts";
import type { SimulationPathMaxDrawdownResult } from "./simulation-path-max-drawdown-types.ts";

export type SimulationPathMaxDrawdownDistributionSummaryBlockerReason =
  | "input_drawdown_not_ready"
  | "input_drawdown_runtime_trust_invalid"
  | "input_drawdown_policy_mismatch"
  | "expected_binding_invalid"
  | "scenario_vector_hash_mismatch"
  | "input_matrix_hash_mismatch"
  | "draw_plan_hash_mismatch"
  | "input_drawdown_shape_invalid"
  | "input_drawdown_too_large"
  | "invalid_drawdown"
  | "invalid_quantile";

export type SimulationPathMaxDrawdownDistributionSummaryBlocker = Readonly<{
  reason: SimulationPathMaxDrawdownDistributionSummaryBlockerReason;
}>;

export type SimulationPathMaxDrawdownDistributionSummaryExpectedBinding =
  Readonly<{
    expectedScenarioVectorHash: string;
    expectedInputMatrixHash: string;
    expectedDrawPlanHash: string;
  }>;

export type SimulationPathMaxDrawdownDistributionSummaryInput = Readonly<{
  pathMaxDrawdown: SimulationPathMaxDrawdownResult;
  expectedBinding: SimulationPathMaxDrawdownDistributionSummaryExpectedBinding;
}>;

export type SimulationPathMaxDrawdownQuantiles = Readonly<{
  p50: number;
  p90: number;
}>;

export type SimulationPathMaxDrawdownDistributionSummaryReadyResult =
  Readonly<{
    summaryStatus: "ready";
    runtimeTrustStatus: "not_established";
    policy: SimulationPathMaxDrawdownDistributionSummaryPolicy;
    scenarioId: string;
    scenarioVersion: string;
    scenarioVectorHash: string;
    inputMatrixHash: string;
    drawPlanHash: string;
    horizon: number;
    pathCount: number;
    totalPointCount: number;
    maxDrawdownQuantiles: SimulationPathMaxDrawdownQuantiles;
    blockers: readonly [];
  }>;

export type SimulationPathMaxDrawdownDistributionSummaryBlockedResult =
  Readonly<{
    summaryStatus: "blocked";
    runtimeTrustStatus: "not_established";
    policy: SimulationPathMaxDrawdownDistributionSummaryPolicy;
    scenarioId: null;
    scenarioVersion: null;
    scenarioVectorHash: null;
    inputMatrixHash: null;
    drawPlanHash: null;
    horizon: 0;
    pathCount: 0;
    totalPointCount: 0;
    maxDrawdownQuantiles: null;
    blockers: readonly SimulationPathMaxDrawdownDistributionSummaryBlocker[];
  }>;

export type SimulationPathMaxDrawdownDistributionSummaryResult =
  | SimulationPathMaxDrawdownDistributionSummaryReadyResult
  | SimulationPathMaxDrawdownDistributionSummaryBlockedResult;

export type ValidatedSimulationPathMaxDrawdownDistributionSummaryInput =
  Readonly<{
    scenarioId: string;
    scenarioVersion: string;
    scenarioVectorHash: string;
    inputMatrixHash: string;
    drawPlanHash: string;
    horizon: number;
    pathCount: number;
    totalPointCount: number;
    drawdownValues: number[];
  }>;

export type SimulationPathMaxDrawdownDistributionSummaryValidationResult =
  Readonly<{
    validated: ValidatedSimulationPathMaxDrawdownDistributionSummaryInput | null;
    blockers: readonly SimulationPathMaxDrawdownDistributionSummaryBlocker[];
  }>;
