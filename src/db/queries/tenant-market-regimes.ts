import "server-only";

import { runTenantReadTransaction } from "@/db/tenant-transaction-context";
import type { TenantContext } from "@/lib/session-resolver-contract";

export type TenantMarketRegimeRow = Readonly<{
  legacyBase44Id: string | null;
  regimeDate: string;
  account: string;
  label: string;
  description: string | null;
  driversJson: object;
  macroStressScore: string | null;
  regimeScore: string | null;
  newsSentimentScore: string | null;
  avgCorrelation: string | null;
  enb: string | null;
  portfolioVolatility: string | null;
  yieldCurve: string | null;
  rateLevel: string | null;
  stressBadgeCount: number | null;
  base44UpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export async function loadTenantMarketRegimeRows(
  tenantContext: TenantContext,
): Promise<TenantMarketRegimeRow[]> {
  const [rows] = await runTenantReadTransaction(
    tenantContext.ownerUserId,
    (transaction) => [transaction.query(TENANT_MARKET_REGIME_ROWS_SQL)],
  );

  return rows.map(projectTenantMarketRegimeRow);
}

const TENANT_MARKET_REGIME_ROWS_SQL = `
  select
    regime.legacy_base44_id,
    regime.date::text as regime_date,
    regime.account,
    regime.label,
    regime.description,
    regime.drivers_json,
    regime.macro_stress_score::text as macro_stress_score,
    regime.regime_score::text as regime_score,
    regime.news_sentiment_score::text as news_sentiment_score,
    regime.avg_correlation::text as avg_correlation,
    regime.enb::text as enb,
    regime.portfolio_volatility::text as portfolio_volatility,
    regime.yield_curve::text as yield_curve,
    regime.rate_level::text as rate_level,
    regime.stress_badge_count,
    regime.base44_updated_at::text as base44_updated_at,
    regime.created_at::text as created_at,
    regime.updated_at::text as updated_at
  from public.market_regime_daily as regime
  inner join public.accounts as account on regime.account_id = account.id
  where account.is_active = true
    and regime.account = account.code
    and regime.is_sample = false
  order by regime.account, regime.date
`;

function projectTenantMarketRegimeRow(
  row: Readonly<Record<string, unknown>>,
): TenantMarketRegimeRow {
  return Object.freeze({
    legacyBase44Id: nullableString(row.legacy_base44_id),
    regimeDate: requiredString(row.regime_date),
    account: requiredString(row.account),
    label: requiredString(row.label),
    description: nullableString(row.description),
    driversJson: requiredJsonObject(row.drivers_json),
    macroStressScore: nullableString(row.macro_stress_score),
    regimeScore: nullableString(row.regime_score),
    newsSentimentScore: nullableString(row.news_sentiment_score),
    avgCorrelation: nullableString(row.avg_correlation),
    enb: nullableString(row.enb),
    portfolioVolatility: nullableString(row.portfolio_volatility),
    yieldCurve: nullableString(row.yield_curve),
    rateLevel: nullableString(row.rate_level),
    stressBadgeCount: nullableInteger(row.stress_badge_count),
    base44UpdatedAt: nullableString(row.base44_updated_at),
    createdAt: requiredString(row.created_at),
    updatedAt: requiredString(row.updated_at),
  });
}

function requiredString(value: unknown) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Tenant market regime row is invalid");
  }
  return value;
}

function nullableString(value: unknown) {
  return value === null ? null : requiredString(value);
}

function nullableInteger(value: unknown) {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("Tenant market regime row is invalid");
  }
  return parsed;
}

function requiredJsonObject(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Tenant market regime row is invalid");
  }
  return value;
}
