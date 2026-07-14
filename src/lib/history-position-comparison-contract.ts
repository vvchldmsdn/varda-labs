import type {
  HistoryAccount,
  HistoryLane,
} from "./history-balance.ts";

export const HISTORY_POSITION_COMPARISON_POLICY = Object.freeze({
  version: "stored_named_account_position_change_v1",
  supportedAccounts: "brokerage_isa_irp_only",
  endpointMatch: "exact_snapshot_date_account_source",
  sourceMatch: "same_exact_stored_source",
  identityBasis: "exact_stored_legacy_asset_id",
  currentAssetFallback: "none",
  livePriceFallback: "none",
  fxReconstruction: "none",
  interpolation: "none",
  endpointRowLimit: 200,
} as const);

export const HISTORY_POSITION_COMPARISON_QUERY_LIMIT =
  HISTORY_POSITION_COMPARISON_POLICY.endpointRowLimit + 1;

export type HistoryPositionComparisonAccount = Exclude<HistoryAccount, "all">;

export type HistoryPositionComparisonEndpoint = Readonly<{
  snapshotDate: string;
  source: string;
}>;

export type HistoryPositionComparisonSelection =
  | Readonly<{ status: "idle"; reason: "not_requested" }>
  | Readonly<{
      status: "blocked";
      reason:
        | "invalid_parameters"
        | "named_account_required"
        | "portfolio_lane_required"
        | "same_source_required"
        | "chronological_order_required";
    }>
  | Readonly<{
      status: "requested";
      reason: "valid_selection";
      account: HistoryPositionComparisonAccount;
      from: HistoryPositionComparisonEndpoint;
      to: HistoryPositionComparisonEndpoint;
    }>;

export type HistoryPositionComparisonRawRow = Readonly<{
  snapshotDate: string;
  account: string;
  source: string;
  assetId: string | null;
  legacyAssetId: string | null;
  ticker: string | null;
  assetName: string;
  market: string | null;
  currency: string | null;
  quantity: string | null;
  marketValueKrw: string | null;
}>;

export type HistoryPositionComparisonOption = Readonly<{
  token: string;
  snapshotDate: string;
  source: string;
}>;

export type HistoryPositionComparisonEndpointSummary = Readonly<{
  snapshotDate: string;
  source: string;
  status: "unavailable" | "partial" | "ready";
  reason:
    | "no_matching_portfolio_snapshot"
    | "ambiguous_portfolio_snapshot"
    | "no_position_rows"
    | "partial_evidence"
    | "ready";
  portfolioTotalMarketValueKrw: number | null;
  portfolioCashValueKrw: number | null;
  positionMarketValueKrw: number | null;
  reconciliationStatus: "matched" | "mismatch" | "not_comparable";
  reconciliationDifferenceKrw: number | null;
  inputRowCount: number;
  positionCount: number;
  valuedPositionCount: number;
  quantityPositionCount: number;
  legacyOnlyCount: number;
  duplicateIdentityCount: number;
  invalidIdentityCount: number;
  incompatibleRowCount: number;
  rowLimitExceeded: boolean;
}>;

export type HistoryPositionChangeReason =
  | "presence"
  | "quantity"
  | "market_value"
  | "reference_status"
  | "display_metadata"
  | "unresolved_identity";

export type HistoryPositionComparisonRow = Readonly<{
  changeKind: "added" | "removed" | "changed" | "unchanged" | "unresolved";
  changeReasons: readonly HistoryPositionChangeReason[];
  evidenceStatus: "compared" | "duplicate_identity" | "invalid_identity";
  ticker: string | null;
  assetName: string;
  market: string | null;
  currency: string | null;
  fromReferenceStatus: "stored_asset_reference" | "legacy_only" | "none";
  toReferenceStatus: "stored_asset_reference" | "legacy_only" | "none";
  fromQuantity: number | null;
  toQuantity: number | null;
  quantityChange: number | null;
  fromMarketValueKrw: number | null;
  toMarketValueKrw: number | null;
  marketValueChangeKrw: number | null;
}>;

export type HistoryPositionComparisonModel = Readonly<{
  policy: typeof HISTORY_POSITION_COMPARISON_POLICY;
  account: HistoryAccount;
  lane: HistoryLane;
  selection: HistoryPositionComparisonSelection;
  status: "idle" | "blocked" | "unavailable" | "partial" | "ready";
  reason:
    | HistoryPositionComparisonSelection["reason"]
    | "comparison_endpoint_unavailable"
    | "partial_evidence"
    | "ready";
  options: readonly HistoryPositionComparisonOption[];
  from: HistoryPositionComparisonEndpointSummary | null;
  to: HistoryPositionComparisonEndpointSummary | null;
  rowCount: number;
  addedCount: number;
  removedCount: number;
  changedCount: number;
  unchangedCount: number;
  unresolvedCount: number;
  rows: readonly HistoryPositionComparisonRow[];
}>;
