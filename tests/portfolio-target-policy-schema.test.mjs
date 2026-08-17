import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const schema = readFileSync(new URL("../src/db/schema.ts", import.meta.url), "utf8");
const writer = readFileSync(
  new URL("../src/lib/portfolio-target-policy-write.ts", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../drizzle/0026_curved_raider.sql", import.meta.url),
  "utf8",
);

describe("portfolio target policy persistence boundary", () => {
  it("uses immutable revisions, normalized rows, and lifecycle events", () => {
    assert.match(schema, /"portfolio_target_policy_revisions"/);
    assert.match(schema, /"portfolio_target_policy_rows"/);
    assert.match(schema, /"portfolio_target_policy_lifecycle_events"/);
    assert.match(schema, /portfolio_target_revisions_scope_shape_check/);
    assert.match(schema, /portfolio_target_rows_asset_account_fk/);
    assert.match(schema, /portfolio_target_rows_positive_buyability_check/);
    assert.match(schema, /portfolio_target_events_audit_version_check/);
    assert.match(schema, /portfolio_target_current_all_unique/);
    assert.match(schema, /portfolio_target_current_account_unique/);
    assert.match(schema, /portfolio_target_current_group_unique/);
    assert.doesNotMatch(schema, /portfolio_target_policy_revisions[\s\S]{0,2000}is_current/);
  });

  it("revalidates session ownership and serializes replacement in one transaction", () => {
    assert.match(writer, /resolveCurrentTenantContext\(\)/);
    assert.match(writer, /submittedUniverseHash !== model\.currentUniverseHash/);
    assert.match(writer, /pg_advisory_xact_lock/);
    assert.match(writer, /set local lock_timeout = '2s'/);
    assert.match(writer, /set local statement_timeout = '8s'/);
    assert.match(writer, /portfolio_target_policy_audit_v1/);
    assert.match(
      writer,
      /serializePortfolioTargetPolicyRows\(record\.rows\)/,
    );
    assert.doesNotMatch(writer, /accountId:\s*row\.accountId/);
    assert.doesNotMatch(writer, /retry/i);
  });

  it("keeps migration 0026 as a three-table expand-only change", () => {
    const createdTables = migration.match(/^CREATE TABLE /gm) ?? [];

    assert.equal(createdTables.length, 3);
    assert.match(migration, /CREATE TABLE "portfolio_target_policy_revisions"/);
    assert.match(migration, /CREATE TABLE "portfolio_target_policy_rows"/);
    assert.match(
      migration,
      /CREATE TABLE "portfolio_target_policy_lifecycle_events"/,
    );
    assert.match(migration, /portfolio_target_events_audit_version_check/);
    assert.match(migration, /portfolio_target_rows_asset_account_fk/);
    assert.match(migration, /portfolio_target_current_all_unique/);
    assert.match(migration, /portfolio_target_current_account_unique/);
    assert.match(migration, /portfolio_target_current_group_unique/);
    assert.ok(
      migration.indexOf("portfolio_target_revisions_id_owner_unique") <
        migration.indexOf("portfolio_target_events_revision_owner_fk"),
      "the referenced revision-owner unique index must exist before its foreign keys",
    );
    assert.doesNotMatch(migration, /^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/gim);
  });
});
