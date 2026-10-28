import "server-only";

// Limited read-only port of the verified deployment source copy; no writer imports.
// src/db/queries/tenant-history-snapshots.ts SHA256 b268d18020284cf4971972893a8ed34ef9152a5aad5ab8a77866527cfd192590
// src/db/queries/broker-recovery-snapshot-scope.ts SHA256 1522c12199a61a62b5ebe61d02766f55fef4ebae4b5142c406fc29ca6ae56b17
// src/lib/snapshots/holdings-revision-policy.ts SHA256 82a2696cce60ee2c6f6421f390eaa47cac1f38ceb37c7ccb29cf1021c2266fb6
/** Only code-owned identifiers are accepted by callers. A correction affects
 * the original valuation instant, not the delayed repair's wall clock. */
export function holdingsRevisionInvalidSql(alias: string, revision = "revision") {
  return `${alias}.source='varda_manual_daily_snapshot'
    and ${revision}.canonical_owner_user_id=${alias}.canonical_owner_user_id
    and (${revision}.account_id=${alias}.account_id or ${alias}.account='all')
    and ${revision}.affected_at <= coalesce(${alias}.cycle_end_at,(${alias}.snapshot_date::timestamp AT TIME ZONE 'Asia/Seoul')+interval '7 hours')
    and ${revision}.recorded_at > coalesce(${alias}.captured_at,${alias}.created_at)
    and ((${alias}.account<>'all' and ${revision}.marker_sequence > coalesce(substring(${alias}.description from '(?:^|; )native_revision=([0-9]+)(?:;|$)')::integer,0))
      or (${alias}.account='all' and ${revision}.recorded_at>coalesce(${alias}.updated_at,${alias}.captured_at,${alias}.created_at)))`;
}

export function holdingsRevisionValidSql(alias: string, scopeAccountsSql?: string) {
  const own = `not exists(select 1 from public.native_ledger_revisions revision where ${holdingsRevisionInvalidSql(alias)})`;
  if (!scopeAccountsSql) return own;
  // A combined scope cannot quietly drop its invalidated account and look whole.
  return `${own} and not exists(select 1 from public.daily_portfolio_snapshots revision_snapshot
    join public.native_ledger_revisions revision on (${holdingsRevisionInvalidSql("revision_snapshot")})
    where revision_snapshot.canonical_owner_user_id=${alias}.canonical_owner_user_id
      and revision_snapshot.snapshot_date=${alias}.snapshot_date and not revision_snapshot.is_sample
      and (${scopeAccountsSql.replaceAll("recovery.account_id", "revision.account_id")}))`;
}


/** Static SQL identifiers only; never pass request text as an alias or scope. */
export function brokerRecoverySnapshotPredicateText(
  alias: "snapshot" | "daily_position_snapshots" | "daily_portfolio_snapshots",
  scopeAccountsSql?: string,
  snapshotTable: "daily_position_snapshots" | "daily_portfolio_snapshots" = alias === "daily_position_snapshots" ? "daily_position_snapshots" : "daily_portfolio_snapshots",
) {
  // A late trade invalidates the old observation, not the underlying immutable row.
  // Whole-scope exclusion avoids presenting the remaining accounts as a full total.
  return `${holdingsRevisionValidSql(alias, scopeAccountsSql)} and not exists (
    select 1 from public.broker_recovery_batches as recovery
    where recovery.canonical_owner_user_id = ${alias}.canonical_owner_user_id
      and (recovery.account_id = ${alias}.account_id or ${alias}.account = 'all'
        ${scopeAccountsSql ? `or (${scopeAccountsSql})` : ""})
      and ${alias}.snapshot_date >= (
        select min(trade->>'tradeDate')::date
        from jsonb_array_elements(recovery.manifest->'trades') as trade
      )
      and (coalesce(${alias}.captured_at, ${alias}.created_at) <= recovery.recorded_at
        ${scopeAccountsSql ? `or not exists (
          select 1 from public.${snapshotTable} as corrected_snapshot
          where corrected_snapshot.canonical_owner_user_id = recovery.canonical_owner_user_id
            and corrected_snapshot.account_id = recovery.account_id
            and corrected_snapshot.snapshot_date = ${alias}.snapshot_date
            and corrected_snapshot.source = ${alias}.source
            and corrected_snapshot.is_sample = false
            and coalesce(corrected_snapshot.captured_at, corrected_snapshot.created_at) > recovery.recorded_at
        )` : ""})
  ) and not exists (
    select 1 from public.${snapshotTable} as newer_reconstruction
    where ${alias}.source like 'broker_reconstructed_close_v1:%'
      and newer_reconstruction.canonical_owner_user_id=${alias}.canonical_owner_user_id
      and newer_reconstruction.account_id=${alias}.account_id
      and newer_reconstruction.snapshot_date=${alias}.snapshot_date
      and newer_reconstruction.source like 'broker_reconstructed_close_v1:%'
      and newer_reconstruction.source<>${alias}.source
      and coalesce(newer_reconstruction.captured_at,newer_reconstruction.created_at)>coalesce(${alias}.captured_at,${alias}.created_at)
      and newer_reconstruction.is_sample=false
  )`;
}


// The snapshot column allowlist is intentionally smaller than the source page.
// Parameters: [owned scope account UUIDs, or null for the authenticated owner].
export const BETA_HISTORY_PORTFOLIO_ROWS_SQL = `
  select
    snapshot.snapshot_date::text as snapshot_date,
    snapshot.cycle_end_at::text as cycle_end_at,
    account.code as account,
    snapshot.source,
    snapshot.cash_value::text as cash_value,
    snapshot.invested_amount::text as invested_amount,
    snapshot.total_cost::text as total_cost,
    snapshot.total_market_value::text as total_market_value,
    snapshot.total_pnl::text as total_pnl,
    snapshot.total_return_pct::text as total_return_pct
  from public.daily_portfolio_snapshots as snapshot
  inner join public.accounts as account on snapshot.account_id = account.id
  where account.is_active = true
    and snapshot.account = account.code
    and snapshot.is_sample = false
    and ${brokerRecoverySnapshotPredicateText("snapshot", "$1::uuid[] is null or recovery.account_id = any($1::uuid[])")}
    and ($1::uuid[] is null or account.id = any($1::uuid[]))
  order by snapshot.snapshot_date, account.sort_order, account.code, snapshot.source
`;

// Parameters: [first membership date, owned whole-account UUIDs, owned asset UUIDs].
export const BETA_HISTORY_GROUP_POSITION_ROWS_SQL = `
  select
    snapshot.snapshot_date::text as snapshot_date,
    snapshot.cycle_end_at::text as cycle_end_at,
    snapshot.source,
    snapshot.account,
    snapshot.account_id::text as account_id,
    snapshot.asset_id::text as asset_id,
    snapshot.market_value_krw::text as market_value_krw,
    snapshot.cost_krw::text as cost_krw,
    snapshot.pnl_krw::text as pnl_krw
  from public.daily_position_snapshots as snapshot
  where snapshot.is_sample = false
    and ${brokerRecoverySnapshotPredicateText("snapshot", "recovery.account_id = any($2::uuid[]) or recovery.account_id in (select account_id from public.assets where id = any($3::uuid[]))", "daily_position_snapshots")}
    and snapshot.snapshot_date >= $1::date
    and (
      snapshot.account_id = any($2::uuid[])
      or snapshot.asset_id = any($3::uuid[])
    )
  order by snapshot.snapshot_date, snapshot.source, snapshot.account,
    snapshot.asset_name
`;
