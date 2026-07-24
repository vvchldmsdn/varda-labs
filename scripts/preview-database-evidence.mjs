import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { neon } from "@neondatabase/serverless";
import { readMigrationFiles } from "drizzle-orm/migrator";

import {
  assertReviewedPreviewDatabaseState,
  publicPreviewDatabaseEvidence,
  readPreviewDatabaseState,
} from "../src/lib/deployment/preview-database-evidence.ts";
import { PREVIEW_DATABASE_TARGET_GUARD_POLICY } from "../src/lib/deployment/preview-database-target.ts";
import { planPreviewMigrations } from "../src/lib/deployment/preview-migration-plan.ts";

const PHASE = readArgument("--phase");
const EVIDENCE_FILE = join(
  tmpdir(),
  "varda-preview-database-preflight-v3.json",
);
const MIGRATIONS_FOLDER = resolve("drizzle");

if (!["preflight", "postflight"].includes(PHASE)) {
  throw new Error("--phase must be preflight or postflight.");
}

try {
  await run();
} catch (error) {
  console.error(`[preview-db] ${sanitizedErrorMessage(error)}`);
  process.exitCode = 1;
}

async function run() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for Preview database evidence.");
  }

  const sql = neon(databaseUrl);
  const query = (text) => sql.query(text);
  const [state, appliedMigrations] = await Promise.all([
    readPreviewDatabaseState({ env: process.env, query }),
    readAppliedMigrations(query),
  ]);
  const localMigrations = readLocalMigrations();
  const plan = planPreviewMigrations({
    localMigrations,
    appliedMigrations,
    allowedPendingMigrations:
      PREVIEW_DATABASE_TARGET_GUARD_POLICY.allowedPendingMigrations,
  });

  if (PHASE === "preflight") {
    assertPreflightCatalog(plan, state);
    const evidence = {
      evidenceVersion: "preview_database_build_preflight_v3",
      targetFingerprint: state.target.targetFingerprint,
      rowCounts: state.rowCounts,
    };
    writeFileSync(EVIDENCE_FILE, `${JSON.stringify(evidence)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    logEvidence(PHASE, state, plan);
    return;
  }

  assert.deepEqual(
    plan.pendingTags,
    [],
    "Preview postflight still has pending migrations",
  );
  assertReviewedPreviewDatabaseState(state);

  const before = JSON.parse(readFileSync(EVIDENCE_FILE, "utf8"));
  assert.equal(
    before.evidenceVersion,
    "preview_database_build_preflight_v3",
    "Preview preflight evidence version drifted",
  );
  assert.equal(
    state.target.targetFingerprint,
    before.targetFingerprint,
    "Preview migration changed database target",
  );
  assert.deepEqual(
    state.rowCounts,
    before.rowCounts,
    "Preview migration changed protected row counts",
  );

  rmSync(EVIDENCE_FILE, { force: true });
  logEvidence(PHASE, state, plan);
}

function assertPreflightCatalog(plan, state) {
  if (plan.pendingTags.length === 0) {
    assertReviewedPreviewDatabaseState(state);
    return;
  }

  assert.deepEqual(
    plan.pendingTags,
    ["0020_rainy_northstar"],
    "Only reviewed migration 0020 may be pending",
  );
  assert.equal(
    state.reviewedCatalog.adjustedClosePriceNullable,
    true,
    "Pending 0020 target lost reviewed adjusted-close nullability",
  );
  assert.deepEqual(
    state.reviewedCatalog.presentColumns,
    [
      "adjusted_close_basis",
      "adjusted_close_provider",
      "adjusted_close_source",
      "adjusted_close_fetched_at",
      "provider_symbol",
      "provider_exchange",
      "fetched_at",
    ],
    "Pending 0020 target lost reviewed provenance columns",
  );
  assert.equal(
    state.reviewedCatalog.instrumentDateUniqueIndexExact,
    true,
    "Pending 0020 target lost the exact instrument/date unique index",
  );
  assert.equal(
    state.reviewedCatalog.legacyTickerDateUniqueIndexExact,
    true,
    "Pending 0020 target does not have the reviewed legacy unique index",
  );
  assert.equal(
    state.reviewedCatalog.legacyTickerDateIndexPresent,
    true,
    "Pending 0020 target already removed the legacy unique index",
  );
}

async function readAppliedMigrations(query) {
  const rows = await query(`
    select hash, created_at::text as created_at
      from drizzle.__drizzle_migrations
     order by created_at asc
  `);
  return rows.map((row) => ({
    createdAt: Number(row.created_at),
    sha256: String(row.hash ?? ""),
  }));
}

function readLocalMigrations() {
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
  return journal.entries.map((entry, index) => ({
    tag: entry.tag,
    createdAt: entry.when,
    sha256: migrations[index].hash,
  }));
}

function logEvidence(phase, state, plan) {
  console.log(
    `[preview-db] ${JSON.stringify({
      phase,
      ...publicPreviewDatabaseEvidence(state),
      migrationPlan: plan,
    })}`,
  );
}

function sanitizedErrorMessage(error) {
  const message = error instanceof Error ? error.message : "Unknown failure";
  return message
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-database-url]")
    .replace(
      /ep-[a-z0-9-]+(?:-pooler)?(?:\.[a-z0-9-]+)+\.neon\.tech/gi,
      "[redacted-database-host]",
    );
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
