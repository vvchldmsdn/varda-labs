import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "@neondatabase/serverless";
import { parse } from "dotenv";

import {
  guardPreviewDatabaseTarget,
} from "../src/lib/deployment/preview-database-target.ts";
import {
  digestIdentityBootstrapClaim,
  IDENTITY_BOOTSTRAP_CLAIM_POLICY,
} from "../src/lib/identity-bootstrap-claim.ts";
import {
  IDENTITY_BOOTSTRAP_CLAIM_MIGRATION_CLI_POLICY,
  runIdentityBootstrapClaimMigrationCli,
} from "./issue-identity-bootstrap-claim.mjs";
import {
  fingerprintAppUserId,
} from "./lib/legacy-account-ownership-evidence.mjs";

const CONFIRMATION =
  "--confirm-run-one-disposable-bootstrap-claim-rehearsal";
const DEFAULT_ENV_FILE = ".env.preview-rehearsal.local";
const RAW_CLAIM_PATTERN =
  /^varda-bootstrap-claim-v1\.[A-Za-z0-9_-]{43}$/;
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const ENV_KEYS = Object.freeze([
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "NEON_PROJECT_ID",
]);

export const IDENTITY_BOOTSTRAP_CLAIM_HANDOFF_REHEARSAL_POLICY =
  Object.freeze({
    operation: "identity_bootstrap_claim_handoff_rehearsal_v1",
    confirmation: CONFIRMATION,
    databaseTarget: "guarded_vercel_preview_neon_child",
    syntheticAppUserCount: 1,
    claimIssuanceCount: 1,
    retryCount: 0,
    migrationCount: 0,
  });

export class IdentityBootstrapClaimHandoffRehearsalError extends Error {
  constructor(code) {
    super("Identity bootstrap claim handoff rehearsal failed");
    this.name = "IdentityBootstrapClaimHandoffRehearsalError";
    this.code = code;
  }
}

export async function runIdentityBootstrapClaimHandoffRehearsal({
  args = process.argv.slice(2),
  repositoryRoot = REPOSITORY_ROOT,
  loadEnvironment = loadIdentityBootstrapClaimHandoffRehearsalEnvironment,
  guardDatabaseTarget = guardPreviewDatabaseTarget,
  createPool = createRehearsalPool,
  runMigrationCli = runIdentityBootstrapClaimMigrationCli,
  createSyntheticAppUserId = randomUUID,
} = {}) {
  const options = readIdentityBootstrapClaimHandoffRehearsalOptions({
    args,
    repositoryRoot,
  });
  const environment = loadEnvironment(options.envFile);
  const databaseTarget = guardDatabaseTarget(environment);
  assert.equal(databaseTarget.status, "operational_guard_passed");

  const connectionString = requiredOwnString(
    environment,
    "DATABASE_URL_UNPOOLED",
    "preview_database_not_configured",
  );
  const targetAppUserId = normalizeUuid(createSyntheticAppUserId());
  const targetAppUserSha256 = fingerprintAppUserId(targetAppUserId);
  const verificationPool = createPool(connectionString);
  let capturedRawClaim = null;
  let receiptEvidenceStored = false;

  try {
    const before = await readRehearsalCounts(verificationPool);
    await insertSyntheticProvisioningUser(
      verificationPool,
      targetAppUserId,
    );

    const receipt = await runMigrationCli({
      args: [
        "--target-app-user-id",
        targetAppUserId,
        "--target-app-user-sha256",
        targetAppUserSha256,
        "--reviewed-database-target-fingerprint",
        databaseTarget.targetFingerprint,
        "--receipt-evidence-dir",
        resolve(
          repositoryRoot,
          "..",
          "varda-bootstrap-claim-rehearsal-evidence",
        ),
        "--write",
        "--reveal-on-tty",
        IDENTITY_BOOTSTRAP_CLAIM_MIGRATION_CLI_POLICY.confirmation,
      ],
      loadEnvironment: () => environment,
      guardDatabaseTarget,
      createPool,
      createReceiptEvidencePort: () =>
        Object.freeze({
          store({ receipt, databaseTargetFingerprint }) {
            assert.equal(
              databaseTargetFingerprint,
              databaseTarget.targetFingerprint,
            );
            const binding = requiredOwnObject(
              receipt,
              "claimBinding",
              "receipt_evidence_invalid",
            );
            const receiptId = requiredOwnString(
              binding,
              "identityPairingIntentSha256",
              "receipt_evidence_invalid",
            );
            receiptEvidenceStored = true;
            return Object.freeze({ status: "stored", receiptId });
          },
        }),
      revealPort: Object.freeze({
        isTTY: true,
        async reveal(rawClaim) {
          if (
            capturedRawClaim !== null ||
            typeof rawClaim !== "string" ||
            !RAW_CLAIM_PATTERN.test(rawClaim)
          ) {
            throw new IdentityBootstrapClaimHandoffRehearsalError(
              "raw_claim_capture_invalid",
            );
          }
          capturedRawClaim = rawClaim;
        },
      }),
    });

    assert.equal(receipt.result, "revealed_to_tty");
    assert.equal(receipt.committed, true);
    assert.equal(receipt.receiptEvidenceStatus, "stored");
    assert.equal(receipt.revealStatus, "tty_write_completed");
    assert.equal(receiptEvidenceStored, true);
    assert.ok(capturedRawClaim !== null);

    const persisted = await readPersistedRehearsalEvidence(
      verificationPool,
      targetAppUserId,
    );
    const after = await readRehearsalCounts(verificationPool);
    const expectedDigest =
      digestIdentityBootstrapClaim(capturedRawClaim);

    assert.equal(persisted.status, "provisioning");
    assert.equal(persisted.role, "user");
    assert.equal(persisted.targetIdentityCount, 0);
    assert.equal(persisted.targetIntentCount, 1);
    assert.equal(persisted.targetTerminalEventCount, 0);
    assert.equal(
      persisted.claimDigestVersion,
      IDENTITY_BOOTSTRAP_CLAIM_POLICY.claimDigestVersion,
    );
    assert.equal(persisted.claimDigest, expectedDigest);
    assert.equal(
      persisted.authorityPolicyId,
      IDENTITY_BOOTSTRAP_CLAIM_POLICY.authorityPolicyId,
    );
    assert.equal(
      persisted.targetReviewPolicyId,
      IDENTITY_BOOTSTRAP_CLAIM_POLICY.targetReviewPolicyId,
    );
    assert.equal(
      receipt.claimBinding.claimDigest,
      persisted.claimDigest,
    );
    assertRehearsalCountDelta(before, after);

    const publicEvidence = Object.freeze({
      operation:
        IDENTITY_BOOTSTRAP_CLAIM_HANDOFF_REHEARSAL_POLICY.operation,
      result: "verified",
      databaseTargetFingerprint: databaseTarget.targetFingerprint,
      syntheticTargetAppUserSha256: targetAppUserSha256,
      claimDigestMatched: true,
      actualWrites: Object.freeze({
        appUsers: 1,
        identityPairingIntents: 1,
        identityPairingIntentEvents: 0,
        authIdentities: 0,
        productTables: 0,
      }),
      rawClaimExposure: Object.freeze({
        receipt: false,
        persistedEvidence: false,
        publicOutput: false,
        transport: "in_memory_rehearsal_capture_only",
      }),
      retryCount:
        IDENTITY_BOOTSTRAP_CLAIM_HANDOFF_REHEARSAL_POLICY.retryCount,
      migrationCount:
        IDENTITY_BOOTSTRAP_CLAIM_HANDOFF_REHEARSAL_POLICY.migrationCount,
    });
    assertPublicEvidenceContainsNoRawClaim({
      receipt,
      persisted,
      publicEvidence,
    });
    return publicEvidence;
  } finally {
    capturedRawClaim = null;
    await closePool(verificationPool);
  }
}

export function readIdentityBootstrapClaimHandoffRehearsalOptions({
  args,
  repositoryRoot = REPOSITORY_ROOT,
}) {
  if (!Array.isArray(args)) {
    throw rehearsalError("arguments_invalid");
  }
  let envFile = DEFAULT_ENV_FILE;
  let envFileSeen = false;
  let confirmed = false;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === CONFIRMATION && !confirmed) {
      confirmed = true;
      continue;
    }
    if (value === "--env-file" && !envFileSeen) {
      const candidate = args[index + 1];
      if (
        typeof candidate !== "string" ||
        candidate.length === 0 ||
        candidate.startsWith("--")
      ) {
        throw rehearsalError("arguments_invalid");
      }
      envFile = candidate;
      envFileSeen = true;
      index += 1;
      continue;
    }
    throw rehearsalError("arguments_invalid");
  }
  if (!confirmed) throw rehearsalError("confirmation_required");

  const root = resolve(repositoryRoot);
  const resolvedEnvFile = resolve(root, envFile);
  const pathFromRoot = relative(root, resolvedEnvFile);
  if (
    isAbsolute(pathFromRoot) ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..\\`) ||
    pathFromRoot.startsWith("../")
  ) {
    throw rehearsalError("env_file_outside_repository");
  }
  return Object.freeze({
    envFile: resolvedEnvFile,
  });
}

export function loadIdentityBootstrapClaimHandoffRehearsalEnvironment(
  envFile,
  {
    readFile = readFileSync,
    parseEnvironment = parse,
  } = {},
) {
  const parsed = parseEnvironment(
    readFile(envFile, { encoding: "utf8" }),
  );
  const environment = Object.create(null);
  environment.VERCEL_ENV = "preview";
  for (const key of ENV_KEYS) {
    const value = ownDataValue(parsed, key);
    if (typeof value === "string") environment[key] = value;
  }
  return Object.freeze(environment);
}

async function insertSyntheticProvisioningUser(pool, targetAppUserId) {
  const result = await pool.query(
    `
      insert into app_users (id, status, role)
      values ($1::uuid, 'provisioning', 'user')
      returning id
    `,
    [targetAppUserId],
  );
  if (result.rowCount !== 1) {
    throw rehearsalError("synthetic_target_insert_failed");
  }
}

async function readRehearsalCounts(pool) {
  const { rows } = await pool.query(`
    select
      (select count(*)::integer from app_users) as app_users,
      (select count(*)::integer from auth_identities) as auth_identities,
      (
        select count(*)::integer
        from identity_pairing_intents
      ) as identity_pairing_intents,
      (
        select count(*)::integer
        from identity_pairing_intent_events
      ) as identity_pairing_intent_events,
      (select count(*)::integer from accounts) as accounts,
      (select count(*)::integer from assets) as assets
  `);
  if (rows.length !== 1) throw rehearsalError("count_read_failed");
  return Object.freeze(
    Object.fromEntries(
      Object.entries(rows[0]).map(([key, value]) => [
        key,
        Number(value),
      ]),
    ),
  );
}

async function readPersistedRehearsalEvidence(pool, targetAppUserId) {
  const { rows } = await pool.query(
    `
      select
        user_row.status,
        user_row.role,
        intent.authority_policy_id,
        intent.claim_digest_version,
        intent.claim_digest,
        intent.target_review_policy_id,
        (
          select count(*)::integer
          from auth_identities identity_row
          where identity_row.app_user_id = user_row.id
        ) as target_identity_count,
        (
          select count(*)::integer
          from identity_pairing_intents target_intent
          where target_intent.target_app_user_id = user_row.id
        ) as target_intent_count,
        (
          select count(*)::integer
          from identity_pairing_intent_events terminal_event
          inner join identity_pairing_intents target_intent
            on target_intent.id =
              terminal_event.identity_pairing_intent_id
          where target_intent.target_app_user_id = user_row.id
        ) as target_terminal_event_count
      from app_users user_row
      inner join identity_pairing_intents intent
        on intent.target_app_user_id = user_row.id
      where user_row.id = $1::uuid
    `,
    [targetAppUserId],
  );
  if (rows.length !== 1) {
    throw rehearsalError("persisted_evidence_invalid");
  }
  const row = rows[0];
  return Object.freeze({
    status: row.status,
    role: row.role,
    authorityPolicyId: row.authority_policy_id,
    claimDigestVersion: row.claim_digest_version,
    claimDigest: row.claim_digest,
    targetReviewPolicyId: row.target_review_policy_id,
    targetIdentityCount: Number(row.target_identity_count),
    targetIntentCount: Number(row.target_intent_count),
    targetTerminalEventCount: Number(
      row.target_terminal_event_count,
    ),
  });
}

function assertRehearsalCountDelta(before, after) {
  assert.deepEqual(after, {
    ...before,
    app_users: before.app_users + 1,
    identity_pairing_intents:
      before.identity_pairing_intents + 1,
  });
}

function assertPublicEvidenceContainsNoRawClaim(value) {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes("varda-bootstrap-claim-v1."), false);
}

function createRehearsalPool(connectionString) {
  return new Pool({
    connectionString,
    max: 1,
  });
}

async function closePool(pool) {
  if (pool && typeof pool.end === "function") await pool.end();
}

function requiredOwnString(value, key, code) {
  const result = ownDataValue(value, key);
  if (typeof result !== "string" || result.trim().length === 0) {
    throw rehearsalError(code);
  }
  return result;
}

function requiredOwnObject(value, key, code) {
  const result = ownDataValue(value, key);
  if (result === null || typeof result !== "object") {
    throw rehearsalError(code);
  }
  return result;
}

function ownDataValue(value, key) {
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

function normalizeUuid(value) {
  if (typeof value !== "string") {
    throw rehearsalError("synthetic_target_invalid");
  }
  const normalized = value.toLowerCase();
  if (fingerprintAppUserId(normalized).length === 0) {
    throw rehearsalError("synthetic_target_invalid");
  }
  return normalized;
}

function rehearsalError(code) {
  return new IdentityBootstrapClaimHandoffRehearsalError(code);
}

function blockedOutput(error) {
  return Object.freeze({
    operation:
      IDENTITY_BOOTSTRAP_CLAIM_HANDOFF_REHEARSAL_POLICY.operation,
    result: "blocked",
    code:
      error instanceof IdentityBootstrapClaimHandoffRehearsalError
        ? error.code
        : "rehearsal_failed",
    writeState: "unconfirmed",
  });
}

function isDirectExecution() {
  return (
    typeof process.argv[1] === "string" &&
    resolve(process.argv[1]) === SCRIPT_PATH
  );
}

if (isDirectExecution()) {
  const output =
    await runIdentityBootstrapClaimHandoffRehearsal().catch(
      blockedOutput,
    );
  console.log(JSON.stringify(output, null, 2));
  if (output.result !== "verified") process.exitCode = 1;
}
