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
      c.confdeltype,
      pg_get_constraintdef(c.oid) as definition
    from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and r.relname in (
        'identity_pairing_intents',
        'identity_pairing_intent_events'
      )
    order by r.relname, c.conname
  `);
  assert.deepEqual(
    constraints.map(({ conname }) => conname).sort(),
    expectedConstraintNames(),
    "pairing constraint set differs from the reviewed schema",
  );
  for (const constraint of constraints) {
    if (constraint.contype === "f") {
      assert.equal(
        constraint.confdeltype,
        "r",
        `${constraint.conname} must use ON DELETE RESTRICT`,
      );
    }
  }
  assertConstraintMarker(
    constraints,
    "id_pair_intents_policy_check",
    "preissued_bootstrap_claim_authority_v1",
  );
  assertConstraintMarker(
    constraints,
    "id_pair_intents_claim_digest_check",
    "bootstrap-claim-sha256-v1",
  );
  assertConstraintMarker(
    constraints,
    "id_pair_intents_target_review_policy_check",
    "single_provisioning_user_explicit_review_v1",
  );
  assertConstraintMarker(
    constraints,
    "id_pair_intent_events_identity_state_check",
    "identity-link-plan-hmac-sha256-v1",
  );

  const indexes = await query.query(`
    select tablename, indexname, indexdef
    from pg_indexes
    where schemaname = 'public'
      and tablename in (
        'identity_pairing_intents',
        'identity_pairing_intent_events'
      )
    order by tablename, indexname
  `);
  assert.deepEqual(
    indexes.map(({ indexname }) => indexname).sort(),
    expectedIndexNames(),
    "pairing index set differs from the reviewed schema",
  );

  const triggers = await query.query(`
    select
      r.relname as table_name,
      t.tgname,
      t.tgenabled,
      pg_get_triggerdef(t.oid) as definition
    from pg_trigger t
    join pg_class r on r.oid = t.tgrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and not t.tgisinternal
      and r.relname in (
        'identity_pairing_intents',
        'identity_pairing_intent_events'
      )
    order by r.relname, t.tgname
  `);
  assert.deepEqual(
    triggers.map(({ tgname }) => tgname).sort(),
    [
      "identity_pairing_intent_events_append_only",
      "identity_pairing_intents_append_only",
    ],
    "append-only trigger set differs from the reviewed schema",
  );
  for (const trigger of triggers) {
    assert.equal(trigger.tgenabled, "O", `${trigger.tgname} is not enabled`);
    assert.match(trigger.definition, /\bBEFORE\b/i);
    assert.match(trigger.definition, /\bUPDATE\b/i);
    assert.match(trigger.definition, /\bDELETE\b/i);
    assert.match(trigger.definition, /\bTRUNCATE\b/i);
    assert.match(
      trigger.definition,
      /prevent_identity_pairing_evidence_mutation/i,
    );
  }

  const functions = await query.query(`
    select pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'prevent_identity_pairing_evidence_mutation'
      and pg_get_function_identity_arguments(p.oid) = ''
  `);
  assert.equal(functions.length, 1, "append-only function count differs");
  assert.match(
    functions[0].definition,
    /RAISE EXCEPTION 'identity pairing evidence is append-only'/,
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

function expectedConstraintNames() {
  return [
    "id_pair_intent_events_identity_fk",
    "id_pair_intent_events_identity_state_check",
    "id_pair_intent_events_intent_fk",
    "id_pair_intent_events_type_check",
    "id_pair_intents_claim_digest_check",
    "id_pair_intents_lifetime_check",
    "id_pair_intents_policy_check",
    "id_pair_intents_provider_check",
    "id_pair_intents_target_app_user_fk",
    "id_pair_intents_target_review_policy_check",
    "identity_pairing_intent_events_pkey",
    "identity_pairing_intents_pkey",
  ].sort();
}

function expectedIndexNames() {
  return [
    "id_pair_intent_events_auth_identity_idx",
    "id_pair_intent_events_subject_binding_idx",
    "id_pair_intent_events_terminal_unique",
    "id_pair_intents_claim_digest_unique",
    "id_pair_intents_target_app_user_idx",
    "identity_pairing_intent_events_pkey",
    "identity_pairing_intents_pkey",
  ].sort();
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

function assertConstraintMarker(constraints, name, marker) {
  const constraint = constraints.find(({ conname }) => conname === name);
  assert.ok(constraint, `missing constraint ${name}`);
  assert.match(constraint.definition, new RegExp(marker));
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
