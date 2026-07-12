import { SIMULATION_NORMALIZED_NAV_POLICY } from "./simulation-normalized-nav-policy.ts";

export const SIMULATION_TERMINAL_LOSS_PROBABILITY_BLOCKER_ORDER = Object.freeze([
  "input_nav_not_ready",
  "input_nav_runtime_trust_invalid",
  "input_nav_policy_mismatch",
  "expected_binding_invalid",
  "scenario_vector_hash_mismatch",
  "input_matrix_hash_mismatch",
  "draw_plan_hash_mismatch",
  "input_nav_shape_invalid",
  "input_nav_too_large",
  "invalid_nav",
  "invalid_terminal_loss_count",
  "invalid_terminal_loss_probability",
] as const);

export const SIMULATION_TERMINAL_LOSS_PROBABILITY_POLICY = Object.freeze({
  version: "simulation_terminal_loss_probability_v1",
  inputNavVersion: SIMULATION_NORMALIZED_NAV_POLICY.version,
  lossDefinition: "strict_terminal_nav_below_literal_one_v1",
  probabilityDenominator: "all_validated_paths_v1",
  pathTreatment: "all_paths_or_block",
  runtimeTrustStatus: "not_established",
  maxInputNavPoints: SIMULATION_NORMALIZED_NAV_POLICY.maxNavPoints,
  outputKind: "dimensionless_terminal_loss_probability",
} as const);

export type SimulationTerminalLossProbabilityPolicy =
  typeof SIMULATION_TERMINAL_LOSS_PROBABILITY_POLICY;
