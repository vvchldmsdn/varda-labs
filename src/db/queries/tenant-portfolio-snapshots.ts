import "server-only";

import { loadOwnedActiveSnapshotAccounts } from "@/db/queries/tenant-snapshot-accounts";
import { runTenantReadTransaction } from "@/db/tenant-transaction-context";
import {
  projectTenantPortfolioSnapshotRows,
  type TenantPortfolioSnapshotReadResult,
  type TenantPortfolioSnapshotReadRow,
} from "@/lib/tenant-portfolio-snapshot-read-model";
import { parseTenantSnapshotDateQuery } from "@/lib/tenant-snapshot-date-query";
import type { TenantContext } from "@/lib/session-resolver-contract";
import {
  tenantSnapshotScopeMatchesAccount,
  type TenantSnapshotScope,
} from "@/lib/tenant-snapshot-scope";

export type TenantPortfolioSnapshotQueryResult =
  | TenantPortfolioSnapshotReadResult
  | Readonly<{ state: "invalid_request" }>
  | Readonly<{ state: "unavailable" }>;

export async function getReadOnlyTenantPortfolioSnapshots({
  tenantContext,
  scope,
  requestedSnapshotDate,
}: {
  tenantContext: TenantContext;
  scope: TenantSnapshotScope;
  requestedSnapshotDate?: string;
}): Promise<TenantPortfolioSnapshotQueryResult> {
  if (
    requestedSnapshotDate !== undefined &&
    parseTenantSnapshotDateQuery(requestedSnapshotDate) !==
      requestedSnapshotDate
  ) {
    return Object.freeze({ state: "invalid_request" });
  }

  try {
    const accountRows = (await loadOwnedActiveSnapshotAccounts(tenantContext)).filter(
      (account) => tenantSnapshotScopeMatchesAccount(scope, account),
    );
    if (accountRows.length === 0) {
      return projectTenantPortfolioSnapshotRows({
        accountRows,
        rows: [],
        scope,
        snapshotDate: requestedSnapshotDate ?? null,
      });
    }

    const [sqlRows] = await runTenantReadTransaction(
      tenantContext.ownerUserId,
      (transaction) => [
        transaction.query(TENANT_PORTFOLIO_SNAPSHOT_ROWS_SQL, [
          requestedSnapshotDate ?? null,
          accountRows.map((account) => account.accountId),
        ]),
      ],
    );
    const { rows, snapshotDate } = projectTenantPortfolioSnapshotSqlRows(sqlRows);

    return projectTenantPortfolioSnapshotRows({
      accountRows,
      rows,
      scope,
      snapshotDate,
    });
  } catch {
    return Object.freeze({ state: "unavailable" });
  }
}

const TENANT_PORTFOLIO_SNAPSHOT_ROWS_SQL = `
  with selected_date as (
    select coalesce($1::date, max(snapshot.snapshot_date)) as snapshot_date
    from public.daily_portfolio_snapshots as snapshot
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
      snapshot.rule_version,
      snapshot.is_sample,
      snapshot.account_id::text as snapshot_account_id,
      account.id::text as owned_account_id,
      account.code as account_code,
      account.name as account_name,
      account.sort_order as account_sort_order,
      snapshot.account as legacy_account_code,
      snapshot.cash_value::text as cash_value,
      snapshot.invested_amount::text as invested_amount,
      snapshot.total_cost::text as total_cost,
      snapshot.total_market_value::text as total_market_value,
      snapshot.total_pnl::text as total_pnl,
      snapshot.total_return_pct::text as total_return_pct,
      snapshot.fx_rate::text as fx_rate,
      snapshot.usdkrw::text as usd_krw,
      snapshot.kr_weight::text as kr_weight,
      snapshot.us_weight::text as us_weight,
      snapshot.usd_exposure_pct::text as usd_exposure_pct,
      snapshot.num_assets,
      snapshot.num_groups,
      snapshot.top_holding_name,
      snapshot.top_holding_weight::text as top_holding_weight,
      snapshot.captured_at::text as captured_at
    from public.daily_portfolio_snapshots as snapshot
    inner join public.accounts as account on snapshot.account_id = account.id
    where selected_date.snapshot_date is not null
      and snapshot.snapshot_date = selected_date.snapshot_date
      and account.id = any($2::uuid[])
      and account.is_active = true
      and snapshot.account = account.code
      and snapshot.is_sample = false
    order by account.sort_order, account.code
  ) as snapshot_row on true
  order by snapshot_row.account_sort_order, snapshot_row.account_code
`;

function projectTenantPortfolioSnapshotSqlRows(
  sqlRows: readonly Record<string, unknown>[],
): Readonly<{
  rows: readonly TenantPortfolioSnapshotReadRow[];
  snapshotDate: string | null;
}> {
  if (sqlRows.length === 0) {
    throw new Error("Tenant portfolio snapshot result is invalid");
  }
  const snapshotDate = nullableString(sqlRows[0].selected_snapshot_date);
  const rows = sqlRows
    .filter((row) => row.snapshot_id !== null)
    .map(projectTenantPortfolioSnapshotSqlRow);
  return Object.freeze({ rows: Object.freeze(rows), snapshotDate });
}

function projectTenantPortfolioSnapshotSqlRow(
  row: Record<string, unknown>,
): TenantPortfolioSnapshotReadRow {
  requiredString(row.snapshot_id);
  return Object.freeze({
    snapshotDate: requiredString(row.snapshot_date),
    source: requiredString(row.source),
    ruleVersion: nullableString(row.rule_version),
    isSample: requiredBoolean(row.is_sample),
    snapshotAccountId: nullableString(row.snapshot_account_id),
    ownedAccountId: requiredString(row.owned_account_id),
    accountCode: requiredString(row.account_code),
    accountName: requiredString(row.account_name),
    accountSortOrder: requiredInteger(row.account_sort_order),
    legacyAccountCode: requiredString(row.legacy_account_code),
    cashValue: nullableString(row.cash_value),
    investedAmount: nullableString(row.invested_amount),
    totalCost: nullableString(row.total_cost),
    totalMarketValue: nullableString(row.total_market_value),
    totalPnl: nullableString(row.total_pnl),
    totalReturnPct: nullableString(row.total_return_pct),
    fxRate: nullableString(row.fx_rate),
    usdKrw: nullableString(row.usd_krw),
    krWeight: nullableString(row.kr_weight),
    usWeight: nullableString(row.us_weight),
    usdExposurePct: nullableString(row.usd_exposure_pct),
    numAssets: nullableInteger(row.num_assets),
    numGroups: nullableInteger(row.num_groups),
    topHoldingName: nullableString(row.top_holding_name),
    topHoldingWeight: nullableString(row.top_holding_weight),
    capturedAt: nullableTimestamp(row.captured_at),
  });
}

function requiredString(value: unknown) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Tenant portfolio snapshot row is invalid");
  }
  return value;
}

function nullableString(value: unknown) {
  return value === null ? null : requiredString(value);
}

function requiredInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("Tenant portfolio snapshot row is invalid");
  }
  return parsed;
}

function nullableInteger(value: unknown) {
  return value === null ? null : requiredInteger(value);
}

function requiredBoolean(value: unknown) {
  if (typeof value !== "boolean") {
    throw new Error("Tenant portfolio snapshot row is invalid");
  }
  return value;
}

function nullableTimestamp(value: unknown) {
  if (value === null) return null;
  const parsed = new Date(requiredString(value));
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("Tenant portfolio snapshot row is invalid");
  }
  return parsed;
}
