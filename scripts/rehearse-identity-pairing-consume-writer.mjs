import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
import { readMigrationFiles } from "drizzle-orm/migrator";

import {
  guardIdentityPairingRehearsalTarget,
} from "../src/lib/deployment/identity-pairing-rehearsal-target.ts";
import {
  planPreviewMigrations,
} from "../src/lib/deployment/preview-migration-plan.ts";
import {
  digestIdentityBootstrapClaim,
  IDENTITY_BOOTSTRAP_CLAIM_POLICY,
} from "../src/lib/identity-bootstrap-claim.ts";
import {
  consumeIdentityPairingClaim,
  IdentityPairingConsumeError,
} from "./lib/identity-pairing-consume-writer.mjs";
import {
  createIdentityPairingRehearsalEvidence,
} from "./lib/identity-pairing-rehearsal-evidence.mjs";
import {
  runIdentityPairingCatalogAuditProcess,
} from "./lib/identity-pairing-catalog-preflight.mjs";

const CONFIRMATION =
  "--confirm-isolated-identity-pairing-rehearsal";
const EXPECTED_MIGRATION_SHA256 =
  "e3590cbe4e787bb32ca6fa9fdb27ae6f50295701dcd22bfb9b3edd8997fb1553";
const EXPECTED_MIGRATION_TAG = "0021_strange_sinister_six";
const MIGRATIONS_FOLDER = resolve("drizzle");
const REJECTION_FUNCTION =
  "identity_pairing_rehearsal_reject_consume_event";
const REJECTION_TRIGGER =
  "identity_pairing_rehearsal_reject_consume_event";

config({ path: ".env.local", quiet: true });

const rehearsalEvidence = createIdentityPairingRehearsalEvidence();

main(rehearsalEvidence).catch((error) => {
  console.error(JSON.stringify(rehearsalEvidence.failure(error)));
  process.exitCode = 1;
});

async function main(evidence) {
  if (
    process.argv.slice(2).length !== 1 ||
    process.argv.slice(2)[0] !== CONFIRMATION
  ) {
    throw new Error(
      `Disposable rehearsal requires the exact ${CONFIRMATION} argument.`,
    );
  }

  const target = guardIdentityPairingRehearsalTarget(process.env);
  evidence.complete("target_guard");
  const connectionString =
    process.env.IDENTITY_PAIRING_REHEARSAL_DATABASE_URL_UNPOOLED;
  assert.ok(connectionString, "The guarded rehearsal URL is unavailable.");

  evidence.begin("catalog_preflight");
  assertReviewedCatalogPreflight();
  evidence.complete("catalog_preflight");

  const hmacKey = randomBytes(32);
  const checks = [];
  let pool = null;

  evidence.begin("pool_readiness");
  try {
    pool = new Pool({ connectionString, max: 8 });
    pool.on("error", () => {});
    await assertPoolReady(pool);
    evidence.markPoolReady();
    evidence.complete("pool_readiness");

    evidence.begin("schema_empty");
    await assertSchemaReadyAndEmpty(pool);
    evidence.complete("schema_empty");

    evidence.begin("successful_consume");
    evidence.markDisposableBranchDmlAttempted();
    await rehearseSuccessfulConsume(pool, hmacKey);
    checks.push("successful_consume");
    evidence.complete("successful_consume");

    evidence.begin("expired_claim");
    await rehearseExpiredClaim(pool, hmacKey);
    checks.push("expired_claim");
    evidence.complete("expired_claim");

    evidence.begin("lock_wait_expiry");
    await rehearseLockWaitExpiry(pool, hmacKey);
    checks.push("lock_wait_expiry");
    evidence.complete("lock_wait_expiry");

    evidence.begin("duplicate_consume");
    await rehearseDuplicateConsume(pool, hmacKey);
    checks.push("duplicate_consume");
    evidence.complete("duplicate_consume");

    evidence.begin("subject_collision");
    await rehearseSubjectCollision(pool, hmacKey);
    checks.push("subject_collision");
    evidence.complete("subject_collision");

    evidence.begin("target_drift");
    await rehearseTargetDrift(pool, hmacKey);
    checks.push("target_drift");
    evidence.complete("target_drift");

    evidence.begin("same_claim_race");
    await rehearseSameClaimRace(pool, hmacKey);
    checks.push("same_claim_race");
    evidence.complete("same_claim_race");

    evidence.begin("same_subject_different_targets_race");
    await rehearseSameSubjectDifferentTargetsRace(pool, hmacKey);
    checks.push("same_subject_different_targets_race");
    evidence.complete("same_subject_different_targets_race");

    evidence.begin("same_target_different_subjects_race");
    await rehearseSameTargetDifferentSubjectsRace(pool, hmacKey);
    checks.push("same_target_different_subjects_race");
    evidence.complete("same_target_different_subjects_race");

    evidence.begin("terminal_insert_full_rollback");
    await rehearseTerminalInsertRollback(pool, hmacKey);
    checks.push("terminal_insert_full_rollback");
    evidence.complete("terminal_insert_full_rollback");

    console.log(
      JSON.stringify({
        rehearsal: "identity_pairing_atomic_consume_disposable_branch",
        status: "passed",
        checks,
        ...evidence.success(),
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
    if (pool !== null) {
      await pool.end();
    }
  }
}

async function assertPoolReady(pool) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      "select 1::integer as rehearsal_pool_ready",
    );
    assert.equal(result.rowCount, 1);
    assert.equal(Number(result.rows[0]?.rehearsal_pool_ready), 1);
  } finally {
    client.release();
  }
}

function assertReviewedCatalogPreflight() {
  const result = runIdentityPairingCatalogAuditProcess();
  if (result.status === "failed") {
    throw catalogPreflightError(result.code);
  }

  try {
    assertReviewedCatalogEvidence(result.evidence);
  } catch {
    throw catalogPreflightError("catalog_preflight_evidence_invalid");
  }
}

function assertReviewedCatalogEvidence(evidence) {
  assert.equal(evidence.status, "passed");
  assert.equal(evidence.state, "present");
  assert.equal(evidence.readOnly, true);
  assert.equal(evidence.databaseWrites, 0);
  assert.deepEqual(evidence.migrationPlan?.pendingTags, []);
  assert.deepEqual(evidence.pairingRows, {
    intents: 0,
    events: 0,
  });
}

function catalogPreflightError(code) {
  const error = new Error("The reviewed identity pairing catalog audit failed.");
  Object.defineProperty(error, "code", {
    configurable: false,
    enumerable: true,
    value: code,
    writable: false,
  });
  return error;
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

async function rehearseLockWaitExpiry(pool, hmacKey) {
  const targetAppUserId = await insertAppUser(pool);
  const claim = await insertIntent(pool, targetAppUserId, "short_lived");
  const subject = syntheticSubject("lock-wait-expiry");
  const blocker = await pool.connect();
  let blockerTransactionOpen = false;
  let consumeObservation = null;

  try {
    await blocker.query("begin");
    blockerTransactionOpen = true;
    const { rows } = await blocker.query(
      `
        select
          expires_at,
          clock_timestamp() as locked_at,
          pg_backend_pid()::integer as blocker_pid
        from identity_pairing_intents
        where claim_digest = $1
        for update
      `,
      [claim.claimDigest],
    );
    assert.equal(rows.length, 1);
    assert.ok(
      new Date(rows[0].expires_at).getTime() -
        new Date(rows[0].locked_at).getTime() >=
        750,
    );
    const blockerBackendPid = Number(rows[0].blocker_pid);
    assert.ok(
      Number.isInteger(blockerBackendPid) && blockerBackendPid > 0,
    );

    const lockObservation = createIntentLockObservedPool(pool);
    consumeObservation = expectConsumeError(
      () =>
        consume(
          lockObservation.pool,
          hmacKey,
          claim.rawClaim,
          subject,
        ),
      ["claim_intent_expired"],
    ).then(
      () => null,
      (error) => error,
    );

    const writerBackendPid = await withTimeout(
      lockObservation.writerBackendPid,
      1_000,
      "The writer database session was not established.",
    );
    await withTimeout(
      lockObservation.intentLockDispatched,
      1_000,
      "The writer did not dispatch the intent row lock.",
    );
    const lockWaitObservedAt = await assertBackendWaitingOnLock(
      pool,
      writerBackendPid,
      blockerBackendPid,
    );
    assert.ok(
      new Date(rows[0].expires_at).getTime() -
        new Date(lockWaitObservedAt).getTime() >
        0,
    );
    await waitUntilAfterDatabaseExpiry(pool, rows[0].expires_at);

    await blocker.query("commit");
    blockerTransactionOpen = false;

    const consumeFailure = await consumeObservation;
    if (consumeFailure) throw consumeFailure;
  } finally {
    if (blockerTransactionOpen) {
      try {
        await blocker.query("rollback");
      } catch {
        // Preserve the original rehearsal failure.
      }
    }
    blocker.release();
    if (consumeObservation && blockerTransactionOpen) {
      await consumeObservation;
    }
  }

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
  await assertExactMigrationLedger(pool);

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
  assert.equal(Number(rows[0].intent_count), 0);
  assert.equal(Number(rows[0].event_count), 0);
  assert.equal(Number(rows[0].required_index_count), 3);
  await assertRejectionTriggerAbsent(pool);
}

async function assertExactMigrationLedger(pool) {
  const localMigrations = readLocalMigrations();
  const expectedLatest = localMigrations.at(-1);
  assert.equal(expectedLatest?.tag, EXPECTED_MIGRATION_TAG);
  assert.equal(expectedLatest?.sha256, EXPECTED_MIGRATION_SHA256);

  const { rows } = await pool.query(`
    select
      created_at as "createdAt",
      hash as sha256
    from drizzle.__drizzle_migrations
    order by created_at asc
  `);
  const plan = planPreviewMigrations({
    localMigrations,
    appliedMigrations: rows,
    allowedPendingMigrations: [],
  });
  assert.equal(plan.appliedCount, localMigrations.length);
  assert.equal(plan.localCount, localMigrations.length);
  assert.equal(plan.latestAppliedTag, EXPECTED_MIGRATION_TAG);
  assert.deepEqual(plan.pendingTags, []);
}

function readLocalMigrations() {
  const journal = JSON.parse(
    readFileSync(
      join(MIGRATIONS_FOLDER, "meta", "_journal.json"),
      "utf8",
    ),
  );
  const migrations = readMigrationFiles({
    migrationsFolder: MIGRATIONS_FOLDER,
  });
  assert.equal(journal.entries.length, migrations.length);

  return journal.entries.map((entry, index) => ({
    tag: entry.tag,
    createdAt: entry.when,
    sha256: migrations[index].hash,
  }));
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
      : timing === "short_lived"
        ? "clock_timestamp(), clock_timestamp() + interval '1.25 seconds'"
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

function delay(milliseconds) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds);
  });
}

function createIntentLockObservedPool(pool) {
  const writerBackendPid = deferred();
  const intentLockDispatched = deferred();

  return {
    pool: Object.freeze({
      async connect() {
        let client;
        try {
          client = await pool.connect();
          const { rows } = await client.query(`
            select pg_backend_pid()::integer as backend_pid
          `);
          const backendPid = Number(rows[0]?.backend_pid);
          assert.ok(Number.isInteger(backendPid) && backendPid > 0);
          writerBackendPid.resolve(backendPid);
        } catch (error) {
          writerBackendPid.reject(error);
          if (client) client.release();
          throw error;
        }

        return Object.freeze({
          query(query, parameters) {
            const pendingQuery = client.query(query, parameters);
            if (isIntentLockQuery(query)) {
              intentLockDispatched.resolve();
            }
            return pendingQuery;
          },
          release() {
            client.release();
          },
        });
      },
    }),
    writerBackendPid: writerBackendPid.promise,
    intentLockDispatched: intentLockDispatched.promise,
  };
}

function isIntentLockQuery(query) {
  return (
    typeof query === "string" &&
    /\bfrom identity_pairing_intents\b/i.test(query) &&
    /\bfor update\b/i.test(query)
  );
}

async function assertBackendWaitingOnLock(
  pool,
  backendPid,
  blockerBackendPid,
) {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query(
      `
        select
          state,
          wait_event_type,
          $2::integer = any(pg_blocking_pids(pid))
            as blocked_by_expected_session,
          clock_timestamp() as observed_at
        from pg_stat_activity
        where pid = $1
      `,
      [backendPid, blockerBackendPid],
    );
    if (
      rows[0]?.state === "active" &&
      rows[0]?.wait_event_type === "Lock" &&
      rows[0]?.blocked_by_expected_session === true
    ) {
      return rows[0].observed_at;
    }
    await delay(25);
  }
  throw new Error("The writer was not observed waiting on a DB lock.");
}

async function waitUntilAfterDatabaseExpiry(pool, expiresAt) {
  const { rows } = await pool.query(
    `
      select greatest(
        0,
        ceil(
          extract(epoch from ($1::timestamptz - clock_timestamp())) *
          1000
        )
      )::integer as remaining_ms
    `,
    [expiresAt],
  );
  const remainingMilliseconds = Number(rows[0]?.remaining_ms);
  assert.ok(
    Number.isInteger(remainingMilliseconds) &&
      remainingMilliseconds >= 0 &&
      remainingMilliseconds <= 1_250,
  );
  await delay(remainingMilliseconds + 100);
}

function deferred() {
  let resolveDeferred;
  let rejectDeferred;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolveDeferred = resolvePromise;
    rejectDeferred = rejectPromise;
  });
  return {
    promise,
    resolve: resolveDeferred,
    reject: rejectDeferred,
  };
}

async function withTimeout(promise, milliseconds, message) {
  let timeoutId;
  const timeout = new Promise((_, rejectTimeout) => {
    timeoutId = setTimeout(
      () => rejectTimeout(new Error(message)),
      milliseconds,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
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
