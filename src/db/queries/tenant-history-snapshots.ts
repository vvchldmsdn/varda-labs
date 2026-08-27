import "server-only";

import { runTenantReadTransaction } from "@/db/tenant-transaction-context";
import type { PortfolioHistoryRawRow } from "@/lib/history-balance";
import type { HistoryPositionComparisonRawRow } from "@/lib/history-position-comparison";
import type { HistoryPositionRawRow } from "@/lib/history-position-detail";
import type { HistoryPositionScopeCandidate } from "@/lib/history-portfolio-scope";
import type { TenantContext } from "@/lib/session-resolver-contract";

export async function loadTenantHistoryPortfolioRows({
  accountIds,
  tenantContext,
}: {
  accountIds?: readonly string[];
  tenantContext: TenantContext;
}): Promise<PortfolioHistoryRawRow[]> {
  if (accountIds?.length === 0) return [];

  const [rows] = await runTenantReadTransaction(
    tenantContext.ownerUserId,
    (transaction) => [
      transaction.query(TENANT_HISTORY_PORTFOLIO_ROWS_SQL, [
        accountIds ?? null,
      ]),
    ],
  );
  return rows.map(projectPortfolioRow);
}

export async function loadTenantHistoryPositionDetailRows({
  account,
  accountId,
  limit,
  snapshotDate,
  source,
  tenantContext,
}: {
  account: string;
  accountId: string;
  limit: number;
  snapshotDate: string;
  source: string;
  tenantContext: TenantContext;
}): Promise<HistoryPositionRawRow[]> {
  const [rows] = await runTenantReadTransaction(
    tenantContext.ownerUserId,
    (transaction) => [
      transaction.query(TENANT_HISTORY_POSITION_DETAIL_ROWS_SQL, [
        accountId,
        account,
        snapshotDate,
        source,
        limit,
      ]),
    ],
  );
  return rows.map(projectPositionDetailRow);
}

export async function loadTenantHistoryPositionComparisonRows({
  account,
  accountId,
  limit,
  snapshotDate,
  source,
  tenantContext,
}: {
  account: string;
  accountId: string;
  limit: number;
  snapshotDate: string;
  source: string;
  tenantContext: TenantContext;
}): Promise<HistoryPositionComparisonRawRow[]> {
  const [rows] = await runTenantReadTransaction(
    tenantContext.ownerUserId,
    (transaction) => [
      transaction.query(TENANT_HISTORY_POSITION_COMPARISON_ROWS_SQL, [
        accountId,
        account,
        snapshotDate,
        source,
        limit,
      ]),
    ],
  );
  return rows.map(projectPositionComparisonRow);
}

export async function loadTenantHistoryGroupPositionRows({
  accountIds,
  assetIds,
  earliestMembershipDate,
  tenantContext,
}: {
  accountIds: readonly string[];
  assetIds: readonly string[];
  earliestMembershipDate: string;
  tenantContext: TenantContext;
}): Promise<HistoryPositionScopeCandidate[]> {
  if (accountIds.length === 0 && assetIds.length === 0) return [];

  const [rows] = await runTenantReadTransaction(
    tenantContext.ownerUserId,
    (transaction) => [
      transaction.query(TENANT_HISTORY_GROUP_POSITION_ROWS_SQL, [
        earliestMembershipDate,
        accountIds,
        assetIds,
      ]),
    ],
  );
  return rows.map(projectGroupPositionRow);
}

const TENANT_HISTORY_PORTFOLIO_ROWS_SQL = `
  select
    snapshot.snapshot_date::text as snapshot_date,
    account.code as account,
    snapshot.source,
    snapshot.cash_value::text as cash_value,
    snapshot.invested_amount::text as invested_amount,
    snapshot.total_cost::text as total_cost,
    snapshot.total_market_value::text as total_market_value,
    snapshot.total_pnl::text as total_pnl,
    snapshot.total_return_pct::text as total_return_pct,
    snapshot.avg_correlation::text as avg_correlation,
    snapshot.enb::text as enb,
    snapshot.portfolio_volatility::text as portfolio_volatility,
    snapshot.regime_label,
    snapshot.regime_score::text as regime_score
  from public.daily_portfolio_snapshots as snapshot
  inner join public.accounts as account on snapshot.account_id = account.id
  where account.is_active = true
    and snapshot.account = account.code
    and snapshot.is_sample = false
    and ($1::uuid[] is null or account.id = any($1::uuid[]))
  order by snapshot.snapshot_date, account.sort_order, account.code, snapshot.source
`;

const TENANT_HISTORY_POSITION_DETAIL_ROWS_SQL = `
  select
    snapshot.snapshot_date::text as snapshot_date,
    snapshot.account,
    snapshot.source,
    snapshot.asset_id::text as asset_id,
    snapshot.legacy_asset_id,
    snapshot.ticker,
    snapshot.asset_name,
    snapshot.market,
    snapshot.currency,
    snapshot.quantity::text as quantity,
    snapshot.current_price::text as current_price,
    snapshot.market_value_local::text as market_value_local,
    snapshot.market_value_krw::text as market_value_krw,
    snapshot.cost_krw::text as cost_krw,
    snapshot.pnl_krw::text as pnl_krw,
    snapshot.pnl_pct::text as pnl_pct,
    snapshot.current_weight::text as current_weight,
    snapshot.fx_rate::text as fx_rate,
    snapshot.price_source,
    snapshot.price_basis
  from public.daily_position_snapshots as snapshot
  inner join public.accounts as account on snapshot.account_id = account.id
  where account.id = $1::uuid
    and account.is_active = true
    and account.code = $2::text
    and snapshot.account = account.code
    and snapshot.snapshot_date = $3::date
    and snapshot.source = $4::text
    and snapshot.is_sample = false
  order by snapshot.market_value_krw desc, snapshot.asset_name, snapshot.legacy_asset_id
  limit $5::integer
`;

const TENANT_HISTORY_POSITION_COMPARISON_ROWS_SQL = `
  select
    snapshot.snapshot_date::text as snapshot_date,
    snapshot.account,
    snapshot.source,
    snapshot.asset_id::text as asset_id,
    snapshot.legacy_asset_id,
    snapshot.ticker,
    snapshot.asset_name,
    snapshot.market,
    snapshot.currency,
    snapshot.quantity::text as quantity,
    snapshot.market_value_krw::text as market_value_krw
  from public.daily_position_snapshots as snapshot
  inner join public.accounts as account on snapshot.account_id = account.id
  where account.id = $1::uuid
    and account.is_active = true
    and account.code = $2::text
    and snapshot.account = account.code
    and snapshot.snapshot_date = $3::date
    and snapshot.source = $4::text
    and snapshot.is_sample = false
  order by snapshot.asset_name, snapshot.legacy_asset_id
  limit $5::integer
`;

const TENANT_HISTORY_GROUP_POSITION_ROWS_SQL = `
  select
    snapshot.snapshot_date::text as snapshot_date,
    snapshot.source,
    snapshot.account,
    snapshot.account_id::text as account_id,
    snapshot.asset_id::text as asset_id,
    snapshot.market_value_krw::text as market_value_krw,
    snapshot.cost_krw::text as cost_krw,
    snapshot.pnl_krw::text as pnl_krw
  from public.daily_position_snapshots as snapshot
  where snapshot.is_sample = false
    and snapshot.snapshot_date >= $1::date
    and (
      snapshot.account_id = any($2::uuid[])
      or snapshot.asset_id = any($3::uuid[])
    )
  order by snapshot.snapshot_date, snapshot.source, snapshot.account,
    snapshot.asset_name
`;

function projectPortfolioRow(
  row: Readonly<Record<string, unknown>>,
): PortfolioHistoryRawRow {
  return Object.freeze({
    snapshotDate: requiredString(row.snapshot_date),
    account: requiredString(row.account),
    source: requiredString(row.source),
    cashValue: nullableString(row.cash_value),
    investedAmount: nullableString(row.invested_amount),
    totalCost: nullableString(row.total_cost),
    totalMarketValue: nullableString(row.total_market_value),
    totalPnl: nullableString(row.total_pnl),
    totalReturnPct: nullableString(row.total_return_pct),
    avgCorrelation: nullableString(row.avg_correlation),
    enb: nullableString(row.enb),
    portfolioVolatility: nullableString(row.portfolio_volatility),
    regimeLabel: nullableString(row.regime_label),
    regimeScore: nullableString(row.regime_score),
  });
}

function projectPositionDetailRow(
  row: Readonly<Record<string, unknown>>,
): HistoryPositionRawRow {
  return Object.freeze({
    snapshotDate: requiredString(row.snapshot_date),
    account: requiredString(row.account),
    source: requiredString(row.source),
    assetId: nullableString(row.asset_id),
    legacyAssetId: nullableString(row.legacy_asset_id),
    ticker: nullableString(row.ticker),
    assetName: requiredString(row.asset_name),
    market: nullableString(row.market),
    currency: nullableString(row.currency),
    quantity: nullableString(row.quantity),
    currentPrice: nullableString(row.current_price),
    marketValueLocal: nullableString(row.market_value_local),
    marketValueKrw: nullableString(row.market_value_krw),
    costKrw: nullableString(row.cost_krw),
    pnlKrw: nullableString(row.pnl_krw),
    pnlPct: nullableString(row.pnl_pct),
    currentWeight: nullableString(row.current_weight),
    fxRate: nullableString(row.fx_rate),
    priceSource: nullableString(row.price_source),
    priceBasis: nullableString(row.price_basis),
  });
}

function projectPositionComparisonRow(
  row: Readonly<Record<string, unknown>>,
): HistoryPositionComparisonRawRow {
  return Object.freeze({
    snapshotDate: requiredString(row.snapshot_date),
    account: requiredString(row.account),
    source: requiredString(row.source),
    assetId: nullableString(row.asset_id),
    legacyAssetId: nullableString(row.legacy_asset_id),
    ticker: nullableString(row.ticker),
    assetName: requiredString(row.asset_name),
    market: nullableString(row.market),
    currency: nullableString(row.currency),
    quantity: nullableString(row.quantity),
    marketValueKrw: nullableString(row.market_value_krw),
  });
}

function projectGroupPositionRow(
  row: Readonly<Record<string, unknown>>,
): HistoryPositionScopeCandidate {
  return Object.freeze({
    snapshotDate: requiredString(row.snapshot_date),
    source: requiredString(row.source),
    account: requiredString(row.account),
    accountId: nullableString(row.account_id),
    assetId: nullableString(row.asset_id),
    marketValueKrw: nullableString(row.market_value_krw),
    costKrw: nullableString(row.cost_krw),
    pnlKrw: nullableString(row.pnl_krw),
  });
}

function requiredString(value: unknown) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Tenant History snapshot row is invalid");
  }
  return value;
}

function nullableString(value: unknown) {
  return value === null ? null : requiredString(value);
}
