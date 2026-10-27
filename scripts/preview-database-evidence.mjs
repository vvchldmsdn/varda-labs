import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { neon } from "@neondatabase/serverless";
import { readMigrationFiles } from "drizzle-orm/migrator";

import {
  assertPreviewHoldingOnboardingRowsPreserved,
  assertPreviewPortfolioTargetPolicyRowsPreserved,
  assertPreviewTargetPolicyRowsPreserved,
  assertPreviewPortfolioScopeRowsPreserved,
  assertReviewedPreviewDatabaseCatalog,
  assertReviewedPreviewDatabaseState,
  publicPreviewDatabaseEvidence,
  readPreviewDatabaseState,
} from "../src/lib/deployment/preview-database-evidence.ts";
import { PREVIEW_DATABASE_TARGET_GUARD_POLICY } from "../src/lib/deployment/preview-database-target.ts";
import { planPreviewMigrations } from "../src/lib/deployment/preview-migration-plan.ts";

const PHASE = readArgument("--phase");
const EVIDENCE_FILE = join(
  tmpdir(),
  "varda-preview-database-preflight-v17.json",
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
  const state = await readPreviewDatabaseState({
    env: process.env,
    query,
  });
  const localMigrations = readLocalMigrations();
  const plan = planPreviewMigrations({
    localMigrations,
    appliedMigrations: state.appliedMigrations,
    allowedPendingMigrations:
      PREVIEW_DATABASE_TARGET_GUARD_POLICY.allowedPendingMigrations,
  });

  if (PHASE === "preflight") {
    assertPreflightCatalog(plan, state, localMigrations);
    const evidence = {
      evidenceVersion: "preview_database_build_preflight_v22",
      targetFingerprint: state.target.targetFingerprint,
      rowCounts: state.rowCounts,
      targetPolicyRows: state.reviewedCatalog.targetPolicyRows,
      portfolioScopeRows: state.reviewedCatalog.portfolioScopeRows,
      holdingOnboardingEvidenceRows:
        state.reviewedCatalog.holdingOnboardingEvidenceRows,
      portfolioTargetPolicyRows:
        state.reviewedCatalog.portfolioTargetPolicyRows,
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
    "preview_database_build_preflight_v22",
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
  assertPreviewTargetPolicyRowsPreserved(
    before.targetPolicyRows ?? null,
    state.reviewedCatalog.targetPolicyRows,
  );
  assertPreviewPortfolioScopeRowsPreserved(
    before.portfolioScopeRows ?? null,
    state.reviewedCatalog.portfolioScopeRows,
  );
  assertPreviewHoldingOnboardingRowsPreserved(
    before.holdingOnboardingEvidenceRows ?? null,
    state.reviewedCatalog.holdingOnboardingEvidenceRows,
  );
  assertPreviewPortfolioTargetPolicyRowsPreserved(
    before.portfolioTargetPolicyRows ?? null,
    state.reviewedCatalog.portfolioTargetPolicyRows,
  );

  rmSync(EVIDENCE_FILE, { force: true });
  logEvidence(PHASE, state, plan);
}

function assertPreflightCatalog(plan, state, localMigrations) {
  if (plan.pendingTags.length === 0) {
    assertReviewedPreviewDatabaseState(state);
    return;
  }

  const latestApplied = localMigrations[plan.appliedCount - 1];
  assert.ok(
    latestApplied,
    "Preview database must have an applied migration before pending migrations",
  );
  assert.deepEqual(
    state.latestMigration,
    {
      createdAt: latestApplied.createdAt,
      sha256: latestApplied.sha256,
    },
    "Preview state and migration ledger disagree before pending migrations",
  );
  assertReviewedPreviewDatabaseCatalog(state);
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
