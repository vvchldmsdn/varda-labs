import "server-only";

import { runTenantReadTransaction } from "@/db/tenant-transaction-context";
import { HISTORY_EVENT_QUERY_LIMIT } from "@/lib/history-event-timeline";
import {
  isNamedPortfolioAccount,
  NAMED_PORTFOLIO_ACCOUNTS,
  type PortfolioAccountScope,
} from "@/lib/portfolio-account-scope";
import {
  projectTenantEventLedgerRows,
  type TenantEventLedgerReadResult,
  type TenantEventLedgerReadRow,
} from "@/lib/tenant-event-ledger-read-model";
import type { TenantContext } from "@/lib/session-resolver-contract";

export type TenantEventLedgerQueryResult =
  | TenantEventLedgerReadResult
  | Readonly<{ state: "unavailable" }>;

export async function getReadOnlyTenantEvents({
  tenantContext,
  scope,
}: {
  tenantContext: TenantContext;
  scope: PortfolioAccountScope;
}): Promise<TenantEventLedgerQueryResult> {
  try {
    const [sqlRows] = await runTenantReadTransaction(
      tenantContext.ownerUserId,
      (transaction) => [
        transaction.query(TENANT_EVENT_ROWS_SQL, [
          scope === "all" ? null : scope,
          NAMED_PORTFOLIO_ACCOUNTS,
          HISTORY_EVENT_QUERY_LIMIT,
        ]),
      ],
    );
    const rows = sqlRows.map(projectTenantEventSqlRow);

    return projectTenantEventLedgerRows(rows, scope);
  } catch {
    return Object.freeze({ state: "unavailable" });
  }
}

const TENANT_EVENT_ROWS_SQL = `
  select
    event.id::text as "internalId",
    event.legacy_base44_id as "legacyBase44Id",
    event.account_id::text as "eventAccountId",
    account.id::text as "ownedAccountId",
    account.code as "accountCode",
    account.name as "accountName",
    account.sort_order as "accountSortOrder",
    event.is_sample as "isSample",
    event.event_date::text as "eventDate",
    event.event_type as "eventType",
    event.source,
    event.recorded_at::text as "recordedAt",
    event.rule_version as "ruleVersion",
    event.account,
    event.asset_id::text as "assetId",
    event.legacy_asset_id as "legacyAssetId",
    event.ticker,
    event.asset_name as "assetName",
    event.group_name as "groupName",
    event.corrects_event_id::text as "correctsEventId",
    event.legacy_corrects_event_id as "legacyCorrectsEventId",
    event.amount_krw::text as "amountKrw",
    event.quantity_delta::text as "quantityDelta",
    event.price::text as price,
    event.fx_rate::text as "fxRate"
  from public.event_ledger_entries as event
  inner join public.accounts as account on event.account_id = account.id
  where account.is_active = true
    and account.code = any($2::text[])
    and event.account = account.code
    and event.is_sample = false
    and ($1::text is null or account.code = $1::text)
  order by
    event.event_date desc,
    event.recorded_at desc nulls last,
    account.sort_order,
    account.code,
    event.created_at desc,
    event.id
  limit $3::integer
`;

function projectTenantEventSqlRow(
  row: Readonly<Record<string, unknown>>,
): TenantEventLedgerReadRow {
  const accountCode = requiredString(row.accountCode);
  if (!isNamedPortfolioAccount(accountCode)) {
    throw new Error("Tenant event ledger row is invalid");
  }

  return Object.freeze({
    internalId: requiredString(row.internalId),
    legacyBase44Id: nullableString(row.legacyBase44Id),
    eventAccountId: nullableString(row.eventAccountId),
    ownedAccountId: requiredString(row.ownedAccountId),
    accountCode,
    accountName: requiredString(row.accountName),
    accountSortOrder: requiredInteger(row.accountSortOrder),
    isSample: requiredBoolean(row.isSample),
    eventDate: requiredString(row.eventDate),
    eventType: requiredString(row.eventType),
    source: nullableString(row.source),
    recordedAt: nullableString(row.recordedAt),
    ruleVersion: nullableString(row.ruleVersion),
    account: nullableString(row.account),
    assetId: nullableString(row.assetId),
    legacyAssetId: requiredString(row.legacyAssetId),
    ticker: nullableString(row.ticker),
    assetName: requiredString(row.assetName),
    groupName: nullableString(row.groupName),
    correctsEventId: nullableString(row.correctsEventId),
    legacyCorrectsEventId: nullableString(row.legacyCorrectsEventId),
    amountKrw: nullableString(row.amountKrw),
    quantityDelta: nullableString(row.quantityDelta),
    price: nullableString(row.price),
    fxRate: nullableString(row.fxRate),
  });
}

function requiredString(value: unknown) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Tenant event ledger row is invalid");
  }
  return value;
}

function nullableString(value: unknown) {
  return value === null ? null : requiredString(value);
}

function requiredInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("Tenant event ledger row is invalid");
  }
  return parsed;
}

function requiredBoolean(value: unknown) {
  if (typeof value !== "boolean") {
    throw new Error("Tenant event ledger row is invalid");
  }
  return value;
}
