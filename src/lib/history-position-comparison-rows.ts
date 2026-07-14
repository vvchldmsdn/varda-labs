import type {
  HistoryPositionChangeReason,
  HistoryPositionComparisonRow,
} from "./history-position-comparison-contract.ts";
import type { PreparedHistoryPosition } from "./history-position-comparison-endpoint.ts";

export function buildHistoryPositionChangeRows(
  fromRows: readonly PreparedHistoryPosition[],
  toRows: readonly PreparedHistoryPosition[],
) {
  const fromByIdentity = uniquePositionsByIdentity(fromRows);
  const toByIdentity = uniquePositionsByIdentity(toRows);
  const identities = new Set([
    ...fromByIdentity.keys(),
    ...toByIdentity.keys(),
  ]);
  const rows = [...identities].map((identity) =>
    comparePositions(fromByIdentity.get(identity), toByIdentity.get(identity)),
  );

  appendUnresolvedRows(rows, fromRows, "from");
  appendUnresolvedRows(rows, toRows, "to");
  rows.sort(compareChangeRows);
  return Object.freeze(rows);
}

export function countHistoryPositionChangeKind(
  rows: readonly HistoryPositionComparisonRow[],
  kind: HistoryPositionComparisonRow["changeKind"],
) {
  return rows.filter((row) => row.changeKind === kind).length;
}

function uniquePositionsByIdentity(
  rows: readonly PreparedHistoryPosition[],
) {
  const positions = new Map<string, PreparedHistoryPosition>();
  for (const row of rows) {
    if (row.evidenceStatus === "compared" && row.identity) {
      positions.set(row.identity, row);
    }
  }
  return positions;
}

function appendUnresolvedRows(
  target: HistoryPositionComparisonRow[],
  positions: readonly PreparedHistoryPosition[],
  endpoint: "from" | "to",
) {
  for (const position of positions) {
    if (position.evidenceStatus !== "compared") {
      target.push(unresolvedRow(position, endpoint));
    }
  }
}

function comparePositions(
  from: PreparedHistoryPosition | undefined,
  to: PreparedHistoryPosition | undefined,
): HistoryPositionComparisonRow {
  const representative = to ?? from;
  if (!representative) {
    throw new Error("comparison identity has no endpoint evidence");
  }

  const changeReasons: HistoryPositionChangeReason[] = [];
  let changeKind: HistoryPositionComparisonRow["changeKind"];
  if (!from || !to) {
    changeKind = from ? "removed" : "added";
    changeReasons.push("presence");
  } else {
    if (from.quantity !== to.quantity) changeReasons.push("quantity");
    if (from.marketValueKrw !== to.marketValueKrw) {
      changeReasons.push("market_value");
    }
    if (from.referenceStatus !== to.referenceStatus) {
      changeReasons.push("reference_status");
    }
    if (!sameDisplayMetadata(from, to)) {
      changeReasons.push("display_metadata");
    }
    changeKind = changeReasons.length > 0 ? "changed" : "unchanged";
  }

  return Object.freeze({
    changeKind,
    changeReasons: Object.freeze(changeReasons),
    evidenceStatus: "compared",
    ticker: representative.ticker,
    assetName: representative.assetName,
    market: representative.market,
    currency: representative.currency,
    fromReferenceStatus: from?.referenceStatus ?? "none",
    toReferenceStatus: to?.referenceStatus ?? "none",
    fromQuantity: from?.quantity ?? null,
    toQuantity: to?.quantity ?? null,
    quantityChange: endpointDifference(
      from?.quantity,
      to?.quantity,
      Boolean(from),
      Boolean(to),
    ),
    fromMarketValueKrw: from?.marketValueKrw ?? null,
    toMarketValueKrw: to?.marketValueKrw ?? null,
    marketValueChangeKrw: endpointDifference(
      from?.marketValueKrw,
      to?.marketValueKrw,
      Boolean(from),
      Boolean(to),
    ),
  });
}

function unresolvedRow(
  position: PreparedHistoryPosition,
  endpoint: "from" | "to",
): HistoryPositionComparisonRow {
  return Object.freeze({
    changeKind: "unresolved",
    changeReasons: Object.freeze(["unresolved_identity"] as const),
    evidenceStatus: position.evidenceStatus,
    ticker: position.ticker,
    assetName: position.assetName,
    market: position.market,
    currency: position.currency,
    fromReferenceStatus:
      endpoint === "from" ? position.referenceStatus : "none",
    toReferenceStatus:
      endpoint === "to" ? position.referenceStatus : "none",
    fromQuantity: endpoint === "from" ? position.quantity : null,
    toQuantity: endpoint === "to" ? position.quantity : null,
    quantityChange: null,
    fromMarketValueKrw:
      endpoint === "from" ? position.marketValueKrw : null,
    toMarketValueKrw: endpoint === "to" ? position.marketValueKrw : null,
    marketValueChangeKrw: null,
  });
}

function endpointDifference(
  from: number | null | undefined,
  to: number | null | undefined,
  hasFrom: boolean,
  hasTo: boolean,
) {
  if (hasFrom && hasTo) {
    return from === null || from === undefined || to === null || to === undefined
      ? null
      : to - from;
  }
  if (hasTo) return to ?? null;
  if (hasFrom) return from === null || from === undefined ? null : -from;
  return null;
}

function sameDisplayMetadata(
  left: PreparedHistoryPosition,
  right: PreparedHistoryPosition,
) {
  return (
    left.ticker === right.ticker &&
    left.assetName === right.assetName &&
    left.market === right.market &&
    left.currency === right.currency
  );
}

function compareChangeRows(
  left: HistoryPositionComparisonRow,
  right: HistoryPositionComparisonRow,
) {
  const priority = {
    added: 0,
    removed: 0,
    changed: 1,
    unresolved: 2,
    unchanged: 3,
  } as const;
  return (
    priority[left.changeKind] - priority[right.changeKind] ||
    Math.abs(right.marketValueChangeKrw ?? 0) -
      Math.abs(left.marketValueChangeKrw ?? 0) ||
    left.assetName.localeCompare(right.assetName) ||
    (left.ticker ?? "").localeCompare(right.ticker ?? "")
  );
}
