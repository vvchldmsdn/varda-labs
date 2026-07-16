export const INVESTMENT_LAB_FOUNT_ACCOUNTS = [
  "brokerage",
  "isa",
  "irp",
] as const;

export const INVESTMENT_LAB_FOUNT_EXCLUSION_POLICY = Object.freeze({
  version: "fount_scope_adjusted_observed_path_v1",
  scope: "investment_lab_and_simulation_research_only",
  approvalAuthority: "explicit_static_owner_scope_decision",
  selectorBasis: "exact_snapshot_legacy_asset_id",
  subtractionAxis: "snapshot_date_account_source",
  arithmetic: "fixed_decimal_24_6",
  eventInvariant: "zero_excluded_or_unattributed_events_in_window",
  output: "separate_scope_adjusted_observed_path",
  originalAggregateMutation: "forbidden",
  excludedHoldingRetention: "forbidden",
  remainingHoldingRenormalization: "forbidden",
  runtimeIntegration: "not_established",
} as const);

export type InvestmentLabFountNamedAccount =
  (typeof INVESTMENT_LAB_FOUNT_ACCOUNTS)[number];
export type InvestmentLabFountDecimalInput = string | number;

export type InvestmentLabFountStaticBinding = Readonly<{
  selectorBasis: typeof INVESTMENT_LAB_FOUNT_EXCLUSION_POLICY.selectorBasis;
  snapshotLegacyAssetId: string;
  account: InvestmentLabFountNamedAccount;
}>;

export type InvestmentLabFountPortfolioRow = Readonly<{
  snapshotDate: string;
  account: string;
  source: string;
  totalMarketValueKrw: InvestmentLabFountDecimalInput;
}>;

export type InvestmentLabFountPositionRow = Readonly<{
  snapshotDate: string;
  account: string;
  source: string;
  snapshotLegacyAssetId: string | null;
  marketValueKrw: InvestmentLabFountDecimalInput;
}>;

export type InvestmentLabFountEventRow = Readonly<{
  eventDate: string;
  legacyAssetId: string | null;
}>;

export type InvestmentLabFountExclusionBlocker =
  | "invalid_static_exclusion_binding"
  | "invalid_service_date_axis"
  | "invalid_portfolio_evidence"
  | "portfolio_evidence_incomplete"
  | "portfolio_evidence_duplicate"
  | "portfolio_all_reconciliation_mismatch"
  | "invalid_position_identity_evidence"
  | "exclusion_evidence_missing"
  | "exclusion_evidence_duplicate"
  | "exclusion_axis_mismatch"
  | "invalid_exclusion_value"
  | "exclusion_value_exceeds_account_total"
  | "aggregate_value_overflow"
  | "invalid_event_evidence"
  | "excluded_holding_event_present"
  | "unattributed_event_present";

export type InvestmentLabFountAdjustedAccountRow = Readonly<{
  serviceDate: string;
  account: InvestmentLabFountNamedAccount;
  source: string;
  originalTotalMarketValueKrw: string;
  excludedMarketValueKrw: string;
  adjustedTotalMarketValueKrw: string;
}>;

export type InvestmentLabFountAdjustedPathRow = Readonly<{
  serviceDate: string;
  originalTotalMarketValueKrw: string;
  excludedMarketValueKrw: string;
  adjustedTotalMarketValueKrw: string;
}>;

export type InvestmentLabFountExclusionCoverage = Readonly<{
  serviceDateCount: number;
  sourcePortfolioRowCount: number;
  sourcePositionRowCount: number;
  inWindowEventRowCount: number;
  excludedHoldingEventRowCount: number;
  unattributedEventRowCount: number;
  reconciledAllRowCount: number;
  adjustedDateCount: number;
}>;

export type InvestmentLabFountExclusionResult =
  | Readonly<{
      status: "ready";
      policy: typeof INVESTMENT_LAB_FOUNT_EXCLUSION_POLICY;
      runtimeTrustStatus: "not_established";
      readinessStatus: "pure_result_ready_runtime_unbound";
      scenarioInitialCapitalKrw: string;
      accountRows: readonly InvestmentLabFountAdjustedAccountRow[];
      scopeAdjustedObservedPath: readonly InvestmentLabFountAdjustedPathRow[];
      coverage: InvestmentLabFountExclusionCoverage;
      blockers: readonly [];
    }>
  | Readonly<{
      status: "blocked";
      policy: typeof INVESTMENT_LAB_FOUNT_EXCLUSION_POLICY;
      runtimeTrustStatus: "not_established";
      readinessStatus: "not_ready";
      scenarioInitialCapitalKrw: null;
      accountRows: readonly [];
      scopeAdjustedObservedPath: readonly [];
      coverage: InvestmentLabFountExclusionCoverage;
      blockers: readonly InvestmentLabFountExclusionBlocker[];
    }>;

export const INVESTMENT_LAB_FOUNT_BLOCKER_ORDER: readonly InvestmentLabFountExclusionBlocker[] = [
  "invalid_static_exclusion_binding",
  "invalid_service_date_axis",
  "invalid_portfolio_evidence",
  "portfolio_evidence_incomplete",
  "portfolio_evidence_duplicate",
  "portfolio_all_reconciliation_mismatch",
  "invalid_position_identity_evidence",
  "exclusion_evidence_missing",
  "exclusion_evidence_duplicate",
  "exclusion_axis_mismatch",
  "invalid_exclusion_value",
  "exclusion_value_exceeds_account_total",
  "aggregate_value_overflow",
  "invalid_event_evidence",
  "excluded_holding_event_present",
  "unattributed_event_present",
];
