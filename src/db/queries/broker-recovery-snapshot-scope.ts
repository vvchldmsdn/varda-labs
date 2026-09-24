import { sql } from "drizzle-orm";

/** Static SQL identifiers only; never pass request text as an alias or scope. */
export function brokerRecoverySnapshotPredicateText(
  alias: "snapshot" | "daily_position_snapshots" | "daily_portfolio_snapshots",
  scopeAccountsSql?: string,
  snapshotTable: "daily_position_snapshots" | "daily_portfolio_snapshots" = alias === "daily_position_snapshots" ? "daily_position_snapshots" : "daily_portfolio_snapshots",
) {
  // A late trade invalidates the old observation, not the underlying immutable row.
  // Whole-scope exclusion avoids presenting the remaining accounts as a full total.
  return `not exists (
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
  )`;
}

export function brokerRecoverySnapshotPredicate(
  table: "daily_position_snapshots" | "daily_portfolio_snapshots",
  scopeAccountIds?: readonly string[],
) {
  return sql.raw(brokerRecoverySnapshotPredicateText(table, recoveryAccountScopeSql(scopeAccountIds)));
}

function recoveryAccountScopeSql(scopeAccountIds?: readonly string[]) {
  if (scopeAccountIds?.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    throw new TypeError("Invalid recovery snapshot account scope");
  }
  return scopeAccountIds?.length
    ? `recovery.account_id in (${scopeAccountIds.map(id => `'${id}'::uuid`).join(",")})`
    : undefined;
}

/** A new daily change must not bridge a correction using an older pre-trade row. */
export function brokerRecoveryBaselinePredicate(snapshotDate: string, scopeAccountIds?: readonly string[]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate) || !Number.isFinite(Date.parse(`${snapshotDate}T00:00:00Z`))) {
    throw new TypeError("Invalid recovery baseline date");
  }
  return sql.raw(brokerRecoverySnapshotPredicateText("daily_position_snapshots", recoveryAccountScopeSql(scopeAccountIds))
    .replace("daily_position_snapshots.snapshot_date >=", `'${snapshotDate}'::date >=`));
}
