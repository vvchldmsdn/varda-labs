import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  classifyCuratedVectorRehearsalError,
  CURATED_VECTOR_REHEARSAL_ROLLBACK_MARKER,
} from "./lib/curated-vector-rehearsal-error.mjs";

const CONFIRMATION = "--confirm-rollback-rehearsal";
const MIGRATION_PATH = new URL(
  "../drizzle/0018_massive_wolfpack.sql",
  import.meta.url,
);
const EXPECTED_MIGRATION_SHA256 =
  "b3d141bda40af8d24bbff248a5beac7f68c7291175cf813da3aedfff148afc9d";
const EXPECTED_PRIOR_MIGRATION_CREATED_AT = "1783899599456";
const VERSION_COLUMN = "scenario_vector_hash_version";
const VERSION_CONSTRAINT =
  "sim_scenario_approval_revisions_vector_hash_version_check";

if (
  process.argv.slice(2).length !== 1 ||
  process.argv.slice(2)[0] !== CONFIRMATION
) {
  throw new Error(
    `Rollback rehearsal requires the exact ${CONFIRMATION} argument`,
  );
}

const [{ neon, NeonDbError }, { config }] = await Promise.all([
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
const before = await readBoundaryState();
assert.deepEqual(before, {
  rows: { revisions: 0, vectorRows: 0, lifecycleEvents: 0 },
  versionColumn: null,
  versionConstraint: null,
  latestMigrationCreatedAt: EXPECTED_PRIOR_MIGRATION_CREATED_AT,
});

const assertionBlock = `
  do $curated_vector_hash_version$
  declare
    version_column_count integer;
    version_constraint_count integer;
    target_row_count bigint;
  begin
    select count(*)::integer
      into version_column_count
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'simulation_scenario_approval_revisions'
       and column_name = '${VERSION_COLUMN}'
       and data_type = 'character varying'
       and character_maximum_length = 64
       and is_nullable = 'NO'
       and column_default is null;

    select count(*)::integer
      into version_constraint_count
      from pg_catalog.pg_constraint constraint_definition
      join pg_catalog.pg_class target_relation
        on target_relation.oid = constraint_definition.conrelid
      join pg_catalog.pg_namespace target_namespace
        on target_namespace.oid = target_relation.relnamespace
     where target_namespace.nspname = 'public'
       and target_relation.relname = 'simulation_scenario_approval_revisions'
       and constraint_definition.contype = 'c'
       and constraint_definition.conname = '${VERSION_CONSTRAINT}';

    select
      (select count(*) from simulation_scenario_approval_revisions)
      + (select count(*) from simulation_scenario_approval_vector_rows)
      + (select count(*) from simulation_scenario_approval_lifecycle_events)
      into target_row_count;

    if version_column_count <> 1 then
      raise exception 'curated_vector_hash_version_check_failed:column';
    end if;
    if version_constraint_count <> 1 then
      raise exception 'curated_vector_hash_version_check_failed:constraint';
    end if;
    if target_row_count <> 0 then
      raise exception 'curated_vector_hash_version_check_failed:rows';
    end if;

    raise exception '${CURATED_VECTOR_REHEARSAL_ROLLBACK_MARKER}';
  end
  $curated_vector_hash_version$;
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
  const classification = classifyCuratedVectorRehearsalError(
    error,
    NeonDbError,
  );
  if (classification.outcome !== "expected_rollback") {
    throw new Error(
      `Curated vector hash-version rollback rehearsal failed (${classification.reason})`,
    );
  }
  expectedRollbackObserved = true;
}

const after = await readBoundaryState();
assert.deepEqual(after, before, "rollback rehearsal changed database state");

console.log(
  JSON.stringify(
    {
      rehearsal: "curated_approved_vector_hash_version_binding",
      committed: false,
      expectedRollbackObserved,
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
  const [[rows], versionColumns, versionConstraints, [latestMigration]] =
    await Promise.all([
      sql.query(`
        select
          (select count(*)::integer from simulation_scenario_approval_revisions)
            as revisions,
          (select count(*)::integer from simulation_scenario_approval_vector_rows)
            as vector_rows,
          (select count(*)::integer from simulation_scenario_approval_lifecycle_events)
            as lifecycle_events
      `),
      sql.query(`
        select
          data_type,
          character_maximum_length::integer as character_maximum_length,
          is_nullable,
          column_default
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'simulation_scenario_approval_revisions'
           and column_name = '${VERSION_COLUMN}'
      `),
      sql.query(`
        select pg_get_constraintdef(constraint_definition.oid) as definition
          from pg_catalog.pg_constraint constraint_definition
          join pg_catalog.pg_class target_relation
            on target_relation.oid = constraint_definition.conrelid
          join pg_catalog.pg_namespace target_namespace
            on target_namespace.oid = target_relation.relnamespace
         where target_namespace.nspname = 'public'
           and target_relation.relname = 'simulation_scenario_approval_revisions'
           and constraint_definition.conname = '${VERSION_CONSTRAINT}'
      `),
      sql.query(`
        select created_at::text as created_at
          from drizzle.__drizzle_migrations
         order by created_at desc
         limit 1
      `),
    ]);

  return {
    rows: {
      revisions: Number(rows.revisions),
      vectorRows: Number(rows.vector_rows),
      lifecycleEvents: Number(rows.lifecycle_events),
    },
    versionColumn:
      versionColumns.length === 1
        ? {
            type: versionColumns[0].data_type,
            length: Number(versionColumns[0].character_maximum_length),
            nullable: versionColumns[0].is_nullable,
            default: versionColumns[0].column_default,
          }
        : null,
    versionConstraint:
      versionConstraints.length === 1
        ? versionConstraints[0].definition
        : null,
    latestMigrationCreatedAt: latestMigration?.created_at ?? null,
  };
}

function assertMigrationAllowlist(candidateStatements, candidateMigration) {
  assert.equal(
    createHash("sha256")
      .update(candidateMigration.replace(/\r\n/g, "\n"))
      .digest("hex"),
    EXPECTED_MIGRATION_SHA256,
  );
  assert.deepEqual(candidateStatements, [
    'ALTER TABLE "simulation_scenario_approval_revisions" ADD COLUMN "scenario_vector_hash_version" varchar(64) NOT NULL;',
    'ALTER TABLE "simulation_scenario_approval_revisions" ADD CONSTRAINT "sim_scenario_approval_revisions_vector_hash_version_check" CHECK ("simulation_scenario_approval_revisions"."scenario_vector_hash_version" = \'simulation_scenario_vector_hash_v2\');',
  ]);
  assert.doesNotMatch(
    candidateMigration,
    /\b(?:INSERT|UPDATE|DELETE|MERGE|COPY|TRUN(?:CATE)|DROP|RENAME|ALTER COLUMN|SET DEFAULT|CREATE INDEX|CREATE TYPE|CREATE TRIGGER|CREATE FUNCTION|CREATE PROCEDURE|CREATE POLICY|ENABLE ROW LEVEL SECURITY|GRANT|REVOKE)\b/i,
  );
}
