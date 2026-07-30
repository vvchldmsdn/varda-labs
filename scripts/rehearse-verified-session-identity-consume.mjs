import assert from "node:assert/strict";
import {
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";

import {
  createSessionSubjectBinding,
} from "../src/lib/auth/session-subject-binding.ts";
import {
  guardIdentityPairingRehearsalTarget,
} from "../src/lib/deployment/identity-pairing-rehearsal-target.ts";
import {
  digestIdentityBootstrapClaim,
  IDENTITY_BOOTSTRAP_CLAIM_POLICY,
} from "../src/lib/identity-bootstrap-claim.ts";
import {
  consumeIdentityPairingClaim,
} from "./lib/identity-pairing-consume-writer.mjs";
import {
  runIdentityPairingCatalogAuditProcess,
} from "./lib/identity-pairing-catalog-preflight.mjs";
import {
  IDENTITY_PAIRING_HOST_ENV_SOURCE,
} from "./lib/identity-pairing-host-target.mjs";
import {
  createVerifiedSessionConsumeCapability,
} from "./lib/verified-session-consume-capability.mjs";
import {
  executeVerifiedSessionIdentityConsume,
} from "./lib/verified-session-identity-consume.mjs";

const CONFIRMATION =
  "--confirm-isolated-verified-session-identity-consume-rehearsal";
const REJECTION_FUNCTION =
  "verified_session_identity_consume_rehearsal_reject_event";
const REJECTION_TRIGGER =
  "verified_session_identity_consume_rehearsal_reject_event";
const SAFE_CODE_PATTERN = /^[a-z][a-z0-9_]{0,79}$/;

export function readVerifiedSessionIdentityConsumeRehearsalOptions(
  args,
) {
  if (
    !Array.isArray(args) ||
    args.length !== 1 ||
    args[0] !== CONFIRMATION
  ) {
    throw rehearsalError("rehearsal_confirmation_invalid");
  }
  return Object.freeze({ confirmed: true });
}

export async function runVerifiedSessionIdentityConsumeRehearsal({
  args = process.argv.slice(2),
  env = process.env,
  createPool = (connectionString) =>
    new Pool({ connectionString, max: 4 }),
  runCatalogPreflight =
    runIdentityPairingCatalogAuditProcess,
  write = (value) => console.log(JSON.stringify(value)),
} = {}) {
  readVerifiedSessionIdentityConsumeRehearsalOptions(args);
  const target = guardIdentityPairingRehearsalTarget(env);
  assertReviewedCatalogPreflight(runCatalogPreflight);
  const connectionString =
    env.IDENTITY_PAIRING_REHEARSAL_DATABASE_URL_UNPOOLED;
  assert.ok(connectionString, "The guarded rehearsal URL is unavailable.");

  const hmacKey = randomBytes(32);
  let pool = null;
  const checks = [];
  try {
    pool = createPool(connectionString);
    await assertPoolReady(pool);
    await assertPairingSchemaReadyAndEmpty(pool);

    await rehearseMatchingConsume(pool, hmacKey);
    checks.push("matching_consume");

    await rehearseSessionBindingMismatch(pool, hmacKey);
    checks.push("session_binding_mismatch_before_writer_dml");

    await rehearseWriterRollback(pool, hmacKey);
    checks.push("writer_rollback_and_one_shot_consumption");

    const result = Object.freeze({
      rehearsal:
        "verified_session_identity_consume_composition_disposable_branch",
      status: "passed",
      checks: Object.freeze(checks),
      productionDatabaseWrites: 0,
      publicRouteEnabled: false,
      issuerInvocations: 0,
      accountOwnerAssignmentInvocations: 0,
      branchIdFingerprint: target.branchIdFingerprint,
      branchNameFingerprint: target.branchNameFingerprint,
      endpointFingerprint: target.endpointFingerprint,
      targetFingerprint: target.targetFingerprint,
      branchDeletionRequired: true,
    });
    write(result);
    return result;
  } finally {
    hmacKey.fill(0);
    if (pool !== null) await pool.end();
  }
}

async function rehearseMatchingConsume(pool, hmacKey) {
  const targetAppUserId = await insertAppUser(pool);
  const claim = await insertIntent(pool, targetAppUserId);
  const subject = syntheticSubject("matching");
  const fixture = createCompositionFixture({
    hmacKey,
    rawClaim: claim.rawClaim,
    subject,
    targetAppUserId,
    identityPairingIntentId: claim.identityPairingIntentId,
    claimDigest: claim.claimDigest,
  });

  const result = await executeVerifiedSessionIdentityConsume(
    {
      executionBinding: fixture.executionBinding,
      claimContinuationPort: fixture.claimContinuationPort,
      pool,
    },
    fixture.dependencies,
  );

  assert.deepEqual(result, {
    operation: "verified_session_identity_consume_v1",
    result: "consumed",
    committed: true,
    retryCount: 0,
  });
  assert.equal(fixture.sessionReadCount(), 1);
  assert.equal(fixture.claimTakeCount(), 1);
  assert.equal(fixture.writerInvocationCount(), 1);
  assert.equal(fixture.sessionCapabilityAvailable(), false);
  await assertConsumedState(
    pool,
    targetAppUserId,
    claim.claimDigest,
    subject,
  );
}

async function rehearseSessionBindingMismatch(pool, hmacKey) {
  const targetAppUserId = await insertAppUser(pool);
  const claim = await insertIntent(pool, targetAppUserId);
  const subject = syntheticSubject("binding-mismatch");
  const fixture = createCompositionFixture({
    hmacKey,
    rawClaim: claim.rawClaim,
    subject,
    targetAppUserId,
    identityPairingIntentId: claim.identityPairingIntentId,
    claimDigest: claim.claimDigest,
  });
  const mismatchedBinding = Object.freeze({
    ...fixture.executionBinding,
    subjectBinding: createMismatchedSubjectBinding(
      fixture.executionBinding.subjectBinding,
    ),
  });

  const result = await executeVerifiedSessionIdentityConsume(
    {
      executionBinding: mismatchedBinding,
      claimContinuationPort: fixture.claimContinuationPort,
      pool,
    },
    fixture.dependencies,
  );

  assert.equal(result.result, "blocked");
  assert.equal(result.blocker, "session_binding_mismatch");
  assert.equal(result.claimContinuationTaken, false);
  assert.equal(result.writerInvoked, false);
  assert.equal(result.restartRequired, false);
  assert.equal(fixture.sessionReadCount(), 1);
  assert.equal(fixture.claimTakeCount(), 0);
  assert.equal(fixture.writerInvocationCount(), 0);
  assert.equal(fixture.sessionCapabilityAvailable(), false);
  await assertUnconsumedState(
    pool,
    targetAppUserId,
    claim.claimDigest,
    subject,
  );
}

async function rehearseWriterRollback(pool, hmacKey) {
  const targetAppUserId = await insertAppUser(pool);
  const claim = await insertIntent(pool, targetAppUserId);
  const subject = syntheticSubject("rollback");
  const fixture = createCompositionFixture({
    hmacKey,
    rawClaim: claim.rawClaim,
    subject,
    targetAppUserId,
    identityPairingIntentId: claim.identityPairingIntentId,
    claimDigest: claim.claimDigest,
  });

  await assertRejectionTriggerAbsent(pool);
  await pool.query(`
    create function ${REJECTION_FUNCTION}()
    returns trigger
    language plpgsql
    as $verified_session_identity_consume_rehearsal$
    begin
      raise exception 'synthetic composition consume rejection';
    end;
    $verified_session_identity_consume_rehearsal$
  `);
  await pool.query(`
    create trigger ${REJECTION_TRIGGER}
    before insert on identity_pairing_intent_events
    for each row
    execute function ${REJECTION_FUNCTION}()
  `);

  let result;
  try {
    result = await executeVerifiedSessionIdentityConsume(
      {
        executionBinding: fixture.executionBinding,
        claimContinuationPort: fixture.claimContinuationPort,
        pool,
      },
      fixture.dependencies,
    );
  } finally {
    await pool.query(`
      drop trigger if exists ${REJECTION_TRIGGER}
      on identity_pairing_intent_events
    `);
    await pool.query(
      `drop function if exists ${REJECTION_FUNCTION}()`,
    );
  }

  assert.equal(result.result, "partial");
  assert.equal(result.blocker, "database_transaction_failed");
  assert.equal(result.restartRequired, true);
  assert.deepEqual(result.committedPhases, []);
  assert.equal(fixture.sessionReadCount(), 1);
  assert.equal(fixture.claimTakeCount(), 1);
  assert.equal(fixture.writerInvocationCount(), 1);
  assert.equal(fixture.sessionCapabilityAvailable(), false);
  await assertUnconsumedState(
    pool,
    targetAppUserId,
    claim.claimDigest,
    subject,
  );
}

function createCompositionFixture({
  hmacKey,
  rawClaim,
  subject,
  targetAppUserId,
  identityPairingIntentId,
  claimDigest,
}) {
  const evidence = Object.freeze({
    state: "verified",
    provider: IDENTITY_BOOTSTRAP_CLAIM_POLICY.provider,
    subject,
    verificationSource: "server_verified_session",
  });
  const subjectBinding = createSessionSubjectBinding({
    evidence,
    hmacKey,
  });
  assert.equal(subjectBinding.state, "verified");

  const executionBinding = Object.freeze({
    targetAppUserSha256: sha256Fingerprint(targetAppUserId),
    provider: IDENTITY_BOOTSTRAP_CLAIM_POLICY.provider,
    claimDigestVersion:
      IDENTITY_BOOTSTRAP_CLAIM_POLICY.claimDigestVersion,
    claimDigest,
    identityPairingIntentSha256: sha256Fingerprint(
      identityPairingIntentId,
    ),
    subjectBindingVersion: subjectBinding.subjectBindingVersion,
    subjectBinding: subjectBinding.subjectBinding,
  });

  let sessionReads = 0;
  let claimTakes = 0;
  let writerInvocations = 0;
  let continuationAvailable = true;
  let capability = null;
  const sessionPort = Object.freeze({
    async read() {
      sessionReads += 1;
      return evidence;
    },
  });
  const claimContinuationPort = Object.freeze({
    take() {
      if (!continuationAvailable) {
        throw rehearsalError("claim_continuation_unavailable");
      }
      continuationAvailable = false;
      claimTakes += 1;
      return Object.freeze({
        rawClaim,
        executionBinding,
      });
    },
  });
  const dependencies = Object.freeze({
    async createSessionCapability() {
      capability = await createVerifiedSessionConsumeCapability({
        sessionPort,
        hmacKey,
      });
      return capability;
    },
    async consumeIdentityPairingClaim(input) {
      writerInvocations += 1;
      return consumeIdentityPairingClaim(input);
    },
  });

  return Object.freeze({
    executionBinding,
    claimContinuationPort,
    dependencies,
    sessionReadCount: () => sessionReads,
    claimTakeCount: () => claimTakes,
    writerInvocationCount: () => writerInvocations,
    sessionCapabilityAvailable: () =>
      capability?.isAvailable() ?? null,
  });
}

function assertReviewedCatalogPreflight(runCatalogPreflight) {
  const result = runCatalogPreflight();
  assert.equal(result.status, "passed");
  assert.equal(result.evidence?.status, "passed");
  assert.equal(result.evidence?.state, "present");
  assert.equal(result.evidence?.readOnly, true);
  assert.equal(result.evidence?.databaseWrites, 0);
  assert.deepEqual(result.evidence?.migrationPlan?.pendingTags, []);
  assert.deepEqual(result.evidence?.pairingRows, {
    intents: 0,
    events: 0,
  });
}

async function assertPoolReady(pool) {
  const { rows } = await pool.query(
    "select 1::integer as rehearsal_pool_ready",
  );
  assert.equal(Number(rows[0]?.rehearsal_pool_ready), 1);
}

async function assertPairingSchemaReadyAndEmpty(pool) {
  const { rows } = await pool.query(`
    select
      to_regclass('public.identity_pairing_intents')::text
        as intents_table,
      to_regclass('public.identity_pairing_intent_events')::text
        as events_table,
      (
        select count(*)::integer
        from identity_pairing_intents
      ) as intent_count,
      (
        select count(*)::integer
        from identity_pairing_intent_events
      ) as event_count
  `);
  assert.equal(rows[0]?.intents_table, "identity_pairing_intents");
  assert.equal(
    rows[0]?.events_table,
    "identity_pairing_intent_events",
  );
  assert.equal(Number(rows[0]?.intent_count), 0);
  assert.equal(Number(rows[0]?.event_count), 0);
  await assertRejectionTriggerAbsent(pool);
}

async function insertAppUser(pool) {
  const id = randomUUID();
  await pool.query(
    `
      insert into app_users (id, status, role)
      values ($1::uuid, 'provisioning', 'user')
    `,
    [id],
  );
  return id;
}

async function insertIntent(pool, targetAppUserId) {
  const rawClaim =
    IDENTITY_BOOTSTRAP_CLAIM_POLICY.claimPrefix +
    randomBytes(
      IDENTITY_BOOTSTRAP_CLAIM_POLICY.claimEntropyBytes,
    ).toString("base64url");
  const claimDigest = digestIdentityBootstrapClaim(rawClaim);
  const { rows } = await pool.query(
    `
      insert into identity_pairing_intents (
        authority_policy_id,
        target_app_user_id,
        provider,
        claim_digest_version,
        claim_digest,
        target_review_policy_id,
        issued_at,
        expires_at
      ) values (
        $1,
        $2::uuid,
        $3,
        $4,
        $5,
        $6,
        clock_timestamp(),
        clock_timestamp() + interval '9 minutes'
      )
      returning id
    `,
    [
      IDENTITY_BOOTSTRAP_CLAIM_POLICY.authorityPolicyId,
      targetAppUserId,
      IDENTITY_BOOTSTRAP_CLAIM_POLICY.provider,
      IDENTITY_BOOTSTRAP_CLAIM_POLICY.claimDigestVersion,
      claimDigest,
      IDENTITY_BOOTSTRAP_CLAIM_POLICY.targetReviewPolicyId,
    ],
  );
  assert.equal(rows.length, 1);
  return Object.freeze({
    rawClaim,
    claimDigest,
    identityPairingIntentId: String(rows[0].id),
  });
}

async function assertConsumedState(
  pool,
  targetAppUserId,
  claimDigest,
  subject,
) {
  const state = await readPairingState(
    pool,
    targetAppUserId,
    claimDigest,
    subject,
  );
  assert.deepEqual(state, {
    targetStatus: "active",
    identityCount: 1,
    eventCount: 1,
  });
}

async function assertUnconsumedState(
  pool,
  targetAppUserId,
  claimDigest,
  subject,
) {
  const state = await readPairingState(
    pool,
    targetAppUserId,
    claimDigest,
    subject,
  );
  assert.deepEqual(state, {
    targetStatus: "provisioning",
    identityCount: 0,
    eventCount: 0,
  });
}

async function readPairingState(
  pool,
  targetAppUserId,
  claimDigest,
  subject,
) {
  const { rows } = await pool.query(
    `
      select
        (
          select status
          from app_users
          where id = $1::uuid
        ) as target_status,
        (
          select count(*)::integer
          from auth_identities
          where provider = 'neon_auth'
            and provider_subject = $3
        ) as identity_count,
        (
          select count(*)::integer
          from identity_pairing_intent_events event
          join identity_pairing_intents intent
            on intent.id = event.identity_pairing_intent_id
          where intent.claim_digest = $2
        ) as event_count
    `,
    [targetAppUserId, claimDigest, subject],
  );
  return {
    targetStatus: rows[0]?.target_status,
    identityCount: Number(rows[0]?.identity_count),
    eventCount: Number(rows[0]?.event_count),
  };
}

async function assertRejectionTriggerAbsent(pool) {
  const { rows } = await pool.query(
    `
      select count(*)::integer as trigger_count
      from pg_trigger
      where tgname = $1
        and not tgisinternal
    `,
    [REJECTION_TRIGGER],
  );
  assert.equal(Number(rows[0]?.trigger_count), 0);
}

function syntheticSubject(label) {
  return `composition-${label}-${randomUUID()}`;
}

function sha256Fingerprint(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function createMismatchedSubjectBinding(value) {
  const [version, digest] = value.split(":");
  assert.equal(version, "hmac-sha256-v1");
  assert.equal(digest.length, 64);
  const replacement = digest[0] === "0" ? "1" : "0";
  return `${version}:${replacement}${digest.slice(1)}`;
}

function rehearsalError(code) {
  return Object.assign(
    new Error("Verified-session identity consume rehearsal failed"),
    { code },
  );
}

function safeFailure(error) {
  let descriptor;
  try {
    descriptor =
      error && typeof error === "object"
        ? Object.getOwnPropertyDescriptor(error, "code")
        : undefined;
  } catch {
    descriptor = undefined;
  }
  const code =
    descriptor &&
    "value" in descriptor &&
    typeof descriptor.value === "string" &&
    SAFE_CODE_PATTERN.test(descriptor.value)
      ? descriptor.value
      : "composition_rehearsal_failed";
  return Object.freeze({
    rehearsal:
      "verified_session_identity_consume_composition_disposable_branch",
    status: "failed",
    code,
    productionDatabaseWrites: 0,
    branchDeletionRequired: true,
  });
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entryUrl === import.meta.url) {
  if (
    process.env.IDENTITY_PAIRING_HOST_ENV_SOURCE !==
    IDENTITY_PAIRING_HOST_ENV_SOURCE
  ) {
    config({ path: ".env.local", quiet: true });
  }
  runVerifiedSessionIdentityConsumeRehearsal().catch((error) => {
    console.error(JSON.stringify(safeFailure(error)));
    process.exitCode = 1;
  });
}
