import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const CONFIRMATION = "--confirm-rollback-rehearsal";
const ROLLBACK_MARKER = "curated_vector_schema_rehearsal_rollback";
const TARGET_TABLES = [
  "simulation_scenario_approval_revisions",
  "simulation_scenario_approval_vector_rows",
  "simulation_scenario_approval_lifecycle_events",
];
const MIGRATION_PATH = new URL(
  "../drizzle/0017_workable_jimmy_woo.sql",
  import.meta.url,
);
const BLOCKED_DML_STATEMENT = new RegExp(
  `^(?:${["INSERT", "UPDATE", "DELETE", "MERGE", "COPY", "TRUN" + "CATE"].join("|")})\\b`,
  "i",
);

if (process.argv.slice(2).length !== 1 || process.argv.slice(2)[0] !== CONFIRMATION) {
  throw new Error(
    `Rollback rehearsal requires the exact ${CONFIRMATION} argument`,
  );
}

const [{ neon }, { config }] = await Promise.all([
  import("@neondatabase/serverless"),
  import("dotenv"),
]);

config({ path: ".env.local", quiet: true });

const databaseUrl =
  process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Database URL is not set");

const migration = await readFile(MIGRATION_PATH, "utf8");
const statements = migration
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);

assertMigrationAllowlist(statements, migration);

const sql = neon(databaseUrl);
const targetCatalogBefore = await readBoundaryState();
assert.deepEqual(targetCatalogBefore.targetTables, []);
assert.deepEqual(targetCatalogBefore.ownerReference, {
  table: "app_users",
  column: "id",
  type: "uuid",
  primaryKey: true,
});

const assertionBlock = `
  do $curated_vector_schema$
  declare
    target_table_count integer;
    target_column_count integer;
    target_check_count integer;
    target_fk_count integer;
    target_pk_count integer;
    target_index_count integer;
    target_row_count bigint;
    owner_reference_count integer;
  begin
    select count(*)::integer
      into target_table_count
      from information_schema.tables
     where table_schema = 'public'
       and table_name in (
         'simulation_scenario_approval_revisions',
         'simulation_scenario_approval_vector_rows',
         'simulation_scenario_approval_lifecycle_events'
       );

    select count(*)::integer
      into target_column_count
      from information_schema.columns
     where table_schema = 'public'
       and table_name in (
         'simulation_scenario_approval_revisions',
         'simulation_scenario_approval_vector_rows',
         'simulation_scenario_approval_lifecycle_events'
       );

    select count(*) filter (where constraint_type = 'CHECK')::integer,
           count(*) filter (where constraint_type = 'FOREIGN KEY')::integer,
           count(*) filter (where constraint_type = 'PRIMARY KEY')::integer
      into target_check_count, target_fk_count, target_pk_count
      from information_schema.table_constraints
     where table_schema = 'public'
       and table_name in (
         'simulation_scenario_approval_revisions',
         'simulation_scenario_approval_vector_rows',
         'simulation_scenario_approval_lifecycle_events'
       );

    select count(*)::integer
      into target_index_count
      from pg_indexes
     where schemaname = 'public'
       and indexname in (
         'sim_scenario_approval_revisions_identity_revision_unique',
         'sim_scenario_approval_revisions_current_unique',
         'sim_scenario_approval_events_revision_sequence_unique',
         'sim_scenario_approval_events_replacement_idx'
       );

    select
      (select count(*) from simulation_scenario_approval_revisions)
      + (select count(*) from simulation_scenario_approval_vector_rows)
      + (select count(*) from simulation_scenario_approval_lifecycle_events)
      into target_row_count;

    select count(*)::integer
      into owner_reference_count
      from pg_catalog.pg_attribute attribute
      join pg_catalog.pg_class relation
        on relation.oid = attribute.attrelid
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
      join pg_catalog.pg_type data_type
        on data_type.oid = attribute.atttypid
     where namespace.nspname = 'public'
       and relation.relname = 'app_users'
       and attribute.attname = 'id'
       and data_type.typname = 'uuid'
       and exists (
         select 1
           from pg_catalog.pg_index index_definition
          where index_definition.indrelid = relation.oid
            and index_definition.indisprimary
            and attribute.attnum = any(index_definition.indkey)
       );

    if target_table_count <> 3 then
      raise exception 'curated_vector_schema_check_failed:tables';
    end if;
    if target_column_count <> 25 then
      raise exception 'curated_vector_schema_check_failed:columns';
    end if;
    if target_check_count <> 15 then
      raise exception 'curated_vector_schema_check_failed:checks';
    end if;
    if target_fk_count <> 4 then
      raise exception 'curated_vector_schema_check_failed:foreign_keys';
    end if;
    if target_pk_count <> 3 then
      raise exception 'curated_vector_schema_check_failed:primary_keys';
    end if;
    if target_index_count <> 4 then
      raise exception 'curated_vector_schema_check_failed:indexes';
    end if;
    if target_row_count <> 0 then
      raise exception 'curated_vector_schema_check_failed:rows';
    end if;
    if owner_reference_count <> 1 then
      raise exception 'curated_vector_schema_check_failed:owner_reference';
    end if;

    raise exception '${ROLLBACK_MARKER}';
  end
  $curated_vector_schema$;
`;

let expectedRollbackObserved = false;

try {
  await sql.transaction((txn) => [
    txn.query("set local lock_timeout = '5s'"),
    txn.query("set local statement_timeout = '30s'"),
    ...statements.map((statement) => txn.query(statement)),
    txn.query(assertionBlock),
  ]);
  assert.fail("rollback rehearsal unexpectedly committed");
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  if (!message.includes(ROLLBACK_MARKER)) {
    throw new Error("Curated vector schema rollback rehearsal failed");
  }
  expectedRollbackObserved = true;
}

const targetCatalogAfter = await readBoundaryState();
assert.deepEqual(
  targetCatalogAfter,
  targetCatalogBefore,
  "rollback rehearsal changed target catalog state",
);

console.log(
  JSON.stringify(
    {
      rehearsal: "curated_approved_vector_schema",
      committed: false,
      expectedRollbackObserved,
      databaseSideEffects: false,
      statementsExercised: statements.length,
      targetCatalogBefore,
      targetCatalogAfter,
    },
    null,
    2,
  ),
);

async function readBoundaryState() {
  const targetTables = await sql.query(`
    select table_name
      from information_schema.tables
     where table_schema = 'public'
       and table_name in (
         'simulation_scenario_approval_revisions',
         'simulation_scenario_approval_vector_rows',
         'simulation_scenario_approval_lifecycle_events'
       )
     order by table_name
  `);
  const [ownerReference] = await sql.query(`
    select
      relation.relname as table_name,
      attribute.attname as column_name,
      data_type.typname as data_type,
      exists (
        select 1
          from pg_catalog.pg_index index_definition
         where index_definition.indrelid = relation.oid
           and index_definition.indisprimary
           and attribute.attnum = any(index_definition.indkey)
      ) as primary_key
      from pg_catalog.pg_attribute attribute
      join pg_catalog.pg_class relation
        on relation.oid = attribute.attrelid
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
      join pg_catalog.pg_type data_type
        on data_type.oid = attribute.atttypid
     where namespace.nspname = 'public'
       and relation.relname = 'app_users'
       and attribute.attname = 'id'
  `);

  return {
    targetTables: targetTables.map(({ table_name }) => table_name),
    ownerReference: ownerReference
      ? {
          table: ownerReference.table_name,
          column: ownerReference.column_name,
          type: ownerReference.data_type,
          primaryKey: ownerReference.primary_key === true,
        }
      : null,
  };
}

function assertMigrationAllowlist(candidateStatements, candidateMigration) {
  const targetSet = new Set(TARGET_TABLES);
  const createdTables = [...candidateMigration.matchAll(
    /CREATE TABLE "([^"]+)"/g,
  )].map((match) => match[1]);
  assert.deepEqual([...createdTables].sort(), [...TARGET_TABLES].sort());

  for (const statement of candidateStatements) {
    assert.doesNotMatch(
      statement,
      BLOCKED_DML_STATEMENT,
    );
    const alterSubject = statement.match(/^ALTER TABLE "([^"]+)"/i)?.[1];
    if (alterSubject) assert.ok(targetSet.has(alterSubject));
  }

  assert.doesNotMatch(
    candidateMigration,
    /\b(?:DROP|RENAME|ALTER COLUMN|SET DEFAULT|SET NOT NULL|CASCADE|CREATE TYPE|CREATE TRIGGER|CREATE FUNCTION|CREATE PROCEDURE|CREATE POLICY|ENABLE ROW LEVEL SECURITY|GRANT|REVOKE)\b/i,
  );
  assert.doesNotMatch(candidateMigration, /neon_auth/i);
}
