export const SIMULATION_PATH_RISK_INPUT_BLOCKER_ORDER = Object.freeze([
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
] as const);

export type SimulationPathRiskInputBlockerReason =
  (typeof SIMULATION_PATH_RISK_INPUT_BLOCKER_ORDER)[number];
