import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "@neondatabase/serverless";

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
  createPool = createProductionPool,
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
  let pool;
  let output;
  let closeStatus = "not_attempted";
  try {
    pool = createPool(connectionString);
    const rows = await readSnapshot({ pool, options });
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw new IdentityBootstrapLifecyclePreflightError(
        "database_snapshot_cardinality_invalid",
      );
    }
    output = buildIdentityBootstrapLifecyclePreflight({
      row: rows[0],
      options,
      databaseTargetFingerprint,
    });
  } catch (error) {
    throw mapPreflightError(error, "database_preflight_failed");
  } finally {
    if (pool !== undefined) {
      try {
        await closeProductionPool(pool);
        closeStatus = "closed";
      } catch {
        closeStatus = "unconfirmed";
      }
    }
  }

  if (closeStatus !== "closed") {
    throw new IdentityBootstrapLifecyclePreflightError(
      "database_pool_close_unconfirmed",
    );
  }
  return Object.freeze({
    ...output,
    connectionCloseStatus: closeStatus,
  });
}

export async function readIdentityBootstrapLifecycleSnapshot({
  pool,
  options,
}) {
  if (!pool || typeof pool.connect !== "function") {
    throw new IdentityBootstrapLifecyclePreflightError(
      "database_port_invalid",
    );
  }

  let client;
  try {
    client = await pool.connect();
  } catch {
    throw new IdentityBootstrapLifecyclePreflightError(
      "database_connection_failed",
    );
  }

  let transactionOpen = false;
  try {
    await client.query(
      "begin isolation level repeatable read read only",
    );
    transactionOpen = true;
    await client.query("set local statement_timeout = '8s'");
    const result = await client.query(
      IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_SQL,
      [
        options.claimDigestVersion,
        options.claimDigest,
        options.targetAppUserId,
        IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_POLICY.provider,
      ],
    );
    await client.query("commit");
    transactionOpen = false;
    return result.rows;
  } catch {
    if (transactionOpen) {
      try {
        await client.query("rollback");
      } catch {
        // Preserve the original fail-closed result.
      }
    }
    throw new IdentityBootstrapLifecyclePreflightError(
      "database_read_transaction_failed",
    );
  } finally {
    try {
      client.release();
    } catch {
      // Pool close remains the outer lifecycle boundary.
    }
  }
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
      throw new IdentityBootstrapLifecyclePreflightError(
        "database_pool_close_failed",
      );
    }
    if (descriptor) {
      if (
        !("value" in descriptor) ||
        typeof descriptor.value !== "function"
      ) {
        throw new IdentityBootstrapLifecyclePreflightError(
          "database_pool_close_failed",
        );
      }
      await Reflect.apply(descriptor.value, pool, []);
      return;
    }
    current = Object.getPrototypeOf(current);
  }
  throw new IdentityBootstrapLifecyclePreflightError(
    "database_pool_close_failed",
  );
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
    connectionCloseStatus: "not_confirmed",
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
  if (
    output.result !== "ready_for_new_issue" ||
    output.connectionCloseStatus !== "closed"
  ) {
    process.exitCode = 1;
  }
}
