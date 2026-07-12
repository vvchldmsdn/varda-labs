import type { SimulationNormalizedNavResult } from "./simulation-normalized-nav-types.ts";
import type { SimulationTerminalLossProbabilityPolicy } from "./simulation-terminal-loss-probability-policy.ts";

export type SimulationTerminalLossProbabilityBlockerReason =
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
  | "invalid_terminal_loss_count"
  | "invalid_terminal_loss_probability";

export type SimulationTerminalLossProbabilityBlocker = Readonly<{
  reason: SimulationTerminalLossProbabilityBlockerReason;
}>;

export type SimulationTerminalLossProbabilityExpectedBinding = Readonly<{
  expectedScenarioVectorHash: string;
  expectedInputMatrixHash: string;
  expectedDrawPlanHash: string;
}>;

export type SimulationTerminalLossProbabilityInput = Readonly<{
  normalizedNav: SimulationNormalizedNavResult;
  expectedBinding: SimulationTerminalLossProbabilityExpectedBinding;
}>;

export type SimulationTerminalLossProbabilityReadyResult = Readonly<{
  lossStatus: "ready";
  runtimeTrustStatus: "not_established";
  policy: SimulationTerminalLossProbabilityPolicy;
  scenarioId: string;
  scenarioVersion: string;
  scenarioVectorHash: string;
  inputMatrixHash: string;
  drawPlanHash: string;
  horizon: number;
  pathCount: number;
  totalPointCount: number;
  lossPathCount: number;
  lossProbability: number;
  blockers: readonly [];
}>;

export type SimulationTerminalLossProbabilityBlockedResult = Readonly<{
  lossStatus: "blocked";
  runtimeTrustStatus: "not_established";
  policy: SimulationTerminalLossProbabilityPolicy;
  scenarioId: null;
  scenarioVersion: null;
  scenarioVectorHash: null;
  inputMatrixHash: null;
  drawPlanHash: null;
  horizon: 0;
  pathCount: 0;
  totalPointCount: 0;
  lossPathCount: 0;
  lossProbability: null;
  blockers: readonly SimulationTerminalLossProbabilityBlocker[];
}>;

export type SimulationTerminalLossProbabilityResult =
  | SimulationTerminalLossProbabilityReadyResult
  | SimulationTerminalLossProbabilityBlockedResult;

export type ValidatedSimulationTerminalLossProbabilityInput = Readonly<{
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

export type SimulationTerminalLossProbabilityValidationResult = Readonly<{
  validated: ValidatedSimulationTerminalLossProbabilityInput | null;
  blockers: readonly SimulationTerminalLossProbabilityBlocker[];
}>;
