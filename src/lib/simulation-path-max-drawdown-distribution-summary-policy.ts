import { SIMULATION_PATH_MAX_DRAWDOWN_POLICY } from "./simulation-path-max-drawdown-policy.ts";

export const SIMULATION_PATH_MAX_DRAWDOWN_DISTRIBUTION_SUMMARY_BLOCKER_ORDER =
  Object.freeze([
    "input_drawdown_not_ready",
    "input_drawdown_runtime_trust_invalid",
    "input_drawdown_policy_mismatch",
    "expected_binding_invalid",
    "scenario_vector_hash_mismatch",
    "input_matrix_hash_mismatch",
    "draw_plan_hash_mismatch",
    "input_drawdown_shape_invalid",
    "input_drawdown_too_large",
    "invalid_drawdown",
    "invalid_quantile",
  ] as const);

export const SIMULATION_PATH_MAX_DRAWDOWN_DISTRIBUTION_SUMMARY_POLICY =
  Object.freeze({
    version: "simulation_path_max_drawdown_distribution_summary_v1",
    inputDrawdownVersion: SIMULATION_PATH_MAX_DRAWDOWN_POLICY.version,
    quantileAlgorithm: "hyndman_fan_type_7_v1",
    quantileProbabilities: Object.freeze([0.5, 0.9] as const),
    pathTreatment: "all_paths_or_block",
    pathWeighting: "equal",
    drawdownDirection: "larger_is_worse",
    drawdownUnit: "dimensionless_loss_fraction",
    runtimeTrustStatus: "not_established",
    maxInputPathDrawdownRows:
      SIMULATION_PATH_MAX_DRAWDOWN_POLICY.maxPathDrawdownRows,
    outputKind: "dimensionless_empirical_max_drawdown_quantile_summary",
  } as const);

export type SimulationPathMaxDrawdownDistributionSummaryPolicy =
  typeof SIMULATION_PATH_MAX_DRAWDOWN_DISTRIBUTION_SUMMARY_POLICY;
