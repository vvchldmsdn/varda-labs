import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "@neondatabase/serverless";
import { parse } from "dotenv";

import {
  guardProductionDatabaseTarget,
} from "../src/lib/deployment/production-database-target.ts";
import {
  createIdentityBootstrapClaimIssuerPort,
} from "./lib/identity-bootstrap-claim-issuer.mjs";
import {
  fingerprintAppUserId,
  isSha256Fingerprint,
} from "./lib/legacy-account-ownership-evidence.mjs";
import {
  readClaimBinding,
} from "./lib/one-user-bootstrap-binding.mjs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RAW_CLAIM_PATTERN =
  /^varda-bootstrap-claim-v1\.[A-Za-z0-9_-]{43}$/;
const SAFE_ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,79}$/;
const CONFIRMATION =
  "--confirm-issue-one-production-bootstrap-claim";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const ENV_KEYS = Object.freeze([
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "NEON_PROJECT_ID",
]);

export const IDENTITY_BOOTSTRAP_CLAIM_MIGRATION_CLI_POLICY =
  Object.freeze({
    operation: "identity_bootstrap_claim_migration_cli_handoff_v1",
    confirmation: CONFIRMATION,
    defaultMode: "dry_run",
    revealTransport: "interactive_tty_stderr_once_after_commit",
    retryCount: 0,
  });

export class IdentityBootstrapClaimMigrationCliError extends Error {
  constructor(code) {
    super("Identity bootstrap claim migration CLI failed");
    this.name = "IdentityBootstrapClaimMigrationCliError";
    this.code = code;
  }
}

export async function runIdentityBootstrapClaimMigrationCli({
  args = process.argv.slice(2),
  repositoryRoot = REPOSITORY_ROOT,
  loadEnvironment = loadIdentityBootstrapClaimEnvironment,
  guardDatabaseTarget = guardProductionDatabaseTarget,
  createPool = createProductionPool,
  createIssuerPort = createIdentityBootstrapClaimIssuerPort,
  revealPort = createProcessTtyRevealPort(),
} = {}) {
  const options = readIdentityBootstrapClaimMigrationCliOptions(args);
  if (options.write) assertInteractiveRevealPort(revealPort);

  let environment;
  try {
    environment = loadEnvironment(repositoryRoot);
  } catch {
    throw new IdentityBootstrapClaimMigrationCliError(
      "environment_load_failed",
    );
  }
  let databaseTarget;
  try {
    databaseTarget = guardDatabaseTarget(environment);
  } catch {
    throw new IdentityBootstrapClaimMigrationCliError(
      "production_database_target_guard_failed",
    );
  }

  if (!options.write) {
    return Object.freeze({
      operation:
        IDENTITY_BOOTSTRAP_CLAIM_MIGRATION_CLI_POLICY.operation,
      mode: "dry_run",
      result: "planned",
      reviewedTargetAppUserSha256: options.targetAppUserSha256,
      databaseTargetFingerprint: readRequiredOwnString(
        databaseTarget,
        "targetFingerprint",
        "production_database_target_guard_failed",
      ),
      plannedWrites: Object.freeze({
        identityPairingIntents: 1,
        identityPairingIntentEvents: 0,
        authIdentities: 0,
        appUsers: 0,
        productTables: 0,
      }),
      revealTransport:
        IDENTITY_BOOTSTRAP_CLAIM_MIGRATION_CLI_POLICY.revealTransport,
      retryCount:
        IDENTITY_BOOTSTRAP_CLAIM_MIGRATION_CLI_POLICY.retryCount,
    });
  }

  const connectionString = readRequiredOwnString(
    environment,
    "DATABASE_URL_UNPOOLED",
    "database_not_configured",
  );
  let pool;
  let issuerPort;
  let issueResult;
  let issueError = null;
  let poolCloseFailed = false;
  try {
    pool = createPool(connectionString);
    issuerPort = createIssuerPort({
      pool,
      targetAppUserId: options.targetAppUserId,
    });
    const issue = readRequiredOwnMethod(
      issuerPort,
      "issue",
      "issuer_port_invalid",
    );
    issueResult = await Reflect.apply(issue, issuerPort, [
      {
        targetAppUserSha256: options.targetAppUserSha256,
      },
    ]);
  } catch (error) {
    issueError = mapMigrationCliError(
      error,
      "claim_issuance_failed",
    );
  } finally {
    if (pool !== undefined) {
      try {
        await closeProductionPool(pool);
      } catch {
        poolCloseFailed = true;
      }
    }
  }
  if (issueError !== null) throw issueError;
  if (poolCloseFailed) {
    return createDeliveryReceipt(
      issueResult,
      "delivery_unconfirmed",
    );
  }

  const receipt = createDeliveryReceipt(
    issueResult,
    "delivery_confirmed",
  );
  let rawClaim = null;
  try {
    const take = readRequiredOwnMethod(
      issuerPort,
      "take",
      "issuer_port_invalid",
    );
    const privateClaim = Reflect.apply(take, issuerPort, [issueResult]);
    rawClaim = readRequiredOwnString(
      privateClaim,
      "rawClaim",
      "claim_material_invalid",
    );
    if (!RAW_CLAIM_PATTERN.test(rawClaim)) {
      throw new IdentityBootstrapClaimMigrationCliError(
        "claim_material_invalid",
      );
    }
    const reveal = readRequiredOwnMethod(
      revealPort,
      "reveal",
      "tty_reveal_required",
    );
    await Reflect.apply(reveal, revealPort, [rawClaim]);
    return receipt;
  } catch {
    return createDeliveryReceipt(
      issueResult,
      "delivery_unconfirmed",
    );
  } finally {
    rawClaim = null;
  }
}

export function readIdentityBootstrapClaimMigrationCliOptions(args) {
  if (!Array.isArray(args)) {
    throw new IdentityBootstrapClaimMigrationCliError(
      "arguments_invalid",
    );
  }

  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (typeof key !== "string") {
      throw new IdentityBootstrapClaimMigrationCliError(
        "arguments_invalid",
      );
    }
    if (
      [
        "--write",
        "--reveal-on-tty",
        CONFIRMATION,
      ].includes(key)
    ) {
      if (flags.has(key)) {
        throw new IdentityBootstrapClaimMigrationCliError(
          "arguments_invalid",
        );
      }
      flags.add(key);
      continue;
    }
    if (
      ![
        "--target-app-user-id",
        "--target-app-user-sha256",
      ].includes(key) ||
      values.has(key)
    ) {
      throw new IdentityBootstrapClaimMigrationCliError(
        "arguments_invalid",
      );
    }
    const value = args[index + 1];
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.startsWith("--")
    ) {
      throw new IdentityBootstrapClaimMigrationCliError(
        "arguments_invalid",
      );
    }
    values.set(key, value);
    index += 1;
  }

  const targetAppUserId = values.get("--target-app-user-id");
  const targetAppUserSha256 = values.get(
    "--target-app-user-sha256",
  );
  if (
    values.size !== 2 ||
    typeof targetAppUserId !== "string" ||
    !UUID_PATTERN.test(targetAppUserId) ||
    targetAppUserId !== targetAppUserId.toLowerCase() ||
    typeof targetAppUserSha256 !== "string" ||
    !isSha256Fingerprint(targetAppUserSha256) ||
    fingerprintAppUserId(targetAppUserId) !== targetAppUserSha256
  ) {
    throw new IdentityBootstrapClaimMigrationCliError(
      "reviewed_target_invalid",
    );
  }

  const write = flags.has("--write");
  const confirmed = flags.has(CONFIRMATION);
  const revealOnTty = flags.has("--reveal-on-tty");
  if (write && (!confirmed || !revealOnTty)) {
    throw new IdentityBootstrapClaimMigrationCliError(
      "write_confirmation_required",
    );
  }
  if (!write && (confirmed || revealOnTty)) {
    throw new IdentityBootstrapClaimMigrationCliError(
      "write_mode_required",
    );
  }

  return Object.freeze({
    mode: write ? "write" : "dry_run",
    write,
    targetAppUserId,
    targetAppUserSha256,
  });
}

export function loadIdentityBootstrapClaimEnvironment(
  repositoryRoot,
  {
    readFile = readFileSync,
    parseEnvironment = parse,
  } = {},
) {
  const parsed = parseEnvironment(
    readFile(join(repositoryRoot, ".env.local"), {
      encoding: "utf8",
    }),
  );
  const environment = Object.create(null);
  for (const key of ENV_KEYS) {
    const value = readOwnDataValue(parsed, key);
    if (typeof value === "string") environment[key] = value;
  }
  return Object.freeze(environment);
}

export function createProcessTtyRevealPort(stream = process.stderr) {
  return Object.freeze({
    isTTY: stream.isTTY === true,
    reveal(rawClaim) {
      return new Promise((resolvePromise, rejectPromise) => {
        stream.write(
          [
            "",
            "One-time identity bootstrap claim (shown once):",
            rawClaim,
            "",
          ].join("\n"),
          "utf8",
          (error) => {
            if (error) rejectPromise(error);
            else resolvePromise();
          },
        );
      });
    },
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
      throw new IdentityBootstrapClaimMigrationCliError(
        "database_pool_close_failed",
      );
    }
    if (descriptor) {
      if (
        !("value" in descriptor) ||
        typeof descriptor.value !== "function"
      ) {
        throw new IdentityBootstrapClaimMigrationCliError(
          "database_pool_close_failed",
        );
      }
      await Reflect.apply(descriptor.value, pool, []);
      return;
    }
    current = Object.getPrototypeOf(current);
  }
  throw new IdentityBootstrapClaimMigrationCliError(
    "database_pool_close_failed",
  );
}

function assertInteractiveRevealPort(revealPort) {
  if (
    readOwnDataValue(revealPort, "isTTY") !== true ||
    typeof readOwnDataValue(revealPort, "reveal") !== "function"
  ) {
    throw new IdentityBootstrapClaimMigrationCliError(
      "tty_reveal_required",
    );
  }
}

function createDeliveryReceipt(issueResult, deliveryStatus) {
  if (
    readOwnDataValue(issueResult, "result") !== "issued" ||
    readOwnDataValue(issueResult, "committed") !== true
  ) {
    throw new IdentityBootstrapClaimMigrationCliError(
      "issuer_result_invalid",
    );
  }
  const evidence = readRequiredOwnObject(
    issueResult,
    "evidence",
    "issuer_result_invalid",
  );
  const executionBinding = readRequiredOwnObject(
    issueResult,
    "executionBinding",
    "issuer_result_invalid",
  );
  const expiresAt = readRequiredOwnString(
    evidence,
    "expiresAt",
    "issuer_result_invalid",
  );
  if (
    !Number.isFinite(Date.parse(expiresAt)) ||
    new Date(expiresAt).toISOString() !== expiresAt
  ) {
    throw new IdentityBootstrapClaimMigrationCliError(
      "issuer_result_invalid",
    );
  }

  let claimBinding;
  try {
    claimBinding = readClaimBinding(executionBinding);
  } catch {
    throw new IdentityBootstrapClaimMigrationCliError(
      "issuer_result_invalid",
    );
  }
  return Object.freeze({
    operation:
      IDENTITY_BOOTSTRAP_CLAIM_MIGRATION_CLI_POLICY.operation,
    mode: "write",
    result:
      deliveryStatus === "delivery_confirmed"
        ? "delivered"
        : "delivery_unconfirmed",
    issued: true,
    committed: true,
    deliveryStatus,
    expiresAt,
    claimBinding,
  });
}

function readRequiredOwnMethod(value, key, code) {
  const method = readOwnDataValue(value, key);
  if (typeof method !== "function") {
    throw new IdentityBootstrapClaimMigrationCliError(code);
  }
  return method;
}

function readRequiredOwnObject(value, key, code) {
  const result = readOwnDataValue(value, key);
  if (result === null || typeof result !== "object") {
    throw new IdentityBootstrapClaimMigrationCliError(code);
  }
  return result;
}

function readRequiredOwnString(value, key, code) {
  const result = readOwnDataValue(value, key);
  if (typeof result !== "string") {
    throw new IdentityBootstrapClaimMigrationCliError(code);
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

function mapMigrationCliError(error, fallback) {
  if (error instanceof IdentityBootstrapClaimMigrationCliError) {
    return error;
  }
  const code = readOwnDataValue(error, "code");
  return new IdentityBootstrapClaimMigrationCliError(
    typeof code === "string" && SAFE_ERROR_CODE_PATTERN.test(code)
      ? code
      : fallback,
  );
}

function blockedOutput(error) {
  const code = readOwnDataValue(error, "code");
  return Object.freeze({
    operation:
      IDENTITY_BOOTSTRAP_CLAIM_MIGRATION_CLI_POLICY.operation,
    mode: "blocked",
    result: "blocked",
    code:
      typeof code === "string" && SAFE_ERROR_CODE_PATTERN.test(code)
        ? code
        : "migration_cli_failed",
    issued: false,
    committed: false,
    deliveryStatus: "not_attempted",
  });
}

function isDirectExecution() {
  return (
    typeof process.argv[1] === "string" &&
    resolve(process.argv[1]) === SCRIPT_PATH
  );
}

if (isDirectExecution()) {
  const output = await runIdentityBootstrapClaimMigrationCli().catch(
    blockedOutput,
  );
  console.log(JSON.stringify(output, null, 2));
  if (!["planned", "delivered"].includes(output.result)) {
    process.exitCode = 1;
  }
}
