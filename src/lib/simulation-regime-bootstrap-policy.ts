export const SIMULATION_REGIME_FACTOR_DEFINITIONS = Object.freeze([
  Object.freeze({ factorKey: "usdkrw", label: "USD/KRW" }),
  Object.freeze({ factorKey: "us_10y_yield", label: "US 10Y yield" }),
  Object.freeze({ factorKey: "us_10y2y_curve", label: "US 10Y-2Y curve" }),
] as const);

export const SIMULATION_REGIME_BOOTSTRAP_POLICY = Object.freeze({
  version: "regime_bootstrap_research_v1",
  inputMatrixVersion: "simulation_return_matrix_v1",
  sourceReturnStepCount: 120,
  requiredFactorCount: 3,
  factorMetrics: Object.freeze(["value", "volatility_20d_pct"] as const),
  factorAsOfPolicy: "latest_release_date_lte_state_date",
  factorObservedAtRole: "import_provenance_only_not_availability_authority",
  factorMaxCarryDays: 7,
  minimumAlignedRegimeRows: 120,
  minimumCandidateRows: 20,
  neighborCount: 40,
  minimumInformativeFeatures: 3,
  featureScaling: "median_mad_with_standard_deviation_fallback",
  distance: "mean_squared_robust_scaled_euclidean",
  neighborWeighting: "gaussian_kernel_over_nearest_neighbors",
  minimumBlockLength: 5,
  maximumBlockLength: 20,
  horizon: 63,
  pathCount: 500,
  samplePathCount: 12,
  seed: 0x52454749,
  prng: "mulberry32_v1",
  samplingUnit: "whole_cross_market_return_row",
  currentStatePolicy: "selected_end_service_date_only",
  portfolioPath: "gross_normalized_buy_and_hold_no_rebalancing",
  commonRandomNumbers: "single_draw_plan_shared_by_all_scenarios",
  persistence: "forbidden",
  fallback: "forbidden",
  accountBinding: "forbidden",
  currentHoldingsBinding: "forbidden",
  recommendation: "forbidden",
  optimizer: "forbidden",
  interpretation: "research_distribution_not_forecast",
} as const);

export type SimulationRegimeFactorKey =
  (typeof SIMULATION_REGIME_FACTOR_DEFINITIONS)[number]["factorKey"];

export type SimulationRegimeFactorObservation = Readonly<{
  factorKey: string;
  factorDate: string;
  periodEndDate: string;
  releaseDate: string;
  value: number | string;
  volatility20dPct: number | string;
}>;

export type SimulationRegimeFactorSourceSummary = Readonly<{
  factorKey: SimulationRegimeFactorKey;
  label: string;
  latestReleaseDate: string | null;
  currentReleaseDate: string | null;
  currentCarryDays: number | null;
  alignedStateCount: number;
}>;
