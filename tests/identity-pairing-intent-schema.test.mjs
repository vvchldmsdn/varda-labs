import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();
const MIGRATION_NAME = "0021_strange_sinister_six.sql";
const EXPECTED_MIGRATION_SHA256 =
  "2a466a9b0dbf38ffd0286e5f1e05154102be12da5ac7a6e2430aed16c8bcbec4";
const MIGRATION_PATH = join(ROOT, "drizzle", MIGRATION_NAME);
const SCHEMA_PATH = join(ROOT, "src", "db", "schema.ts");
const AUDIT_PATH = join(ROOT, "scripts", "audit-identity-pairing-schema.mjs");
const migration = readFileSync(MIGRATION_PATH, "utf8");
const schema = readFileSync(SCHEMA_PATH, "utf8");
const audit = readFileSync(AUDIT_PATH, "utf8");
const priorSnapshot = JSON.parse(
  readFileSync(join(ROOT, "drizzle", "meta", "0020_snapshot.json"), "utf8"),
);
const snapshot = JSON.parse(
  readFileSync(join(ROOT, "drizzle", "meta", "0021_snapshot.json"), "utf8"),
);
const journal = JSON.parse(
  readFileSync(join(ROOT, "drizzle", "meta", "_journal.json"), "utf8"),
);
const statements = migration
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);

describe("durable identity bootstrap claim schema", () => {
  it("adds only the immutable claim header and terminal event tables", () => {
    assert.deepEqual(
      readdirSync(join(ROOT, "drizzle")).filter((name) =>
        /^0021_[a-z0-9_]+\.sql$/.test(name),
      ),
      [MIGRATION_NAME],
    );
    assert.equal(normalizedHash(migration), EXPECTED_MIGRATION_SHA256);
    assert.equal(countMatches(migration, /CREATE TABLE /g), 2);
    assert.match(migration, /CREATE TABLE "identity_pairing_intents"/);
    assert.match(
      migration,
      /CREATE TABLE "identity_pairing_intent_events"/,
    );
    assert.equal(statements.length, 16);

    const intentTable = extractCreateTable(
      migration,
      "identity_pairing_intents",
    );
    assert.match(intentTable, /"target_app_user_id" uuid NOT NULL/);
    assert.match(intentTable, /"claim_digest" varchar\(96\) NOT NULL/);
    assert.match(intentTable, /"target_review_policy_id" varchar\(64\) NOT NULL/);
    assert.match(intentTable, /"issued_at" timestamp with time zone NOT NULL/);
    assert.match(intentTable, /"expires_at" timestamp with time zone NOT NULL/);
    assert.doesNotMatch(intentTable, /"status"/);
    assert.doesNotMatch(intentTable, /"updated_at"/);
    assert.doesNotMatch(
      intentTable,
      /operator|subject_binding|identity_link_plan|challenge_digest/i,
    );
  });

  it("preserves the generated Drizzle migration chain", () => {
    assert.equal(snapshot.prevId, priorSnapshot.id);
    const matchingEntries = journal.entries.filter(
      (entry) => entry.tag === "0021_strange_sinister_six",
    );
    assert.equal(matchingEntries.length, 1);
    assert.equal(matchingEntries[0].idx, 21);
    assert.equal(matchingEntries[0].version, "7");
  });

  it("stores only a reviewed target and one-way claim digest in the header", () => {
    for (const constraint of [
      "id_pair_intents_policy_check",
      "id_pair_intents_provider_check",
      "id_pair_intents_claim_digest_check",
      "id_pair_intents_target_review_policy_check",
      "id_pair_intents_lifetime_check",
    ]) {
      assert.match(migration, new RegExp(`CONSTRAINT "${constraint}"`));
    }

    assert.match(migration, /preissued_bootstrap_claim_authority_v1/);
    assert.match(migration, /bootstrap_claim_sha256_v1/);
    assert.match(migration, /bootstrap-claim-sha256-v1/);
    assert.match(
      migration,
      /single_provisioning_user_explicit_review_v1/,
    );
    assert.match(
      migration,
      /CREATE UNIQUE INDEX "id_pair_intents_claim_digest_unique".*"claim_digest"/,
    );

    assert.doesNotMatch(
      migration,
      /"provider_subject"|"email"|"token"|"cookie"|"profile"|"authorization"/i,
    );
    assert.doesNotMatch(
      migration,
      /operator_session|operator_principal|subject_principal|operator_binding/i,
    );
  });

  it("requires consume-time subject and identity-link evidence", () => {
    const eventTable = extractCreateTable(
      migration,
      "identity_pairing_intent_events",
    );
    assert.match(eventTable, /"subject_binding" varchar\(96\)/);
    assert.match(
      eventTable,
      /"identity_link_plan_binding" varchar\(112\)/,
    );
    assert.match(
      eventTable,
      /"event_type" = 'consumed'.*"auth_identity_id" is not null.*provider_subject_hmac_sha256_v1.*initial_identity_link_planner_v1.*identity_link_plan_hmac_sha256_v1/s,
    );
    for (const column of [
      "subject_binding_version",
      "subject_binding",
      "identity_link_planner_policy_id",
      "identity_link_plan_binding_version",
      "identity_link_plan_binding",
    ]) {
      assert.match(
        eventTable,
        new RegExp(`"${column}" is not null`),
        `${column} must be required for consumed events`,
      );
    }
    assert.match(
      eventTable,
      /"event_type" = 'revoked'.*"auth_identity_id" is null.*"subject_binding" is null.*"identity_link_plan_binding" is null/s,
    );
    assert.match(
      migration,
      /CREATE UNIQUE INDEX "id_pair_intent_events_terminal_unique".*"identity_pairing_intent_id"/,
    );
  });

  it("enforces a ten-minute lifetime and restrictive foreign keys", () => {
    assert.match(
      migration,
      /"expires_at" > "identity_pairing_intents"\."issued_at"/,
    );
    assert.match(
      migration,
      /"expires_at" <= "identity_pairing_intents"\."issued_at" \+ interval '10 minutes'/,
    );

    const foreignKeys = statements.filter((statement) =>
      statement.includes("FOREIGN KEY"),
    );
    assert.equal(foreignKeys.length, 3);
    assert.match(
      migration,
      /"target_app_user_id"\) REFERENCES "public"\."app_users"\("id"\) ON DELETE restrict/,
    );
    assert.match(
      migration,
      /"identity_pairing_intent_id"\) REFERENCES "public"\."identity_pairing_intents"\("id"\) ON DELETE restrict/,
    );
    assert.match(
      migration,
      /"auth_identity_id"\) REFERENCES "public"\."auth_identities"\("id"\) ON DELETE restrict/,
    );
    assert.doesNotMatch(migration, /ON DELETE cascade/i);
  });

  it("binds consumed identity evidence to a live intent and immutable provider principal", () => {
    assert.match(
      migration,
      /CREATE FUNCTION "enforce_identity_pairing_consumed_identity_match"\(\) RETURNS trigger/,
    );
    assert.match(
      migration,
      /intent\.issued_at[\s\S]*intent\.expires_at[\s\S]*identity_row\.app_user_id[\s\S]*identity_row\.provider[\s\S]*FROM public\.identity_pairing_intents AS intent[\s\S]*JOIN public\.auth_identities AS identity_row[\s\S]*FOR UPDATE OF identity_row/,
    );
    assert.match(
      migration,
      /FOR UPDATE OF identity_row;[\s\S]*validation_time := clock_timestamp\(\)[\s\S]*validation_time < intent_issued_at[\s\S]*validation_time >= intent_expires_at[\s\S]*identity pairing intent is not valid at database time/,
    );
    assert.match(
      migration,
      /identity_app_user_id IS DISTINCT FROM intent_target_app_user_id[\s\S]*identity_provider IS DISTINCT FROM intent_provider/,
    );
    assert.match(
      migration,
      /NEW\.app_user_id IS NOT DISTINCT FROM OLD\.app_user_id[\s\S]*NEW\.provider IS NOT DISTINCT FROM OLD\.provider[\s\S]*NEW\.provider_subject IS NOT DISTINCT FROM OLD\.provider_subject[\s\S]*public\.identity_pairing_intent_events AS event[\s\S]*event\.auth_identity_id = NEW\.id[\s\S]*consumed identity owner, provider, and provider subject are immutable/,
    );
    assert.equal(
      countMatches(migration, /USING ERRCODE = '23514'/g),
      3,
    );
    assert.match(
      migration,
      /CREATE CONSTRAINT TRIGGER "id_pair_intent_events_identity_match"\s+AFTER INSERT ON "identity_pairing_intent_events"\s+DEFERRABLE INITIALLY IMMEDIATE\s+FOR EACH ROW\s+EXECUTE FUNCTION "enforce_identity_pairing_consumed_identity_match"\(\)/,
    );
    assert.match(
      migration,
      /CREATE CONSTRAINT TRIGGER "auth_identities_consumed_pairing_binding_guard"\s+AFTER UPDATE ON "auth_identities"\s+DEFERRABLE INITIALLY IMMEDIATE\s+FOR EACH ROW\s+EXECUTE FUNCTION "enforce_identity_pairing_consumed_identity_match"\(\)/,
    );
  });

  it("enforces append-only evidence with exact functions and triggers", () => {
    const functions = statements.filter((statement) =>
      statement.startsWith("CREATE FUNCTION"),
    );
    const triggers = statements.filter(
      (statement) =>
        statement.startsWith("CREATE TRIGGER") ||
        statement.startsWith("CREATE CONSTRAINT TRIGGER"),
    );
    assert.equal(functions.length, 2);
    assert.equal(triggers.length, 4);
    assert.match(
      functions[0],
      /^CREATE FUNCTION "prevent_identity_pairing_evidence_mutation"\(\) RETURNS trigger[\s\S]*RAISE EXCEPTION 'identity pairing evidence is append-only'/,
    );

    for (const [triggerName, tableName] of [
      ["identity_pairing_intents_append_only", "identity_pairing_intents"],
      [
        "identity_pairing_intent_events_append_only",
        "identity_pairing_intent_events",
      ],
    ]) {
      assert.match(
        migration,
        new RegExp(
          `CREATE TRIGGER "${triggerName}"\\s+BEFORE UPDATE OR DELETE OR TRUNCATE ON "${tableName}"\\s+FOR EACH STATEMENT\\s+EXECUTE FUNCTION "prevent_identity_pairing_evidence_mutation"\\(\\)`,
        ),
      );
    }
  });

  it("pins full catalog semantics for the postflight audit", () => {
    for (const catalogField of [
      "convalidated",
      "condeferrable",
      "condeferred",
      "confupdtype",
      "source_columns",
      "referenced_columns",
      "indisunique",
      "indisvalid",
      "indisready",
      "indislive",
      "indnullsnotdistinct",
      "key_expressions",
      "tgtype",
      "tgdeferrable",
      "tginitdeferred",
      "constraint_catalog_name",
      "constraint_catalog_type",
      "constraint_catalog_validated",
      "provolatile",
      "proparallel",
      "prosrc",
    ]) {
      assert.match(audit, new RegExp(`\\b${catalogField}\\b`));
    }
    assert.match(audit, /expectedConstraints\(\)/);
    assert.match(audit, /expectedIndexes\(\)/);
    assert.match(audit, /expectedTriggers\(\)/);
    assert.match(audit, /expectedFunctions\(\)/);
    assert.match(audit, /c\.contype <> 't'/);
    assert.match(audit, /constraintCatalog/);
    assert.doesNotMatch(audit, /assertConstraintMarker/);
  });

  it("contains no identity DML, destructive DDL, RLS, or auth secret", () => {
    for (const statement of statements) {
      assert.doesNotMatch(
        statement,
        /^(?:INSERT|UPDATE|DELETE|MERGE|COPY|TRUNCATE)\b/i,
      );
    }

    assert.doesNotMatch(
      migration,
      /\b(?:DROP|RENAME|ALTER COLUMN|CASCADE|CREATE POLICY|ENABLE ROW LEVEL SECURITY|GRANT|REVOKE)\b/i,
    );
    assert.doesNotMatch(
      migration,
      /NEON_AUTH_COOKIE_SECRET|VARDA_APP_PASSWORD|APP_ACCESS_PASSWORD/,
    );
  });

  it("keeps the active Drizzle schema and exported types aligned", () => {
    assert.match(schema, /export const identityPairingIntents = pgTable/);
    assert.match(
      schema,
      /export const identityPairingIntentEvents = pgTable/,
    );
    assert.match(schema, /export type IdentityPairingIntent =/);
    assert.match(schema, /export type NewIdentityPairingIntent =/);
    assert.match(schema, /export type IdentityPairingIntentEvent =/);
    assert.match(schema, /export type NewIdentityPairingIntentEvent =/);
  });
});

function extractCreateTable(sql, tableName) {
  const match = sql.match(
    new RegExp(`CREATE TABLE "${tableName}" \\(([\\s\\S]*?)\\n\\);`),
  );
  assert.ok(match, `missing CREATE TABLE ${tableName}`);
  return match[1];
}

function countMatches(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

function normalizedHash(value) {
  return createHash("sha256")
    .update(value.replace(/\r\n/g, "\n"))
    .digest("hex");
}
