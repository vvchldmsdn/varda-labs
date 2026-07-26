import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";

import { guardIdentityPairingRehearsalTarget } from "../src/lib/deployment/identity-pairing-rehearsal-target.ts";
import {
  createOneTimeIdentityBootstrapClaim,
} from "./lib/identity-bootstrap-claim-issuer.mjs";
import {
  consumeIdentityPairingClaim,
  IdentityPairingConsumeError,
} from "./lib/identity-pairing-consume-writer.mjs";

const CONFIRMATION =
  "--confirm-isolated-branch-consume-writer-rehearsal";

config({ path: ".env.local", quiet: true });

main().catch((error) => {
  console.error(
    JSON.stringify({
      rehearsal: "identity_pairing_consume_writer_isolated_branch",
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
      `Isolated rehearsal requires the exact ${CONFIRMATION} argument.`,
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

    await rehearseLockRace(pool, hmacKey);
    checks.push("lock_race");

    await rehearseTerminalInsertRollback(pool, hmacKey);
    checks.push("terminal_insert_full_rollback");

    console.log(
      JSON.stringify({
        rehearsal: "identity_pairing_consume_writer_isolated_branch",
        status: "passed",
        checks,
        writerTransactions: 9,
        successfulConsumes: 3,
        productionDatabaseWrites: 0,
        branchFingerprint: target.branchFingerprint,
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

  const result = await consumeIdentityPairingClaim({
    pool,
    rawClaim: claim.rawClaim,
    verifiedSubjectPort: syntheticSubjectPort(subject),
    hmacKey,
  });
  assert.equal(result.result, "consumed");
  await assertConsumedState(pool, targetAppUserId, claim.claimDigest, subject);
}

async function rehearseExpiredClaim(pool, hmacKey) {
  const targetAppUserId = await insertAppUser(pool);
  const claim = await insertIntent(pool, targetAppUserId, "expired");
  const subject = syntheticSubject("expired");

  await expectConsumeError(
    () =>
      consumeIdentityPairingClaim({
        pool,
        rawClaim: claim.rawClaim,
        verifiedSubjectPort: syntheticSubjectPort(subject),
        hmacKey,
      }),
    "claim_intent_expired",
  );
  await assertUnconsumedState(
    pool,
    targetAppUserId,
    claim.claimDigest,
    subject,
  );
}

async function rehearseDuplicateConsume(pool, hmacKey) {
  const targetAppUserId = await insertAppUser(pool);
  const claim = await insertIntent(pool, targetAppUserId, "current");
  const subject = syntheticSubject("duplicate");
  const input = {
    pool,
    rawClaim: claim.rawClaim,
    verifiedSubjectPort: syntheticSubjectPort(subject),
    hmacKey,
  };

  await consumeIdentityPairingClaim(input);
  await expectConsumeError(
    () =>
      consumeIdentityPairingClaim({
        ...input,
        verifiedSubjectPort: syntheticSubjectPort(subject),
      }),
    "claim_intent_already_terminal",
  );
  await assertConsumedState(pool, targetAppUserId, claim.claimDigest, subject);
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
    () =>
      consumeIdentityPairingClaim({
        pool,
        rawClaim: claim.rawClaim,
        verifiedSubjectPort: syntheticSubjectPort(subject),
        hmacKey,
      }),
    "identity_link_provider_subject_collision",
  );
  const state = await readPairingState(
    pool,
    targetAppUserId,
    claim.claimDigest,
    subject,
  );
  assert.equal(state.target_status, "provisioning");
  assert.equal(Number(state.target_identity_count), 0);
  assert.equal(Number(state.event_count), 0);
}

async function rehearseTargetDrift(pool, hmacKey) {
  const targetAppUserId = await insertAppUser(pool);
  const claim = await insertIntent(pool, targetAppUserId, "current");
  const subject = syntheticSubject("target-drift");
  await pool.query(
    `update app_users
        set status = 'disabled',
            updated_at = clock_timestamp()
      where id = $1::uuid`,
    [targetAppUserId],
  );

  await expectConsumeError(
    () =>
      consumeIdentityPairingClaim({
        pool,
        rawClaim: claim.rawClaim,
        verifiedSubjectPort: syntheticSubjectPort(subject),
        hmacKey,
      }),
    "reviewed_target_state_mismatch",
  );
  const state = await readPairingState(
    pool,
    targetAppUserId,
    claim.claimDigest,
    subject,
  );
  assert.equal(state.target_status, "disabled");
  assert.equal(Number(state.target_identity_count), 0);
  assert.equal(Number(state.event_count), 0);
}

async function rehearseLockRace(pool, hmacKey) {
  const targetAppUserId = await insertAppUser(pool);
  const claim = await insertIntent(pool, targetAppUserId, "current");
  const subject = syntheticSubject("race");

  const attempts = await Promise.allSettled(
    [1, 2].map(() =>
      consumeIdentityPairingClaim({
        pool,
        rawClaim: claim.rawClaim,
        verifiedSubjectPort: syntheticSubjectPort(subject),
        hmacKey,
      }),
    ),
  );
  assert.equal(
    attempts.filter(
      (attempt) =>
        attempt.status === "fulfilled" &&
        attempt.value.result === "consumed",
    ).length,
    1,
  );
  const rejected = attempts.filter(
    (attempt) => attempt.status === "rejected",
  );
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reason instanceof IdentityPairingConsumeError);
  assert.ok(
    [
      "claim_intent_already_terminal",
      "reviewed_target_state_mismatch",
    ].includes(rejected[0].reason.code),
  );
  await assertConsumedState(pool, targetAppUserId, claim.claimDigest, subject);
}

async function rehearseTerminalInsertRollback(pool, hmacKey) {
  const targetAppUserId = await insertAppUser(pool);
  const claim = await insertIntent(pool, targetAppUserId, "current");
  const subject = syntheticSubject("rollback");

  await pool.query(`
    create function rehearsal_reject_pairing_consume_event()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'rehearsal terminal event rejection';
    end;
    $$
  `);
  await pool.query(`
    create trigger rehearsal_reject_pairing_consume_event
    before insert on identity_pairing_intent_events
    for each row
    execute function rehearsal_reject_pairing_consume_event()
  `);

  try {
    await expectConsumeError(
      () =>
        consumeIdentityPairingClaim({
          pool,
          rawClaim: claim.rawClaim,
          verifiedSubjectPort: syntheticSubjectPort(subject),
          hmacKey,
        }),
      "database_transaction_failed",
    );
  } finally {
    await pool.query(`
      drop trigger if exists rehearsal_reject_pairing_consume_event
      on identity_pairing_intent_events
    `);
    await pool.query(
      `drop function if exists rehearsal_reject_pairing_consume_event()`,
    );
  }

  await assertUnconsumedState(
    pool,
    targetAppUserId,
    claim.claimDigest,
    subject,
  );
}

async function assertSchemaReadyAndEmpty(pool) {
  const { rows } = await pool.query(`
    select
      to_regclass('public.identity_pairing_intents')::text as intents_table,
      to_regclass('public.identity_pairing_intent_events')::text as events_table,
      (select count(*)::int from identity_pairing_intents) as intent_count,
      (select count(*)::int from identity_pairing_intent_events) as event_count
  `);
  assert.equal(rows[0]?.intents_table, "identity_pairing_intents");
  assert.equal(rows[0]?.events_table, "identity_pairing_intent_events");
  assert.equal(Number(rows[0]?.intent_count), 0);
  assert.equal(Number(rows[0]?.event_count), 0);
}

async function insertAppUser(pool, status = "provisioning") {
  const id = randomUUID();
  await pool.query(
    `insert into app_users (id, status, role)
     values ($1::uuid, $2, 'user')`,
    [id, status],
  );
  return id;
}

async function insertIntent(pool, targetAppUserId, timing) {
  const claim = createOneTimeIdentityBootstrapClaim();
  const clockSql =
    timing === "expired"
      ? "clock_timestamp() - interval '11 minutes', clock_timestamp() - interval '1 minute'"
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
      ) values (
        'preissued_bootstrap_claim_authority_v1',
        $1::uuid,
        'neon_auth',
        'bootstrap_claim_sha256_v1',
        $2,
        'single_provisioning_user_explicit_review_v1',
        ${clockSql}
      )
    `,
    [targetAppUserId, claim.claimDigest],
  );
  return claim;
}

function syntheticSubjectPort(subject) {
  return Object.freeze({
    async use(consumer) {
      const value = await consumer(
        Object.freeze({
          provider: "neon_auth",
          subject,
          verificationSource: "server_verified_session",
        }),
      );
      return Object.freeze({ state: "verified", value });
    },
  });
}

function syntheticSubject(label) {
  return `rehearsal-${label}-${randomUUID()}`;
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
  assert.equal(state.target_status, "active");
  assert.equal(Number(state.target_identity_count), 1);
  assert.equal(Number(state.event_count), 1);
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
  assert.equal(state.target_status, "provisioning");
  assert.equal(Number(state.target_identity_count), 0);
  assert.equal(Number(state.event_count), 0);
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
        target.status as target_status,
        (
          select count(*)::int
          from auth_identities identity_row
          where identity_row.app_user_id = target.id
            and identity_row.provider = 'neon_auth'
            and identity_row.provider_subject = $3
        ) as target_identity_count,
        (
          select count(*)::int
          from identity_pairing_intent_events event
          join identity_pairing_intents intent
            on intent.id = event.identity_pairing_intent_id
          where intent.claim_digest = $2
        ) as event_count
      from app_users target
      where target.id = $1::uuid
    `,
    [targetAppUserId, claimDigest, subject],
  );
  assert.equal(rows.length, 1);
  return rows[0];
}

async function expectConsumeError(operation, expectedCode) {
  await assert.rejects(
    operation,
    (error) =>
      error instanceof IdentityPairingConsumeError &&
      error.code === expectedCode,
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
