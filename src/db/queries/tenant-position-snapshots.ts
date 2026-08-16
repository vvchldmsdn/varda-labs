import "server-only";

import { loadOwnedActiveSnapshotAccounts } from "@/db/queries/tenant-snapshot-accounts";
import { runTenantReadTransaction } from "@/db/tenant-transaction-context";
import {
  parseTenantPositionSnapshotDateQuery,
  projectTenantPositionSnapshotRows,
  type TenantPositionSnapshotReadResult,
  type TenantPositionSnapshotReadRow,
} from "@/lib/tenant-position-snapshot-read-model";
import type { TenantContext } from "@/lib/session-resolver-contract";
import {
  tenantSnapshotScopeMatchesAccount,
  type TenantSnapshotScope,
} from "@/lib/tenant-snapshot-scope";

export type TenantPositionSnapshotQueryResult =
  | TenantPositionSnapshotReadResult
  | Readonly<{ state: "invalid_request" }>
  | Readonly<{ state: "unavailable" }>;

export async function getReadOnlyTenantPositionSnapshots({
  tenantContext,
  scope,
  requestedSnapshotDate,
}: {
  tenantContext: TenantContext;
  scope: TenantSnapshotScope;
  requestedSnapshotDate?: string;
}): Promise<TenantPositionSnapshotQueryResult> {
  if (
    requestedSnapshotDate !== undefined &&
    parseTenantPositionSnapshotDateQuery(requestedSnapshotDate) !==
      requestedSnapshotDate
  ) {
    return Object.freeze({ state: "invalid_request" });
  }

  try {
    const accountRows = (await loadOwnedActiveSnapshotAccounts(tenantContext)).filter(
      (account) => tenantSnapshotScopeMatchesAccount(scope, account),
    );
    if (accountRows.length === 0) {
      return projectTenantPositionSnapshotRows({
        accountRows,
        rows: [],
        scope,
        snapshotDate: requestedSnapshotDate ?? null,
      });
    }

    const [sqlRows] = await runTenantReadTransaction(
      tenantContext.ownerUserId,
      (transaction) => [
        transaction.query(TENANT_POSITION_SNAPSHOT_ROWS_SQL, [
          requestedSnapshotDate ?? null,
          accountRows.map((account) => account.accountId),
        ]),
      ],
    );
    const { rows, snapshotDate } = projectTenantPositionSnapshotSqlRows(sqlRows);

    return projectTenantPositionSnapshotRows({
      accountRows,
      rows,
      scope,
      snapshotDate,
    });
  } catch {
    return Object.freeze({ state: "unavailable" });
  }
}

const TENANT_POSITION_SNAPSHOT_ROWS_SQL = `
  with selected_date as (
    select coalesce($1::date, max(snapshot.snapshot_date)) as snapshot_date
    from public.daily_position_snapshots as snapshot
    inner join public.accounts as account on snapshot.account_id = account.id
    where account.id = any($2::uuid[])
      and account.is_active = true
      and snapshot.account = account.code
      and snapshot.is_sample = false
  )
  select
    selected_date.snapshot_date::text as selected_snapshot_date,
    snapshot_row.*
  from selected_date
  left join lateral (
    select
      snapshot.id::text as snapshot_id,
      snapshot.snapshot_date::text as snapshot_date,
      snapshot.source,
      snapshot.is_sample,
      snapshot.asset_id::text as asset_id,
      snapshot.legacy_asset_id,
      snapshot.account_id::text as snapshot_account_id,
      account.id::text as owned_account_id,
      account.code as account_code,
      account.name as account_name,
      account.sort_order as account_sort_order,
      snapshot.account as legacy_account_code,
      snapshot.asset_name,
      snapshot.ticker,
      snapshot.asset_type,
      snapshot.market,
      snapshot.currency,
      snapshot.quantity::text as quantity,
      snapshot.current_price::text as current_price,
      snapshot.close_price::text as close_price,
      snapshot.market_value_krw::text as market_value_krw,
      snapshot.current_weight::text as current_weight,
      snapshot.target_weight::text as target_weight,
      snapshot.below_ma,
      snapshot.price_source,
      snapshot.price_basis
    from public.daily_position_snapshots as snapshot
    inner join public.accounts as account on snapshot.account_id = account.id
    where selected_date.snapshot_date is not null
      and snapshot.snapshot_date = selected_date.snapshot_date
      and account.id = any($2::uuid[])
      and account.is_active = true
      and snapshot.account = account.code
      and snapshot.is_sample = false
    order by account.sort_order, account.code, snapshot.asset_name,
      snapshot.ticker, snapshot.legacy_asset_id
  ) as snapshot_row on true
  order by snapshot_row.account_sort_order, snapshot_row.account_code,
    snapshot_row.asset_name, snapshot_row.ticker,
    snapshot_row.legacy_asset_id
`;

function projectTenantPositionSnapshotSqlRows(
  sqlRows: readonly Record<string, unknown>[],
): Readonly<{
  rows: readonly TenantPositionSnapshotReadRow[];
  snapshotDate: string | null;
}> {
  if (sqlRows.length === 0) {
    throw new Error("Tenant position snapshot result is invalid");
  }
  const snapshotDate = nullableString(sqlRows[0].selected_snapshot_date);
  const rows = sqlRows
    .filter((row) => row.snapshot_id !== null)
    .map(projectTenantPositionSnapshotSqlRow);
  return Object.freeze({ rows: Object.freeze(rows), snapshotDate });
}

function projectTenantPositionSnapshotSqlRow(
  row: Record<string, unknown>,
): TenantPositionSnapshotReadRow {
  requiredString(row.snapshot_id);
  return Object.freeze({
    snapshotDate: requiredString(row.snapshot_date),
    source: requiredString(row.source),
    isSample: requiredBoolean(row.is_sample),
    assetId: nullableString(row.asset_id),
    legacyAssetId: nullableString(row.legacy_asset_id),
    snapshotAccountId: nullableString(row.snapshot_account_id),
    ownedAccountId: requiredString(row.owned_account_id),
    accountCode: requiredString(row.account_code),
    accountName: requiredString(row.account_name),
    accountSortOrder: requiredInteger(row.account_sort_order),
    legacyAccountCode: requiredString(row.legacy_account_code),
    assetName: requiredString(row.asset_name),
    ticker: nullableString(row.ticker),
    assetType: nullableString(row.asset_type),
    market: nullableString(row.market),
    currency: nullableString(row.currency),
    quantity: nullableString(row.quantity),
    currentPrice: nullableString(row.current_price),
    closePrice: nullableString(row.close_price),
    marketValueKrw: nullableString(row.market_value_krw),
    currentWeight: nullableString(row.current_weight),
    targetWeight: nullableString(row.target_weight),
    belowMa: requiredBoolean(row.below_ma),
    priceSource: nullableString(row.price_source),
    priceBasis: nullableString(row.price_basis),
  });
}

function requiredString(value: unknown) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Tenant position snapshot row is invalid");
  }
  return value;
}

function nullableString(value: unknown) {
  return value === null ? null : requiredString(value);
}

function requiredInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("Tenant position snapshot row is invalid");
  }
  return parsed;
}

function requiredBoolean(value: unknown) {
  if (typeof value !== "boolean") {
    throw new Error("Tenant position snapshot row is invalid");
  }
  return value;
}
