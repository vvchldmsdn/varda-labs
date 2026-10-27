export const SIMULATION_TERMINAL_DOWNSIDE_TAIL_BLOCKER_ORDER = Object.freeze([
  "invalid_input_shape",
  "invalid_path_count",
  "invalid_terminal_return",
  "invalid_p5_return",
  "invalid_tail_mean_return",
] as const);

export const SIMULATION_TERMINAL_DOWNSIDE_TAIL_POLICY = Object.freeze({
  version: "simulation_terminal_downside_tail_summary_v2",
  supportedPathCounts: Object.freeze([500, 1000] as const),
  tailProbability: 0.05,
  returnDefinition: "terminal_nav_minus_literal_one_v1",
  p5Algorithm: "hyndman_fan_type_7_v1",
  tailSelection: "lowest_exact_five_percent_terminal_returns_v2",
  tiePolicy: "fixed_rank_count_without_boundary_expansion_v1",
  denominator: "five_percent_of_complete_path_count_v2",
  signConvention: "signed_return_negative_is_loss_v1",
  summationAlgorithm: "neumaier_compensated_sum_v1",
  pathTreatment: "all_supported_paths_or_block",
  runtimeTrustStatus: "not_established",
  outputKind: "dimensionless_terminal_return_tail_summary",
} as const);

export type SimulationTerminalDownsideTailPolicy =
  typeof SIMULATION_TERMINAL_DOWNSIDE_TAIL_POLICY;
