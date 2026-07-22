import { SIMULATION_FAN_BAND_VALIDATION_POLICY } from "./simulation-fan-band-validation-policy.ts";

export const SIMULATION_DOWNSIDE_OUTCOME_VALIDATION_POLICY = Object.freeze({
  version: "stationary_downside_outcome_validation_v1",
  sourcePolicyVersion: SIMULATION_FAN_BAND_VALIDATION_POLICY.version,
  completePathCount: SIMULATION_FAN_BAND_VALIDATION_POLICY.pathCount,
  terminalLoss: "terminal_nav_strictly_below_one",
  predictedLossProbability: "complete_path_loss_count_divided_by_path_count",
  predictedMaxDrawdownQuantiles: "type_7_P50_and_P90",
  observedMaxDrawdown:
    "initial_weight_buy_and_hold_running_peak_over_exact_63_outcome_rows",
  p90Comparison: "descriptive_actual_mdd_at_or_below_predicted_P90",
  overlapDisclosure: "overlapping_windows_not_independent_trials",
  calibrationPassFail: "forbidden",
  modelRanking: "forbidden",
  hyperparameterSelection: "forbidden",
  recommendation: "forbidden",
  interpretation:
    "retrospective_downside_diagnostic_not_forecast_or_calibration_pass_fail",
} as const);
