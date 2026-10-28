import type {
  SimulationPathRiskExpectedBinding,
  SimulationPathRiskInput,
} from "./simulation-path-risk-input-validation.ts";
import type { SimulationPathMaxDrawdownPolicy } from "./simulation-path-max-drawdown-policy.ts";
import type { SimulationNormalizedNavResult } from "./simulation-normalized-nav-types.ts";

export type SimulationPathMaxDrawdownBlockerReason =
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
  | "invalid_drawdown";

export type SimulationPathMaxDrawdownBlocker = Readonly<{
  reason: SimulationPathMaxDrawdownBlockerReason;
}>;

export type SimulationPathMaxDrawdownExpectedBinding =
  SimulationPathRiskExpectedBinding;

export type SimulationPathMaxDrawdownInput = SimulationPathRiskInput;

export type SimulationPathMaxDrawdownRow = Readonly<{
  pathIndex: number;
  maxDrawdown: number;
}>;

export type SimulationPathMaxDrawdownReadyResult = Readonly<{
  drawdownStatus: "ready";
  runtimeTrustStatus: "not_established";
  policy: SimulationPathMaxDrawdownPolicy;
  scenarioId: string;
  scenarioVersion: string;
  scenarioVectorHash: string;
  inputMatrixHash: string;
  drawPlanHash: string;
  horizon: number;
  pathCount: number;
  totalPointCount: number;
  pathDrawdowns: readonly SimulationPathMaxDrawdownRow[];
  blockers: readonly [];
}>;

export type SimulationPathMaxDrawdownBlockedResult = Readonly<{
  drawdownStatus: "blocked";
  runtimeTrustStatus: "not_established";
  policy: SimulationPathMaxDrawdownPolicy;
  scenarioId: null;
  scenarioVersion: null;
  scenarioVectorHash: null;
  inputMatrixHash: null;
  drawPlanHash: null;
  horizon: 0;
  pathCount: 0;
  totalPointCount: 0;
  pathDrawdowns: readonly [];
  blockers: readonly SimulationPathMaxDrawdownBlocker[];
}>;

export type SimulationPathMaxDrawdownResult =
  | SimulationPathMaxDrawdownReadyResult
  | SimulationPathMaxDrawdownBlockedResult;

export type ValidatedSimulationPathMaxDrawdownInput = Readonly<{
  normalizedNav: SimulationNormalizedNavResult;
  scenarioId: string;
  scenarioVersion: string;
  scenarioVectorHash: string;
  inputMatrixHash: string;
  drawPlanHash: string;
  horizon: number;
  pathCount: number;
  totalPointCount: number;
  derivedMaxPathDrawdownRows: number;
}>;

export type SimulationPathMaxDrawdownValidationResult = Readonly<{
  validated: ValidatedSimulationPathMaxDrawdownInput | null;
  blockers: readonly SimulationPathMaxDrawdownBlocker[];
}>;
