import {
  SIMULATION_PORTFOLIO_PATH_GATE0_APPROVAL_COMMIT,
  SIMULATION_PORTFOLIO_PATH_POLICY_ID,
} from "./simulation-scenario-vector-review-serialization.ts";

export const SIMULATION_NORMALIZED_NAV_POLICY = Object.freeze({
  version: "simulation_normalized_nav_v1",
  inputGrossGrowthVersion: "simulation_gross_growth_v1",
  portfolioPathPolicyId: SIMULATION_PORTFOLIO_PATH_POLICY_ID,
  gate0ApprovalCommit: SIMULATION_PORTFOLIO_PATH_GATE0_APPROVAL_COMMIT,
  weightedSumAlgorithm: "neumaier_compensated_sum_v1",
  weightedSumOrder: "canonical_instrument_order",
  baseline: "literal_one_at_step_zero",
  runtimeTrustStatus: "not_established",
  maxNavPoints: 1_000_000,
  outputKind: "dimensionless_normalized_nav_paths",
  rebalancing: "forbidden",
  initialKrw: "forbidden",
  distributionSummary: "forbidden",
} as const);

export type SimulationNormalizedNavPolicy =
  typeof SIMULATION_NORMALIZED_NAV_POLICY;
