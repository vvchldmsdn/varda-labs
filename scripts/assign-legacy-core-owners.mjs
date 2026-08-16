import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "@neondatabase/serverless";

import { guardProductionDatabaseTarget } from "../src/lib/deployment/production-database-target.ts";
import {
  buildLegacyCoreOwnerAssignmentPlan,
  LEGACY_CORE_OWNER_ASSIGNMENT_POLICY,
  LegacyCoreOwnerAssignmentError,
} from "./lib/legacy-core-owner-assignment.mjs";
import { loadProductionDatabaseEnvironmentFromEnvLocal } from "./lib/production-database-environment.mjs";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SAFE_ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,79}$/;
const CONFIRMATION = "--confirm-initial-core-owner-assignment-v1";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), "..");

export const LEGACY_CORE_OWNER_ASSIGNMENT_CLI_POLICY = Object.freeze({
  ...LEGACY_CORE_OWNER_ASSIGNMENT_POLICY,
  confirmation: CONFIRMATION,
  defaultMode: "dry_run",
});

export class LegacyCoreOwnerAssignmentCliError extends Error {
  constructor(code) {
    super("Legacy core owner assignment CLI failed");
    this.name = "LegacyCoreOwnerAssignmentCliError";
    this.code = code;
  }
}

export function readLegacyCoreOwnerAssignmentCliOptions(args) {
  if (!Array.isArray(args)) {
    throw new LegacyCoreOwnerAssignmentCliError("arguments_invalid");
  }

  const flags = new Set();
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (typeof key !== "string") {
      throw new LegacyCoreOwnerAssignmentCliError("arguments_invalid");
    }
    if (["--write", CONFIRMATION].includes(key)) {
      if (flags.has(key)) {
        throw new LegacyCoreOwnerAssignmentCliError("arguments_invalid");
      }
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
      throw new LegacyCoreOwnerAssignmentCliError("arguments_invalid");
    }
    const value = args[index + 1];
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.startsWith("--")
    ) {
      throw new LegacyCoreOwnerAssignmentCliError("arguments_invalid");
    }
    values.set(key, value);
    index += 1;
  }

  const write = flags.has("--write");
  const confirmed = flags.has(CONFIRMATION);
  const reviewedManifestSha256 = values.get(
    "--reviewed-manifest-sha256",
  );
  const reviewedDatabaseTargetFingerprint = values.get(
    "--reviewed-database-target-fingerprint",
  );
  if (!write && (confirmed || values.size > 0)) {
    throw new LegacyCoreOwnerAssignmentCliError(
      "write_mode_required",
    );
  }
  if (write && !confirmed) {
    throw new LegacyCoreOwnerAssignmentCliError(
      "write_confirmation_required",
    );
  }
  if (
    write &&
    (!isSha256(reviewedManifestSha256) ||
      !isSha256(reviewedDatabaseTargetFingerprint) ||
      values.size !== 2)
  ) {
    throw new LegacyCoreOwnerAssignmentCliError(
      "reviewed_evidence_required",
    );
  }
  if (!write && (flags.size !== 0 || args.length !== 0)) {
    throw new LegacyCoreOwnerAssignmentCliError("arguments_invalid");
  }

  return Object.freeze({
    mode: write ? "write" : "dry_run",
    write,
    reviewedManifestSha256: reviewedManifestSha256 ?? null,
    reviewedDatabaseTargetFingerprint:
      reviewedDatabaseTargetFingerprint ?? null,
  });
}

export async function runLegacyCoreOwnerAssignmentCli({
  args = process.argv.slice(2),
  repositoryRoot = REPOSITORY_ROOT,
  loadEnvironment = loadProductionDatabaseEnvironmentFromEnvLocal,
  guardDatabaseTarget = guardProductionDatabaseTarget,
  createPool = createProductionPool,
} = {}) {
  const options = readLegacyCoreOwnerAssignmentCliOptions(args);
  let environment;
  try {
    environment = loadEnvironment(repositoryRoot);
  } catch {
    throw new LegacyCoreOwnerAssignmentCliError(
      "environment_load_failed",
    );
  }

  let databaseTarget;
  try {
    databaseTarget = guardDatabaseTarget(environment);
  } catch {
    throw new LegacyCoreOwnerAssignmentCliError(
      "production_database_target_guard_failed",
    );
  }
  const databaseTargetFingerprint = readRequiredOwnString(
    databaseTarget,
    "targetFingerprint",
    "production_database_target_guard_failed",
  );
  if (!isSha256(databaseTargetFingerprint)) {
    throw new LegacyCoreOwnerAssignmentCliError(
      "production_database_target_guard_failed",
    );
  }
  if (
    options.write &&
    options.reviewedDatabaseTargetFingerprint !==
      databaseTargetFingerprint
  ) {
    throw new LegacyCoreOwnerAssignmentCliError(
      "reviewed_database_target_fingerprint_mismatch",
    );
  }

  const connectionString = readRequiredOwnString(
    environment,
    "DATABASE_URL_UNPOOLED",
    "database_not_configured",
  );
  const pool = createPool(connectionString);
  let result;
  let failure = null;
  let connectionCloseStatus = "not_attempted";
  try {
    result = await executeLegacyCoreOwnerAssignment({
      pool,
      options,
    });
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
    operation: LEGACY_CORE_OWNER_ASSIGNMENT_CLI_POLICY.operation,
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
    retryCount: LEGACY_CORE_OWNER_ASSIGNMENT_CLI_POLICY.retryCount,
  });
}

async function executeLegacyCoreOwnerAssignment({ pool, options }) {
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
      [LEGACY_CORE_OWNER_ASSIGNMENT_CLI_POLICY.operation],
    );

    const lockedRows = await readCoreRows(client, { forUpdate: true });
    const plan = buildLegacyCoreOwnerAssignmentPlan(lockedRows);
    if (
      options.write &&
      plan.manifestSha256 !== options.reviewedManifestSha256
    ) {
      throw new LegacyCoreOwnerAssignmentCliError(
        "reviewed_manifest_mismatch",
      );
    }

    if (!options.write) {
      await client.query("rollback");
      transactionOpen = false;
      return buildExecutionResult({
        plan,
        result:
          plan.state === "already_applied"
            ? "already_applied"
            : "planned",
        committed: false,
      });
    }

    const actualWrites = {
      assets: await updateOwners(
        client,
        "assets",
        plan.eligibleIds.assets,
        plan.targetOwnerUserId,
      ),
      assetGroups: await updateOwners(
        client,
        "asset_groups",
        plan.eligibleIds.assetGroups,
        plan.targetOwnerUserId,
      ),
      assetGroupMembers: await updateOwners(
        client,
        "asset_group_members",
        plan.eligibleIds.assetGroupMembers,
        plan.targetOwnerUserId,
      ),
    };
    assertWriteCounts(actualWrites, plan.plannedWrites);

    const postflightRows = await readCoreRows(client, {
      forUpdate: false,
    });
    const postflightPlan = buildLegacyCoreOwnerAssignmentPlan(
      postflightRows,
    );
    if (
      postflightPlan.state !== "already_applied" ||
      Object.values(postflightPlan.plannedWrites).some(
        (count) => count !== 0,
      )
    ) {
      throw new LegacyCoreOwnerAssignmentCliError(
        "postflight_owner_assignment_failed",
      );
    }

    await client.query("commit");
    transactionOpen = false;
    return buildExecutionResult({
      plan,
      result:
        Object.values(actualWrites).some((count) => count > 0)
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
        // Preserve the fail-closed reason from the attempted assignment.
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

async function readCoreRows(client, { forUpdate }) {
  const lockClause = forUpdate ? " for update" : "";
  // These reads share one transaction and acquire row locks in a fixed order.
  const appUsers = await client.query(
    `select id, status, role from app_users order by id${lockClause}`,
  );
  const authIdentities = await client.query(
    `select id, app_user_id, status from auth_identities order by id${lockClause}`,
  );
  const accounts = await client.query(
    `select id, canonical_owner_user_id, code from accounts order by id${lockClause}`,
  );
  const assets = await client.query(
    `select id, canonical_owner_user_id, account_id, account, market, currency, ticker from assets order by id${lockClause}`,
  );
  const assetGroups = await client.query(
    `select id, canonical_owner_user_id from asset_groups order by id${lockClause}`,
  );
  const members = await client.query(
    `select id, canonical_owner_user_id, group_id, asset_id from asset_group_members order by id${lockClause}`,
  );
  return {
    appUsers: appUsers.rows,
    authIdentities: authIdentities.rows,
    accounts: accounts.rows,
    assets: assets.rows,
    assetGroups: assetGroups.rows,
    assetGroupMembers: members.rows,
  };
}

async function updateOwners(client, tableName, ids, targetOwnerUserId) {
  if (ids.length === 0) return 0;
  const allowedTableNames = new Set([
    "assets",
    "asset_groups",
    "asset_group_members",
  ]);
  if (!allowedTableNames.has(tableName)) {
    throw new LegacyCoreOwnerAssignmentCliError(
      "owner_assignment_table_invalid",
    );
  }
  const result = await client.query(
    `
      update ${tableName}
      set canonical_owner_user_id = $1::uuid,
          updated_at = clock_timestamp()
      where id = any($2::uuid[])
        and canonical_owner_user_id is null
      returning id
    `,
    [targetOwnerUserId, ids],
  );
  const returnedIds = result.rows
    .map((row) => readRequiredOwnString(row, "id", "write_result_invalid"))
    .sort(compareAscii);
  if (
    returnedIds.length !== ids.length ||
    returnedIds.some((id, index) => id !== ids[index])
  ) {
    throw new LegacyCoreOwnerAssignmentCliError(
      "write_result_invalid",
    );
  }
  return returnedIds.length;
}

function assertWriteCounts(actualWrites, plannedWrites) {
  for (const key of ["assets", "assetGroups", "assetGroupMembers"]) {
    if (actualWrites[key] !== plannedWrites[key]) {
      throw new LegacyCoreOwnerAssignmentCliError(
        "write_count_mismatch",
      );
    }
  }
}

function buildExecutionResult({
  plan,
  result,
  actualWrites = {
    assets: 0,
    assetGroups: 0,
    assetGroupMembers: 0,
  },
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

function createProductionPool(connectionString) {
  return new Pool({ connectionString, max: 1 });
}

function isSha256(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function readRequiredOwnString(value, key, code) {
  const result = readOwn(value, key);
  if (typeof result !== "string") {
    throw new LegacyCoreOwnerAssignmentCliError(code);
  }
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
    error instanceof LegacyCoreOwnerAssignmentCliError ||
    error instanceof LegacyCoreOwnerAssignmentError
  ) {
    return error;
  }
  const code = readOwn(error, "code");
  return new LegacyCoreOwnerAssignmentCliError(
    typeof code === "string" && SAFE_ERROR_CODE_PATTERN.test(code)
      ? code
      : fallback,
  );
}

function blockedOutput(error) {
  const code = readOwn(error, "code");
  return Object.freeze({
    operation: LEGACY_CORE_OWNER_ASSIGNMENT_CLI_POLICY.operation,
    mode: "blocked",
    result: "blocked",
    code:
      typeof code === "string" && SAFE_ERROR_CODE_PATTERN.test(code)
        ? code
        : "owner_assignment_cli_failed",
    committed: false,
    retryCount: LEGACY_CORE_OWNER_ASSIGNMENT_CLI_POLICY.retryCount,
  });
}

function isDirectExecution() {
  return (
    typeof process.argv[1] === "string" &&
    resolve(process.argv[1]) === SCRIPT_PATH
  );
}

if (isDirectExecution()) {
  const output = await runLegacyCoreOwnerAssignmentCli().catch(
    blockedOutput,
  );
  console.log(JSON.stringify(output, null, 2));
  if (
    output.result === "blocked" ||
    output.connectionCloseStatus !== "closed"
  ) {
    process.exitCode = 1;
  }
}
