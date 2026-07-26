import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";

import {
  guardIdentityPairingRehearsalTarget,
} from "../src/lib/deployment/identity-pairing-rehearsal-target.ts";
import {
  digestIdentityBootstrapClaim,
  IDENTITY_BOOTSTRAP_CLAIM_POLICY,
} from "../src/lib/identity-bootstrap-claim.ts";
import {
  consumeIdentityPairingClaim,
  IdentityPairingConsumeError,
} from "./lib/identity-pairing-consume-writer.mjs";

const CONFIRMATION =
  "--confirm-isolated-identity-pairing-rehearsal";
const EXPECTED_MIGRATION_SHA256 =
  "e3590cbe4e787bb32ca6fa9fdb27ae6f50295701dcd22bfb9b3edd8997fb1553";
const REJECTION_FUNCTION =
  "identity_pairing_rehearsal_reject_consume_event";
const REJECTION_TRIGGER =
  "identity_pairing_rehearsal_reject_consume_event";

config({ path: ".env.local", quiet: true });

main().catch((error) => {
  console.error(
    JSON.stringify({
      rehearsal: "identity_pairing_atomic_consume_disposable_branch",
      status: "failed",
      code: safeErrorCode(error),
      productionDatabaseWrites: 0,
    }),
  );
  process.exitCode = 1;
});

async function main() {
  if (
    process.argv.slice(2).length !== 1 ||
    process.argv.slice(2)[0] !== CONFIRMATION
  ) {
    throw new Error(
      `Disposable rehearsal requires the exact ${CONFIRMATION} argument.`,
    );
  }

  const target = guardIdentityPairingRehearsalTarget(process.env);
  const connectionString =
    process.env.IDENTITY_PAIRING_REHEARSAL_DATABASE_URL_UNPOOLED;
  assert.ok(connectionString, "The guarded rehearsal URL is unavailable.");

  const pool = new Pool({ connectionString, max: 8 });
  pool.on("error", () => {});
  const hmacKey = randomBytes(32);
  const checks = [];

  try {
    await assertSchemaReadyAndEmpty(pool);

    await rehearseSuccessfulConsume(pool, hmacKey);
    checks.push("successful_consume");

    await rehearseExpiredClaim(pool, hmacKey);
    checks.push("expired_claim");

    await rehearseDuplicateConsume(pool, hmacKey);
    checks.push("duplicate_consume");

    await rehearseSubjectCollision(pool, hmacKey);
    checks.push("subject_collision");

    await rehearseTargetDrift(pool, hmacKey);
    checks.push("target_drift");

    await rehearseSameClaimRace(pool, hmacKey);
    checks.push("same_claim_race");

    await rehearseSameSubjectDifferentTargetsRace(pool, hmacKey);
    checks.push("same_subject_different_targets_race");

    await rehearseSameTargetDifferentSubjectsRace(pool, hmacKey);
    checks.push("same_target_different_subjects_race");

    await rehearseTerminalInsertRollback(pool, hmacKey);
    checks.push("terminal_insert_full_rollback");

    console.log(
      JSON.stringify({
        rehearsal: "identity_pairing_atomic_consume_disposable_branch",
        status: "passed",
        checks,
        productionDatabaseWrites: 0,
        controlPlaneVerificationRequired:
          target.controlPlaneVerificationRequired,
        branchIdFingerprint: target.branchIdFingerprint,
        branchNameFingerprint: target.branchNameFingerprint,
        endpointFingerprint: target.endpointFingerprint,
        targetFingerprint: target.targetFingerprint,
        branchDeletionRequired: true,
      }),
    );
  } finally {
    hmacKey.fill(0);
    await pool.end();
  }
}

async function rehearseSuccessfulConsume(pool, hmacKey) {
  const targetAppUserId = await insertAppUser(pool);
  const claim = await insertIntent(pool, targetAppUserId, "current");
  const subject = syntheticSubject("success");

  const result = await consume(pool, hmacKey, claim.rawClaim, subject);
  assert.equal(result.result, "consumed");
  await assertConsumedState(
    pool,
    targetAppUserId,
    [claim.claimDigest],
    [subject],
  );
}

async function rehearseExpiredClaim(pool, hmacKey) {
  const targetAppUserId = await insertAppUser(pool);
  const claim = await insertIntent(pool, targetAppUserId, "expired");
  const subject = syntheticSubject("expired");

  await expectConsumeError(
    () => consume(pool, hmacKey, claim.rawClaim, subject),
    ["claim_intent_expired"],
  );
  await assertUnconsumedState(
    pool,
    targetAppUserId,
    [claim.claimDigest],
    [subject],
  );
}

async function rehearseDuplicateConsume(pool, hmacKey) {
  const targetAppUserId = await insertAppUser(pool);
  const claim = await insertIntent(pool, targetAppUserId, "current");
  const subject = syntheticSubject("duplicate");

  await consume(pool, hmacKey, claim.rawClaim, subject);
  await expectConsumeError(
    () => consume(pool, hmacKey, claim.rawClaim, subject),
    [
      "claim_intent_already_terminal",
      "reviewed_target_state_mismatch",
    ],
  );
  await assertConsumedState(
    pool,
    targetAppUserId,
    [claim.claimDigest],
    [subject],
  );
}

async function rehearseSubjectCollision(pool, hmacKey) {
  const targetAppUserId = await insertAppUser(pool);
  const collisionOwnerId = await insertAppUser(pool, "active");
  const claim = await insertIntent(pool, targetAppUserId, "current");
  const subject = syntheticSubject("collision");
  await pool.query(
    `
      insert into auth_identities (
        app_user_id,
        provider,
        provider_subject,
        status
      ) values ($1::uuid, 'neon_auth', $2, 'active')
    `,
    [collisionOwnerId, subject],
  );

  await expectConsumeError(
    () => consume(pool, hmacKey, claim.rawClaim, subject),
    ["identity_link_provider_subject_collision"],
  );
  const state = await readPairingState(
    pool,
    [targetAppUserId],
    [claim.claimDigest],
    [subject],
  );
  assert.deepEqual(state.targetStatuses, ["provisioning"]);
  assert.equal(state.identityCount, 1);
  assert.equal(state.eventCount, 0);
}

async function rehearseTargetDrift(pool, hmacKey) {
  const targetAppUserId = await insertAppUser(pool);
  const claim = await insertIntent(pool, targetAppUserId, "current");
  const subject = syntheticSubject("target-drift");
  await pool.query(
    `
      update app_users
      set status = 'disabled',
          updated_at = clock_timestamp()
      where id = $1::uuid
    `,
    [targetAppUserId],
  );

  await expectConsumeError(
    () => consume(pool, hmacKey, claim.rawClaim, subject),
    ["reviewed_target_state_mismatch"],
  );
  const state = await readPairingState(
    pool,
    [targetAppUserId],
    [claim.claimDigest],
    [subject],
  );
  assert.deepEqual(state.targetStatuses, ["disabled"]);
  assert.equal(state.identityCount, 0);
  assert.equal(state.eventCount, 0);
}

async function rehearseSameClaimRace(pool, hmacKey) {
  const targetAppUserId = await insertAppUser(pool);
  const claim = await insertIntent(pool, targetAppUserId, "current");
  const subject = syntheticSubject("same-claim-race");

  const attempts = await Promise.allSettled([
    consume(pool, hmacKey, claim.rawClaim, subject),
    consume(pool, hmacKey, claim.rawClaim, subject),
  ]);
  assertSingleConsume(attempts, [
    "claim_intent_already_terminal",
    "reviewed_target_state_mismatch",
    "database_timeout",
  ]);
  await assertConsumedState(
    pool,
    targetAppUserId,
    [claim.claimDigest],
    [subject],
  );
}

async function rehearseSameSubjectDifferentTargetsRace(pool, hmacKey) {
  const targetIds = [await insertAppUser(pool), await insertAppUser(pool)];
  const claims = [
    await insertIntent(pool, targetIds[0], "current"),
    await insertIntent(pool, targetIds[1], "current"),
  ];
  const subject = syntheticSubject("subject-race");

  const attempts = await Promise.allSettled([
    consume(pool, hmacKey, claims[0].rawClaim, subject),
    consume(pool, hmacKey, claims[1].rawClaim, subject),
  ]);
  assertSingleConsume(attempts, [
    "concurrent_state_conflict",
    "database_timeout",
  ]);

  const state = await readPairingState(
    pool,
    targetIds,
    claims.map(({ claimDigest }) => claimDigest),
    [subject],
  );
  assert.deepEqual(state.targetStatuses.sort(), [
    "active",
    "provisioning",
  ]);
  assert.equal(state.identityCount, 1);
  assert.equal(state.eventCount, 1);
}

async function rehearseSameTargetDifferentSubjectsRace(pool, hmacKey) {
  const targetAppUserId = await insertAppUser(pool);
  const claims = [
    await insertIntent(pool, targetAppUserId, "current"),
    await insertIntent(pool, targetAppUserId, "current"),
  ];
  const subjects = [
    syntheticSubject("target-race-a"),
    syntheticSubject("target-race-b"),
  ];

  const attempts = await Promise.allSettled([
    consume(pool, hmacKey, claims[0].rawClaim, subjects[0]),
    consume(pool, hmacKey, claims[1].rawClaim, subjects[1]),
  ]);
  assertSingleConsume(attempts, [
    "reviewed_target_state_mismatch",
    "database_timeout",
  ]);

  const state = await readPairingState(
    pool,
    [targetAppUserId],
    claims.map(({ claimDigest }) => claimDigest),
    subjects,
  );
  assert.deepEqual(state.targetStatuses, ["active"]);
  assert.equal(state.identityCount, 1);
  assert.equal(state.eventCount, 1);
}

async function rehearseTerminalInsertRollback(pool, hmacKey) {
  const targetAppUserId = await insertAppUser(pool);
  const claim = await insertIntent(pool, targetAppUserId, "current");
  const subject = syntheticSubject("rollback");

  await assertRejectionTriggerAbsent(pool);
  await pool.query(`
    create function ${REJECTION_FUNCTION}()
    returns trigger
    language plpgsql
    as $identity_pairing_rehearsal$
    begin
      raise exception 'synthetic consume event rejection';
    end;
    $identity_pairing_rehearsal$
  `);
  await pool.query(`
    create trigger ${REJECTION_TRIGGER}
    before insert on identity_pairing_intent_events
    for each row
    execute function ${REJECTION_FUNCTION}()
  `);

  try {
    await expectConsumeError(
      () => consume(pool, hmacKey, claim.rawClaim, subject),
      ["database_transaction_failed"],
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

  await assertUnconsumedState(
    pool,
    targetAppUserId,
    [claim.claimDigest],
    [subject],
  );
}

async function assertSchemaReadyAndEmpty(pool) {
  const { rows } = await pool.query(`
    select
      to_regclass('public.identity_pairing_intents')::text
        as intents_table,
      to_regclass('public.identity_pairing_intent_events')::text
        as events_table,
      (
        select hash
        from drizzle.__drizzle_migrations
        order by created_at desc
        limit 1
      ) as latest_migration_hash,
      (
        select count(*)::integer
        from identity_pairing_intents
      ) as intent_count,
      (
        select count(*)::integer
        from identity_pairing_intent_events
      ) as event_count,
      (
        select count(*)::integer
        from pg_indexes
        where schemaname = 'public'
          and indexname in (
            'auth_identities_provider_subject_unique',
            'auth_identities_active_app_user_provider_unique',
            'id_pair_intent_events_terminal_unique'
          )
      ) as required_index_count
  `);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].intents_table, "identity_pairing_intents");
  assert.equal(rows[0].events_table, "identity_pairing_intent_events");
  assert.equal(
    rows[0].latest_migration_hash,
    EXPECTED_MIGRATION_SHA256,
  );
  assert.equal(Number(rows[0].intent_count), 0);
  assert.equal(Number(rows[0].event_count), 0);
  assert.equal(Number(rows[0].required_index_count), 3);
  await assertRejectionTriggerAbsent(pool);
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

async function insertAppUser(pool, status = "provisioning") {
  const id = randomUUID();
  await pool.query(
    `
      insert into app_users (id, status, role)
      values ($1::uuid, $2, 'user')
    `,
    [id, status],
  );
  return id;
}

async function insertIntent(pool, targetAppUserId, timing) {
  const rawClaim =
    IDENTITY_BOOTSTRAP_CLAIM_POLICY.claimPrefix +
    randomBytes(
      IDENTITY_BOOTSTRAP_CLAIM_POLICY.claimEntropyBytes,
    ).toString("base64url");
  const claimDigest = digestIdentityBootstrapClaim(rawClaim);
  const clockSql =
    timing === "expired"
      ? "clock_timestamp() - interval '9 minutes', clock_timestamp() - interval '1 minute'"
      : "clock_timestamp(), clock_timestamp() + interval '9 minutes'";

  await pool.query(
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
      ) values ($1, $2::uuid, $3, $4, $5, $6, ${clockSql})
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
  return { rawClaim, claimDigest };
}

function consume(pool, hmacKey, rawClaim, subject) {
  return consumeIdentityPairingClaim({
    pool,
    rawClaim,
    verifiedSessionSubjectPort: Object.freeze({
      async read() {
        return Object.freeze({
          state: "verified",
          provider: "neon_auth",
          subject,
          verificationSource: "server_verified_session",
        });
      },
    }),
    hmacKey,
  });
}

function syntheticSubject(label) {
  return `rehearsal-${label}-${randomUUID()}`;
}

async function assertConsumedState(
  pool,
  targetAppUserId,
  claimDigests,
  subjects,
) {
  const state = await readPairingState(
    pool,
    [targetAppUserId],
    claimDigests,
    subjects,
  );
  assert.deepEqual(state.targetStatuses, ["active"]);
  assert.equal(state.identityCount, 1);
  assert.equal(state.eventCount, 1);
}

async function assertUnconsumedState(
  pool,
  targetAppUserId,
  claimDigests,
  subjects,
) {
  const state = await readPairingState(
    pool,
    [targetAppUserId],
    claimDigests,
    subjects,
  );
  assert.deepEqual(state.targetStatuses, ["provisioning"]);
  assert.equal(state.identityCount, 0);
  assert.equal(state.eventCount, 0);
}

async function readPairingState(
  pool,
  targetAppUserIds,
  claimDigests,
  subjects,
) {
  const { rows } = await pool.query(
    `
      select
        array(
          select status
          from app_users
          where id = any($1::uuid[])
          order by id
        ) as target_statuses,
        (
          select count(*)::integer
          from auth_identities
          where provider = 'neon_auth'
            and provider_subject = any($3::text[])
        ) as identity_count,
        (
          select count(*)::integer
          from identity_pairing_intent_events event
          join identity_pairing_intents intent
            on intent.id = event.identity_pairing_intent_id
          where intent.claim_digest = any($2::text[])
        ) as event_count
    `,
    [targetAppUserIds, claimDigests, subjects],
  );
  assert.equal(rows.length, 1);
  return {
    targetStatuses: rows[0].target_statuses,
    identityCount: Number(rows[0].identity_count),
    eventCount: Number(rows[0].event_count),
  };
}

function assertSingleConsume(attempts, allowedFailureCodes) {
  const fulfilled = attempts.filter(
    (attempt) =>
      attempt.status === "fulfilled" &&
      attempt.value.result === "consumed",
  );
  const rejected = attempts.filter(
    (attempt) => attempt.status === "rejected",
  );
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reason instanceof IdentityPairingConsumeError);
  assert.ok(allowedFailureCodes.includes(rejected[0].reason.code));
}

async function expectConsumeError(operation, expectedCodes) {
  await assert.rejects(
    operation,
    (error) =>
      error instanceof IdentityPairingConsumeError &&
      expectedCodes.includes(error.code),
  );
}

function safeErrorCode(error) {
  if (error instanceof IdentityPairingConsumeError) return error.code;
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    /^[A-Za-z0-9_]+$/.test(String(error.code))
  ) {
    return String(error.code);
  }
  return "rehearsal_failed";
}
