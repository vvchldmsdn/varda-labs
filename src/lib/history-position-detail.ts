import type {
  HistoryAccount,
  HistoryLane,
  PortfolioHistoryDisplayRow,
} from "./history-balance.ts";

export const HISTORY_POSITION_DETAIL_POLICY = Object.freeze({
  version: "stored_named_account_position_drilldown_v1",
  supportedAccounts: "brokerage_isa_irp_only",
  sourceMatch: "exact_snapshot_date_account_source",
  currentAssetFallback: "none",
  livePriceFallback: "none",
  interpolation: "none",
  rowLimit: 200,
} as const);

export const HISTORY_POSITION_DETAIL_QUERY_LIMIT =
  HISTORY_POSITION_DETAIL_POLICY.rowLimit + 1;

export type HistoryPositionAccount = Exclude<HistoryAccount, "all">;

export type HistoryPositionSelection =
  | Readonly<{
      status: "idle";
      reason: "not_requested";
    }>
  | Readonly<{
      status: "blocked";
      reason:
        | "invalid_parameters"
        | "named_account_required"
        | "portfolio_lane_required";
    }>
  | Readonly<{
      status: "requested";
      reason: "valid_selection";
      account: HistoryPositionAccount;
      snapshotDate: string;
      source: string;
    }>;

export type HistoryPositionRawRow = Readonly<{
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
  currentPrice: string | null;
  marketValueLocal: string | null;
  marketValueKrw: string | null;
  costKrw: string | null;
  pnlKrw: string | null;
  pnlPct: string | null;
  currentWeight: string | null;
  fxRate: string | null;
  priceSource: string | null;
  priceBasis: string | null;
}>;

export type HistoryPositionDisplayRow = Readonly<{
  ticker: string | null;
  assetName: string;
  market: string | null;
  currency: string | null;
  mappingStatus: "current_asset_mapped" | "legacy_only";
  evidenceStatus: "stored" | "duplicate_identity" | "invalid_identity";
  valuationStatus: "valued" | "missing_market_value";
  quantity: number | null;
  currentPrice: number | null;
  marketValueLocal: number | null;
  marketValueKrw: number | null;
  costKrw: number | null;
  pnlKrw: number | null;
  pnlPct: number | null;
  currentWeight: number | null;
  fxRate: number | null;
  priceSource: string | null;
  priceBasis: string | null;
}>;

export type HistoryPositionDetailModel = Readonly<{
  policy: typeof HISTORY_POSITION_DETAIL_POLICY;
  account: HistoryAccount;
  lane: HistoryLane;
  selection: HistoryPositionSelection;
  status: "idle" | "blocked" | "unavailable" | "partial" | "ready";
  reason:
    | HistoryPositionSelection["reason"]
    | "no_matching_portfolio_snapshot"
    | "no_position_rows"
    | "no_compatible_position_rows"
    | "partial_evidence"
    | "ready";
  snapshotDate: string | null;
  source: string | null;
  portfolioTotalMarketValueKrw: number | null;
  portfolioCashValueKrw: number | null;
  positionMarketValueKrw: number | null;
  reconciliationDifferenceKrw: number | null;
  reconciliationStatus: "matched" | "mismatch" | "not_comparable";
  inputPositionRowCount: number;
  positionCount: number;
  valuedPositionCount: number;
  legacyOnlyCount: number;
  duplicateIdentityCount: number;
  invalidIdentityCount: number;
  incompatibleRowCount: number;
  rowLimitExceeded: boolean;
  rows: readonly HistoryPositionDisplayRow[];
}>;

export function normalizeHistoryPositionSelection({
  account,
  lane,
  positionDate,
  positionSource,
}: {
  account: HistoryAccount;
  lane: HistoryLane;
  positionDate: string | string[] | undefined;
  positionSource: string | string[] | undefined;
}): HistoryPositionSelection {
  const requested =
    positionDate !== undefined || positionSource !== undefined;
  if (!requested) {
    return Object.freeze({ status: "idle", reason: "not_requested" });
  }
  if (account === "all") {
    return Object.freeze({
      status: "blocked",
      reason: "named_account_required",
    });
  }
  if (lane === "balance") {
    return Object.freeze({
      status: "blocked",
      reason: "portfolio_lane_required",
    });
  }
  if (
    Array.isArray(positionDate) ||
    Array.isArray(positionSource) ||
    !isStrictDate(positionDate) ||
    !isStrictSource(positionSource)
  ) {
    return Object.freeze({
      status: "blocked",
      reason: "invalid_parameters",
    });
  }

  return Object.freeze({
    status: "requested",
    reason: "valid_selection",
    account,
    snapshotDate: positionDate,
    source: positionSource,
  });
}

export function buildHistoryPositionDetail({
  account,
  lane,
  selection,
  portfolioRows,
  positionRows,
}: {
  account: HistoryAccount;
  lane: HistoryLane;
  selection: HistoryPositionSelection;
  portfolioRows: readonly PortfolioHistoryDisplayRow[];
  positionRows: readonly HistoryPositionRawRow[];
}): HistoryPositionDetailModel {
  if (selection.status !== "requested") {
    return emptyModel({
      account,
      lane,
      selection,
      status: selection.status,
      reason: selection.reason,
    });
  }

  const portfolio = portfolioRows.find(
    (row) =>
      row.rowKind === "stored" &&
      row.account === selection.account &&
      row.snapshotDate === selection.snapshotDate &&
      row.source === selection.source,
  );
  if (!portfolio) {
    return emptyModel({
      account,
      lane,
      selection,
      status: "unavailable",
      reason: "no_matching_portfolio_snapshot",
    });
  }

  const compatibleRows = positionRows.filter(
    (row) =>
      row.snapshotDate === selection.snapshotDate &&
      row.account === selection.account &&
      row.source === selection.source,
  );
  const incompatibleRowCount = positionRows.length - compatibleRows.length;
  if (compatibleRows.length === 0) {
    return emptyModel({
      account,
      lane,
      selection,
      status: "unavailable",
      reason:
        positionRows.length > 0
          ? "no_compatible_position_rows"
          : "no_position_rows",
      snapshotDate: portfolio.snapshotDate,
      source: portfolio.source,
      portfolioTotalMarketValueKrw: portfolio.totalMarketValue,
      portfolioCashValueKrw: portfolio.cashValue,
      inputPositionRowCount: positionRows.length,
      incompatibleRowCount,
    });
  }

  const identityCounts = new Map<string, number>();
  for (const row of compatibleRows) {
    const identity = internalIdentity(row);
    if (identity) {
      identityCounts.set(identity, (identityCounts.get(identity) ?? 0) + 1);
    }
  }

  const projected = compatibleRows.map((row) => {
    const identity = internalIdentity(row);
    const duplicateIdentity =
      identity !== null && (identityCounts.get(identity) ?? 0) > 1;
    const assetName = cleanText(row.assetName) ?? "이름 없음";
    const marketValueKrw = finiteNumber(row.marketValueKrw);

    return Object.freeze({
      ticker: cleanText(row.ticker),
      assetName,
      market: cleanText(row.market),
      currency: cleanText(row.currency),
      mappingStatus: row.assetId
        ? ("current_asset_mapped" as const)
        : ("legacy_only" as const),
      evidenceStatus:
        identity === null || assetName === "이름 없음"
          ? ("invalid_identity" as const)
          : duplicateIdentity
            ? ("duplicate_identity" as const)
            : ("stored" as const),
      valuationStatus:
        marketValueKrw === null
          ? ("missing_market_value" as const)
          : ("valued" as const),
      quantity: finiteNumber(row.quantity),
      currentPrice: finiteNumber(row.currentPrice),
      marketValueLocal: finiteNumber(row.marketValueLocal),
      marketValueKrw,
      costKrw: finiteNumber(row.costKrw),
      pnlKrw: finiteNumber(row.pnlKrw),
      pnlPct: finiteNumber(row.pnlPct),
      currentWeight: finiteNumber(row.currentWeight),
      fxRate: finiteNumber(row.fxRate),
      priceSource: cleanText(row.priceSource),
      priceBasis: cleanText(row.priceBasis),
    });
  });

  projected.sort(compareDisplayRows);
  const rowLimitExceeded =
    projected.length > HISTORY_POSITION_DETAIL_POLICY.rowLimit;
  const rows = projected.slice(0, HISTORY_POSITION_DETAIL_POLICY.rowLimit);
  const valuedRows = rows.filter((row) => row.marketValueKrw !== null);
  const positionMarketValueKrw =
    valuedRows.length > 0
      ? valuedRows.reduce(
          (sum, row) => sum + (row.marketValueKrw ?? 0),
          0,
        )
      : null;
  const duplicateIdentityCount = rows.filter(
    (row) => row.evidenceStatus === "duplicate_identity",
  ).length;
  const invalidIdentityCount = rows.filter(
    (row) => row.evidenceStatus === "invalid_identity",
  ).length;
  const legacyOnlyCount = rows.filter(
    (row) => row.mappingStatus === "legacy_only",
  ).length;
  const reconciliation = reconcileStoredValues({
    portfolioTotalMarketValueKrw: portfolio.totalMarketValue,
    positionMarketValueKrw,
    comparable:
      !rowLimitExceeded &&
      rows.length === compatibleRows.length &&
      valuedRows.length === rows.length,
  });
  const partial =
    rowLimitExceeded ||
    incompatibleRowCount > 0 ||
    duplicateIdentityCount > 0 ||
    invalidIdentityCount > 0 ||
    valuedRows.length !== rows.length;

  return Object.freeze({
    policy: HISTORY_POSITION_DETAIL_POLICY,
    account,
    lane,
    selection,
    status: partial ? "partial" : "ready",
    reason: partial ? "partial_evidence" : "ready",
    snapshotDate: portfolio.snapshotDate,
    source: portfolio.source,
    portfolioTotalMarketValueKrw: portfolio.totalMarketValue,
    portfolioCashValueKrw: portfolio.cashValue,
    positionMarketValueKrw,
    reconciliationDifferenceKrw: reconciliation.differenceKrw,
    reconciliationStatus: reconciliation.status,
    inputPositionRowCount: positionRows.length,
    positionCount: rows.length,
    valuedPositionCount: valuedRows.length,
    legacyOnlyCount,
    duplicateIdentityCount,
    invalidIdentityCount,
    incompatibleRowCount,
    rowLimitExceeded,
    rows: Object.freeze(rows),
  });
}

function emptyModel({
  account,
  lane,
  selection,
  status,
  reason,
  snapshotDate = null,
  source = null,
  portfolioTotalMarketValueKrw = null,
  portfolioCashValueKrw = null,
  inputPositionRowCount = 0,
  incompatibleRowCount = 0,
}: {
  account: HistoryAccount;
  lane: HistoryLane;
  selection: HistoryPositionSelection;
  status: HistoryPositionDetailModel["status"];
  reason: HistoryPositionDetailModel["reason"];
  snapshotDate?: string | null;
  source?: string | null;
  portfolioTotalMarketValueKrw?: number | null;
  portfolioCashValueKrw?: number | null;
  inputPositionRowCount?: number;
  incompatibleRowCount?: number;
}): HistoryPositionDetailModel {
  return Object.freeze({
    policy: HISTORY_POSITION_DETAIL_POLICY,
    account,
    lane,
    selection,
    status,
    reason,
    snapshotDate,
    source,
    portfolioTotalMarketValueKrw,
    portfolioCashValueKrw,
    positionMarketValueKrw: null,
    reconciliationDifferenceKrw: null,
    reconciliationStatus: "not_comparable",
    inputPositionRowCount,
    positionCount: 0,
    valuedPositionCount: 0,
    legacyOnlyCount: 0,
    duplicateIdentityCount: 0,
    invalidIdentityCount: 0,
    incompatibleRowCount,
    rowLimitExceeded: false,
    rows: Object.freeze([]),
  });
}

function reconcileStoredValues({
  portfolioTotalMarketValueKrw,
  positionMarketValueKrw,
  comparable,
}: {
  portfolioTotalMarketValueKrw: number | null;
  positionMarketValueKrw: number | null;
  comparable: boolean;
}) {
  if (
    !comparable ||
    portfolioTotalMarketValueKrw === null ||
    positionMarketValueKrw === null
  ) {
    return { status: "not_comparable" as const, differenceKrw: null };
  }
  const differenceKrw =
    positionMarketValueKrw - portfolioTotalMarketValueKrw;
  return {
    status:
      Math.abs(differenceKrw) <= 1
        ? ("matched" as const)
        : ("mismatch" as const),
    differenceKrw,
  };
}

function internalIdentity(row: HistoryPositionRawRow) {
  const assetId = cleanText(row.assetId);
  if (assetId) return `asset:${assetId}`;
  const legacyAssetId = cleanText(row.legacyAssetId);
  return legacyAssetId ? `legacy:${legacyAssetId}` : null;
}

function compareDisplayRows(
  left: HistoryPositionDisplayRow,
  right: HistoryPositionDisplayRow,
) {
  if (left.marketValueKrw !== null || right.marketValueKrw !== null) {
    if (left.marketValueKrw === null) return 1;
    if (right.marketValueKrw === null) return -1;
    if (left.marketValueKrw !== right.marketValueKrw) {
      return right.marketValueKrw - left.marketValueKrw;
    }
  }
  return (
    left.assetName.localeCompare(right.assetName) ||
    (left.ticker ?? "").localeCompare(right.ticker ?? "")
  );
}

function finiteNumber(value: string | number | null) {
  if (value === null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function cleanText(value: string | null) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function isStrictDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  );
}

function isStrictSource(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,99}$/.test(value)
  );
}
