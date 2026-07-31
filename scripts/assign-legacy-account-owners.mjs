import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "@neondatabase/serverless";

import {
  guardProductionDatabaseTarget,
} from "../src/lib/deployment/production-database-target.ts";
import {
  isSha256Fingerprint,
} from "./lib/legacy-account-ownership-evidence.mjs";
import {
  assignLegacyAccountsToConsumedIdentity,
  planLegacyAccountOwnerAssignment,
} from "./lib/legacy-account-owner-assignment-writer.mjs";
import {
  loadProductionDatabaseEnvironmentFromEnvLocal,
} from "./lib/production-database-environment.mjs";

const CLAIM_DIGEST_PATTERN =
  /^bootstrap-claim-sha256-v1:[0-9a-f]{64}$/;
const SAFE_ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,79}$/;
const CONFIRMATION =
  "--confirm-post-consume-legacy-account-owner-assignment-v1";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), "..");

export const LEGACY_ACCOUNT_OWNER_ASSIGNMENT_CLI_POLICY =
  Object.freeze({
    operation: "legacy_account_owner_assignment_migration_cli_v1",
    confirmation: CONFIRMATION,
    defaultMode: "dry_run",
    expectedAccountCount: 4,
    retryCount: 0,
  });

export class LegacyAccountOwnerAssignmentCliError extends Error {
  constructor(code) {
    super("Legacy account owner assignment CLI failed");
    this.name = "LegacyAccountOwnerAssignmentCliError";
    this.code = code;
  }
}

export async function runLegacyAccountOwnerAssignmentCli({
  args = process.argv.slice(2),
  repositoryRoot = REPOSITORY_ROOT,
  loadEnvironment =
    loadProductionDatabaseEnvironmentFromEnvLocal,
  guardDatabaseTarget = guardProductionDatabaseTarget,
  createPool = createProductionPool,
  planAssignment = planLegacyAccountOwnerAssignment,
  writeAssignment = assignLegacyAccountsToConsumedIdentity,
} = {}) {
  const options = readLegacyAccountOwnerAssignmentCliOptions(args);

  let environment;
  try {
    environment = loadEnvironment(repositoryRoot);
  } catch {
    throw new LegacyAccountOwnerAssignmentCliError(
      "environment_load_failed",
    );
  }

  let databaseTarget;
  try {
    databaseTarget = guardDatabaseTarget(environment);
  } catch {
    throw new LegacyAccountOwnerAssignmentCliError(
      "production_database_target_guard_failed",
    );
  }
  const databaseTargetFingerprint = readRequiredOwnString(
    databaseTarget,
    "targetFingerprint",
    "production_database_target_guard_failed",
  );
  if (!isSha256Fingerprint(databaseTargetFingerprint)) {
    throw new LegacyAccountOwnerAssignmentCliError(
      "production_database_target_guard_failed",
    );
  }
  if (
    options.write &&
    options.reviewedDatabaseTargetFingerprint !==
      databaseTargetFingerprint
  ) {
    throw new LegacyAccountOwnerAssignmentCliError(
      "reviewed_database_target_fingerprint_mismatch",
    );
  }

  const connectionString = readRequiredOwnString(
    environment,
    "DATABASE_URL_UNPOOLED",
    "database_not_configured",
  );
  let pool;
  let assignmentResult;
  let assignmentError = null;
  let connectionCloseStatus = "not_attempted";
  try {
    pool = createPool(connectionString);
    const assignment = options.write
      ? writeAssignment
      : planAssignment;
    assignmentResult = await assignment({
      pool,
      claimDigest: options.claimDigest,
      targetAppUserSha256: options.targetAppUserSha256,
      legacyOwnerSha256: options.legacyOwnerSha256,
      candidateSetDigest: options.candidateSetDigest,
      eligibleSetDigest: options.eligibleSetDigest,
    });
  } catch (error) {
    assignmentError = mapCliError(
      error,
      "owner_assignment_failed",
    );
  } finally {
    if (pool !== undefined) {
      try {
        await closeProductionPool(pool);
        connectionCloseStatus = "closed";
      } catch {
        connectionCloseStatus = "unconfirmed";
      }
    }
  }
  if (assignmentError !== null) throw assignmentError;

  return projectAssignmentReceipt({
    assignmentResult,
    databaseTargetFingerprint,
    options,
    connectionCloseStatus,
  });
}

export function readLegacyAccountOwnerAssignmentCliOptions(args) {
  if (!Array.isArray(args)) {
    throw new LegacyAccountOwnerAssignmentCliError(
      "arguments_invalid",
    );
  }

  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (typeof key !== "string") {
      throw new LegacyAccountOwnerAssignmentCliError(
        "arguments_invalid",
      );
    }
    if (["--write", CONFIRMATION].includes(key)) {
      if (flags.has(key)) {
        throw new LegacyAccountOwnerAssignmentCliError(
          "arguments_invalid",
        );
      }
      flags.add(key);
      continue;
    }
    if (
      ![
        "--claim-digest",
        "--target-app-user-sha256",
        "--legacy-owner-sha256",
        "--candidate-set-digest",
        "--eligible-set-digest",
        "--reviewed-database-target-fingerprint",
      ].includes(key) ||
      values.has(key)
    ) {
      throw new LegacyAccountOwnerAssignmentCliError(
        "arguments_invalid",
      );
    }
    const value = args[index + 1];
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.startsWith("--")
    ) {
      throw new LegacyAccountOwnerAssignmentCliError(
        "arguments_invalid",
      );
    }
    values.set(key, value);
    index += 1;
  }

  const claimDigest = values.get("--claim-digest");
  const targetAppUserSha256 = values.get(
    "--target-app-user-sha256",
  );
  const legacyOwnerSha256 = values.get("--legacy-owner-sha256");
  const candidateSetDigest = values.get("--candidate-set-digest");
  const eligibleSetDigest = values.get("--eligible-set-digest");
  const reviewedDatabaseTargetFingerprint = values.get(
    "--reviewed-database-target-fingerprint",
  );
  if (
    typeof claimDigest !== "string" ||
    !CLAIM_DIGEST_PATTERN.test(claimDigest) ||
    !isSha256Fingerprint(targetAppUserSha256) ||
    !isSha256Fingerprint(legacyOwnerSha256) ||
    !isSha256Fingerprint(candidateSetDigest) ||
    !isSha256Fingerprint(eligibleSetDigest)
  ) {
    throw new LegacyAccountOwnerAssignmentCliError(
      "reviewed_evidence_invalid",
    );
  }

  const write = flags.has("--write");
  const confirmed = flags.has(CONFIRMATION);
  if (write && !confirmed) {
    throw new LegacyAccountOwnerAssignmentCliError(
      "write_confirmation_required",
    );
  }
  if (!write && confirmed) {
    throw new LegacyAccountOwnerAssignmentCliError(
      "write_mode_required",
    );
  }
  if (
    write &&
    !isSha256Fingerprint(reviewedDatabaseTargetFingerprint)
  ) {
    throw new LegacyAccountOwnerAssignmentCliError(
      "reviewed_database_target_fingerprint_required",
    );
  }
  if (!write && reviewedDatabaseTargetFingerprint !== undefined) {
    throw new LegacyAccountOwnerAssignmentCliError(
      "reviewed_database_target_fingerprint_requires_write",
    );
  }
  if (values.size !== (write ? 6 : 5)) {
    throw new LegacyAccountOwnerAssignmentCliError(
      "reviewed_evidence_invalid",
    );
  }

  return Object.freeze({
    mode: write ? "write" : "dry_run",
    write,
    claimDigest,
    targetAppUserSha256,
    legacyOwnerSha256,
    candidateSetDigest,
    eligibleSetDigest,
    reviewedDatabaseTargetFingerprint:
      reviewedDatabaseTargetFingerprint ?? null,
  });
}

function projectAssignmentReceipt({
  assignmentResult,
  databaseTargetFingerprint,
  options,
  connectionCloseStatus,
}) {
  const result = readRequiredOwnString(
    assignmentResult,
    "result",
    "owner_assignment_result_invalid",
  );
  if (!["planned", "assigned", "already_applied"].includes(result)) {
    throw new LegacyAccountOwnerAssignmentCliError(
      "owner_assignment_result_invalid",
    );
  }
  const mode = readRequiredOwnString(
    assignmentResult,
    "mode",
    "owner_assignment_result_invalid",
  );
  const committed = readRequiredOwnBoolean(
    assignmentResult,
    "committed",
    "owner_assignment_result_invalid",
  );
  if (
    mode !== options.mode ||
    (options.write && !committed) ||
    (!options.write && committed)
  ) {
    throw new LegacyAccountOwnerAssignmentCliError(
      "owner_assignment_result_invalid",
    );
  }

  const evidence = readRequiredOwnObject(
    assignmentResult,
    "evidence",
    "owner_assignment_result_invalid",
  );
  const plannedWrites = readRequiredOwnObject(
    assignmentResult,
    "plannedWrites",
    "owner_assignment_result_invalid",
  );
  const actualWrites = readRequiredOwnObject(
    assignmentResult,
    "actualWrites",
    "owner_assignment_result_invalid",
  );
  const projectedCandidateSetDigest = readRequiredOwnString(
    evidence,
    "candidateSetDigest",
    "owner_assignment_result_invalid",
  );
  const projectedEligibleSetDigest = readRequiredOwnString(
    evidence,
    "eligibleSetDigest",
    "owner_assignment_result_invalid",
  );
  const plannedAccounts = readRequiredOwnInteger(
    plannedWrites,
    "accounts",
    "owner_assignment_result_invalid",
  );
  const actualAccounts = readRequiredOwnInteger(
    actualWrites,
    "accounts",
    "owner_assignment_result_invalid",
  );
  if (
    projectedCandidateSetDigest !== options.candidateSetDigest ||
    projectedEligibleSetDigest !== options.eligibleSetDigest ||
    ![0, LEGACY_ACCOUNT_OWNER_ASSIGNMENT_CLI_POLICY.expectedAccountCount]
      .includes(plannedAccounts) ||
    ![0, LEGACY_ACCOUNT_OWNER_ASSIGNMENT_CLI_POLICY.expectedAccountCount]
      .includes(actualAccounts)
  ) {
    throw new LegacyAccountOwnerAssignmentCliError(
      "owner_assignment_result_invalid",
    );
  }

  return Object.freeze({
    operation:
      LEGACY_ACCOUNT_OWNER_ASSIGNMENT_CLI_POLICY.operation,
    mode: options.mode,
    result,
    databaseTargetFingerprint,
    evidence: Object.freeze({
      targetAppUserSha256: options.targetAppUserSha256,
      legacyOwnerSha256: options.legacyOwnerSha256,
      candidateSetDigest: options.candidateSetDigest,
      eligibleSetDigest: options.eligibleSetDigest,
    }),
    accountCounts: Object.freeze({
      expected:
        LEGACY_ACCOUNT_OWNER_ASSIGNMENT_CLI_POLICY.expectedAccountCount,
      planned: plannedAccounts,
      written: actualAccounts,
    }),
    committed,
    connectionCloseStatus,
    retryCount:
      LEGACY_ACCOUNT_OWNER_ASSIGNMENT_CLI_POLICY.retryCount,
  });
}

function createProductionPool(connectionString) {
  return new Pool({
    connectionString,
    max: 1,
  });
}

async function closeProductionPool(pool) {
  let current = pool;
  while (current !== null && current !== Object.prototype) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(current, "end");
    } catch {
      throw new LegacyAccountOwnerAssignmentCliError(
        "database_pool_close_failed",
      );
    }
    if (descriptor) {
      if (
        !("value" in descriptor) ||
        typeof descriptor.value !== "function"
      ) {
        throw new LegacyAccountOwnerAssignmentCliError(
          "database_pool_close_failed",
        );
      }
      await Reflect.apply(descriptor.value, pool, []);
      return;
    }
    current = Object.getPrototypeOf(current);
  }
  throw new LegacyAccountOwnerAssignmentCliError(
    "database_pool_close_failed",
  );
}

function readRequiredOwnObject(value, key, code) {
  const result = readOwnDataValue(value, key);
  if (result === null || typeof result !== "object") {
    throw new LegacyAccountOwnerAssignmentCliError(code);
  }
  return result;
}

function readRequiredOwnString(value, key, code) {
  const result = readOwnDataValue(value, key);
  if (typeof result !== "string") {
    throw new LegacyAccountOwnerAssignmentCliError(code);
  }
  return result;
}

function readRequiredOwnBoolean(value, key, code) {
  const result = readOwnDataValue(value, key);
  if (typeof result !== "boolean") {
    throw new LegacyAccountOwnerAssignmentCliError(code);
  }
  return result;
}

function readRequiredOwnInteger(value, key, code) {
  const result = readOwnDataValue(value, key);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new LegacyAccountOwnerAssignmentCliError(code);
  }
  return result;
}

function readOwnDataValue(value, key) {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return undefined;
  }
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
  return descriptor && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function mapCliError(error, fallback) {
  if (error instanceof LegacyAccountOwnerAssignmentCliError) {
    return error;
  }
  const code = readOwnDataValue(error, "code");
  return new LegacyAccountOwnerAssignmentCliError(
    typeof code === "string" && SAFE_ERROR_CODE_PATTERN.test(code)
      ? code
      : fallback,
  );
}

function blockedOutput(error) {
  const code = readOwnDataValue(error, "code");
  return Object.freeze({
    operation:
      LEGACY_ACCOUNT_OWNER_ASSIGNMENT_CLI_POLICY.operation,
    mode: "blocked",
    result: "blocked",
    code:
      typeof code === "string" && SAFE_ERROR_CODE_PATTERN.test(code)
        ? code
        : "owner_assignment_cli_failed",
    committed: false,
    connectionCloseStatus: "not_attempted",
    retryCount:
      LEGACY_ACCOUNT_OWNER_ASSIGNMENT_CLI_POLICY.retryCount,
  });
}

function isDirectExecution() {
  return (
    typeof process.argv[1] === "string" &&
    resolve(process.argv[1]) === SCRIPT_PATH
  );
}

if (isDirectExecution()) {
  const output = await runLegacyAccountOwnerAssignmentCli().catch(
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
