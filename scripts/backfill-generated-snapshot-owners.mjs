import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { neon } from "@neondatabase/serverless";

import { guardProductionDatabaseTarget } from "../src/lib/deployment/production-database-target.ts";
import { loadProductionDatabaseEnvironmentFromEnvLocal } from "./lib/production-database-environment.mjs";

const SOURCE = "varda_manual_daily_snapshot";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

if (args.some((arg) => arg !== "--write") || args.length > 1) {
  throw new Error("Usage: npm run snapshots:backfill-owners -- [--write]");
}

const write = args[0] === "--write";
const environment = loadProductionDatabaseEnvironmentFromEnvLocal(repositoryRoot);
const target = guardProductionDatabaseTarget(environment);
const sql = neon(environment.DATABASE_URL_UNPOOLED);
const before = await loadPlan(sql);

if (!before.dataReady) {
  console.log(JSON.stringify(receipt("blocked", before, target), null, 2));
  process.exitCode = 1;
} else if (!write) {
  console.log(
    JSON.stringify(
      receipt(before.schemaReady ? "planned" : "migration_required", before, target),
      null,
      2,
    ),
  );
} else if (!before.schemaReady) {
  console.log(JSON.stringify(receipt("blocked", before, target), null, 2));
  process.exitCode = 1;
} else {
  const [namedWrites, allWrites, positionWrites] = await sql.transaction((tx) => [
    tx`
      update daily_portfolio_snapshots p
      set canonical_owner_user_id = a.canonical_owner_user_id,
          updated_at = now()
      from accounts a
      where p.source = ${SOURCE}
        and p.canonical_owner_user_id is null
        and p.account in ('brokerage', 'isa', 'irp')
        and p.account_id = a.id
        and p.account = a.code
        and a.canonical_owner_user_id is not null
      returning 1
    `,
    tx`
      with mapped as (
        select
          all_rows.id,
          min(a.canonical_owner_user_id::text)::uuid as owner_user_id
        from daily_portfolio_snapshots all_rows
        join daily_portfolio_snapshots named_rows
          on named_rows.snapshot_date = all_rows.snapshot_date
         and named_rows.source = all_rows.source
         and named_rows.account in ('brokerage', 'isa', 'irp')
        join accounts a on a.id = named_rows.account_id
        where all_rows.source = ${SOURCE}
          and all_rows.account = 'all'
          and all_rows.account_id is null
          and all_rows.canonical_owner_user_id is null
          and a.canonical_owner_user_id is not null
        group by all_rows.id
        having count(distinct a.canonical_owner_user_id) = 1
      )
      update daily_portfolio_snapshots p
      set canonical_owner_user_id = mapped.owner_user_id,
          updated_at = now()
      from mapped
      where p.id = mapped.id
      returning 1
    `,
    tx`
      update daily_position_snapshots p
      set canonical_owner_user_id = a.canonical_owner_user_id,
          updated_at = now()
      from accounts a, assets asset
      where p.source = ${SOURCE}
        and p.canonical_owner_user_id is null
        and p.account_id = a.id
        and p.asset_id = asset.id
        and p.account = a.code
        and p.account = asset.account
        and p.account_id = asset.account_id
        and a.canonical_owner_user_id is not null
      returning 1
    `,
    tx`
      alter table daily_portfolio_snapshots
      validate constraint daily_portfolio_snapshots_generated_owner_check
    `,
    tx`
      alter table daily_position_snapshots
      validate constraint daily_position_snapshots_generated_owner_check
    `,
  ]);
  const after = await loadPlan(sql);
  const updated =
    namedWrites.length + allWrites.length + positionWrites.length;

  if (
    !after.dataReady ||
    !after.constraintsValidated ||
    after.requiredWrites !== 0
  ) {
    throw new Error("Snapshot owner backfill postflight failed");
  }

  console.log(
    JSON.stringify(
      {
        ...receipt("written", after, target),
        updatedRows: updated,
        expectedRows: before.requiredWrites,
      },
      null,
      2,
    ),
  );
}

async function loadPlan(query) {
  const [row] = await query.query(`
    with
    named_required as (
      select id
      from daily_portfolio_snapshots
      where source = '${SOURCE}'
        and account in ('brokerage', 'isa', 'irp')
        and canonical_owner_user_id is null
    ),
    named_candidates as (
      select p.id
      from daily_portfolio_snapshots p
      join accounts a on a.id = p.account_id
      where p.source = '${SOURCE}'
        and p.account in ('brokerage', 'isa', 'irp')
        and p.canonical_owner_user_id is null
        and p.account = a.code
        and a.canonical_owner_user_id is not null
    ),
    all_required as (
      select id
      from daily_portfolio_snapshots
      where source = '${SOURCE}'
        and account = 'all'
        and canonical_owner_user_id is null
    ),
    all_candidates as (
      select all_rows.id
      from daily_portfolio_snapshots all_rows
      join daily_portfolio_snapshots named_rows
        on named_rows.snapshot_date = all_rows.snapshot_date
       and named_rows.source = all_rows.source
       and named_rows.account in ('brokerage', 'isa', 'irp')
      join accounts a on a.id = named_rows.account_id
      where all_rows.source = '${SOURCE}'
        and all_rows.account = 'all'
        and all_rows.account_id is null
        and all_rows.canonical_owner_user_id is null
        and a.canonical_owner_user_id is not null
      group by all_rows.id
      having count(distinct a.canonical_owner_user_id) = 1
    ),
    position_required as (
      select id
      from daily_position_snapshots
      where source = '${SOURCE}'
        and canonical_owner_user_id is null
    ),
    position_candidates as (
      select p.id
      from daily_position_snapshots p
      join accounts a on a.id = p.account_id
      join assets asset on asset.id = p.asset_id
      where p.source = '${SOURCE}'
        and p.canonical_owner_user_id is null
        and p.account = a.code
        and p.account = asset.account
        and p.account_id = asset.account_id
        and a.canonical_owner_user_id is not null
    )
    select
      (select count(*)::int from named_required) as named_required,
      (select count(*)::int from named_candidates) as named_candidates,
      (select count(*)::int from all_required) as all_required,
      (select count(*)::int from all_candidates) as all_candidates,
      (select count(*)::int from position_required) as position_required,
      (select count(*)::int from position_candidates) as position_candidates,
      (
        select count(*)::int
        from pg_constraint
        where conname in (
          'daily_portfolio_snapshots_generated_owner_check',
          'daily_position_snapshots_generated_owner_check'
        )
      ) as owner_check_constraint_count,
      (
        select count(*)::int
        from pg_constraint
        where conname in (
          'daily_portfolio_snapshots_generated_owner_check',
          'daily_position_snapshots_generated_owner_check'
        )
          and convalidated
      ) as owner_check_validated_count
  `);
  const counts = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, Number(value)]),
  );
  const requiredWrites =
    counts.named_required + counts.all_required + counts.position_required;
  const candidateWrites =
    counts.named_candidates + counts.all_candidates + counts.position_candidates;

  const dataReady = requiredWrites === candidateWrites;
  const schemaReady = counts.owner_check_constraint_count === 2;

  return {
    ...counts,
    requiredWrites,
    candidateWrites,
    dataReady,
    schemaReady,
    constraintsValidated: counts.owner_check_validated_count === 2,
    readyForWrite: dataReady && schemaReady,
  };
}

function receipt(status, plan, target) {
  return {
    operation: "generated_snapshot_owner_backfill_v1",
    mode: write ? "write" : "dry_run",
    status,
    databaseTargetGuard: target.status,
    databaseTargetFingerprint: target.targetFingerprint,
    source: SOURCE,
    plan,
  };
}
