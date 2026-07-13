import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  classifyCuratedVectorRehearsalError,
  CURATED_VECTOR_REHEARSAL_ROLLBACK_MARKER,
} from "./lib/curated-vector-rehearsal-error.mjs";

const CONFIRMATION = "--confirm-rollback-rehearsal";
const TARGET_TABLES = [
  "simulation_scenario_approval_revisions",
  "simulation_scenario_approval_vector_rows",
  "simulation_scenario_approval_lifecycle_events",
];
const MIGRATION_PATH = new URL(
  "../drizzle/0017_workable_jimmy_woo.sql",
  import.meta.url,
);
const EXPECTED_MIGRATION_SHA256 =
  "8f736749953d3c5f1f814a87a803729be1eb91932eb1694d64feb69e728930b8";
const EXPECTED_STATEMENT_SIGNATURES = [
  "create_table:simulation_scenario_approval_lifecycle_events",
  "create_table:simulation_scenario_approval_revisions",
  "create_table:simulation_scenario_approval_vector_rows",
  "foreign_key:simulation_scenario_approval_lifecycle_events:sim_scenario_approval_events_revision_fk",
  "foreign_key:simulation_scenario_approval_lifecycle_events:sim_scenario_approval_events_replacement_fk",
  "foreign_key:simulation_scenario_approval_revisions:sim_scenario_approval_revisions_owner_user_fk",
  "foreign_key:simulation_scenario_approval_vector_rows:sim_scenario_approval_vector_rows_revision_fk",
  "index:simulation_scenario_approval_lifecycle_events:sim_scenario_approval_events_replacement_idx",
  "unique_index:simulation_scenario_approval_lifecycle_events:sim_scenario_approval_events_revision_sequence_unique",
  "unique_index:simulation_scenario_approval_revisions:sim_scenario_approval_revisions_current_unique",
  "unique_index:simulation_scenario_approval_revisions:sim_scenario_approval_revisions_identity_revision_unique",
].sort();
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

    select count(*) filter (
             where constraint_definition.contype = 'c'
               and constraint_definition.conname in (
                 'sim_scenario_approval_revisions_policy_id_check',
                 'sim_scenario_approval_revisions_gate0_commit_check',
                 'sim_scenario_approval_revisions_scenario_id_check',
                 'sim_scenario_approval_revisions_scenario_version_check',
                 'sim_scenario_approval_revisions_revision_check',
                 'sim_scenario_approval_revisions_vector_hash_check',
                 'sim_scenario_approval_revisions_lifecycle_status_check',
                 'sim_scenario_approval_revisions_terminal_state_check',
                 'sim_scenario_approval_vector_rows_market_check',
                 'sim_scenario_approval_vector_rows_currency_check',
                 'sim_scenario_approval_vector_rows_ticker_check',
                 'sim_scenario_approval_vector_rows_weight_check',
                 'sim_scenario_approval_events_sequence_check',
                 'sim_scenario_approval_events_audit_version_check',
                 'sim_scenario_approval_events_transition_shape_check'
               )
           )::integer,
           count(*) filter (
             where constraint_definition.contype = 'f'
               and constraint_definition.conname in (
                 'sim_scenario_approval_revisions_owner_user_fk',
                 'sim_scenario_approval_vector_rows_revision_fk',
                 'sim_scenario_approval_events_revision_fk',
                 'sim_scenario_approval_events_replacement_fk'
               )
           )::integer,
           count(*) filter (
             where constraint_definition.contype = 'p'
           )::integer
      into target_check_count, target_fk_count, target_pk_count
      from pg_catalog.pg_constraint constraint_definition
      join pg_catalog.pg_class target_relation
        on target_relation.oid = constraint_definition.conrelid
      join pg_catalog.pg_namespace target_namespace
        on target_namespace.oid = target_relation.relnamespace
     where target_namespace.nspname = 'public'
       and target_relation.relname in (
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

    raise exception '${CURATED_VECTOR_REHEARSAL_ROLLBACK_MARKER}';
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
  const classification = classifyCuratedVectorRehearsalError(error);
  if (classification.outcome !== "expected_rollback") {
    throw new Error(
      `Curated vector schema rollback rehearsal failed (${classification.reason})`,
    );
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
  const statementSignatures = candidateStatements
    .map(statementSignature)
    .sort();
  assert.deepEqual(statementSignatures, EXPECTED_STATEMENT_SIGNATURES);
  assert.equal(
    createHash("sha256")
      .update(candidateMigration.replace(/\r\n/g, "\n"))
      .digest("hex"),
    EXPECTED_MIGRATION_SHA256,
    "migration content differs from the reviewed Stage I artifact",
  );

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

function statementSignature(statement) {
  const createTable = statement.match(/^CREATE TABLE "([^"]+)" \(/);
  if (createTable) return `create_table:${createTable[1]}`;

  const foreignKey = statement.match(
    /^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" FOREIGN KEY/,
  );
  if (foreignKey) return `foreign_key:${foreignKey[1]}:${foreignKey[2]}`;

  const uniqueIndex = statement.match(
    /^CREATE UNIQUE INDEX "([^"]+)" ON "([^"]+)"/,
  );
  if (uniqueIndex) return `unique_index:${uniqueIndex[2]}:${uniqueIndex[1]}`;

  const regularIndex = statement.match(
    /^CREATE INDEX "([^"]+)" ON "([^"]+)"/,
  );
  if (regularIndex) return `index:${regularIndex[2]}:${regularIndex[1]}`;

  throw new Error("migration statement is outside the exact Stage II allowlist");
}
