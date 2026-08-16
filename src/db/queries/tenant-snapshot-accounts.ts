import "server-only";

import { runTenantReadTransaction } from "@/db/tenant-transaction-context";
import type { TenantContext } from "@/lib/session-resolver-contract";
import { SNAPSHOT_INVESTMENT_ASSET_TYPES } from "@/lib/snapshots/investment-eligibility";

export type TenantSnapshotAccountRow = Readonly<{
  accountId: string;
  accountCode: string;
  accountName: string;
  accountSortOrder: number;
}>;

export async function loadOwnedActiveSnapshotAccounts(
  tenantContext: TenantContext,
): Promise<TenantSnapshotAccountRow[]> {
  const [rows] = await runTenantReadTransaction(
    tenantContext.ownerUserId,
    (transaction) => [
      transaction.query(TENANT_SNAPSHOT_ACCOUNTS_SQL, [
        [...SNAPSHOT_INVESTMENT_ASSET_TYPES],
      ]),
    ],
  );

  return rows.map(projectTenantSnapshotAccountSqlRow);
}

const TENANT_SNAPSHOT_ACCOUNTS_SQL = `
  select distinct
    account.id::text as account_id,
    account.code as account_code,
    account.name as account_name,
    account.sort_order as account_sort_order
  from public.accounts as account
  inner join public.assets as asset on asset.account_id = account.id
  where account.is_active = true
    and account.account_type <> 'cash'
    and asset.account = account.code
    and asset.asset_type = any($1::text[])
    and (asset.quantity > 0 or asset.fractional_krw_value > 0)
  order by account.sort_order, account.name, account.code
`;

function projectTenantSnapshotAccountSqlRow(
  row: Record<string, unknown>,
): TenantSnapshotAccountRow {
  return Object.freeze({
    accountId: requiredString(row.account_id),
    accountCode: requiredString(row.account_code),
    accountName: requiredString(row.account_name),
    accountSortOrder: requiredInteger(row.account_sort_order),
  });
}

function requiredString(value: unknown) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Tenant snapshot account row is invalid");
  }
  return value;
}

function requiredInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("Tenant snapshot account row is invalid");
  }
  return parsed;
}
