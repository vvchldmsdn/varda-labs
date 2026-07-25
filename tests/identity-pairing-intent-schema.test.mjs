import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();
const MIGRATION_NAME = "0021_previous_deathbird.sql";
const EXPECTED_MIGRATION_SHA256 =
  "ef49f7d2b9074daf10dbb2d7890875cc895cf6dd87a4d9b39d01c8a9df0a3c50";
const MIGRATION_PATH = join(
  ROOT,
  "drizzle",
  MIGRATION_NAME,
);
const SCHEMA_PATH = join(ROOT, "src", "db", "schema.ts");
const migration = readFileSync(MIGRATION_PATH, "utf8");
const schema = readFileSync(SCHEMA_PATH, "utf8");
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

describe("durable identity pairing intent schema", () => {
  it("adds only the immutable intent header and terminal event tables", () => {
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
    assert.equal(statements.length, 10);

    const intentTable = extractCreateTable(
      migration,
      "identity_pairing_intents",
    );
    assert.match(intentTable, /"target_app_user_id" uuid NOT NULL/);
    assert.match(intentTable, /"subject_binding" varchar\(96\) NOT NULL/);
    assert.match(intentTable, /"challenge_digest" varchar\(96\) NOT NULL/);
    assert.match(intentTable, /"issued_at" timestamp with time zone NOT NULL/);
    assert.match(intentTable, /"expires_at" timestamp with time zone NOT NULL/);
    assert.doesNotMatch(intentTable, /"status"/);
    assert.doesNotMatch(intentTable, /"updated_at"/);
  });

  it("preserves the generated Drizzle migration chain", () => {
    assert.equal(snapshot.prevId, priorSnapshot.id);
    const matchingEntries = journal.entries.filter(
      (entry) => entry.tag === "0021_previous_deathbird",
    );
    assert.equal(matchingEntries.length, 1);
    assert.equal(matchingEntries[0].idx, 21);
    assert.equal(matchingEntries[0].version, "7");
  });

  it("stores only reviewed bindings and never raw identity credentials", () => {
    for (const constraint of [
      "id_pair_intents_policy_check",
      "id_pair_intents_provider_check",
      "id_pair_intents_subject_binding_check",
      "id_pair_intents_operator_principal_check",
      "id_pair_intents_subject_principal_check",
      "id_pair_intents_operator_binding_check",
      "id_pair_intents_planner_policy_check",
      "id_pair_intents_plan_binding_check",
      "id_pair_intents_challenge_digest_check",
    ]) {
      assert.match(migration, new RegExp(`CONSTRAINT "${constraint}"`));
    }

    assert.match(migration, /identity_pairing_authority_v1/);
    assert.match(migration, /provider_subject_hmac_sha256_v1/);
    assert.match(migration, /operator_session_hmac_sha256_v1/);
    assert.match(migration, /initial_identity_link_planner_v1/);
    assert.match(migration, /identity_link_plan_hmac_sha256_v1/);
    assert.match(migration, /challenge-sha256-v1/);

    assert.doesNotMatch(
      migration,
      /"provider_subject"|"email"|"token"|"cookie"|"profile"|"authorization"/i,
    );
  });

  it("enforces a ten-minute lifetime and exactly one terminal event", () => {
    assert.match(
      migration,
      /"expires_at" > "identity_pairing_intents"\."issued_at"/,
    );
    assert.match(
      migration,
      /"expires_at" <= "identity_pairing_intents"\."issued_at" \+ interval '10 minutes'/,
    );
    assert.match(
      migration,
      /"event_type" in \('consumed', 'revoked'\)/,
    );
    assert.match(
      migration,
      /"event_type" = 'consumed'.*"auth_identity_id" is not null.*"event_type" = 'revoked'.*"auth_identity_id" is null/s,
    );
    assert.match(
      migration,
      /CREATE UNIQUE INDEX "id_pair_intent_events_terminal_unique".*"identity_pairing_intent_id"/,
    );
    assert.match(
      migration,
      /CREATE UNIQUE INDEX "id_pair_intents_challenge_digest_unique".*"challenge_digest"/,
    );
  });

  it("binds targets and consumed identities without cascading deletes", () => {
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
