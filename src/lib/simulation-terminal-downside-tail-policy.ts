export const SIMULATION_TERMINAL_DOWNSIDE_TAIL_BLOCKER_ORDER = Object.freeze([
  "invalid_input_shape",
  "invalid_path_count",
  "invalid_terminal_return",
  "invalid_p5_return",
  "invalid_tail_mean_return",
] as const);

export const SIMULATION_TERMINAL_DOWNSIDE_TAIL_POLICY = Object.freeze({
  version: "simulation_terminal_downside_tail_summary_v1",
  requiredPathCount: 500,
  tailProbability: 0.05,
  tailPathCount: 25,
  returnDefinition: "terminal_nav_minus_literal_one_v1",
  p5Algorithm: "hyndman_fan_type_7_v1",
  tailSelection: "lowest_exact_25_terminal_returns_v1",
  tiePolicy: "fixed_rank_count_without_boundary_expansion_v1",
  denominator: "exact_25_selected_terminal_returns_v1",
  signConvention: "signed_return_negative_is_loss_v1",
  summationAlgorithm: "neumaier_compensated_sum_v1",
  pathTreatment: "all_500_paths_or_block",
  runtimeTrustStatus: "not_established",
  outputKind: "dimensionless_terminal_return_tail_summary",
} as const);

export type SimulationTerminalDownsideTailPolicy =
  typeof SIMULATION_TERMINAL_DOWNSIDE_TAIL_POLICY;
