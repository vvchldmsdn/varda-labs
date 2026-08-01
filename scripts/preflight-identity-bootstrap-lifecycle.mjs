import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { neon } from "@neondatabase/serverless";

import {
  guardProductionDatabaseTarget,
} from "../src/lib/deployment/production-database-target.ts";
import {
  buildIdentityBootstrapLifecyclePreflight,
  IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_POLICY,
  IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_SQL,
  IdentityBootstrapLifecyclePreflightError,
  parseIdentityBootstrapLifecyclePreflightArgs,
} from "./lib/identity-bootstrap-lifecycle-preflight.mjs";
import {
  isSha256Fingerprint,
} from "./lib/legacy-account-ownership-evidence.mjs";
import {
  loadProductionDatabaseEnvironmentFromEnvLocal,
} from "./lib/production-database-environment.mjs";

const SAFE_ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,79}$/;
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), "..");

export async function runIdentityBootstrapLifecyclePreflight({
  args = process.argv.slice(2),
  repositoryRoot = REPOSITORY_ROOT,
  loadEnvironment =
    loadProductionDatabaseEnvironmentFromEnvLocal,
  guardDatabaseTarget = guardProductionDatabaseTarget,
  createSql = createProductionSql,
  readSnapshot = readIdentityBootstrapLifecycleSnapshot,
} = {}) {
  const options = parseIdentityBootstrapLifecyclePreflightArgs(args);

  let environment;
  try {
    environment = loadEnvironment(repositoryRoot);
  } catch {
    throw new IdentityBootstrapLifecyclePreflightError(
      "environment_load_failed",
    );
  }

  let databaseTarget;
  try {
    databaseTarget = guardDatabaseTarget(environment);
  } catch {
    throw new IdentityBootstrapLifecyclePreflightError(
      "production_database_target_guard_failed",
    );
  }
  const databaseTargetFingerprint = readRequiredOwnString(
    databaseTarget,
    "targetFingerprint",
    "production_database_target_guard_failed",
  );
  if (!isSha256Fingerprint(databaseTargetFingerprint)) {
    throw new IdentityBootstrapLifecyclePreflightError(
      "production_database_target_guard_failed",
    );
  }
  if (
    databaseTargetFingerprint !==
    options.reviewedDatabaseTargetFingerprint
  ) {
    throw new IdentityBootstrapLifecyclePreflightError(
      "reviewed_database_target_fingerprint_mismatch",
    );
  }

  const connectionString = readRequiredOwnString(
    environment,
    "DATABASE_URL_UNPOOLED",
    "database_not_configured",
  );
  try {
    const sql = createSql(connectionString);
    const rows = await readSnapshot({ sql, options });
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw new IdentityBootstrapLifecyclePreflightError(
        "database_snapshot_cardinality_invalid",
      );
    }
    return buildIdentityBootstrapLifecyclePreflight({
      row: rows[0],
      options,
      databaseTargetFingerprint,
    });
  } catch (error) {
    throw mapPreflightError(error, "database_preflight_failed");
  }
}

export async function readIdentityBootstrapLifecycleSnapshot({
  sql,
  options,
}) {
  const transaction = readOwnDataValue(sql, "transaction");
  if (typeof sql !== "function" || typeof transaction !== "function") {
    throw new IdentityBootstrapLifecyclePreflightError(
      "database_port_invalid",
    );
  }

  try {
    const results = await Reflect.apply(transaction, sql, [
      (transactionSql) => {
        const query = readOwnDataValue(transactionSql, "query");
        if (typeof query !== "function") {
          throw new IdentityBootstrapLifecyclePreflightError(
            "database_port_invalid",
          );
        }
        return [
          Reflect.apply(query, transactionSql, [
            "set local statement_timeout = '8s'",
          ]),
          Reflect.apply(query, transactionSql, [
            IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_SQL,
            [
              options.claimDigestVersion,
              options.claimDigest,
              options.targetAppUserId,
              IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_POLICY.provider,
            ],
          ]),
        ];
      },
      {
        isolationLevel: "RepeatableRead",
        readOnly: true,
      },
    ]);
    if (
      !Array.isArray(results) ||
      results.length !== 2 ||
      !Array.isArray(results[1])
    ) {
      throw new IdentityBootstrapLifecyclePreflightError(
        "database_snapshot_invalid",
      );
    }
    return results[1];
  } catch {
    throw new IdentityBootstrapLifecyclePreflightError(
      "database_read_transaction_failed",
    );
  }
}

function createProductionSql(connectionString) {
  return neon(connectionString);
}

function readRequiredOwnString(value, key, code) {
  const result = readOwnDataValue(value, key);
  if (typeof result !== "string") {
    throw new IdentityBootstrapLifecyclePreflightError(code);
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

function mapPreflightError(error, fallback) {
  if (error instanceof IdentityBootstrapLifecyclePreflightError) {
    return error;
  }
  const code = readOwnDataValue(error, "code");
  return new IdentityBootstrapLifecyclePreflightError(
    typeof code === "string" && SAFE_ERROR_CODE_PATTERN.test(code)
      ? code
      : fallback,
  );
}

function blockedOutput(error) {
  const code = readOwnDataValue(error, "code");
  return Object.freeze({
    operation:
      IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_POLICY.operation,
    mode: "production_select_only",
    result: "blocked",
    readOnly: true,
    databaseSideEffects: false,
    blockers: Object.freeze([
      typeof code === "string" && SAFE_ERROR_CODE_PATTERN.test(code)
        ? code
        : "identity_bootstrap_lifecycle_preflight_failed",
    ]),
    transaction: Object.freeze({
      isolation:
        IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_POLICY.transactionIsolation,
      accessMode:
        IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_POLICY.accessMode,
      statementTimeoutMs:
        IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_POLICY.statementTimeoutMs,
      retryCount:
        IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_POLICY.retryCount,
    }),
    plannedWrites: Object.freeze({
      identityPairingIntents: 0,
      identityPairingIntentEvents: 0,
      authIdentities: 0,
      appUsers: 0,
      accounts: 0,
      productTables: 0,
    }),
  });
}

function isDirectExecution() {
  return (
    typeof process.argv[1] === "string" &&
    resolve(process.argv[1]) === SCRIPT_PATH
  );
}

if (isDirectExecution()) {
  const output = await runIdentityBootstrapLifecyclePreflight().catch(
    blockedOutput,
  );
  console.log(JSON.stringify(output, null, 2));
  if (output.result !== "ready_for_new_issue") {
    process.exitCode = 1;
  }
}
