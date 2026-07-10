import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import { TENANT_TABLE_POLICIES } from "./lib/tenant-ownership-policy.mjs";

config({ path: ".env.local", quiet: true });

const CONFIRMATION = "--confirm-rollback-rehearsal";
const ROLLBACK_MARKER = "phase1c_rehearsal_rollback";
const MIGRATION_PATH = new URL(
  "../drizzle/0016_ambiguous_vulcan.sql",
  import.meta.url,
);

if (process.argv.slice(2).join(" ") !== CONFIRMATION) {
  throw new Error(
    `Rollback rehearsal requires the exact ${CONFIRMATION} argument`,
  );
}

const databaseUrl =
  process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Database URL is not set");

const sql = neon(databaseUrl);
const expectedBeforeTables = TENANT_TABLE_POLICIES.map(({ table }) => table).sort();
const before = await readBoundaryState();

assert.deepEqual(before.publicTables, expectedBeforeTables);
assert.equal(before.canonicalOwnerColumns, 0);
assert.equal(before.identityTables, 0);

const migration = await readFile(MIGRATION_PATH, "utf8");
const statements = migration
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);
assert.equal(statements.length, 34);

const assertionBlock = `
  do $phase1c$
  declare
    public_table_count integer;
    identity_table_count integer;
    canonical_column_count integer;
    canonical_index_count integer;
    identity_row_count integer;
  begin
    select count(*)::integer
      into public_table_count
      from information_schema.tables
     where table_schema = 'public'
       and table_type = 'BASE TABLE';

    select count(*)::integer
      into identity_table_count
      from information_schema.tables
     where table_schema = 'public'
       and table_name in ('app_users', 'auth_identities');

    select count(*)::integer
      into canonical_column_count
      from information_schema.columns
     where table_schema = 'public'
       and column_name = 'canonical_owner_user_id'
       and data_type = 'uuid'
       and is_nullable = 'YES'
       and column_default is null;

    select count(*)::integer
      into canonical_index_count
      from pg_indexes
     where schemaname = 'public'
       and indexname like '%_canonical_owner_user_id_idx';

    select
      (select count(*) from app_users)
      + (select count(*) from auth_identities)
      into identity_row_count;

    if public_table_count <> 24 then
      raise exception 'phase1c_check_failed:public_tables';
    end if;
    if identity_table_count <> 2 then
      raise exception 'phase1c_check_failed:identity_tables';
    end if;
    if canonical_column_count <> 14 then
      raise exception 'phase1c_check_failed:canonical_columns';
    end if;
    if canonical_index_count <> 14 then
      raise exception 'phase1c_check_failed:canonical_indexes';
    end if;
    if identity_row_count <> 0 then
      raise exception 'phase1c_check_failed:identity_rows';
    end if;

    raise exception '${ROLLBACK_MARKER}';
  end
  $phase1c$;
`;

try {
  await sql.transaction((txn) => [
    txn.query("set local lock_timeout = '5s'"),
    txn.query("set local statement_timeout = '30s'"),
    ...statements.map((statement) => txn.query(statement)),
    txn.query(assertionBlock),
  ]);
  assert.fail("rollback rehearsal unexpectedly committed");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes(ROLLBACK_MARKER)) throw error;
}

const after = await readBoundaryState();
assert.deepEqual(after, before, "rollback rehearsal changed database state");

console.log(
  JSON.stringify(
    {
      rehearsal: "tenant_expand_phase_1c",
      committed: false,
      expectedRollbackObserved: true,
      databaseSideEffects: false,
      statementsExercised: statements.length,
      before,
      after,
    },
    null,
    2,
  ),
);

async function readBoundaryState() {
  const publicTables = await sql.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
    order by table_name
  `);
  const [counts] = await sql.query(`
    select
      count(*) filter (
        where table_schema = 'public'
          and column_name = 'canonical_owner_user_id'
      )::int as canonical_owner_columns,
      (
        select count(*)::int
        from information_schema.tables
        where table_schema = 'public'
          and table_name in ('app_users', 'auth_identities')
      ) as identity_tables
    from information_schema.columns
  `);

  return {
    publicTables: publicTables.map(({ table_name }) => table_name),
    canonicalOwnerColumns: Number(counts.canonical_owner_columns),
    identityTables: Number(counts.identity_tables),
  };
}
