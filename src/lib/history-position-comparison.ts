import type {
  HistoryAccount,
  HistoryLane,
  PortfolioHistoryDisplayRow,
} from "./history-balance.ts";
import {
  HISTORY_POSITION_COMPARISON_POLICY,
  type HistoryPositionComparisonEndpoint,
  type HistoryPositionComparisonEndpointSummary,
  type HistoryPositionComparisonModel,
  type HistoryPositionComparisonOption,
  type HistoryPositionComparisonRawRow,
  type HistoryPositionComparisonSelection,
} from "./history-position-comparison-contract.ts";
import { prepareHistoryPositionComparisonEndpoint } from "./history-position-comparison-endpoint.ts";
import {
  buildHistoryPositionChangeRows,
  countHistoryPositionChangeKind,
} from "./history-position-comparison-rows.ts";

export {
  HISTORY_POSITION_COMPARISON_POLICY,
  HISTORY_POSITION_COMPARISON_QUERY_LIMIT,
  type HistoryPositionChangeReason,
  type HistoryPositionComparisonAccount,
  type HistoryPositionComparisonEndpoint,
  type HistoryPositionComparisonEndpointSummary,
  type HistoryPositionComparisonModel,
  type HistoryPositionComparisonOption,
  type HistoryPositionComparisonRawRow,
  type HistoryPositionComparisonRow,
  type HistoryPositionComparisonSelection,
} from "./history-position-comparison-contract.ts";

export function normalizeHistoryPositionComparisonSelection({
  account,
  lane,
  comparisonFrom,
  comparisonTo,
}: {
  account: HistoryAccount;
  lane: HistoryLane;
  comparisonFrom: string | string[] | undefined;
  comparisonTo: string | string[] | undefined;
}): HistoryPositionComparisonSelection {
  const requested = comparisonFrom !== undefined || comparisonTo !== undefined;
  if (!requested) {
    return Object.freeze({ status: "idle", reason: "not_requested" });
  }
  if (account === "all") {
    return Object.freeze({
      status: "blocked",
      reason: "named_account_required",
    });
  }
  if (lane !== "all" && lane !== "portfolio") {
    return Object.freeze({
      status: "blocked",
      reason: "portfolio_lane_required",
    });
  }

  const from = parseEndpointToken(comparisonFrom);
  const to = parseEndpointToken(comparisonTo);
  if (!from || !to) {
    return Object.freeze({
      status: "blocked",
      reason: "invalid_parameters",
    });
  }
  if (from.source !== to.source) {
    return Object.freeze({
      status: "blocked",
      reason: "same_source_required",
    });
  }
  if (from.snapshotDate >= to.snapshotDate) {
    return Object.freeze({
      status: "blocked",
      reason: "chronological_order_required",
    });
  }

  return Object.freeze({
    status: "requested",
    reason: "valid_selection",
    account,
    from,
    to,
  });
}

export function buildHistoryPositionComparison({
  account,
  lane,
  selection,
  portfolioRows,
  fromRows,
  toRows,
}: {
  account: HistoryAccount;
  lane: HistoryLane;
  selection: HistoryPositionComparisonSelection;
  portfolioRows: readonly PortfolioHistoryDisplayRow[];
  fromRows: readonly HistoryPositionComparisonRawRow[];
  toRows: readonly HistoryPositionComparisonRawRow[];
}): HistoryPositionComparisonModel {
  const options = buildOptions(account, portfolioRows);
  if (selection.status !== "requested") {
    return emptyModel({
      account,
      lane,
      selection,
      status: selection.status,
      reason: selection.reason,
      options,
    });
  }

  const from = prepareHistoryPositionComparisonEndpoint({
    account: selection.account,
    endpoint: selection.from,
    portfolioRows,
    rawRows: fromRows,
  });
  const to = prepareHistoryPositionComparisonEndpoint({
    account: selection.account,
    endpoint: selection.to,
    portfolioRows,
    rawRows: toRows,
  });

  if (
    from.summary.status === "unavailable" ||
    to.summary.status === "unavailable"
  ) {
    return emptyModel({
      account,
      lane,
      selection,
      status: "unavailable",
      reason: "comparison_endpoint_unavailable",
      options,
      from: from.summary,
      to: to.summary,
    });
  }

  const rows = buildHistoryPositionChangeRows(from.rows, to.rows);
  const unresolvedCount = countHistoryPositionChangeKind(rows, "unresolved");
  const partial =
    from.summary.status === "partial" ||
    to.summary.status === "partial" ||
    unresolvedCount > 0;

  return Object.freeze({
    policy: HISTORY_POSITION_COMPARISON_POLICY,
    account,
    lane,
    selection,
    status: partial ? "partial" : "ready",
    reason: partial ? "partial_evidence" : "ready",
    options,
    from: from.summary,
    to: to.summary,
    rowCount: rows.length,
    addedCount: countHistoryPositionChangeKind(rows, "added"),
    removedCount: countHistoryPositionChangeKind(rows, "removed"),
    changedCount: countHistoryPositionChangeKind(rows, "changed"),
    unchangedCount: countHistoryPositionChangeKind(rows, "unchanged"),
    unresolvedCount,
    rows,
  });
}

export function historyPositionComparisonToken(
  endpoint: HistoryPositionComparisonEndpoint,
) {
  return `${endpoint.snapshotDate}~${endpoint.source}`;
}

function buildOptions(
  account: HistoryAccount,
  portfolioRows: readonly PortfolioHistoryDisplayRow[],
) {
  if (account === "all") return Object.freeze([]);
  const options = new Map<string, HistoryPositionComparisonOption>();
  for (const row of portfolioRows) {
    if (row.account !== account || row.rowKind !== "stored") continue;
    const endpoint = { snapshotDate: row.snapshotDate, source: row.source };
    const token = historyPositionComparisonToken(endpoint);
    options.set(token, Object.freeze({ token, ...endpoint }));
  }
  return Object.freeze(
    [...options.values()].sort(
      (left, right) =>
        right.snapshotDate.localeCompare(left.snapshotDate) ||
        left.source.localeCompare(right.source),
    ),
  );
}

function parseEndpointToken(value: string | string[] | undefined) {
  if (typeof value !== "string") return null;
  const separator = value.indexOf("~");
  if (separator <= 0 || separator !== value.lastIndexOf("~")) return null;
  const snapshotDate = value.slice(0, separator);
  const source = value.slice(separator + 1);
  if (!isStrictDate(snapshotDate) || !isStrictSource(source)) return null;
  return Object.freeze({ snapshotDate, source });
}

function emptyModel({
  account,
  lane,
  selection,
  status,
  reason,
  options,
  from = null,
  to = null,
}: {
  account: HistoryAccount;
  lane: HistoryLane;
  selection: HistoryPositionComparisonSelection;
  status: HistoryPositionComparisonModel["status"];
  reason: HistoryPositionComparisonModel["reason"];
  options: readonly HistoryPositionComparisonOption[];
  from?: HistoryPositionComparisonEndpointSummary | null;
  to?: HistoryPositionComparisonEndpointSummary | null;
}): HistoryPositionComparisonModel {
  return Object.freeze({
    policy: HISTORY_POSITION_COMPARISON_POLICY,
    account,
    lane,
    selection,
    status,
    reason,
    options,
    from,
    to,
    rowCount: 0,
    addedCount: 0,
    removedCount: 0,
    changedCount: 0,
    unchangedCount: 0,
    unresolvedCount: 0,
    rows: Object.freeze([]),
  });
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
