import { SIMULATION_NORMALIZED_NAV_POLICY } from "./simulation-normalized-nav-policy.ts";

export const SIMULATION_SPAGHETTI_PATH_SAMPLE_BLOCKER_ORDER = Object.freeze([
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
  "sample_count_invalid",
  "sample_count_exceeds_path_count",
  "sample_count_exceeds_limit",
  "sample_output_too_large",
  "invalid_selection",
] as const);

export const SIMULATION_SPAGHETTI_PATH_SAMPLE_POLICY = Object.freeze({
  version: "simulation_spaghetti_path_sample_v1",
  inputNavVersion: SIMULATION_NORMALIZED_NAV_POLICY.version,
  selectionAlgorithm: "canonical_index_even_spacing_v1",
  sampleCountSource: "caller_explicit",
  sampleCountBehavior: "exact_or_block",
  pathTreatment: "validate_all_then_select",
  pointTreatment: "complete_selected_paths",
  runtimeTrustStatus: "not_established",
  maxInputNavPoints: SIMULATION_NORMALIZED_NAV_POLICY.maxNavPoints,
  maxSelectedPaths: 64,
  maxOutputPoints: 16_384,
  outputKind: "dimensionless_deterministic_nav_path_subset",
} as const);

export type SimulationSpaghettiPathSamplePolicy =
  typeof SIMULATION_SPAGHETTI_PATH_SAMPLE_POLICY;
