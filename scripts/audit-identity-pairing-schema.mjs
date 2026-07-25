import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { neon } from "@neondatabase/serverless";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const MIGRATIONS_FOLDER = join(process.cwd(), "drizzle");
const PAIRING_TABLES = [
  "identity_pairing_intent_events",
  "identity_pairing_intents",
];
const TRUNCATE_TRIGGER_EVENT = ["TRUN", "CATE"].join("");
const options = readOptions(process.argv.slice(2));

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const sql = neon(process.env.DATABASE_URL);
const localMigration = readLatestLocalMigration();
const publicTables = await sql.query(`
  select table_name
  from information_schema.tables
  where table_schema = 'public'
    and table_type = 'BASE TABLE'
  order by table_name
`);
const publicTableNames = publicTables.map(({ table_name }) => table_name);
const pairingPresence = PAIRING_TABLES.map((table) =>
  publicTableNames.includes(table),
);
assert.ok(
  pairingPresence.every(Boolean) || pairingPresence.every((value) => !value),
  "identity pairing schema is partially present",
);
const state = pairingPresence.every(Boolean) ? "present" : "absent";
if (options.expectedState !== null) {
  assert.equal(state, options.expectedState, "pairing schema state mismatch");
}

const appliedMigrations = await sql.query(`
  select hash, created_at::text as created_at
  from drizzle.__drizzle_migrations
  order by created_at asc
`);
const appliedLocalMigration = appliedMigrations.find(
  ({ created_at }) => Number(created_at) === localMigration.createdAt,
);

const productRowCounts = [];
for (const table of publicTableNames.filter(
  (table) => !PAIRING_TABLES.includes(table),
)) {
  assert.match(table, /^[a-z0-9_]+$/, `unsafe table identifier: ${table}`);
  const [row] = await sql.query(
    `select count(*)::int as row_count from "${table}"`,
  );
  productRowCounts.push({
    table,
    rowCount: Number(row.row_count),
  });
}
const productRowCountsSha256 = canonicalSha256(productRowCounts);
if (options.expectedProductRowCountsSha256 !== null) {
  assert.equal(
    productRowCountsSha256,
    options.expectedProductRowCountsSha256,
    "existing product row counts changed during migration",
  );
}

let catalogEvidence = null;
if (state === "absent") {
  assert.equal(
    appliedLocalMigration,
    undefined,
    "migration ledger contains 0021 while pairing tables are absent",
  );
} else {
  assert.ok(
    appliedLocalMigration,
    "pairing tables exist without the reviewed 0021 ledger entry",
  );
  assert.equal(
    String(appliedLocalMigration.hash),
    localMigration.drizzleHash,
    "applied 0021 hash differs from the local migration",
  );
  catalogEvidence = await auditPresentSchema(sql);
}

console.log(
  JSON.stringify(
    {
      audit: "identity_pairing_schema_catalog",
      status: "passed",
      state,
      readOnly: true,
      databaseWrites: 0,
      localMigration,
      appliedMigration:
        appliedLocalMigration === undefined
          ? null
          : {
              createdAt: Number(appliedLocalMigration.created_at),
              drizzleHash: String(appliedLocalMigration.hash),
            },
      publicTableCount: publicTableNames.length,
      pairingRows: catalogEvidence?.pairingRows ?? null,
      catalogEvidence,
      productRowCounts,
      productRowCountsSha256,
    },
    null,
    2,
  ),
);

async function auditPresentSchema(query) {
  const columns = await query.query(`
    select
      table_name,
      column_name,
      data_type,
      is_nullable,
      column_default,
      ordinal_position
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'identity_pairing_intents',
        'identity_pairing_intent_events'
      )
    order by table_name, ordinal_position
  `);
  assert.deepEqual(
    columns.map((column) => ({
      table: column.table_name,
      column: column.column_name,
      type: column.data_type,
      nullable: column.is_nullable,
      default: defaultKind(column.column_default),
    })),
    expectedColumns(),
    "pairing column catalog differs from the reviewed schema",
  );

  const constraints = await query.query(`
    select
      r.relname as table_name,
      c.conname,
      c.contype,
      c.convalidated,
      c.condeferrable,
      c.condeferred,
      c.confdeltype,
      c.confupdtype,
      referenced.relname as referenced_table,
      coalesce((
        select json_agg(attribute.attname order by key.ordinality)
        from unnest(c.conkey) with ordinality as key(attnum, ordinality)
        join pg_attribute attribute
          on attribute.attrelid = c.conrelid
         and attribute.attnum = key.attnum
      ), '[]'::json) as source_columns,
      coalesce((
        select json_agg(attribute.attname order by key.ordinality)
        from unnest(c.confkey) with ordinality as key(attnum, ordinality)
        join pg_attribute attribute
          on attribute.attrelid = c.confrelid
         and attribute.attnum = key.attnum
      ), '[]'::json) as referenced_columns,
      pg_get_constraintdef(c.oid, true) as definition
    from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    left join pg_class referenced on referenced.oid = c.confrelid
    where n.nspname = 'public'
      and r.relname in (
        'identity_pairing_intents',
        'identity_pairing_intent_events'
      )
      and c.contype <> 't'
    order by r.relname, c.conname
  `);
  assert.deepEqual(
    constraints.map((constraint) => ({
      table: constraint.table_name,
      name: constraint.conname,
      type: constraint.contype,
      validated: Boolean(constraint.convalidated),
      deferrable: Boolean(constraint.condeferrable),
      initiallyDeferred: Boolean(constraint.condeferred),
      sourceColumns: normalizeConstraintSourceColumns(
        constraint.contype,
        constraint.source_columns,
      ),
      referencedTable: constraint.referenced_table ?? null,
      referencedColumns: constraint.referenced_columns,
      onDelete:
        constraint.contype === "f"
          ? constraintAction(constraint.confdeltype)
          : null,
      onUpdate:
        constraint.contype === "f"
          ? constraintAction(constraint.confupdtype)
          : null,
      definition: normalizeConstraintDefinition(constraint.definition),
    })),
    expectedConstraints(),
    "pairing constraint definitions differ from the reviewed schema",
  );

  const indexes = await query.query(`
    select
      table_row.relname as table_name,
      index_row.relname as index_name,
      access_method.amname as access_method,
      catalog.indisunique,
      catalog.indisprimary,
      catalog.indisvalid,
      catalog.indisready,
      catalog.indislive,
      catalog.indisexclusion,
      catalog.indnullsnotdistinct,
      catalog.indnkeyatts,
      catalog.indnatts,
      pg_get_expr(catalog.indpred, catalog.indrelid, true) as predicate,
      pg_get_expr(catalog.indexprs, catalog.indrelid, true) as expressions,
      coalesce((
        select json_agg(
          pg_get_indexdef(catalog.indexrelid, key_position, true)
          order by key_position
        )
        from generate_series(1, catalog.indnkeyatts) as key_position
      ), '[]'::json) as key_expressions
    from pg_index catalog
    join pg_class table_row on table_row.oid = catalog.indrelid
    join pg_namespace namespace on namespace.oid = table_row.relnamespace
    join pg_class index_row on index_row.oid = catalog.indexrelid
    join pg_am access_method on access_method.oid = index_row.relam
    where namespace.nspname = 'public'
      and table_row.relname in (
        'identity_pairing_intents',
        'identity_pairing_intent_events'
      )
    order by table_row.relname, index_row.relname
  `);
  assert.deepEqual(
    indexes.map((indexRow) => ({
      table: indexRow.table_name,
      name: indexRow.index_name,
      accessMethod: indexRow.access_method,
      unique: Boolean(indexRow.indisunique),
      primary: Boolean(indexRow.indisprimary),
      valid: Boolean(indexRow.indisvalid),
      ready: Boolean(indexRow.indisready),
      live: Boolean(indexRow.indislive),
      exclusion: Boolean(indexRow.indisexclusion),
      nullsNotDistinct: Boolean(indexRow.indnullsnotdistinct),
      keyAttributeCount: Number(indexRow.indnkeyatts),
      totalAttributeCount: Number(indexRow.indnatts),
      predicate: indexRow.predicate ?? null,
      expressions: indexRow.expressions ?? null,
      keyExpressions: indexRow.key_expressions,
    })),
    expectedIndexes(),
    "pairing index definitions differ from the reviewed schema",
  );

  const triggers = await query.query(`
    select
      r.relname as table_name,
      t.tgname,
      t.tgenabled,
      t.tgtype,
      t.tgconstraint <> 0 as is_constraint,
      t.tgdeferrable,
      t.tginitdeferred,
      constraint_row.conname as constraint_catalog_name,
      constraint_row.contype as constraint_catalog_type,
      constraint_row.convalidated as constraint_catalog_validated,
      constraint_row.condeferrable as constraint_catalog_deferrable,
      constraint_row.condeferred as constraint_catalog_initially_deferred,
      constraint_table.relname as constraint_catalog_table,
      function_row.proname as function_name,
      pg_get_expr(t.tgqual, t.tgrelid, true) as when_clause,
      pg_get_triggerdef(t.oid, true) as definition
    from pg_trigger t
    join pg_class r on r.oid = t.tgrelid
    join pg_namespace n on n.oid = r.relnamespace
    join pg_proc function_row on function_row.oid = t.tgfoid
    left join pg_constraint constraint_row
      on constraint_row.oid = t.tgconstraint
    left join pg_class constraint_table
      on constraint_table.oid = constraint_row.conrelid
    where n.nspname = 'public'
      and not t.tgisinternal
      and r.relname in (
        'auth_identities',
        'identity_pairing_intents',
        'identity_pairing_intent_events'
      )
    order by r.relname, t.tgname
  `);
  assert.deepEqual(
    triggers.map((trigger) => ({
      table: trigger.table_name,
      name: trigger.tgname,
      enabled: trigger.tgenabled,
      typeMask: Number(trigger.tgtype),
      constraint: Boolean(trigger.is_constraint),
      deferrable: Boolean(trigger.tgdeferrable),
      initiallyDeferred: Boolean(trigger.tginitdeferred),
      constraintCatalog:
        trigger.constraint_catalog_name === null
          ? null
          : {
              name: trigger.constraint_catalog_name,
              table: trigger.constraint_catalog_table,
              type: trigger.constraint_catalog_type,
              validated: Boolean(trigger.constraint_catalog_validated),
              deferrable: Boolean(trigger.constraint_catalog_deferrable),
              initiallyDeferred: Boolean(
                trigger.constraint_catalog_initially_deferred,
              ),
            },
      functionName: trigger.function_name,
      whenClause: trigger.when_clause ?? null,
      definition: normalizeSqlDefinition(trigger.definition),
    })),
    expectedTriggers(),
    "pairing trigger definitions differ from the reviewed schema",
  );

  const functions = await query.query(`
    select
      p.proname,
      language.lanname,
      pg_get_function_result(p.oid) as result_type,
      pg_get_function_identity_arguments(p.oid) as identity_arguments,
      p.prokind,
      p.provolatile,
      p.proparallel,
      p.prosecdef,
      p.proleakproof,
      p.proisstrict,
      p.proconfig,
      p.prosrc
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language language on language.oid = p.prolang
    where n.nspname = 'public'
      and p.proname in (
        'prevent_identity_pairing_evidence_mutation',
        'enforce_identity_pairing_consumed_identity_match'
      )
      and pg_get_function_identity_arguments(p.oid) = ''
    order by p.proname
  `);
  assert.deepEqual(
    functions.map((functionRow) => ({
      name: functionRow.proname,
      language: functionRow.lanname,
      resultType: functionRow.result_type,
      identityArguments: functionRow.identity_arguments,
      kind: functionRow.prokind,
      volatility: functionRow.provolatile,
      parallel: functionRow.proparallel,
      securityDefiner: Boolean(functionRow.prosecdef),
      leakproof: Boolean(functionRow.proleakproof),
      strict: Boolean(functionRow.proisstrict),
      config: functionRow.proconfig ?? null,
      source: normalizeSqlDefinition(functionRow.prosrc),
    })),
    expectedFunctions(),
    "pairing function definitions differ from the reviewed schema",
  );

  const pairingRows = await query.query(`
    select
      (select count(*)::int from identity_pairing_intents) as intents,
      (
        select count(*)::int from identity_pairing_intent_events
      ) as events
  `);
  assert.equal(Number(pairingRows[0].intents), 0, "pairing intents not empty");
  assert.equal(Number(pairingRows[0].events), 0, "pairing events not empty");

  return {
    columnCount: columns.length,
    constraintCount: constraints.length,
    indexCount: indexes.length,
    triggerCount: triggers.length,
    functionCount: functions.length,
    pairingRows: {
      intents: Number(pairingRows[0].intents),
      events: Number(pairingRows[0].events),
    },
  };
}

function readLatestLocalMigration() {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8"),
  );
  const migrations = readMigrationFiles({
    migrationsFolder: MIGRATIONS_FOLDER,
  });
  assert.equal(
    journal.entries.length,
    migrations.length,
    "Drizzle journal and migration files differ",
  );
  const index = journal.entries.length - 1;
  const entry = journal.entries[index];
  assert.equal(entry.idx, 21, "latest local migration is not 0021");
  return {
    tag: entry.tag,
    createdAt: entry.when,
    drizzleHash: migrations[index].hash,
    fileSha256: normalizedFileSha256(
      join(MIGRATIONS_FOLDER, `${entry.tag}.sql`),
    ),
  };
}

function expectedColumns() {
  return [
    column("identity_pairing_intent_events", "id", "uuid", "NO", "uuid"),
    column(
      "identity_pairing_intent_events",
      "identity_pairing_intent_id",
      "uuid",
      "NO",
    ),
    column(
      "identity_pairing_intent_events",
      "event_type",
      "character varying",
      "NO",
    ),
    column(
      "identity_pairing_intent_events",
      "auth_identity_id",
      "uuid",
      "YES",
    ),
    column(
      "identity_pairing_intent_events",
      "subject_binding_version",
      "character varying",
      "YES",
    ),
    column(
      "identity_pairing_intent_events",
      "subject_binding",
      "character varying",
      "YES",
    ),
    column(
      "identity_pairing_intent_events",
      "identity_link_planner_policy_id",
      "character varying",
      "YES",
    ),
    column(
      "identity_pairing_intent_events",
      "identity_link_plan_binding_version",
      "character varying",
      "YES",
    ),
    column(
      "identity_pairing_intent_events",
      "identity_link_plan_binding",
      "character varying",
      "YES",
    ),
    column(
      "identity_pairing_intent_events",
      "occurred_at",
      "timestamp with time zone",
      "NO",
      "now",
    ),
    column("identity_pairing_intents", "id", "uuid", "NO", "uuid"),
    column(
      "identity_pairing_intents",
      "authority_policy_id",
      "character varying",
      "NO",
    ),
    column(
      "identity_pairing_intents",
      "target_app_user_id",
      "uuid",
      "NO",
    ),
    column(
      "identity_pairing_intents",
      "provider",
      "character varying",
      "NO",
    ),
    column(
      "identity_pairing_intents",
      "claim_digest_version",
      "character varying",
      "NO",
    ),
    column(
      "identity_pairing_intents",
      "claim_digest",
      "character varying",
      "NO",
    ),
    column(
      "identity_pairing_intents",
      "target_review_policy_id",
      "character varying",
      "NO",
    ),
    column(
      "identity_pairing_intents",
      "issued_at",
      "timestamp with time zone",
      "NO",
    ),
    column(
      "identity_pairing_intents",
      "expires_at",
      "timestamp with time zone",
      "NO",
    ),
    column(
      "identity_pairing_intents",
      "created_at",
      "timestamp with time zone",
      "NO",
      "now",
    ),
  ];
}

function expectedConstraints() {
  return [
    catalogConstraint({
      table: "identity_pairing_intent_events",
      name: "id_pair_intent_events_identity_fk",
      type: "f",
      sourceColumns: ["auth_identity_id"],
      referencedTable: "auth_identities",
      referencedColumns: ["id"],
      onDelete: "restrict",
      onUpdate: "no_action",
      definition:
        "FOREIGN KEY (auth_identity_id) REFERENCES auth_identities(id) ON DELETE RESTRICT",
    }),
    catalogConstraint({
      table: "identity_pairing_intent_events",
      name: "id_pair_intent_events_identity_state_check",
      type: "c",
      sourceColumns: [
        "event_type",
        "auth_identity_id",
        "subject_binding_version",
        "subject_binding",
        "identity_link_planner_policy_id",
        "identity_link_plan_binding_version",
        "identity_link_plan_binding",
      ],
      definition: `CHECK (
        event_type::text = 'consumed'::text
        AND auth_identity_id IS NOT NULL
        AND subject_binding_version IS NOT NULL
        AND subject_binding_version::text = 'provider_subject_hmac_sha256_v1'::text
        AND subject_binding IS NOT NULL
        AND subject_binding::text ~ '^hmac-sha256-v1:[0-9a-f]{64}$'::text
        AND identity_link_planner_policy_id IS NOT NULL
        AND identity_link_planner_policy_id::text = 'initial_identity_link_planner_v1'::text
        AND identity_link_plan_binding_version IS NOT NULL
        AND identity_link_plan_binding_version::text = 'identity_link_plan_hmac_sha256_v1'::text
        AND identity_link_plan_binding IS NOT NULL
        AND identity_link_plan_binding::text ~ '^identity-link-plan-hmac-sha256-v1:[0-9a-f]{64}$'::text
        OR event_type::text = 'revoked'::text
        AND auth_identity_id IS NULL
        AND subject_binding_version IS NULL
        AND subject_binding IS NULL
        AND identity_link_planner_policy_id IS NULL
        AND identity_link_plan_binding_version IS NULL
        AND identity_link_plan_binding IS NULL
      )`,
    }),
    catalogConstraint({
      table: "identity_pairing_intent_events",
      name: "id_pair_intent_events_intent_fk",
      type: "f",
      sourceColumns: ["identity_pairing_intent_id"],
      referencedTable: "identity_pairing_intents",
      referencedColumns: ["id"],
      onDelete: "restrict",
      onUpdate: "no_action",
      definition:
        "FOREIGN KEY (identity_pairing_intent_id) REFERENCES identity_pairing_intents(id) ON DELETE RESTRICT",
    }),
    catalogConstraint({
      table: "identity_pairing_intent_events",
      name: "id_pair_intent_events_type_check",
      type: "c",
      sourceColumns: ["event_type"],
      definition:
        "CHECK (event_type::text = ANY (ARRAY['consumed'::character varying, 'revoked'::character varying]::text[]))",
    }),
    catalogConstraint({
      table: "identity_pairing_intent_events",
      name: "identity_pairing_intent_events_pkey",
      type: "p",
      sourceColumns: ["id"],
      definition: "PRIMARY KEY (id)",
    }),
    catalogConstraint({
      table: "identity_pairing_intents",
      name: "id_pair_intents_claim_digest_check",
      type: "c",
      sourceColumns: ["claim_digest_version", "claim_digest"],
      definition:
        "CHECK (claim_digest_version::text = 'bootstrap_claim_sha256_v1'::text AND claim_digest::text ~ '^bootstrap-claim-sha256-v1:[0-9a-f]{64}$'::text)",
    }),
    catalogConstraint({
      table: "identity_pairing_intents",
      name: "id_pair_intents_lifetime_check",
      type: "c",
      sourceColumns: ["issued_at", "expires_at"],
      definition:
        "CHECK (expires_at > issued_at AND expires_at <= (issued_at + '00:10:00'::interval))",
    }),
    catalogConstraint({
      table: "identity_pairing_intents",
      name: "id_pair_intents_policy_check",
      type: "c",
      sourceColumns: ["authority_policy_id"],
      definition:
        "CHECK (authority_policy_id::text = 'preissued_bootstrap_claim_authority_v1'::text)",
    }),
    catalogConstraint({
      table: "identity_pairing_intents",
      name: "id_pair_intents_provider_check",
      type: "c",
      sourceColumns: ["provider"],
      definition: "CHECK (provider::text = 'neon_auth'::text)",
    }),
    catalogConstraint({
      table: "identity_pairing_intents",
      name: "id_pair_intents_target_app_user_fk",
      type: "f",
      sourceColumns: ["target_app_user_id"],
      referencedTable: "app_users",
      referencedColumns: ["id"],
      onDelete: "restrict",
      onUpdate: "no_action",
      definition:
        "FOREIGN KEY (target_app_user_id) REFERENCES app_users(id) ON DELETE RESTRICT",
    }),
    catalogConstraint({
      table: "identity_pairing_intents",
      name: "id_pair_intents_target_review_policy_check",
      type: "c",
      sourceColumns: ["target_review_policy_id"],
      definition:
        "CHECK (target_review_policy_id::text = 'single_provisioning_user_explicit_review_v1'::text)",
    }),
    catalogConstraint({
      table: "identity_pairing_intents",
      name: "identity_pairing_intents_pkey",
      type: "p",
      sourceColumns: ["id"],
      definition: "PRIMARY KEY (id)",
    }),
  ].sort(compareCatalogEntries);
}

function expectedIndexes() {
  return [
    catalogIndex(
      "identity_pairing_intent_events",
      "id_pair_intent_events_auth_identity_idx",
      ["auth_identity_id"],
    ),
    catalogIndex(
      "identity_pairing_intent_events",
      "id_pair_intent_events_subject_binding_idx",
      ["subject_binding"],
    ),
    catalogIndex(
      "identity_pairing_intent_events",
      "id_pair_intent_events_terminal_unique",
      ["identity_pairing_intent_id"],
      { unique: true },
    ),
    catalogIndex(
      "identity_pairing_intent_events",
      "identity_pairing_intent_events_pkey",
      ["id"],
      { unique: true, primary: true },
    ),
    catalogIndex(
      "identity_pairing_intents",
      "id_pair_intents_claim_digest_unique",
      ["claim_digest"],
      { unique: true },
    ),
    catalogIndex(
      "identity_pairing_intents",
      "id_pair_intents_target_app_user_idx",
      ["target_app_user_id"],
    ),
    catalogIndex(
      "identity_pairing_intents",
      "identity_pairing_intents_pkey",
      ["id"],
      { unique: true, primary: true },
    ),
  ].sort(compareCatalogEntries);
}

function expectedTriggers() {
  return [
    catalogTrigger({
      table: "auth_identities",
      name: "auth_identities_consumed_pairing_binding_guard",
      typeMask: 17,
      constraint: true,
      deferrable: true,
      constraintCatalog: {
        name: "auth_identities_consumed_pairing_binding_guard",
        table: "auth_identities",
        type: "t",
        validated: true,
        deferrable: true,
        initiallyDeferred: false,
      },
      functionName: "enforce_identity_pairing_consumed_identity_match",
      definition:
        "CREATE CONSTRAINT TRIGGER auth_identities_consumed_pairing_binding_guard AFTER UPDATE ON auth_identities DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION enforce_identity_pairing_consumed_identity_match()",
    }),
    catalogTrigger({
      table: "identity_pairing_intent_events",
      name: "id_pair_intent_events_identity_match",
      typeMask: 5,
      constraint: true,
      deferrable: true,
      constraintCatalog: {
        name: "id_pair_intent_events_identity_match",
        table: "identity_pairing_intent_events",
        type: "t",
        validated: true,
        deferrable: true,
        initiallyDeferred: false,
      },
      functionName: "enforce_identity_pairing_consumed_identity_match",
      definition:
        "CREATE CONSTRAINT TRIGGER id_pair_intent_events_identity_match AFTER INSERT ON identity_pairing_intent_events DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION enforce_identity_pairing_consumed_identity_match()",
    }),
    catalogTrigger({
      table: "identity_pairing_intent_events",
      name: "identity_pairing_intent_events_append_only",
      typeMask: 58,
      functionName: "prevent_identity_pairing_evidence_mutation",
      definition: `CREATE TRIGGER identity_pairing_intent_events_append_only BEFORE DELETE OR UPDATE OR ${TRUNCATE_TRIGGER_EVENT} ON identity_pairing_intent_events FOR EACH STATEMENT EXECUTE FUNCTION prevent_identity_pairing_evidence_mutation()`,
    }),
    catalogTrigger({
      table: "identity_pairing_intents",
      name: "identity_pairing_intents_append_only",
      typeMask: 58,
      functionName: "prevent_identity_pairing_evidence_mutation",
      definition: `CREATE TRIGGER identity_pairing_intents_append_only BEFORE DELETE OR UPDATE OR ${TRUNCATE_TRIGGER_EVENT} ON identity_pairing_intents FOR EACH STATEMENT EXECUTE FUNCTION prevent_identity_pairing_evidence_mutation()`,
    }),
  ].sort(compareCatalogEntries);
}

function expectedFunctions() {
  return [
    catalogFunction(
      "enforce_identity_pairing_consumed_identity_match",
      `
        DECLARE
          intent_target_app_user_id uuid;
          intent_provider varchar(50);
          intent_issued_at timestamp with time zone;
          intent_expires_at timestamp with time zone;
          identity_app_user_id uuid;
          identity_provider varchar(50);
          validation_time timestamp with time zone;
        BEGIN
          IF TG_TABLE_NAME = 'identity_pairing_intent_events' THEN
            IF NEW.event_type <> 'consumed' THEN
              RETURN NEW;
            END IF;
            SELECT
              intent.target_app_user_id,
              intent.provider,
              intent.issued_at,
              intent.expires_at,
              identity_row.app_user_id,
              identity_row.provider
            INTO STRICT
              intent_target_app_user_id,
              intent_provider,
              intent_issued_at,
              intent_expires_at,
              identity_app_user_id,
              identity_provider
            FROM public.identity_pairing_intents AS intent
            JOIN public.auth_identities AS identity_row
              ON identity_row.id = NEW.auth_identity_id
            WHERE intent.id = NEW.identity_pairing_intent_id
            FOR UPDATE OF identity_row;
            validation_time := clock_timestamp();
            IF validation_time < intent_issued_at
              OR validation_time >= intent_expires_at THEN
              RAISE EXCEPTION 'identity pairing intent is not valid at database time'
                USING ERRCODE = '23514';
            END IF;
            IF identity_app_user_id IS DISTINCT FROM intent_target_app_user_id
              OR identity_provider IS DISTINCT FROM intent_provider THEN
              RAISE EXCEPTION 'consumed identity does not match pairing intent target and provider'
                USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
          END IF;
          IF TG_TABLE_NAME = 'auth_identities' THEN
            IF NEW.app_user_id IS NOT DISTINCT FROM OLD.app_user_id
              AND NEW.provider IS NOT DISTINCT FROM OLD.provider
              AND NEW.provider_subject IS NOT DISTINCT FROM OLD.provider_subject THEN
              RETURN NEW;
            END IF;
            IF EXISTS (
              SELECT 1
              FROM public.identity_pairing_intent_events AS event
              WHERE event.auth_identity_id = NEW.id
                AND event.event_type = 'consumed'
            ) THEN
              RAISE EXCEPTION 'consumed identity owner, provider, and provider subject are immutable'
                USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
          END IF;
          RAISE EXCEPTION 'unsupported identity pairing constraint trigger table';
        END;
      `,
    ),
    catalogFunction(
      "prevent_identity_pairing_evidence_mutation",
      `
        BEGIN
          RAISE EXCEPTION 'identity pairing evidence is append-only';
          RETURN NULL;
        END;
      `,
    ),
  ].sort((left, right) => left.name.localeCompare(right.name));
}

function catalogConstraint({
  table,
  name,
  type,
  sourceColumns,
  definition,
  referencedTable = null,
  referencedColumns = [],
  onDelete = null,
  onUpdate = null,
}) {
  return {
    table,
    name,
    type,
    validated: true,
    deferrable: false,
    initiallyDeferred: false,
    sourceColumns: normalizeConstraintSourceColumns(type, sourceColumns),
    referencedTable,
    referencedColumns,
    onDelete,
    onUpdate,
    definition: normalizeConstraintDefinition(definition),
  };
}

function catalogIndex(
  table,
  name,
  keyExpressions,
  { unique = false, primary = false } = {},
) {
  return {
    table,
    name,
    accessMethod: "btree",
    unique,
    primary,
    valid: true,
    ready: true,
    live: true,
    exclusion: false,
    nullsNotDistinct: false,
    keyAttributeCount: keyExpressions.length,
    totalAttributeCount: keyExpressions.length,
    predicate: null,
    expressions: null,
    keyExpressions,
  };
}

function catalogTrigger({
  table,
  name,
  typeMask,
  functionName,
  definition,
  constraint = false,
  deferrable = false,
  constraintCatalog = null,
}) {
  return {
    table,
    name,
    enabled: "O",
    typeMask,
    constraint,
    deferrable,
    initiallyDeferred: false,
    constraintCatalog,
    functionName,
    whenClause: null,
    definition: normalizeSqlDefinition(definition),
  };
}

function catalogFunction(name, source) {
  return {
    name,
    language: "plpgsql",
    resultType: "trigger",
    identityArguments: "",
    kind: "f",
    volatility: "v",
    parallel: "u",
    securityDefiner: false,
    leakproof: false,
    strict: false,
    config: null,
    source: normalizeSqlDefinition(source),
  };
}

function compareCatalogEntries(left, right) {
  return (
    left.table.localeCompare(right.table) || left.name.localeCompare(right.name)
  );
}

function column(table, name, type, nullable, defaultValue = null) {
  return { table, column: name, type, nullable, default: defaultValue };
}

function defaultKind(value) {
  if (value === null) return null;
  if (String(value).includes("gen_random_uuid()")) return "uuid";
  if (String(value).includes("now()")) return "now";
  return String(value);
}

function constraintAction(code) {
  const actions = {
    a: "no_action",
    r: "restrict",
    c: "cascade",
    n: "set_null",
    d: "set_default",
  };
  const action = actions[code];
  assert.ok(action, `unknown constraint action code: ${code}`);
  return action;
}

function normalizeSqlDefinition(value) {
  return String(value)
    .replaceAll('"', "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeConstraintDefinition(value) {
  return normalizeSqlDefinition(value)
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")");
}

function normalizeConstraintSourceColumns(type, sourceColumns) {
  return type === "c" ? [...sourceColumns].sort() : sourceColumns;
}

function normalizedFileSha256(path) {
  return createHash("sha256")
    .update(readFileSync(path, "utf8").replace(/\r\n/g, "\n"))
    .digest("hex");
}

function canonicalSha256(value) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function readOptions(args) {
  let expectedState = null;
  let expectedProductRowCountsSha256 = null;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--expect-state") {
      expectedState = args[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (argument === "--expect-product-row-counts-sha256") {
      expectedProductRowCountsSha256 = args[index + 1] ?? null;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (
    expectedState !== null &&
    expectedState !== "absent" &&
    expectedState !== "present"
  ) {
    throw new Error("--expect-state must be absent or present");
  }
  if (
    expectedProductRowCountsSha256 !== null &&
    !/^[0-9a-f]{64}$/.test(expectedProductRowCountsSha256)
  ) {
    throw new Error(
      "--expect-product-row-counts-sha256 must be a SHA-256 hex digest",
    );
  }
  return { expectedState, expectedProductRowCountsSha256 };
}
