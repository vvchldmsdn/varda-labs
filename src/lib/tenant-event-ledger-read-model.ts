import {
  getHistoryEventEvidenceIdentity,
  HISTORY_EVENT_TIMELINE_POLICY,
  projectHistoryEventRows,
  type HistoryEventDisplayRow,
  type HistoryEventRawRow,
} from "./history-event-timeline.ts";
import {
  isNamedPortfolioAccount,
  type NamedPortfolioAccount,
  type PortfolioAccountScope,
} from "./portfolio-account-scope.ts";

export const TENANT_EVENT_LEDGER_POLICY = Object.freeze({
  version: "owner_scoped_linked_event_ledger_v1",
  ownershipAuthority: "active_owned_named_account_relation",
  aggregateAuthority: "derived_owned_named_accounts_only",
  unlinkedLegacyRows: "excluded_without_account_string_inference",
  rowLimit: HISTORY_EVENT_TIMELINE_POLICY.rowLimit,
} as const);

export type TenantEventLedgerReadRow = HistoryEventRawRow &
  Readonly<{
    eventAccountId: string | null;
    ownedAccountId: string;
    accountCode: string;
    accountName: string;
    accountSortOrder: number;
    isSample: boolean;
  }>;

export type TenantEventLedgerDto = HistoryEventDisplayRow &
  Readonly<{
    accountCode: NamedPortfolioAccount;
    accountName: string;
  }>;

export type TenantEventLedgerReadResult =
  | Readonly<{
      state: "ready" | "partial";
      policy: typeof TENANT_EVENT_LEDGER_POLICY;
      scope: PortfolioAccountScope;
      authorityStatus: "linked_rows_only";
      events: readonly TenantEventLedgerDto[];
      eventCount: number;
      tradeCount: number;
      lifecycleCount: number;
      partialCount: number;
      legacyOnlyCount: number;
      correctionCount: number;
      rowLimitExceeded: boolean;
      dateRange: Readonly<{ minDate: string | null; maxDate: string | null }>;
    }>
  | Readonly<{
      state: "no_data";
      policy: typeof TENANT_EVENT_LEDGER_POLICY;
      scope: PortfolioAccountScope;
      authorityStatus: "linked_rows_only";
    }>
  | Readonly<{
      state: "integrity_error";
      reason:
        | "invalid_account_relation"
        | "invalid_account_metadata"
        | "noncanonical_account_code"
        | "account_scope_mismatch"
        | "duplicate_account_relation"
        | "duplicate_event_row"
        | "sample_row_admitted";
    }>;

type EventGroup = Readonly<{
  accountCode: NamedPortfolioAccount;
  accountName: string;
  accountSortOrder: number;
  ownedAccountId: string;
  rows: HistoryEventRawRow[];
}>;

type InternalTenantEvent = TenantEventLedgerDto &
  Readonly<{ accountSortOrder: number }>;

export function projectTenantEventLedgerRows(
  rows: readonly TenantEventLedgerReadRow[],
  scope: PortfolioAccountScope,
): TenantEventLedgerReadResult {
  const accountCodesById = new Map<string, NamedPortfolioAccount>();
  const accountIdsByCode = new Map<NamedPortfolioAccount, string>();
  const eventIdentities = new Set<string>();
  const groups = new Map<NamedPortfolioAccount, EventGroup>();

  for (const row of rows) {
    if (
      !isCanonicalText(row.ownedAccountId) ||
      row.eventAccountId === null ||
      row.eventAccountId !== row.ownedAccountId ||
      row.account !== row.accountCode
    ) {
      return integrityError("invalid_account_relation");
    }
    if (
      !isNamedPortfolioAccount(row.accountCode) ||
      row.accountCode.trim().toLowerCase() !== row.accountCode
    ) {
      return integrityError("noncanonical_account_code");
    }
    if (scope !== "all" && row.accountCode !== scope) {
      return integrityError("account_scope_mismatch");
    }
    if (
      !isCanonicalText(row.accountName) ||
      !Number.isSafeInteger(row.accountSortOrder)
    ) {
      return integrityError("invalid_account_metadata");
    }
    if (row.isSample) return integrityError("sample_row_admitted");

    const knownCode = accountCodesById.get(row.ownedAccountId);
    const knownId = accountIdsByCode.get(row.accountCode);
    if (
      (knownCode !== undefined && knownCode !== row.accountCode) ||
      (knownId !== undefined && knownId !== row.ownedAccountId)
    ) {
      return integrityError("duplicate_account_relation");
    }
    accountCodesById.set(row.ownedAccountId, row.accountCode);
    accountIdsByCode.set(row.accountCode, row.ownedAccountId);

    const existingGroup = groups.get(row.accountCode);
    if (
      existingGroup !== undefined &&
      (existingGroup.ownedAccountId !== row.ownedAccountId ||
        existingGroup.accountName !== row.accountName ||
        existingGroup.accountSortOrder !== row.accountSortOrder)
    ) {
      return integrityError("duplicate_account_relation");
    }

    const identity = getHistoryEventEvidenceIdentity(row);
    if (identity !== null) {
      if (eventIdentities.has(identity)) {
        return integrityError("duplicate_event_row");
      }
      eventIdentities.add(identity);
    }

    const group = existingGroup ?? {
      accountCode: row.accountCode,
      accountName: row.accountName,
      accountSortOrder: row.accountSortOrder,
      ownedAccountId: row.ownedAccountId,
      rows: [],
    };
    group.rows.push(row);
    groups.set(row.accountCode, group);
  }

  if (rows.length === 0) {
    return Object.freeze({
      state: "no_data",
      policy: TENANT_EVENT_LEDGER_POLICY,
      scope,
      authorityStatus: "linked_rows_only",
    });
  }

  const projected: InternalTenantEvent[] = [];
  for (const group of groups.values()) {
    for (const event of projectHistoryEventRows(group.rows)) {
      projected.push(
        Object.freeze({
          ...event,
          accountCode: group.accountCode,
          accountName: group.accountName,
          accountSortOrder: group.accountSortOrder,
        }),
      );
    }
  }

  projected.sort(compareTenantEvents);
  const rowLimitExceeded =
    projected.length > TENANT_EVENT_LEDGER_POLICY.rowLimit;
  const events = Object.freeze(
    projected
      .slice(0, TENANT_EVENT_LEDGER_POLICY.rowLimit)
      .map(toPublicEvent),
  );
  const partialCount = events.filter(
    (event) => event.evidenceStatus !== "complete",
  ).length;
  const partial = rowLimitExceeded || partialCount > 0;

  return Object.freeze({
    state: partial ? "partial" : "ready",
    policy: TENANT_EVENT_LEDGER_POLICY,
    scope,
    authorityStatus: "linked_rows_only",
    events,
    eventCount: events.length,
    tradeCount: events.filter((event) => event.eventKind === "trade").length,
    lifecycleCount: events.filter(
      (event) => event.eventKind === "lifecycle",
    ).length,
    partialCount,
    legacyOnlyCount: events.filter(
      (event) => event.assetReferenceStatus === "legacy_only",
    ).length,
    correctionCount: events.filter(
      (event) => event.correctionStatus !== "none",
    ).length,
    rowLimitExceeded,
    dateRange: summarizeDateRange(events),
  });
}

function toPublicEvent(event: InternalTenantEvent): TenantEventLedgerDto {
  return Object.freeze({
    accountCode: event.accountCode,
    accountName: event.accountName,
    eventDate: event.eventDate,
    recordedAt: event.recordedAt,
    eventType: event.eventType,
    eventKind: event.eventKind,
    source: event.source,
    ruleVersion: event.ruleVersion,
    ticker: event.ticker,
    assetName: event.assetName,
    groupName: event.groupName,
    assetReferenceStatus: event.assetReferenceStatus,
    correctionStatus: event.correctionStatus,
    evidenceStatus: event.evidenceStatus,
    missingFields: event.missingFields,
    amountKrw: event.amountKrw,
    quantityDelta: event.quantityDelta,
    price: event.price,
    fxRate: event.fxRate,
  });
}

function compareTenantEvents(
  left: InternalTenantEvent,
  right: InternalTenantEvent,
) {
  return (
    right.eventDate.localeCompare(left.eventDate) ||
    (right.recordedAt ?? "").localeCompare(left.recordedAt ?? "") ||
    left.accountSortOrder - right.accountSortOrder ||
    left.accountCode.localeCompare(right.accountCode) ||
    left.eventType.localeCompare(right.eventType) ||
    (left.ticker ?? "").localeCompare(right.ticker ?? "") ||
    left.assetName.localeCompare(right.assetName)
  );
}

function summarizeDateRange(events: readonly TenantEventLedgerDto[]) {
  const dates = events
    .map((event) => event.eventDate)
    .filter(isStrictDate)
    .sort();
  return Object.freeze({
    minDate: dates[0] ?? null,
    maxDate: dates.at(-1) ?? null,
  });
}

function isCanonicalText(value: string) {
  return value.length > 0 && value.trim() === value;
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

function integrityError(
  reason: Extract<
    TenantEventLedgerReadResult,
    { state: "integrity_error" }
  >["reason"],
): TenantEventLedgerReadResult {
  return Object.freeze({ state: "integrity_error", reason });
}
