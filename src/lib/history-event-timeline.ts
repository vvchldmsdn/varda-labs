import type {
  HistoryAccount,
  HistoryLane,
} from "./history-balance.ts";

export const HISTORY_EVENT_TIMELINE_POLICY = Object.freeze({
  version: "stored_named_account_event_timeline_v1",
  supportedAccounts: "brokerage_isa_irp_only",
  accountMatch: "exact_stored_account_only",
  eventDateMeaning: "stored_event_calendar_date",
  snapshotCausality: "not_inferred",
  currentAssetFallback: "none",
  correctionNetting: "none",
  rowLimit: 100,
} as const);

export const HISTORY_EVENT_QUERY_LIMIT =
  HISTORY_EVENT_TIMELINE_POLICY.rowLimit + 1;

const TRADE_EVENT_TYPES = new Set(["buy", "sell"]);
const LIFECYCLE_EVENT_TYPES = new Set(["asset_added", "asset_removed"]);

export type HistoryEventRawRow = Readonly<{
  internalId: string | null;
  legacyBase44Id: string | null;
  eventDate: string;
  eventType: string;
  source: string | null;
  recordedAt: Date | string | null;
  ruleVersion: string | null;
  account: string | null;
  assetId: string | null;
  legacyAssetId: string | null;
  ticker: string | null;
  assetName: string;
  groupName: string | null;
  correctsEventId: string | null;
  legacyCorrectsEventId: string | null;
  amountKrw: string | null;
  quantityDelta: string | null;
  price: string | null;
  fxRate: string | null;
}>;

export type HistoryEventMissingField =
  | "event_date"
  | "event_type"
  | "asset_name"
  | "event_identity"
  | "asset_reference"
  | "amount_krw"
  | "quantity_delta"
  | "price"
  | "unknown_event_type"
  | "correction_target_unverified";

export type HistoryEventDisplayRow = Readonly<{
  eventDate: string;
  recordedAt: string | null;
  eventType: string;
  eventKind: "trade" | "lifecycle" | "unknown";
  source: string | null;
  ruleVersion: string | null;
  ticker: string | null;
  assetName: string;
  groupName: string | null;
  assetReferenceStatus:
    | "stored_asset_reference"
    | "legacy_only"
    | "unmatched";
  correctionStatus: "none" | "reference_unverified";
  evidenceStatus: "complete" | "partial" | "duplicate_identity";
  missingFields: readonly HistoryEventMissingField[];
  amountKrw: number | null;
  quantityDelta: number | null;
  price: number | null;
  fxRate: number | null;
}>;

export type HistoryEventTimelineModel = Readonly<{
  policy: typeof HISTORY_EVENT_TIMELINE_POLICY;
  account: HistoryAccount;
  lane: HistoryLane;
  status: "idle" | "blocked" | "unavailable" | "partial" | "ready";
  reason:
    | "event_lane_not_visible"
    | "named_account_required"
    | "no_event_rows"
    | "no_compatible_event_rows"
    | "partial_evidence"
    | "ready";
  inputRowCount: number;
  eventCount: number;
  tradeCount: number;
  lifecycleCount: number;
  partialCount: number;
  legacyOnlyCount: number;
  correctionCount: number;
  incompatibleRowCount: number;
  duplicateIdentityCount: number;
  rowLimitExceeded: boolean;
  dateRange: Readonly<{ minDate: string | null; maxDate: string | null }>;
  rows: readonly HistoryEventDisplayRow[];
}>;

export function shouldLoadHistoryEvents(
  account: HistoryAccount,
  lane: HistoryLane,
) {
  return account !== "all" && (lane === "all" || lane === "events");
}

export function buildHistoryEventTimeline({
  account,
  lane,
  eventRows,
}: {
  account: HistoryAccount;
  lane: HistoryLane;
  eventRows: readonly HistoryEventRawRow[];
}): HistoryEventTimelineModel {
  if (lane !== "all" && lane !== "events") {
    return emptyModel(account, lane, "idle", "event_lane_not_visible");
  }
  if (account === "all") {
    return emptyModel(account, lane, "blocked", "named_account_required");
  }

  const compatibleRows = eventRows.filter((row) => row.account === account);
  const incompatibleRowCount = eventRows.length - compatibleRows.length;
  if (compatibleRows.length === 0) {
    return emptyModel(
      account,
      lane,
      "unavailable",
      eventRows.length > 0 ? "no_compatible_event_rows" : "no_event_rows",
      eventRows.length,
      incompatibleRowCount,
    );
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
    const eventType = cleanText(row.eventType) ?? "unknown";
    const eventKind = classifyEventKind(eventType);
    const correctionStatus =
      cleanText(row.correctsEventId) || cleanText(row.legacyCorrectsEventId)
        ? ("reference_unverified" as const)
        : ("none" as const);
    const assetReferenceStatus = row.assetId
      ? ("stored_asset_reference" as const)
      : cleanText(row.legacyAssetId)
        ? ("legacy_only" as const)
        : ("unmatched" as const);
    const amountKrw = finiteNumber(row.amountKrw);
    const quantityDelta = finiteNumber(row.quantityDelta);
    const price = finiteNumber(row.price);
    const missingFields = collectMissingFields({
      row,
      eventKind,
      identity,
      assetReferenceStatus,
      correctionStatus,
      amountKrw,
      quantityDelta,
      price,
    });

    return Object.freeze({
      eventDate: row.eventDate,
      recordedAt: timestampIso(row.recordedAt),
      eventType,
      eventKind,
      source: cleanText(row.source),
      ruleVersion: cleanText(row.ruleVersion),
      ticker: cleanText(row.ticker),
      assetName: cleanText(row.assetName) ?? "이름 없음",
      groupName: cleanText(row.groupName),
      assetReferenceStatus,
      correctionStatus,
      evidenceStatus: duplicateIdentity
        ? ("duplicate_identity" as const)
        : missingFields.length > 0
          ? ("partial" as const)
          : ("complete" as const),
      missingFields: Object.freeze(missingFields),
      amountKrw,
      quantityDelta,
      price,
      fxRate: finiteNumber(row.fxRate),
    });
  });

  projected.sort(compareDisplayRows);
  const rowLimitExceeded =
    projected.length > HISTORY_EVENT_TIMELINE_POLICY.rowLimit;
  const rows = projected.slice(0, HISTORY_EVENT_TIMELINE_POLICY.rowLimit);
  const duplicateIdentityCount = rows.filter(
    (row) => row.evidenceStatus === "duplicate_identity",
  ).length;
  const partialCount = rows.filter(
    (row) => row.evidenceStatus !== "complete",
  ).length;
  const partial =
    rowLimitExceeded ||
    incompatibleRowCount > 0 ||
    partialCount > 0;

  return Object.freeze({
    policy: HISTORY_EVENT_TIMELINE_POLICY,
    account,
    lane,
    status: partial ? "partial" : "ready",
    reason: partial ? "partial_evidence" : "ready",
    inputRowCount: eventRows.length,
    eventCount: rows.length,
    tradeCount: rows.filter((row) => row.eventKind === "trade").length,
    lifecycleCount: rows.filter((row) => row.eventKind === "lifecycle").length,
    partialCount,
    legacyOnlyCount: rows.filter(
      (row) => row.assetReferenceStatus === "legacy_only",
    ).length,
    correctionCount: rows.filter(
      (row) => row.correctionStatus !== "none",
    ).length,
    incompatibleRowCount,
    duplicateIdentityCount,
    rowLimitExceeded,
    dateRange: summarizeDateRange(rows),
    rows: Object.freeze(rows),
  });
}

function emptyModel(
  account: HistoryAccount,
  lane: HistoryLane,
  status: HistoryEventTimelineModel["status"],
  reason: HistoryEventTimelineModel["reason"],
  inputRowCount = 0,
  incompatibleRowCount = 0,
): HistoryEventTimelineModel {
  return Object.freeze({
    policy: HISTORY_EVENT_TIMELINE_POLICY,
    account,
    lane,
    status,
    reason,
    inputRowCount,
    eventCount: 0,
    tradeCount: 0,
    lifecycleCount: 0,
    partialCount: 0,
    legacyOnlyCount: 0,
    correctionCount: 0,
    incompatibleRowCount,
    duplicateIdentityCount: 0,
    rowLimitExceeded: false,
    dateRange: Object.freeze({ minDate: null, maxDate: null }),
    rows: Object.freeze([]),
  });
}

function collectMissingFields({
  row,
  eventKind,
  identity,
  assetReferenceStatus,
  correctionStatus,
  amountKrw,
  quantityDelta,
  price,
}: {
  row: HistoryEventRawRow;
  eventKind: HistoryEventDisplayRow["eventKind"];
  identity: string | null;
  assetReferenceStatus: HistoryEventDisplayRow["assetReferenceStatus"];
  correctionStatus: HistoryEventDisplayRow["correctionStatus"];
  amountKrw: number | null;
  quantityDelta: number | null;
  price: number | null;
}) {
  const missing: HistoryEventMissingField[] = [];
  if (!isStrictDate(row.eventDate)) missing.push("event_date");
  if (!cleanText(row.eventType)) missing.push("event_type");
  if (!cleanText(row.assetName)) missing.push("asset_name");
  if (!identity) missing.push("event_identity");
  if (assetReferenceStatus === "unmatched") missing.push("asset_reference");
  if (eventKind === "unknown" && cleanText(row.eventType)) {
    missing.push("unknown_event_type");
  }
  if (eventKind === "trade") {
    if (amountKrw === null) missing.push("amount_krw");
    if (quantityDelta === null) missing.push("quantity_delta");
    if (price === null) missing.push("price");
  }
  if (correctionStatus === "reference_unverified") {
    missing.push("correction_target_unverified");
  }
  return missing;
}

function classifyEventKind(
  eventType: string,
): HistoryEventDisplayRow["eventKind"] {
  if (TRADE_EVENT_TYPES.has(eventType)) return "trade";
  if (LIFECYCLE_EVENT_TYPES.has(eventType)) return "lifecycle";
  return "unknown";
}

function internalIdentity(row: HistoryEventRawRow) {
  const internalId = cleanText(row.internalId);
  if (internalId) return `event:${internalId}`;
  const legacyId = cleanText(row.legacyBase44Id);
  return legacyId ? `legacy:${legacyId}` : null;
}

function compareDisplayRows(
  left: HistoryEventDisplayRow,
  right: HistoryEventDisplayRow,
) {
  return (
    right.eventDate.localeCompare(left.eventDate) ||
    (right.recordedAt ?? "").localeCompare(left.recordedAt ?? "") ||
    left.eventType.localeCompare(right.eventType) ||
    (left.ticker ?? "").localeCompare(right.ticker ?? "") ||
    left.assetName.localeCompare(right.assetName)
  );
}

function summarizeDateRange(rows: readonly HistoryEventDisplayRow[]) {
  const dates = rows
    .map((row) => row.eventDate)
    .filter(isStrictDate)
    .sort();
  return Object.freeze({
    minDate: dates[0] ?? null,
    maxDate: dates.at(-1) ?? null,
  });
}

function timestampIso(value: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
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
