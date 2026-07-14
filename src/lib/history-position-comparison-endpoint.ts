import type { PortfolioHistoryDisplayRow } from "./history-balance.ts";
import {
  HISTORY_POSITION_COMPARISON_POLICY,
  type HistoryPositionComparisonAccount,
  type HistoryPositionComparisonEndpoint,
  type HistoryPositionComparisonEndpointSummary,
  type HistoryPositionComparisonRawRow,
  type HistoryPositionComparisonRow,
} from "./history-position-comparison-contract.ts";

export type PreparedHistoryPosition = Readonly<{
  identity: string | null;
  evidenceStatus: HistoryPositionComparisonRow["evidenceStatus"];
  ticker: string | null;
  assetName: string;
  market: string | null;
  currency: string | null;
  referenceStatus: "stored_asset_reference" | "legacy_only";
  quantity: number | null;
  marketValueKrw: number | null;
}>;

export type PreparedHistoryPositionEndpoint = Readonly<{
  summary: HistoryPositionComparisonEndpointSummary;
  rows: readonly PreparedHistoryPosition[];
}>;

export function prepareHistoryPositionComparisonEndpoint({
  account,
  endpoint,
  portfolioRows,
  rawRows,
}: {
  account: HistoryPositionComparisonAccount;
  endpoint: HistoryPositionComparisonEndpoint;
  portfolioRows: readonly PortfolioHistoryDisplayRow[];
  rawRows: readonly HistoryPositionComparisonRawRow[];
}): PreparedHistoryPositionEndpoint {
  const portfolioCandidates = portfolioRows.filter(
    (row) =>
      row.rowKind === "stored" &&
      row.account === account &&
      row.snapshotDate === endpoint.snapshotDate &&
      row.source === endpoint.source,
  );
  if (portfolioCandidates.length !== 1) {
    return Object.freeze({
      summary: unavailableEndpointSummary(
        endpoint,
        portfolioCandidates.length === 0
          ? "no_matching_portfolio_snapshot"
          : "ambiguous_portfolio_snapshot",
        rawRows.length,
      ),
      rows: Object.freeze([]),
    });
  }

  const portfolio = portfolioCandidates[0];
  const compatibleRows = rawRows.filter(
    (row) =>
      row.account === account &&
      row.snapshotDate === endpoint.snapshotDate &&
      row.source === endpoint.source,
  );
  const incompatibleRowCount = rawRows.length - compatibleRows.length;
  if (compatibleRows.length === 0) {
    return Object.freeze({
      summary: Object.freeze({
        ...unavailableEndpointSummary(
          endpoint,
          "no_position_rows",
          rawRows.length,
        ),
        portfolioTotalMarketValueKrw: portfolio.totalMarketValue,
        portfolioCashValueKrw: portfolio.cashValue,
        incompatibleRowCount,
      }),
      rows: Object.freeze([]),
    });
  }

  const identityCounts = countStoredIdentities(compatibleRows);
  const projected = compatibleRows.map((row) =>
    projectStoredPosition(row, identityCounts),
  );
  projected.sort(comparePreparedPositions);

  const rowLimitExceeded =
    projected.length > HISTORY_POSITION_COMPARISON_POLICY.endpointRowLimit;
  const rows = projected.slice(
    0,
    HISTORY_POSITION_COMPARISON_POLICY.endpointRowLimit,
  );
  const valuedPositionCount = rows.filter(
    (row) => row.marketValueKrw !== null,
  ).length;
  const quantityPositionCount = rows.filter(
    (row) => row.quantity !== null,
  ).length;
  const duplicateIdentityCount = rows.filter(
    (row) => row.evidenceStatus === "duplicate_identity",
  ).length;
  const invalidIdentityCount = rows.filter(
    (row) => row.evidenceStatus === "invalid_identity",
  ).length;
  const positionMarketValueKrw =
    valuedPositionCount > 0
      ? rows.reduce((sum, row) => sum + (row.marketValueKrw ?? 0), 0)
      : null;
  const comparable =
    !rowLimitExceeded &&
    incompatibleRowCount === 0 &&
    duplicateIdentityCount === 0 &&
    invalidIdentityCount === 0 &&
    valuedPositionCount === rows.length;
  const reconciliation = reconcileValues({
    portfolioTotalMarketValueKrw: portfolio.totalMarketValue,
    positionMarketValueKrw,
    comparable,
  });
  const partial = !comparable || quantityPositionCount !== rows.length;

  return Object.freeze({
    summary: Object.freeze({
      snapshotDate: endpoint.snapshotDate,
      source: endpoint.source,
      status: partial ? "partial" : "ready",
      reason: partial ? "partial_evidence" : "ready",
      portfolioTotalMarketValueKrw: portfolio.totalMarketValue,
      portfolioCashValueKrw: portfolio.cashValue,
      positionMarketValueKrw,
      reconciliationStatus: reconciliation.status,
      reconciliationDifferenceKrw: reconciliation.differenceKrw,
      inputRowCount: rawRows.length,
      positionCount: rows.length,
      valuedPositionCount,
      quantityPositionCount,
      legacyOnlyCount: rows.filter(
        (row) => row.referenceStatus === "legacy_only",
      ).length,
      duplicateIdentityCount,
      invalidIdentityCount,
      incompatibleRowCount,
      rowLimitExceeded,
    }),
    rows: Object.freeze(rows),
  });
}

function countStoredIdentities(
  rows: readonly HistoryPositionComparisonRawRow[],
) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const identity = storedIdentity(row);
    if (identity) counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }
  return counts;
}

function projectStoredPosition(
  row: HistoryPositionComparisonRawRow,
  identityCounts: ReadonlyMap<string, number>,
): PreparedHistoryPosition {
  const identity = storedIdentity(row);
  const duplicateIdentity =
    identity !== null && (identityCounts.get(identity) ?? 0) > 1;
  return Object.freeze({
    identity,
    evidenceStatus:
      identity === null
        ? "invalid_identity"
        : duplicateIdentity
          ? "duplicate_identity"
          : "compared",
    ticker: cleanText(row.ticker),
    assetName: cleanText(row.assetName) ?? "이름 없음",
    market: cleanText(row.market),
    currency: cleanText(row.currency),
    referenceStatus: cleanText(row.assetId)
      ? "stored_asset_reference"
      : "legacy_only",
    quantity: finiteNumber(row.quantity),
    marketValueKrw: finiteNumber(row.marketValueKrw),
  });
}

function unavailableEndpointSummary(
  endpoint: HistoryPositionComparisonEndpoint,
  reason: HistoryPositionComparisonEndpointSummary["reason"],
  inputRowCount: number,
): HistoryPositionComparisonEndpointSummary {
  return Object.freeze({
    snapshotDate: endpoint.snapshotDate,
    source: endpoint.source,
    status: "unavailable",
    reason,
    portfolioTotalMarketValueKrw: null,
    portfolioCashValueKrw: null,
    positionMarketValueKrw: null,
    reconciliationStatus: "not_comparable",
    reconciliationDifferenceKrw: null,
    inputRowCount,
    positionCount: 0,
    valuedPositionCount: 0,
    quantityPositionCount: 0,
    legacyOnlyCount: 0,
    duplicateIdentityCount: 0,
    invalidIdentityCount: 0,
    incompatibleRowCount: 0,
    rowLimitExceeded: false,
  });
}

function comparePreparedPositions(
  left: PreparedHistoryPosition,
  right: PreparedHistoryPosition,
) {
  return (
    left.assetName.localeCompare(right.assetName) ||
    (left.ticker ?? "").localeCompare(right.ticker ?? "") ||
    (left.identity ?? "").localeCompare(right.identity ?? "")
  );
}

function reconcileValues({
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

function storedIdentity(row: HistoryPositionComparisonRawRow) {
  const legacyAssetId = cleanText(row.legacyAssetId);
  return legacyAssetId ? `legacy:${legacyAssetId}` : null;
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
