import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  TRANSITIONAL_OWNER_COLUMN,
  USER_OWNED_TABLE_NAMES,
} from "../scripts/lib/tenant-ownership-policy.mjs";

const ROOT = process.cwd();
const MIGRATION_PATH = join(ROOT, "drizzle", "0016_ambiguous_vulcan.sql");
const SCHEMA_PATH = join(ROOT, "src", "db", "schema.ts");
const migration = readFileSync(MIGRATION_PATH, "utf8");
const schema = readFileSync(SCHEMA_PATH, "utf8");
const statements = migration
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);

const expectedOwnerTables = [...USER_OWNED_TABLE_NAMES].sort();
const expectedOwnerIndexes = expectedOwnerTables
  .map((table) => `${table}_${TRANSITIONAL_OWNER_COLUMN}_idx`)
  .sort();
const expectedIdentityIndexes = [
  "auth_identities_active_app_user_provider_unique",
  "auth_identities_app_user_id_idx",
  "auth_identities_provider_subject_unique",
];

describe("tenant Phase 1C expand migration", () => {
  it("adds the exact two identity tables and 14 nullable owner columns", () => {
    assert.equal(countMatches(migration, /CREATE TABLE /g), 2);
    assert.match(migration, /CREATE TABLE "app_users"/);
    assert.match(migration, /CREATE TABLE "auth_identities"/);

    const ownerTables = [...migration.matchAll(
      /ALTER TABLE "([^"]+)" ADD COLUMN "canonical_owner_user_id" uuid;/g,
    )]
      .map((match) => match[1])
      .sort();

    assert.deepEqual(ownerTables, expectedOwnerTables);
    assert.equal(new Set(ownerTables).size, 14);
    assert.doesNotMatch(
      migration,
      /ADD COLUMN "canonical_owner_user_id" uuid (?:DEFAULT|NOT NULL)/i,
    );
  });

  it("creates only the allowed identity FK and expected indexes", () => {
    const foreignKeyStatements = statements.filter((statement) =>
      statement.includes("FOREIGN KEY"),
    );
    assert.equal(foreignKeyStatements.length, 1);
    assert.match(
      foreignKeyStatements[0],
      /^ALTER TABLE "auth_identities" ADD CONSTRAINT /,
    );
    assert.match(foreignKeyStatements[0], /ON DELETE restrict/);

    const indexNames = [...migration.matchAll(
      /CREATE (?:UNIQUE )?INDEX "([^"]+)"/g,
    )].map((match) => match[1]);
    const ownerIndexes = indexNames
      .filter((name) => name.endsWith(`_${TRANSITIONAL_OWNER_COLUMN}_idx`))
      .sort();
    const identityIndexes = indexNames
      .filter((name) => name.startsWith("auth_identities_"))
      .sort();

    assert.deepEqual(ownerIndexes, expectedOwnerIndexes);
    assert.deepEqual(identityIndexes, expectedIdentityIndexes);
    assert.equal(indexNames.length, 17);
  });

  it("keeps identity values normalized without rewriting provider subjects", () => {
    for (const constraint of [
      "app_users_status_check",
      "app_users_role_check",
      "auth_identities_status_check",
      "auth_identities_provider_check",
      "auth_identities_provider_subject_check",
      "auth_identities_disabled_state_check",
    ]) {
      assert.match(migration, new RegExp(`CONSTRAINT "${constraint}"`));
    }

    assert.match(
      migration,
      /"provider" = lower\(btrim\("auth_identities"\."provider"\)\)/,
    );
    assert.match(
      migration,
      /"provider_subject" = btrim\("auth_identities"\."provider_subject"\)/,
    );
    assert.doesNotMatch(migration, /lower\([^)]*provider_subject/i);
    assert.match(
      migration,
      /"status" = 'active'.*"disabled_at" is null.*"status" = 'disabled'.*"disabled_at" is not null/s,
    );
  });

  it("contains no row write, destructive DDL, RLS, or managed auth reference", () => {
    for (const statement of statements) {
      assert.doesNotMatch(
        statement,
        /^(?:INSERT|UPDATE|DELETE|MERGE|COPY|TRUNCATE)\b/i,
      );
    }

    assert.doesNotMatch(
      migration,
      /\b(?:DROP|RENAME|ALTER COLUMN|SET DEFAULT|SET NOT NULL|CASCADE|CREATE POLICY|ENABLE ROW LEVEL SECURITY|GRANT|REVOKE)\b/i,
    );
    assert.doesNotMatch(migration, /neon_auth/i);
    assert.equal(statements.length, 34);
  });

  it("keeps the active Drizzle schema aligned with the migration allowlist", () => {
    assert.equal(
      countMatches(
        schema,
        /canonicalOwnerUserId: uuid\("canonical_owner_user_id"\)/g,
      ),
      14,
    );

    for (const table of expectedOwnerTables) {
      assert.match(
        schema,
        new RegExp(`"${table}_${TRANSITIONAL_OWNER_COLUMN}_idx"`),
      );
    }

    assert.match(schema, /export const appUsers = pgTable/);
    assert.match(schema, /export const authIdentities = pgTable/);
  });
});

function countMatches(value, pattern) {
  return [...value.matchAll(pattern)].length;
}
