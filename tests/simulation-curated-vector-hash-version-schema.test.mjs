import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();
const MIGRATION_NAME = "0018_massive_wolfpack.sql";
const EXPECTED_MIGRATION_SHA256 =
  "b3d141bda40af8d24bbff248a5beac7f68c7291175cf813da3aedfff148afc9d";
const PRIOR_MIGRATION_SHA256 =
  "8f736749953d3c5f1f814a87a803729be1eb91932eb1694d64feb69e728930b8";
const TARGET_TABLE = "public.simulation_scenario_approval_revisions";
const VERSION_COLUMN = "scenario_vector_hash_version";
const VERSION_CONSTRAINT =
  "sim_scenario_approval_revisions_vector_hash_version_check";

const migrationNames = readdirSync(join(ROOT, "drizzle")).filter((name) =>
  /^0018_[a-z0-9_]+\.sql$/.test(name),
);
assert.deepEqual(migrationNames, [MIGRATION_NAME]);

const migration = read("drizzle", MIGRATION_NAME);
const priorMigration = read("drizzle", "0017_workable_jimmy_woo.sql");
const priorSnapshot = json("drizzle", "meta", "0017_snapshot.json");
const snapshot = json("drizzle", "meta", "0018_snapshot.json");
const journal = json("drizzle", "meta", "_journal.json");
const schema = read("src", "db", "schema.ts");
const rehearsal = read(
  "scripts",
  "rehearse-curated-vector-hash-version.mjs",
);
const packageJson = json("package.json");

describe("curated approved-vector hash-version schema amendment", () => {
  it("generates only the exact non-null v2 binding column and check", () => {
    assert.equal(normalizedHash(migration), EXPECTED_MIGRATION_SHA256);
    assert.deepEqual(statements(migration), [
      'ALTER TABLE "simulation_scenario_approval_revisions" ADD COLUMN "scenario_vector_hash_version" varchar(64) NOT NULL;',
      'ALTER TABLE "simulation_scenario_approval_revisions" ADD CONSTRAINT "sim_scenario_approval_revisions_vector_hash_version_check" CHECK ("simulation_scenario_approval_revisions"."scenario_vector_hash_version" = \'simulation_scenario_vector_hash_v2\');',
    ]);
    assert.doesNotMatch(
      migration,
      /\b(?:INSERT|UPDATE|DELETE|MERGE|COPY|TRUNCATE|DROP|RENAME|ALTER COLUMN|SET DEFAULT|CREATE INDEX|CREATE TYPE|CREATE TRIGGER|CREATE FUNCTION|CREATE PROCEDURE|CREATE POLICY|ENABLE ROW LEVEL SECURITY|GRANT|REVOKE)\b/i,
    );
    assert.doesNotMatch(migration, /\bDEFAULT\b/i);
  });

  it("keeps 0017 immutable and records exactly one 0018 journal entry", () => {
    assert.equal(normalizedHash(priorMigration), PRIOR_MIGRATION_SHA256);
    assert.equal(snapshot.prevId, priorSnapshot.id);
    assert.deepEqual(journal.entries.at(-1), {
      idx: 18,
      version: "7",
      when: 1783945272945,
      tag: "0018_massive_wolfpack",
      breakpoints: true,
    });
  });

  it("changes only the target table metadata", () => {
    const expected = clone(priorSnapshot);
    expected.id = snapshot.id;
    expected.prevId = priorSnapshot.id;
    expected.tables[TARGET_TABLE].columns[VERSION_COLUMN] = {
      name: VERSION_COLUMN,
      type: "varchar(64)",
      primaryKey: false,
      notNull: true,
    };
    expected.tables[TARGET_TABLE].checkConstraints[VERSION_CONSTRAINT] = {
      name: VERSION_CONSTRAINT,
      value:
        '"simulation_scenario_approval_revisions"."scenario_vector_hash_version" = \'simulation_scenario_vector_hash_v2\'',
    };
    assert.deepEqual(snapshot, expected);
  });

  it("keeps the active Drizzle declaration exact and default-free", () => {
    assert.match(
      schema,
      /scenarioVectorHashVersion: varchar\("scenario_vector_hash_version", \{\s*length: 64,\s*\}\)\.notNull\(\)/,
    );
    assert.match(
      schema,
      /"sim_scenario_approval_revisions_vector_hash_version_check",\s*sql`\$\{table\.scenarioVectorHashVersion\} = 'simulation_scenario_vector_hash_v2'`/,
    );
    assert.doesNotMatch(
      schema,
      /scenarioVectorHashVersion[\s\S]{0,120}\.default\(/,
    );
  });

  it("keeps the rollback rehearsal explicit, pinned, and fail-closed", () => {
    const guardIndex = rehearsal.indexOf("process.argv.slice(2)");
    const dotenvImportIndex = rehearsal.indexOf('import("dotenv")');
    const neonImportIndex = rehearsal.indexOf(
      'import("@neondatabase/serverless")',
    );

    assert.ok(guardIndex >= 0);
    assert.ok(dotenvImportIndex > guardIndex);
    assert.ok(neonImportIndex > guardIndex);
    assert.match(rehearsal, new RegExp(EXPECTED_MIGRATION_SHA256));
    assert.match(rehearsal, /EXPECTED_PRIOR_MIGRATION_CREATED_AT/);
    assert.match(rehearsal, /target_row_count <> 0/);
    assert.match(rehearsal, /version_column_count <> 1/);
    assert.match(rehearsal, /version_constraint_count <> 1/);
    assert.match(rehearsal, /set local lock_timeout = '5s'/);
    assert.match(rehearsal, /set local statement_timeout = '30s'/);
    assert.doesNotMatch(rehearsal, /db:migrate|process\.env\.[A-Z_]+\s*=/);
    assert.equal(
      packageJson.scripts["rehearse:curated-vector-hash-version"],
      "node --no-warnings scripts/rehearse-curated-vector-hash-version.mjs",
    );
  });
});

function read(...parts) {
  return readFileSync(join(ROOT, ...parts), "utf8");
}

function json(...parts) {
  return JSON.parse(read(...parts));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizedHash(value) {
  return createHash("sha256")
    .update(value.replace(/\r\n/g, "\n"))
    .digest("hex");
}

function statements(value) {
  return value
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}
