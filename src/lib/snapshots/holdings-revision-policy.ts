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

/** Native closing frames exclude an event at exactly 07:00. A holdings repair
 * uses the source row's actual cutoff, as does its revision enqueue trigger. */
export function snapshotWorkRevisionAppliesSql(alias: string) {
  const scheduled = `(${alias}.snapshot_date::timestamp AT TIME ZONE 'Asia/Seoul')+interval '7 hours'`;
  return `case when ${alias}.stage='native' then r.affected_at < ${scheduled}
    else r.affected_at <= coalesce((select s.cycle_end_at from daily_portfolio_snapshots s
    where s.account_id=${alias}.account_id and s.canonical_owner_user_id=${alias}.canonical_owner_user_id
      and s.snapshot_date=${alias}.snapshot_date and s.source='varda_manual_daily_snapshot' and not s.is_sample limit 1),
    ${scheduled}) end`;
}
