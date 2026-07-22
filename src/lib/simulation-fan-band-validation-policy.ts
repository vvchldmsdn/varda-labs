import { FIXED_MIX_RESEARCH_SIMULATION_POLICY } from "./simulation-fixed-mix-research-context.ts";
import { STATIONARY_BOOTSTRAP_POLICY } from "./simulation-stationary-bootstrap-policy.ts";

export const SIMULATION_FAN_BAND_VALIDATION_POLICY = Object.freeze({
  version: "stationary_fan_band_validation_history_v1",
  endpointCount: 7,
  endpointPolicy: "explicit_end_and_previous_six_calendar_service_dates",
  trainingReturnStepCount: 90,
  outcomeReturnStepCount: 63,
  sourceReturnStepCount: 153,
  scenarioId: "research-kodex-voo-equal-mix-fan-band-validation",
  scenarioVersion: "v1",
  scenario:
    "KODEX200_5000bps_VOO_5000bps_initial_weight_buy_and_hold_no_rebalancing",
  bootstrapPolicyVersion: STATIONARY_BOOTSTRAP_POLICY.version,
  bootstrapModel:
    FIXED_MIX_RESEARCH_SIMULATION_POLICY.bootstrapModel,
  pathCount: FIXED_MIX_RESEARCH_SIMULATION_POLICY.pathCount,
  expectedBlockLength:
    FIXED_MIX_RESEARCH_SIMULATION_POLICY.expectedBlockLength,
  seed: FIXED_MIX_RESEARCH_SIMULATION_POLICY.seed,
  band: "terminal_P10_to_P90_inclusive",
  medianError: "absolute_terminal_return_percentage_point_error",
  overlapDisclosure: "overlapping_windows_not_independent_trials",
  missingEndpointPolicy:
    "preserve_ready_rows_and_mark_only_missing_row_unavailable",
  endpointRanking: "forbidden",
  hyperparameterSelection: "forbidden",
  automaticEndpointFallback: "forbidden",
  providerBackfill: "forbidden",
  accountBinding: "forbidden",
  currentHoldingBinding: "forbidden",
  targetBinding: "forbidden",
  recommendation: "forbidden",
  persistence: "forbidden",
  interpretation:
    "retrospective_research_diagnostic_not_forecast_or_calibration_pass_fail",
} as const);
