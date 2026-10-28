import {brokerRecoverySnapshotPredicateText} from './history-read-sql';
// Limited port of original portfolio-dashboard recent-position SELECT. IDs come only
// from the already-admitted server dashboard. The SQL rechecks owner/account/asset.
export const BETA_HEATMAP_ROWS_SQL=`
 select snapshot.snapshot_date::text as snapshot_date,
 snapshot.cycle_end_at::text as cycle_end_at, snapshot.asset_id::text as asset_id,
 snapshot.ticker, snapshot.asset_name, account.code as account,
 snapshot.unit_value_change_pct as unit_value_change_pct,
 snapshot.market_value_change_pct, snapshot.market_value_change_krw,
 snapshot.price_change_krw, snapshot.fx_change_krw, snapshot.market_value_krw,
 snapshot.cost_krw, snapshot.pnl_krw, snapshot.source,
 snapshot.captured_at::text as captured_at, snapshot.created_at::text as created_at
 from public.daily_position_snapshots as snapshot
 join public.accounts as account on account.id=snapshot.account_id
 join public.assets as holding on holding.id=snapshot.asset_id and holding.account_id=account.id
 where snapshot.canonical_owner_user_id=current_setting('app.current_user_id',true)::uuid
 and account.canonical_owner_user_id=snapshot.canonical_owner_user_id
 and holding.canonical_owner_user_id=snapshot.canonical_owner_user_id
 and account.is_active=true and holding.archived_at is null
 and snapshot.account=account.code and holding.account=account.code
 and not snapshot.is_sample and snapshot.asset_id=any($1::uuid[])
 and snapshot.snapshot_date <= $2::date
 and ${brokerRecoverySnapshotPredicateText('snapshot',undefined,'daily_position_snapshots')}
 order by snapshot.snapshot_date desc, snapshot.captured_at desc nulls last, snapshot.created_at desc
 limit $3
`;
