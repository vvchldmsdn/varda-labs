import { SIMULATION_NORMALIZED_NAV_POLICY } from "./simulation-normalized-nav-policy.ts";
import { SIMULATION_PATH_RISK_INPUT_BLOCKER_ORDER } from "./simulation-path-risk-input-policy.ts";

const MAX_PATH_DRAWDOWN_ROWS = Math.floor(
  SIMULATION_NORMALIZED_NAV_POLICY.maxNavPoints / 2,
);

export const SIMULATION_PATH_MAX_DRAWDOWN_BLOCKER_ORDER = Object.freeze([
  ...SIMULATION_PATH_RISK_INPUT_BLOCKER_ORDER,
  "invalid_drawdown",
] as const);

export const SIMULATION_PATH_MAX_DRAWDOWN_POLICY = Object.freeze({
  version: "simulation_path_max_drawdown_v1",
  inputNavVersion: SIMULATION_NORMALIZED_NAV_POLICY.version,
  drawdownAlgorithm: "running_peak_from_literal_step_zero_v1",
  drawdownDefinition: "one_minus_nav_div_running_peak_v1",
  signConvention: "nonnegative_loss_fraction",
  pathTreatment: "all_paths_or_block",
  resultTreatment: "per_path_only",
  runtimeTrustStatus: "not_established",
  maxInputNavPoints: SIMULATION_NORMALIZED_NAV_POLICY.maxNavPoints,
  maxPathDrawdownRows: MAX_PATH_DRAWDOWN_ROWS,
  pathDrawdownCardinality: "exactly_one_per_validated_path_v1",
  pathDrawdownLimitBehavior: "exact_or_block",
  outputKind: "dimensionless_per_path_max_drawdown",
} as const);

export type SimulationPathMaxDrawdownPolicy =
  typeof SIMULATION_PATH_MAX_DRAWDOWN_POLICY;
