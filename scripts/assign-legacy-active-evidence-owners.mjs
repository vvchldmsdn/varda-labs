import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "@neondatabase/serverless";

import { guardProductionDatabaseTarget } from "../src/lib/deployment/production-database-target.ts";
import {
  buildLegacyActiveEvidenceOwnerAssignmentPlan,
  LEGACY_ACTIVE_EVIDENCE_OWNER_ASSIGNMENT_POLICY,
  LEGACY_ACTIVE_EVIDENCE_TABLES,
  LegacyActiveEvidenceOwnerAssignmentError,
} from "./lib/legacy-active-evidence-owner-assignment.mjs";
import { loadProductionDatabaseEnvironmentFromEnvLocal } from "./lib/production-database-environment.mjs";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SAFE_ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,79}$/;
const CONFIRMATION = "--confirm-initial-active-evidence-owner-assignment-v1";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const PLAN_KEYS = Object.freeze(Object.keys(LEGACY_ACTIVE_EVIDENCE_TABLES));
const ALLOWED_TABLES = new Set(Object.values(LEGACY_ACTIVE_EVIDENCE_TABLES));

export const LEGACY_ACTIVE_EVIDENCE_OWNER_ASSIGNMENT_CLI_POLICY = Object.freeze({
  ...LEGACY_ACTIVE_EVIDENCE_OWNER_ASSIGNMENT_POLICY,
  confirmation: CONFIRMATION,
  defaultMode: "dry_run",
});

export class LegacyActiveEvidenceOwnerAssignmentCliError extends Error {
  constructor(code) {
    super("Legacy active evidence owner assignment CLI failed");
    this.name = "LegacyActiveEvidenceOwnerAssignmentCliError";
    this.code = code;
  }
}

export function readLegacyActiveEvidenceOwnerAssignmentCliOptions(args) {
  if (!Array.isArray(args)) fail("arguments_invalid");
  const flags = new Set();
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (typeof key !== "string") fail("arguments_invalid");
    if (["--write", CONFIRMATION].includes(key)) {
      if (flags.has(key)) fail("arguments_invalid");
      flags.add(key);
      continue;
    }
    if (
      ![
        "--reviewed-manifest-sha256",
        "--reviewed-database-target-fingerprint",
      ].includes(key) ||
      values.has(key)
    ) {
      fail("arguments_invalid");
    }
    const value = args[index + 1];
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.startsWith("--")
    ) {
      fail("arguments_invalid");
    }
    values.set(key, value);
    index += 1;
  }

  const write = flags.has("--write");
  const confirmed = flags.has(CONFIRMATION);
  const reviewedManifestSha256 = values.get("--reviewed-manifest-sha256");
  const reviewedDatabaseTargetFingerprint = values.get(
    "--reviewed-database-target-fingerprint",
  );
  if (!write && (confirmed || values.size > 0)) fail("write_mode_required");
  if (write && !confirmed) fail("write_confirmation_required");
  if (
    write &&
    (!isSha256(reviewedManifestSha256) ||
      !isSha256(reviewedDatabaseTargetFingerprint) ||
      values.size !== 2)
  ) {
    fail("reviewed_evidence_required");
  }
  if (!write && (flags.size !== 0 || args.length !== 0)) {
    fail("arguments_invalid");
  }

  return Object.freeze({
    mode: write ? "write" : "dry_run",
    write,
    reviewedManifestSha256: reviewedManifestSha256 ?? null,
    reviewedDatabaseTargetFingerprint:
      reviewedDatabaseTargetFingerprint ?? null,
  });
}

export async function runLegacyActiveEvidenceOwnerAssignmentCli({
  args = process.argv.slice(2),
  repositoryRoot = REPOSITORY_ROOT,
  loadEnvironment = loadProductionDatabaseEnvironmentFromEnvLocal,
  guardDatabaseTarget = guardProductionDatabaseTarget,
  createPool = createProductionPool,
} = {}) {
  const options = readLegacyActiveEvidenceOwnerAssignmentCliOptions(args);
  let environment;
  try {
    environment = loadEnvironment(repositoryRoot);
  } catch {
    fail("environment_load_failed");
  }

  let databaseTarget;
  try {
    databaseTarget = guardDatabaseTarget(environment);
  } catch {
    fail("production_database_target_guard_failed");
  }
  const databaseTargetFingerprint = requiredString(
    databaseTarget,
    "targetFingerprint",
    "production_database_target_guard_failed",
  );
  if (!isSha256(databaseTargetFingerprint)) {
    fail("production_database_target_guard_failed");
  }
  if (
    options.write &&
    options.reviewedDatabaseTargetFingerprint !== databaseTargetFingerprint
  ) {
    fail("reviewed_database_target_fingerprint_mismatch");
  }

  const connectionString = requiredString(
    environment,
    "DATABASE_URL_UNPOOLED",
    "database_not_configured",
  );
  const pool = createPool(connectionString);
  let result;
  let failure = null;
  let connectionCloseStatus = "not_attempted";
  try {
    result = await executeAssignment({ pool, options });
  } catch (error) {
    failure = mapError(error, "owner_assignment_failed");
  } finally {
    try {
      await pool.end();
      connectionCloseStatus = "closed";
    } catch {
      connectionCloseStatus = "unconfirmed";
    }
  }
  if (failure !== null) throw failure;

  return Object.freeze({
    operation: LEGACY_ACTIVE_EVIDENCE_OWNER_ASSIGNMENT_CLI_POLICY.operation,
    mode: options.mode,
    result: result.result,
    databaseTargetFingerprint,
    ownerFingerprint: result.ownerFingerprint,
    manifestSha256: result.manifestSha256,
    postflightManifestSha256: result.postflightManifestSha256,
    candidateCounts: result.candidateCounts,
    plannedWrites: result.plannedWrites,
    actualWrites: result.actualWrites,
    committed: result.committed,
    connectionCloseStatus,
    retryCount: LEGACY_ACTIVE_EVIDENCE_OWNER_ASSIGNMENT_CLI_POLICY.retryCount,
  });
}

async function executeAssignment({ pool, options }) {
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    throw mapError(error, "database_connect_failed");
  }

  let transactionOpen = false;
  try {
    await client.query("begin isolation level read committed");
    transactionOpen = true;
    await client.query("set local lock_timeout = '2s'");
    await client.query("set local statement_timeout = '8s'");
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [LEGACY_ACTIVE_EVIDENCE_OWNER_ASSIGNMENT_CLI_POLICY.operation],
    );

    const plan = buildLegacyActiveEvidenceOwnerAssignmentPlan(
      await readRows(client, { forUpdate: true }),
    );
    if (
      options.write &&
      plan.manifestSha256 !== options.reviewedManifestSha256
    ) {
      fail("reviewed_manifest_mismatch");
    }

    if (!options.write) {
      await client.query("rollback");
      transactionOpen = false;
      return executionResult({
        plan,
        result: plan.state === "already_applied" ? "already_applied" : "planned",
        committed: false,
      });
    }

    const actualWrites = {};
    for (const key of PLAN_KEYS) {
      actualWrites[key] = await updateOwners({
        client,
        table: LEGACY_ACTIVE_EVIDENCE_TABLES[key],
        ids: plan.eligibleIds[key],
        targetOwnerUserId: plan.targetOwnerUserId,
      });
      if (actualWrites[key] !== plan.plannedWrites[key]) {
        fail("write_count_mismatch");
      }
    }

    const postflightPlan = buildLegacyActiveEvidenceOwnerAssignmentPlan(
      await readRows(client, { forUpdate: false }),
    );
    if (
      postflightPlan.state !== "already_applied" ||
      Object.values(postflightPlan.plannedWrites).some((count) => count !== 0)
    ) {
      fail("postflight_owner_assignment_failed");
    }

    await client.query("commit");
    transactionOpen = false;
    return executionResult({
      plan,
      result: Object.values(actualWrites).some((count) => count > 0)
        ? "assigned"
        : "already_applied",
      actualWrites,
      committed: true,
      postflightManifestSha256: postflightPlan.manifestSha256,
    });
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("rollback");
      } catch {
        // Keep the fail-closed reason from the attempted assignment.
      }
    }
    throw mapError(error, "owner_assignment_failed");
  } finally {
    try {
      client.release();
    } catch {
      // The transaction outcome remains authoritative.
    }
  }
}

async function readRows(client, { forUpdate }) {
  const lockClause = forUpdate ? " for update" : "";
  const legacyClause = " where legacy_base44_id is not null";
  const query = async (text) => (await client.query(text)).rows;
  return {
    appUsers: await query(`select id, status, role from app_users order by id${lockClause}`),
    authIdentities: await query(`select id, app_user_id, status from auth_identities order by id${lockClause}`),
    accounts: await query(`select id, canonical_owner_user_id, code from accounts order by id${lockClause}`),
    assets: await query(`select id, canonical_owner_user_id, account_id from assets order by id${lockClause}`),
    assetGroups: await query(`select id, canonical_owner_user_id from asset_groups order by id${lockClause}`),
    accountBalanceSnapshots: await query(`select id, legacy_base44_id, canonical_owner_user_id from account_balance_snapshots${legacyClause} order by id${lockClause}`),
    dailyPortfolioSnapshots: await query(`select id, legacy_base44_id, canonical_owner_user_id, snapshot_date, account, account_id, source from daily_portfolio_snapshots${legacyClause} order by id${lockClause}`),
    dailyPositionSnapshots: await query(`select id, legacy_base44_id, canonical_owner_user_id, snapshot_date, account, account_id, asset_id, legacy_asset_id, source from daily_position_snapshots${legacyClause} order by id${lockClause}`),
    eventLedgerEntries: await query(`select id, legacy_base44_id, canonical_owner_user_id, account, account_id, asset_id, legacy_asset_id, group_id, corrects_event_id from event_ledger_entries${legacyClause} order by id${lockClause}`),
    marketRegimeDaily: await query(`select id, legacy_base44_id, canonical_owner_user_id, date, account, account_id from market_regime_daily${legacyClause} order by id${lockClause}`),
    settings: await query(`select id, legacy_base44_id, canonical_owner_user_id from settings${legacyClause} order by id${lockClause}`),
  };
}

async function updateOwners({ client, table, ids, targetOwnerUserId }) {
  if (ids.length === 0) return 0;
  if (!ALLOWED_TABLES.has(table)) fail("owner_assignment_table_invalid");
  const result = await client.query(
    `
      update ${table}
      set canonical_owner_user_id = $1::uuid,
          updated_at = clock_timestamp()
      where id = any($2::uuid[])
        and legacy_base44_id is not null
        and canonical_owner_user_id is null
      returning id
    `,
    [targetOwnerUserId, ids],
  );
  const returnedIds = result.rows
    .map((row) => requiredString(row, "id", "write_result_invalid"))
    .sort(compareAscii);
  if (
    returnedIds.length !== ids.length ||
    returnedIds.some((id, index) => id !== ids[index])
  ) {
    fail("write_result_invalid");
  }
  return returnedIds.length;
}

function executionResult({
  plan,
  result,
  actualWrites = zeroCounts(),
  committed,
  postflightManifestSha256 = null,
}) {
  return Object.freeze({
    result,
    ownerFingerprint: plan.ownerFingerprint,
    manifestSha256: plan.manifestSha256,
    postflightManifestSha256,
    candidateCounts: plan.candidateCounts,
    plannedWrites: plan.plannedWrites,
    actualWrites: Object.freeze(actualWrites),
    committed,
  });
}

function zeroCounts() {
  return Object.fromEntries(PLAN_KEYS.map((key) => [key, 0]));
}

function createProductionPool(connectionString) {
  return new Pool({ connectionString, max: 1 });
}

function isSha256(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function requiredString(value, key, code) {
  const result = readOwn(value, key);
  if (typeof result !== "string") fail(code);
  return result;
}

function readOwn(value, key) {
  if (value === null || typeof value !== "object") return undefined;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function compareAscii(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function mapError(error, fallback) {
  if (
    error instanceof LegacyActiveEvidenceOwnerAssignmentCliError ||
    error instanceof LegacyActiveEvidenceOwnerAssignmentError
  ) {
    return error;
  }
  const code = readOwn(error, "code");
  return new LegacyActiveEvidenceOwnerAssignmentCliError(
    typeof code === "string" && SAFE_ERROR_CODE_PATTERN.test(code)
      ? code
      : fallback,
  );
}

function fail(code) {
  throw new LegacyActiveEvidenceOwnerAssignmentCliError(code);
}

function blockedOutput(error) {
  const code = readOwn(error, "code");
  return Object.freeze({
    operation: LEGACY_ACTIVE_EVIDENCE_OWNER_ASSIGNMENT_CLI_POLICY.operation,
    mode: "blocked",
    result: "blocked",
    code:
      typeof code === "string" && SAFE_ERROR_CODE_PATTERN.test(code)
        ? code
        : "owner_assignment_cli_failed",
    committed: false,
    retryCount: LEGACY_ACTIVE_EVIDENCE_OWNER_ASSIGNMENT_CLI_POLICY.retryCount,
  });
}

function isDirectExecution() {
  return (
    typeof process.argv[1] === "string" && resolve(process.argv[1]) === SCRIPT_PATH
  );
}

if (isDirectExecution()) {
  const output = await runLegacyActiveEvidenceOwnerAssignmentCli().catch(
    blockedOutput,
  );
  console.log(JSON.stringify(output, null, 2));
  if (output.result === "blocked" || output.connectionCloseStatus !== "closed") {
    process.exitCode = 1;
  }
}
