import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, it } from "node:test";
import { NeonDbError } from "@neondatabase/serverless";

import {
  classifyCuratedVectorRehearsalError,
  CURATED_VECTOR_REHEARSAL_ROLLBACK_MARKER,
} from "../scripts/lib/curated-vector-rehearsal-error.mjs";

const ROOT = process.cwd();
const SCHEMA_PATH = join(ROOT, "src", "db", "schema.ts");
const META_PATH = join(ROOT, "drizzle", "meta", "0017_snapshot.json");
const MIGRATION_NAME = "0017_workable_jimmy_woo.sql";
const EXPECTED_MIGRATION_SHA256 =
  "8f736749953d3c5f1f814a87a803729be1eb91932eb1694d64feb69e728930b8";
const REHEARSAL_PATH = join(
  ROOT,
  "scripts",
  "rehearse-curated-vector-schema.mjs",
);
const PACKAGE_PATH = join(ROOT, "package.json");
const migrationNames = readdirSync(join(ROOT, "drizzle")).filter((name) =>
  /^0017_[a-z0-9_]+\.sql$/.test(name),
);

assert.deepEqual(migrationNames, [MIGRATION_NAME]);

const MIGRATION_PATH = join(ROOT, "drizzle", MIGRATION_NAME);
const migration = readFileSync(MIGRATION_PATH, "utf8");
const schema = readFileSync(SCHEMA_PATH, "utf8");
const metadata = JSON.parse(readFileSync(META_PATH, "utf8"));
const rehearsal = readFileSync(REHEARSAL_PATH, "utf8");
const packageJson = JSON.parse(readFileSync(PACKAGE_PATH, "utf8"));
const statements = migration
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);

const TABLES = {
  simulation_scenario_approval_revisions: [
    "id",
    "owner_user_id",
    "portfolio_path_policy_id",
    "gate0_approval_commit",
    "scenario_id",
    "scenario_version",
    "approval_revision",
    "scenario_vector_hash",
    "approved_at",
    "lifecycle_status",
    "terminal_at",
  ],
  simulation_scenario_approval_vector_rows: [
    "approval_revision_id",
    "market",
    "currency",
    "ticker",
    "weight_bps",
  ],
  simulation_scenario_approval_lifecycle_events: [
    "id",
    "approval_revision_id",
    "event_sequence",
    "audit_version",
    "transition_kind",
    "previous_status",
    "resulting_status",
    "transitioned_at",
    "replacement_revision_id",
  ],
};

const SCHEMA_FIELDS = {
  simulation_scenario_approval_revisions: [
    "id",
    "ownerUserId",
    "portfolioPathPolicyId",
    "gate0ApprovalCommit",
    "scenarioId",
    "scenarioVersion",
    "approvalRevision",
    "scenarioVectorHashVersion",
    "scenarioVectorHash",
    "approvedAt",
    "lifecycleStatus",
    "terminalAt",
  ],
  simulation_scenario_approval_vector_rows: [
    "approvalRevisionId",
    "market",
    "currency",
    "ticker",
    "weightBps",
  ],
  simulation_scenario_approval_lifecycle_events: [
    "id",
    "approvalRevisionId",
    "eventSequence",
    "auditVersion",
    "transitionKind",
    "previousStatus",
    "resultingStatus",
    "transitionedAt",
    "replacementRevisionId",
  ],
};

const CHECKS = [
  "sim_scenario_approval_revisions_policy_id_check",
  "sim_scenario_approval_revisions_gate0_commit_check",
  "sim_scenario_approval_revisions_scenario_id_check",
  "sim_scenario_approval_revisions_scenario_version_check",
  "sim_scenario_approval_revisions_revision_check",
  "sim_scenario_approval_revisions_vector_hash_check",
  "sim_scenario_approval_revisions_lifecycle_status_check",
  "sim_scenario_approval_revisions_terminal_state_check",
  "sim_scenario_approval_vector_rows_market_check",
  "sim_scenario_approval_vector_rows_currency_check",
  "sim_scenario_approval_vector_rows_ticker_check",
  "sim_scenario_approval_vector_rows_weight_check",
  "sim_scenario_approval_events_sequence_check",
  "sim_scenario_approval_events_audit_version_check",
  "sim_scenario_approval_events_transition_shape_check",
].sort();

const FOREIGN_KEYS = [
  "sim_scenario_approval_revisions_owner_user_fk",
  "sim_scenario_approval_vector_rows_revision_fk",
  "sim_scenario_approval_events_revision_fk",
  "sim_scenario_approval_events_replacement_fk",
].sort();

const UNIQUE_INDEXES = [
  "sim_scenario_approval_revisions_identity_revision_unique",
  "sim_scenario_approval_revisions_current_unique",
  "sim_scenario_approval_events_revision_sequence_unique",
].sort();

const REGULAR_INDEXES = [
  "sim_scenario_approval_events_replacement_idx",
];

const STATEMENT_SIGNATURES = [
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

const EXPORTS = [
  "simulationScenarioApprovalRevisions",
  "simulationScenarioApprovalVectorRows",
  "simulationScenarioApprovalLifecycleEvents",
];

describe("curated approved-vector schema", () => {
  it("declares the exact current tables, columns, and inferred types", () => {
    for (const [tableName, columns] of Object.entries(SCHEMA_FIELDS)) {
      const exportName = EXPORTS.find((name) =>
        schema.includes(`export const ${name} = pgTable(\n  "${tableName}"`),
      );
      assert.ok(exportName, `missing schema export for ${tableName}`);
      assert.deepEqual(schemaFieldNames(exportName), columns);
      assert.equal(countMatches(schema, new RegExp(`"${tableName}"`, "g")), 1);
    }

    for (const typeName of [
      "SimulationScenarioApprovalRevision",
      "NewSimulationScenarioApprovalRevision",
      "SimulationScenarioApprovalVectorRow",
      "NewSimulationScenarioApprovalVectorRow",
      "SimulationScenarioApprovalLifecycleEvent",
      "NewSimulationScenarioApprovalLifecycleEvent",
    ]) {
      assert.equal(
        countMatches(schema, new RegExp(`export type ${typeName}\\b`, "g")),
        1,
      );
    }

    assert.match(schema, /weightBps: integer\("weight_bps"\)\.notNull\(\)/);
    assert.doesNotMatch(
      approvedSchemaBlocks(),
      /\b(?:account|assetId|isCurrent|legacy|weightsJson|ordinal|provider|job|result)\s*:/,
    );
  });

  it("generates only the exact new table and column shapes", () => {
    assert.deepEqual(createdTableNames(), Object.keys(TABLES).sort());

    for (const [tableName, expectedColumns] of Object.entries(TABLES)) {
      assert.deepEqual(migrationColumnNames(tableName), expectedColumns);
    }

    assert.match(
      migration,
      /"id" uuid PRIMARY KEY DEFAULT gen_random_uuid\(\) NOT NULL/,
    );
    assert.match(migration, /"approved_at" timestamp with time zone NOT NULL/);
    assert.match(migration, /"lifecycle_status" varchar\(20\) NOT NULL/);
    assert.match(migration, /"terminal_at" timestamp with time zone[,\r\n]/);
    assert.match(migration, /"transitioned_at" timestamp with time zone NOT NULL/);
    assert.doesNotMatch(
      migration,
      /"(?:approved_at|lifecycle_status|terminal_at|transitioned_at|transition_kind|audit_version)"[^\n]*DEFAULT/i,
    );
    assert.match(
      migration,
      /CONSTRAINT "sim_scenario_approval_vector_rows_pk" PRIMARY KEY\("approval_revision_id","market","currency","ticker"\)/,
    );
  });

  it("keeps exact checks, restricted foreign keys, and indexes", () => {
    const checkNames = [...migration.matchAll(/CONSTRAINT "([^"]+)" CHECK/g)]
      .map((match) => match[1])
      .sort();
    const foreignKeyNames = [...migration.matchAll(
      /ADD CONSTRAINT "([^"]+)" FOREIGN KEY/g,
    )]
      .map((match) => match[1])
      .sort();
    const uniqueIndexNames = [...migration.matchAll(
      /CREATE UNIQUE INDEX "([^"]+)"/g,
    )]
      .map((match) => match[1])
      .sort();
    const regularIndexNames = [...migration.matchAll(
      /CREATE INDEX "([^"]+)"/g,
    )].map((match) => match[1]);

    assert.deepEqual(checkNames, CHECKS);
    assert.deepEqual(foreignKeyNames, FOREIGN_KEYS);
    assert.deepEqual(uniqueIndexNames, UNIQUE_INDEXES);
    assert.deepEqual(regularIndexNames, REGULAR_INDEXES);

    const foreignKeyStatements = statements.filter((statement) =>
      statement.includes("FOREIGN KEY"),
    );
    assert.equal(foreignKeyStatements.length, 4);
    for (const statement of foreignKeyStatements) {
      assert.match(statement, /ON DELETE restrict ON UPDATE no action;?$/);
    }

    assert.match(
      migration,
      /CREATE UNIQUE INDEX "sim_scenario_approval_revisions_current_unique" ON "simulation_scenario_approval_revisions" USING btree \("owner_user_id","portfolio_path_policy_id","gate0_approval_commit","scenario_id","scenario_version"\) WHERE "simulation_scenario_approval_revisions"\."lifecycle_status" = 'approved'/,
    );
    assert.match(
      migration,
      /"weight_bps" between 0 and 10000/,
      "explicit zero-bps rows must remain valid",
    );
  });

  it("contains no DML, destructive DDL, existing-table alteration, or authority leakage", () => {
    assertPinnedMigration(migration);

    for (const statement of statements) {
      assert.doesNotMatch(
        statement,
        /^(?:INSERT|UPDATE|DELETE|MERGE|COPY|TRUNCATE)\b/i,
      );

      const alterSubject = statement.match(/^ALTER TABLE "([^"]+)"/i)?.[1];
      if (alterSubject) assert.ok(alterSubject in TABLES);
    }

    assert.doesNotMatch(
      migration,
      /\b(?:DROP|RENAME|ALTER COLUMN|SET DEFAULT|SET NOT NULL|CASCADE|CREATE TYPE|CREATE TRIGGER|CREATE FUNCTION|CREATE PROCEDURE|CREATE POLICY|ENABLE ROW LEVEL SECURITY|GRANT|REVOKE)\b/i,
    );
    assert.doesNotMatch(migration, /neon_auth/i);
    assert.doesNotMatch(
      migration,
      /"(?:legacy[^" ]*|created_by_id|account|asset_id|weights_json|is_current|email|provider_subject|token|password|secret|api_key|job|result|path|seed|horizon|price|fx|target|current_weight)"/i,
    );
    assert.equal(countMatches(migration, /CREATE TABLE /g), 3);
  });

  it("rejects every adversarial statement outside the exact allowlist", () => {
    for (const unapprovedStatement of [
      "CREATE EXTENSION pgcrypto;",
      'COMMENT ON TABLE "simulation_scenario_approval_revisions" IS \'drift\';',
      'CREATE VIEW "simulation_scenario_approval_current" AS SELECT 1;',
      'WITH injected AS (INSERT INTO "simulation_scenario_approval_revisions" DEFAULT VALUES RETURNING 1) SELECT 1;',
      'ALTER TABLE "simulation_scenario_approval_revisions" ADD COLUMN "drift" text;',
    ]) {
      assert.throws(() =>
        assertPinnedMigration(
          `${migration}\n--> statement-breakpoint\n${unapprovedStatement}`,
        ),
      );
    }

    assert.throws(() =>
      assertPinnedMigration(
        migration.replace(
          "CREATE TABLE \"simulation_scenario_approval_revisions\" (",
          'CREATE TABLE "simulation_scenario_approval_revisions" (; COMMENT ON TABLE "simulation_scenario_approval_revisions" IS \'drift\'',
        ),
      ),
    );
  });

  it("keeps Drizzle metadata and product imports inside the Stage I boundary", () => {
    const metadataTables = Object.keys(metadata.tables)
      .filter((name) => name.includes("simulation_scenario_approval_"))
      .sort();
    assert.deepEqual(
      metadataTables,
      Object.keys(TABLES)
        .map((name) => `public.${name}`)
        .sort(),
    );

    for (const filePath of sourceFiles(join(ROOT, "src"))) {
      if (filePath === SCHEMA_PATH) continue;
      const source = readFileSync(filePath, "utf8");
      for (const exportName of EXPORTS) {
        assert.doesNotMatch(source, new RegExp(`\\b${exportName}\\b`));
      }
    }
  });

  it("keeps the rollback rehearsal guarded and uninvoked by default", () => {
    const guardIndex = rehearsal.indexOf("process.argv.slice(2)");
    const dotenvImportIndex = rehearsal.indexOf('import("dotenv")');
    const neonImportIndex = rehearsal.indexOf(
      'import("@neondatabase/serverless")',
    );
    const databaseUrlIndex = rehearsal.indexOf("process.env.DATABASE_URL_UNPOOLED");

    assert.ok(guardIndex >= 0);
    assert.ok(dotenvImportIndex > guardIndex);
    assert.ok(neonImportIndex > guardIndex);
    assert.ok(databaseUrlIndex > neonImportIndex);
    assert.doesNotMatch(
      rehearsal,
      /^import .* from ["'](?:dotenv|@neondatabase\/serverless)["'];$/m,
    );
    assert.match(rehearsal, new RegExp(EXPECTED_MIGRATION_SHA256));
    assert.match(rehearsal, /\.map\(statementSignature\)/);
    assert.equal(
      packageJson.scripts["rehearse:curated-vector-schema"],
      "node --no-warnings scripts/rehearse-curated-vector-schema.mjs",
    );
  });

  it("classifies only the exact top-level Neon driver marker as expected", () => {
    const expected = neonError(CURATED_VECTOR_REHEARSAL_ROLLBACK_MARKER);
    assert.deepEqual(classifyCuratedVectorRehearsalError(expected, NeonDbError), {
      outcome: "expected_rollback",
      reason: "exact_driver_marker",
    });

    assert.deepEqual(
      classifyCuratedVectorRehearsalError(
        neonError(`prefix:${CURATED_VECTOR_REHEARSAL_ROLLBACK_MARKER}`),
        NeonDbError,
      ),
      { outcome: "unexpected_failure", reason: "database_error" },
    );
    assert.deepEqual(
      classifyCuratedVectorRehearsalError(
        neonError("catalog assertion failed"),
        NeonDbError,
      ),
      { outcome: "unexpected_failure", reason: "database_error" },
    );

    const transport = neonError(CURATED_VECTOR_REHEARSAL_ROLLBACK_MARKER);
    transport.sourceError = new Error("synthetic transport detail");
    assert.deepEqual(
      classifyCuratedVectorRehearsalError(transport, NeonDbError),
      {
      outcome: "unexpected_failure",
      reason: "transport_error",
      },
    );

    const nested = neonError(CURATED_VECTOR_REHEARSAL_ROLLBACK_MARKER);
    Object.defineProperty(nested, "cause", {
      configurable: true,
      enumerable: false,
      value: new Error(CURATED_VECTOR_REHEARSAL_ROLLBACK_MARKER),
    });
    assert.deepEqual(
      classifyCuratedVectorRehearsalError(nested, NeonDbError),
      {
      outcome: "unexpected_failure",
      reason: "unknown_error_envelope",
      },
    );

    const symbolEnvelope = neonError(CURATED_VECTOR_REHEARSAL_ROLLBACK_MARKER);
    symbolEnvelope[Symbol("nested")] = "synthetic";
    assert.deepEqual(
      classifyCuratedVectorRehearsalError(symbolEnvelope, NeonDbError),
      { outcome: "unexpected_failure", reason: "unknown_error_envelope" },
    );

    const accessorEnvelope = neonError(
      CURATED_VECTOR_REHEARSAL_ROLLBACK_MARKER,
    );
    Object.defineProperty(accessorEnvelope, "cause", {
      configurable: true,
      enumerable: false,
      get() {
        throw new Error("accessor must not be evaluated");
      },
    });
    assert.deepEqual(
      classifyCuratedVectorRehearsalError(accessorEnvelope, NeonDbError),
      { outcome: "unexpected_failure", reason: "unknown_error_envelope" },
    );

    const spoofedName = new Error(CURATED_VECTOR_REHEARSAL_ROLLBACK_MARKER);
    spoofedName.name = "NeonDbError";
    assert.deepEqual(
      classifyCuratedVectorRehearsalError(spoofedName, NeonDbError),
      { outcome: "unexpected_failure", reason: "opaque_error" },
    );

    class NeonDbErrorSubclass extends NeonDbError {}
    assert.deepEqual(
      classifyCuratedVectorRehearsalError(
        new NeonDbErrorSubclass(CURATED_VECTOR_REHEARSAL_ROLLBACK_MARKER),
        NeonDbError,
      ),
      { outcome: "unexpected_failure", reason: "opaque_error" },
    );

    assert.deepEqual(
      classifyCuratedVectorRehearsalError({
        message: CURATED_VECTOR_REHEARSAL_ROLLBACK_MARKER,
      }, NeonDbError),
      { outcome: "unexpected_failure", reason: "opaque_error" },
    );
    assert.deepEqual(
      classifyCuratedVectorRehearsalError(
        new Error(CURATED_VECTOR_REHEARSAL_ROLLBACK_MARKER),
        NeonDbError,
      ),
      { outcome: "unexpected_failure", reason: "opaque_error" },
    );
  });

  it("pins rehearsal catalog assertions to generated constraint evidence", () => {
    for (const constraintName of [...CHECKS, ...FOREIGN_KEYS]) {
      assert.match(rehearsal, new RegExp(`'${constraintName}'`));
    }

    for (const [variable, expected] of [
      ["target_table_count", 3],
      ["target_column_count", 25],
      ["target_check_count", CHECKS.length],
      ["target_fk_count", FOREIGN_KEYS.length],
      ["target_pk_count", 3],
      ["target_index_count", UNIQUE_INDEXES.length + REGULAR_INDEXES.length],
      ["target_row_count", 0],
      ["owner_reference_count", 1],
    ]) {
      assert.match(
        rehearsal,
        new RegExp(`if ${variable} <> ${expected} then`),
      );
    }

    assert.doesNotMatch(rehearsal, /information_schema\.table_constraints/);
    assert.match(rehearsal, /pg_catalog\.pg_constraint/);
  });
});

function createdTableNames() {
  return [...migration.matchAll(/CREATE TABLE "([^"]+)"/g)]
    .map((match) => match[1])
    .sort();
}

function assertPinnedMigration(candidateMigration) {
  const candidateStatements = candidateMigration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  assert.deepEqual(
    candidateStatements.map(statementSignature).sort(),
    STATEMENT_SIGNATURES,
  );
  assert.equal(
    createHash("sha256")
      .update(candidateMigration.replace(/\r\n/g, "\n"))
      .digest("hex"),
    EXPECTED_MIGRATION_SHA256,
  );
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

  throw new Error("statement is outside the exact curated-vector allowlist");
}

function migrationColumnNames(tableName) {
  const block = migration.match(
    new RegExp(`CREATE TABLE "${tableName}" \\(\\r?\\n([\\s\\S]*?)\\r?\\n\\);`),
  )?.[1];
  assert.ok(block, `missing migration block for ${tableName}`);
  return [...block.matchAll(/^\s*"([^"]+)"\s+/gm)].map((match) => match[1]);
}

function schemaFieldNames(exportName) {
  const block = schema.match(
    new RegExp(
      `export const ${exportName} = pgTable\\([\\s\\S]*?\\n  \\{([\\s\\S]*?)\\n  \\},\\n  \\(table\\)`,
    ),
  )?.[1];
  assert.ok(block, `missing schema column block for ${exportName}`);
  return [...block.matchAll(/^\s{4}(\w+):/gm)].map((match) => match[1]);
}

function approvedSchemaBlocks() {
  return EXPORTS.map((exportName) => {
    const start = schema.indexOf(`export const ${exportName} = pgTable`);
    const next = schema.indexOf("\nexport const ", start + 1);
    return schema.slice(start, next < 0 ? schema.length : next);
  }).join("\n");
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return [".ts", ".tsx", ".js", ".jsx", ".mjs"].includes(extname(entry.name))
      ? [entryPath]
      : [];
  });
}

function countMatches(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

function neonError(message) {
  return new NeonDbError(message);
}
