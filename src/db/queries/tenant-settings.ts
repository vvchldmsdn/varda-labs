import "server-only";

import { runTenantReadTransaction } from "@/db/tenant-transaction-context";
import type { TenantContext } from "@/lib/session-resolver-contract";

export type TenantPortfolioSettingsRow = Readonly<{
  minExecutionRatioPct: string | null;
  trimDriftThreshold: string | null;
  usdKrwRate: string | null;
  useTrendFilter: boolean;
}>;

export async function loadLatestTenantPortfolioSettingsRows(
  tenantContext: TenantContext,
): Promise<readonly TenantPortfolioSettingsRow[]> {
  const [rows] = await runTenantReadTransaction(
    tenantContext.ownerUserId,
    (transaction) => [transaction.query(LATEST_TENANT_SETTINGS_SQL)],
  );

  return Object.freeze(rows.map(projectTenantPortfolioSettingsRow));
}

const LATEST_TENANT_SETTINGS_SQL = `
  select
    min_execution_ratio_pct::text as min_execution_ratio_pct,
    trim_drift_threshold::text as trim_drift_threshold,
    usd_krw_rate::text as usd_krw_rate,
    use_trend_filter
  from public.settings
  where is_sample = false
  order by created_at desc, id desc
  limit 1
`;

function projectTenantPortfolioSettingsRow(
  row: Readonly<Record<string, unknown>>,
): TenantPortfolioSettingsRow {
  return Object.freeze({
    minExecutionRatioPct: nullableString(row.min_execution_ratio_pct),
    trimDriftThreshold: nullableString(row.trim_drift_threshold),
    usdKrwRate: nullableString(row.usd_krw_rate),
    useTrendFilter: requiredBoolean(row.use_trend_filter),
  });
}

function nullableString(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error("Tenant settings row is invalid");
  }
  return value;
}

function requiredBoolean(value: unknown) {
  if (typeof value !== "boolean") {
    throw new Error("Tenant settings row is invalid");
  }
  return value;
}
