import "server-only";

import { getPortfolioAnalysisScopeTargets } from "@/db/queries/portfolio-analysis-scope-targets";
import { runTenantReadTransaction } from "@/db/tenant-transaction-context";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import {
  projectTenantHoldingRows,
  type TenantHoldingReadRow,
  type TenantHoldingReadResult,
} from "@/lib/tenant-holding-read-model";
import type { TenantContext } from "@/lib/session-resolver-contract";

export type TenantHoldingQueryResult =
  | TenantHoldingReadResult
  | Readonly<{ state: "unavailable" }>;

export async function getReadOnlyTenantHoldings({
  tenantContext,
  serviceDate,
  scope,
}: {
  tenantContext: TenantContext;
  serviceDate: string;
  scope: PortfolioAnalysisScope;
}): Promise<TenantHoldingQueryResult> {
  try {
    const [membershipTargets, resultSets] = await Promise.all([
      scope.kind === "portfolio_group"
        ? getPortfolioAnalysisScopeTargets({
            scope,
            serviceDate,
            tenantContext,
          })
        : Promise.resolve(null),
      runTenantReadTransaction(
        tenantContext.ownerUserId,
        (transaction) => [transaction.query(TENANT_HOLDING_ROWS_SQL)],
      ),
    ]);
    const rows = resultSets[0].map(projectTenantHoldingSqlRow);
    const scopedRows = filterTenantHoldingRows(rows, scope, membershipTargets);

    return projectTenantHoldingRows(scopedRows, scope);
  } catch {
    return Object.freeze({ state: "unavailable" });
  }
}

const TENANT_HOLDING_ROWS_SQL = `
  select
    asset.id::text as asset_id,
    asset.account_id::text as asset_account_id,
    account.id::text as owned_account_id,
    account.code as account_code,
    account.name as account_name,
    account.sort_order as account_sort_order,
    asset.account as legacy_account_code,
    asset.name,
    asset.ticker,
    asset.asset_type,
    asset.market,
    asset.currency,
    asset.quantity::text as quantity,
    asset.average_cost::text as average_cost,
    asset.current_price::text as current_price,
    asset.price_source,
    asset.price_as_of::text as price_as_of,
    asset.price_status,
    asset.updated_at::text as updated_at
  from public.assets as asset
  inner join public.accounts as account on asset.account_id = account.id
  where account.is_active = true
    and asset.account = account.code
  order by account.sort_order, account.code, asset.name, asset.ticker
`;

function projectTenantHoldingSqlRow(
  row: Record<string, unknown>,
): TenantHoldingReadRow {
  return Object.freeze({
    assetId: requiredString(row.asset_id),
    assetAccountId: nullableString(row.asset_account_id),
    ownedAccountId: requiredString(row.owned_account_id),
    accountCode: requiredString(row.account_code),
    accountName: requiredString(row.account_name),
    accountSortOrder: requiredInteger(row.account_sort_order),
    legacyAccountCode: requiredString(row.legacy_account_code),
    name: requiredString(row.name),
    ticker: nullableString(row.ticker),
    assetType: nullableString(row.asset_type),
    market: requiredString(row.market),
    currency: requiredString(row.currency),
    quantity: requiredString(row.quantity),
    averageCost: nullableString(row.average_cost),
    currentPrice: requiredString(row.current_price),
    priceSource: nullableString(row.price_source),
    priceAsOf: nullableTimestamp(row.price_as_of),
    priceStatus: nullableString(row.price_status),
    updatedAt: requiredTimestamp(row.updated_at),
  });
}

function filterTenantHoldingRows(
  rows: readonly TenantHoldingReadRow[],
  scope: PortfolioAnalysisScope,
  membershipTargets: Awaited<
    ReturnType<typeof getPortfolioAnalysisScopeTargets>
  > | null,
) {
  if (scope.kind === "all") return rows;
  if (scope.kind === "account") {
    return rows.filter((row) => row.ownedAccountId === scope.accountId);
  }
  if (!membershipTargets) return [];

  const wholeAccountIds = new Set(membershipTargets.wholeAccountIds);
  const directAssetIds = new Set(membershipTargets.directAssetIds);
  return rows.filter(
    (row) =>
      wholeAccountIds.has(row.ownedAccountId) || directAssetIds.has(row.assetId),
  );
}

function requiredString(value: unknown) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Tenant holding row is invalid");
  }
  return value;
}

function nullableString(value: unknown) {
  return value === null ? null : requiredString(value);
}

function requiredInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("Tenant holding row is invalid");
  }
  return parsed;
}

function requiredTimestamp(value: unknown) {
  const parsed = new Date(requiredString(value));
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("Tenant holding row is invalid");
  }
  return parsed;
}

function nullableTimestamp(value: unknown) {
  return value === null ? null : requiredTimestamp(value);
}
