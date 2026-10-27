import { SIMULATION_NORMALIZED_NAV_POLICY } from "./simulation-normalized-nav-policy.ts";

export const SIMULATION_NORMALIZED_NAV_DISTRIBUTION_SUMMARY_BLOCKER_ORDER =
  Object.freeze([
    "input_nav_not_ready",
    "input_nav_runtime_trust_invalid",
    "input_nav_policy_mismatch",
    "expected_binding_invalid",
    "scenario_vector_hash_mismatch",
    "input_matrix_hash_mismatch",
    "draw_plan_hash_mismatch",
    "input_nav_shape_invalid",
    "summary_output_too_large",
    "invalid_nav",
    "invalid_quantile",
  ] as const);

export const SIMULATION_NORMALIZED_NAV_DISTRIBUTION_SUMMARY_POLICY =
  Object.freeze({
    version: "simulation_normalized_nav_distribution_summary_v1",
    inputNavVersion: SIMULATION_NORMALIZED_NAV_POLICY.version,
    quantileAlgorithm: "hyndman_fan_type_7_v1",
    quantileProbabilities: Object.freeze([0.1, 0.5, 0.9] as const),
    pathTreatment: "all_paths_or_block",
    stepOrder: "increasing_step_index",
    baseline: "literal_one_band_at_step_zero",
    runtimeTrustStatus: "not_established",
    maxInputNavPoints: SIMULATION_NORMALIZED_NAV_POLICY.maxNavPoints,
    outputKind: "dimensionless_empirical_nav_quantile_summary",
  } as const);

export type SimulationNormalizedNavDistributionSummaryPolicy =
  typeof SIMULATION_NORMALIZED_NAV_DISTRIBUTION_SUMMARY_POLICY;
