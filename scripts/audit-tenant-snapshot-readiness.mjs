import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

const sql = neon(databaseUrl);

const [summary] = await sql.query(`
  with
  active_targets as (
    select distinct u.id
    from app_users u
    join accounts a
      on a.canonical_owner_user_id = u.id
     and a.is_active = true
     and a.code in ('brokerage', 'isa', 'irp')
    where u.status = 'active'
      and u.role in ('user', 'admin')
  ),
  account_owner_code_duplicates as (
    select canonical_owner_user_id, code
    from accounts
    where canonical_owner_user_id is not null
    group by canonical_owner_user_id, code
    having count(*) > 1
  ),
  asset_owner_mismatches as (
    select a.id
    from assets a
    left join accounts acct on acct.id = a.account_id
    where a.account_id is null
       or acct.id is null
       or acct.code is distinct from a.account
       or (
         a.canonical_owner_user_id is not null
         and acct.canonical_owner_user_id is distinct from a.canonical_owner_user_id
       )
  ),
  snapshot_owner_orphans as (
    select canonical_owner_user_id
    from daily_portfolio_snapshots p
    where p.canonical_owner_user_id is not null
      and not exists (
        select 1 from app_users u where u.id = p.canonical_owner_user_id
      )
    union all
    select canonical_owner_user_id
    from daily_position_snapshots p
    where p.canonical_owner_user_id is not null
      and not exists (
        select 1 from app_users u where u.id = p.canonical_owner_user_id
      )
  ),
  portfolio_account_owner_mismatches as (
    select p.id
    from daily_portfolio_snapshots p
    left join accounts a
      on a.id = p.account_id
     and a.canonical_owner_user_id = p.canonical_owner_user_id
    where p.account_id is not null
      and p.canonical_owner_user_id is not null
      and a.id is null
  ),
  position_account_owner_mismatches as (
    select p.id
    from daily_position_snapshots p
    left join accounts a
      on a.id = p.account_id
     and a.canonical_owner_user_id = p.canonical_owner_user_id
    where p.account_id is not null
      and p.canonical_owner_user_id is not null
      and a.id is null
  ),
  position_asset_account_mismatches as (
    select p.id
    from daily_position_snapshots p
    left join assets a
      on a.id = p.asset_id
     and a.account_id = p.account_id
    where p.asset_id is not null
      and p.account_id is not null
      and a.id is null
  ),
  missing_position_identities as (
    select id
    from daily_position_snapshots
    where asset_id is null and legacy_asset_id is null
  ),
  generated_portfolio_invalid as (
    select p.id
    from daily_portfolio_snapshots p
    left join accounts acct on acct.id = p.account_id
    where p.source = 'varda_manual_daily_snapshot'
      and (
        p.canonical_owner_user_id is null
        or (
          p.account = 'all'
          and p.account_id is not null
        )
        or (
          p.account in ('brokerage', 'isa', 'irp')
          and (
            p.account_id is null
            or acct.id is null
            or acct.canonical_owner_user_id is distinct from p.canonical_owner_user_id
            or acct.code is distinct from p.account
          )
        )
        or p.account not in ('all', 'brokerage', 'isa', 'irp')
      )
  ),
  generated_position_invalid as (
    select p.id
    from daily_position_snapshots p
    left join accounts acct on acct.id = p.account_id
    left join assets a on a.id = p.asset_id
    where p.source = 'varda_manual_daily_snapshot'
      and (
        p.canonical_owner_user_id is null
        or p.account_id is null
        or p.asset_id is null
        or p.account not in ('brokerage', 'isa', 'irp')
        or acct.id is null
        or a.id is null
        or acct.canonical_owner_user_id is distinct from p.canonical_owner_user_id
        or acct.code is distinct from p.account
        or a.account is distinct from p.account
        or a.account_id is distinct from p.account_id
      )
  ),
  portfolio_key_duplicates as (
    select canonical_owner_user_id, snapshot_date, account, source
    from daily_portfolio_snapshots
    where canonical_owner_user_id is not null
    group by canonical_owner_user_id, snapshot_date, account, source
    having count(*) > 1
  ),
  position_key_duplicates as (
    select canonical_owner_user_id, snapshot_date, account, asset_id, source
    from daily_position_snapshots
    where canonical_owner_user_id is not null
      and asset_id is not null
    group by canonical_owner_user_id, snapshot_date, account, asset_id, source
    having count(*) > 1
  )
  select
    (select count(*)::int from active_targets) as active_target_count,
    (select count(*)::int from account_owner_code_duplicates) as account_owner_code_duplicate_count,
    (select count(*)::int from asset_owner_mismatches) as asset_owner_mismatch_count,
    (select count(*)::int from snapshot_owner_orphans) as snapshot_owner_orphan_count,
    (select count(*)::int from portfolio_account_owner_mismatches) as portfolio_account_owner_mismatch_count,
    (select count(*)::int from position_account_owner_mismatches) as position_account_owner_mismatch_count,
    (select count(*)::int from position_asset_account_mismatches) as position_asset_account_mismatch_count,
    (select count(*)::int from missing_position_identities) as missing_position_identity_count,
    (select count(*)::int from generated_portfolio_invalid) as generated_portfolio_invalid_count,
    (select count(*)::int from generated_position_invalid) as generated_position_invalid_count,
    (select count(*)::int from portfolio_key_duplicates) as portfolio_key_duplicate_count,
    (select count(*)::int from position_key_duplicates) as position_key_duplicate_count,
    (select count(*)::int from daily_portfolio_snapshots where source = 'varda_manual_daily_snapshot') as generated_portfolio_count,
    (select count(*)::int from daily_position_snapshots where source = 'varda_manual_daily_snapshot') as generated_position_count,
    (select count(*)::int from daily_portfolio_snapshots where source = 'varda_manual_daily_snapshot' and canonical_owner_user_id is null) as generated_portfolio_null_owner_count,
    (select count(*)::int from daily_portfolio_snapshots where source = 'varda_manual_daily_snapshot' and account in ('brokerage', 'isa', 'irp') and account_id is null) as generated_portfolio_null_account_count,
    (select count(*)::int from daily_portfolio_snapshots where source = 'varda_manual_daily_snapshot' and account = 'all' and account_id is not null) as generated_all_unexpected_account_count,
    (select count(*)::int from daily_position_snapshots where source = 'varda_manual_daily_snapshot' and canonical_owner_user_id is null) as generated_position_null_owner_count,
    (select count(*)::int from daily_position_snapshots where source = 'varda_manual_daily_snapshot' and account_id is null) as generated_position_null_account_count,
    (select count(*)::int from daily_position_snapshots where source = 'varda_manual_daily_snapshot' and asset_id is null) as generated_position_null_asset_count
`);

const checks = [
  check("active_snapshot_targets", Number(summary.active_target_count) > 0),
  check(
    "account_owner_code_duplicates",
    Number(summary.account_owner_code_duplicate_count) === 0,
  ),
  check("asset_owner_mismatches", Number(summary.asset_owner_mismatch_count) === 0),
  check("snapshot_owner_orphans", Number(summary.snapshot_owner_orphan_count) === 0),
  check(
    "portfolio_account_owner_mismatches",
    Number(summary.portfolio_account_owner_mismatch_count) === 0,
  ),
  check(
    "position_account_owner_mismatches",
    Number(summary.position_account_owner_mismatch_count) === 0,
  ),
  check(
    "position_asset_account_mismatches",
    Number(summary.position_asset_account_mismatch_count) === 0,
  ),
  check(
    "missing_position_identities",
    Number(summary.missing_position_identity_count) === 0,
  ),
  check(
    "generated_portfolio_owner_integrity",
    Number(summary.generated_portfolio_invalid_count) === 0,
  ),
  check(
    "generated_position_owner_integrity",
    Number(summary.generated_position_invalid_count) === 0,
  ),
  check(
    "portfolio_owner_key_duplicates",
    Number(summary.portfolio_key_duplicate_count) === 0,
  ),
  check(
    "position_owner_key_duplicates",
    Number(summary.position_key_duplicate_count) === 0,
  ),
];
const result = {
  audit: "tenant_snapshot_readiness",
  readOnly: true,
  databaseSideEffects: false,
  ok: checks.every(({ ok }) => ok),
  counts: Object.fromEntries(
    Object.entries(summary).map(([key, value]) => [key, Number(value)]),
  ),
  checks,
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;

function check(id, ok) {
  return { id, ok };
}
