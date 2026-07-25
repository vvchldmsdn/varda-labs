import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";

import { guardIdentityPairingRehearsalTarget } from "../src/lib/deployment/identity-pairing-rehearsal-target.ts";

const CONFIRMATION = "--confirm-isolated-branch-rehearsal";
const EXPECTED_PRODUCT_ROW_COUNTS_SHA256 =
  "d1df61e199c3432c7ac56d4f2ac2ebc770de1784fa40abe39ce60b23c2456fad";
const MIGRATION = Object.freeze({
  tag: "0021_strange_sinister_six",
  createdAt: 1784991961050,
  drizzleHash:
    "2a466a9b0dbf38ffd0286e5f1e05154102be12da5ac7a6e2430aed16c8bcbec4",
});
const PAIRING_TABLES = [
  "identity_pairing_intent_events",
  "identity_pairing_intents",
];
const ALLOWED_PRODUCT_ROW_DELTAS = Object.freeze({
  app_users: 2,
  auth_identities: 2,
});

config({ path: ".env.local", quiet: true });

main().catch((error) => {
  console.error(
    JSON.stringify({
      rehearsal: "identity_pairing_isolated_branch",
      status: "failed",
      code: databaseErrorCode(error),
      message: sanitizeErrorMessage(error),
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

  const pool = new Pool({
    connectionString,
    max: 6,
  });
  pool.on("error", () => {});

  const checks = [];
  try {
    const before = await readBoundaryState(pool);
    assert.equal(
      before.productRowCountsSha256,
      EXPECTED_PRODUCT_ROW_COUNTS_SHA256,
      "The isolated branch does not match the reviewed Production row counts.",
    );
    assert.deepEqual(before.pairingRows, {
      identity_pairing_intent_events: 0,
      identity_pairing_intents: 0,
    });
    await assertReviewedMigration(pool);

    await runRolledBackCase(pool, "valid_consume", async (client) => {
      const userId = await insertAppUser(client);
      const identityId = await insertIdentity(client, userId, "neon_auth");
      const intentId = await insertIntent(client, userId, "valid");
      await insertConsumedEvent(client, intentId, identityId, "valid");
      const { rows } = await client.query(
        `select occurred_at
           from identity_pairing_intent_events
          where identity_pairing_intent_id = $1`,
        [intentId],
      );
      assert.equal(rows.length, 1);
      assert.ok(rows[0].occurred_at);
    });
    checks.push("valid_consume");

    await runRolledBackCase(pool, "temporal_boundaries", async (client) => {
      const userId = await insertAppUser(client);
      const identityId = await insertIdentity(client, userId, "neon_auth");
      for (const mode of ["future", "expired"]) {
        const intentId = await insertIntent(client, userId, mode);
        await expectDatabaseError(
          client,
          () =>
            insertConsumedEvent(
              client,
              intentId,
              identityId,
              `temporal-${mode}`,
            ),
          "23514",
          "not valid at database time",
        );
      }
    });
    checks.push("not_yet_valid_and_expired");

    await runRolledBackCase(
      pool,
      "target_and_provider_mismatch",
      async (client) => {
        const targetUserId = await insertAppUser(client);
        const otherUserId = await insertAppUser(client);
        const otherUserIdentityId = await insertIdentity(
          client,
          otherUserId,
          "neon_auth",
        );
        const otherProviderIdentityId = await insertIdentity(
          client,
          targetUserId,
          "other_auth",
        );

        const targetMismatchIntent = await insertIntent(
          client,
          targetUserId,
          "valid",
        );
        await expectDatabaseError(
          client,
          () =>
            insertConsumedEvent(
              client,
              targetMismatchIntent,
              otherUserIdentityId,
              "target-mismatch",
            ),
          "23514",
          "does not match pairing intent",
        );

        const providerMismatchIntent = await insertIntent(
          client,
          targetUserId,
          "valid",
        );
        await expectDatabaseError(
          client,
          () =>
            insertConsumedEvent(
              client,
              providerMismatchIntent,
              otherProviderIdentityId,
              "provider-mismatch",
            ),
          "23514",
          "does not match pairing intent",
        );
      },
    );
    checks.push("target_and_provider_mismatch");

    await runRolledBackCase(
      pool,
      "terminal_and_identity_immutability",
      async (client) => {
        const userId = await insertAppUser(client);
        const replacementUserId = await insertAppUser(client);
        const identityId = await insertIdentity(
          client,
          userId,
          "neon_auth",
        );
        const intentId = await insertIntent(client, userId, "valid");
        await insertConsumedEvent(
          client,
          intentId,
          identityId,
          "immutable",
        );

        await expectDatabaseError(
          client,
          () =>
            client.query(
              `update auth_identities
                  set app_user_id = $1
                where id = $2`,
              [replacementUserId, identityId],
            ),
          "23514",
          "owner, provider, and provider subject are immutable",
        );
        await expectDatabaseError(
          client,
          () =>
            client.query(
              `update auth_identities
                  set provider = 'other_auth'
                where id = $1`,
              [identityId],
            ),
          "23514",
          "owner, provider, and provider subject are immutable",
        );
        await expectDatabaseError(
          client,
          () =>
            client.query(
              `update auth_identities
                  set provider_subject = $1
                where id = $2`,
              [syntheticSubject("immutable-update"), identityId],
            ),
          "23514",
          "owner, provider, and provider subject are immutable",
        );
        await expectDatabaseError(
          client,
          () =>
            client.query(
              `insert into identity_pairing_intent_events (
                 identity_pairing_intent_id,
                 event_type
               ) values ($1, 'revoked')`,
              [intentId],
            ),
          "23505",
          "id_pair_intent_events_terminal_unique",
        );
      },
    );
    checks.push("immutable_consumed_tuple_and_duplicate_terminal");

    await runRolledBackCase(pool, "append_only", async (client) => {
      const userId = await insertAppUser(client);
      const identityId = await insertIdentity(client, userId, "neon_auth");
      const intentId = await insertIntent(client, userId, "valid");
      const eventId = await insertConsumedEvent(
        client,
        intentId,
        identityId,
        "append-only",
      );

      for (const operation of [
        () =>
          client.query(
            `update identity_pairing_intents
                set authority_policy_id = authority_policy_id
              where id = $1`,
            [intentId],
          ),
        () =>
          client.query(
            "delete from identity_pairing_intents where id = $1",
            [intentId],
          ),
        () => client.query("truncate identity_pairing_intents cascade"),
        () =>
          client.query(
            `update identity_pairing_intent_events
                set event_type = event_type
              where id = $1`,
            [eventId],
          ),
        () =>
          client.query(
            "delete from identity_pairing_intent_events where id = $1",
            [eventId],
          ),
        () => client.query("truncate identity_pairing_intent_events"),
      ]) {
        await expectDatabaseError(
          client,
          operation,
          "P0001",
          "identity pairing evidence is append-only",
        );
      }
    });
    checks.push("append_only_update_delete_truncate");

    await runRolledBackCase(pool, "deferred_constraint", async (client) => {
      const targetUserId = await insertAppUser(client);
      const otherUserId = await insertAppUser(client);
      const identityId = await insertIdentity(
        client,
        otherUserId,
        "neon_auth",
      );
      const intentId = await insertIntent(client, targetUserId, "valid");

      await client.query(
        'set constraints "id_pair_intent_events_identity_match" deferred',
      );
      await insertConsumedEvent(
        client,
        intentId,
        identityId,
        "deferred",
      );
      const { rows } = await client.query(
        `select count(*)::int as row_count
           from identity_pairing_intent_events
          where identity_pairing_intent_id = $1`,
        [intentId],
      );
      assert.equal(Number(rows[0].row_count), 1);

      try {
        await client.query(
          'set constraints "id_pair_intent_events_identity_match" immediate',
        );
        assert.fail("Deferred mismatch unexpectedly became immediate.");
      } catch (error) {
        assertDatabaseError(
          error,
          "23514",
          "does not match pairing intent",
        );
      }
    });
    checks.push("deferred_constraint_is_enforced");

    const afterRolledBackCases = await readBoundaryState(pool);
    assert.deepEqual(
      afterRolledBackCases,
      before,
      "Rolled-back behavior checks changed the isolated branch.",
    );

    const concurrencyFixtures = await createConcurrencyFixtures(pool);
    await runLockWaitExpiry(pool, concurrencyFixtures.lockWait);
    checks.push("lock_wait_expiry_uses_database_clock");
    await runConsumeRebindRace(pool, concurrencyFixtures.consumeRebind);
    checks.push("two_connection_consume_rebind_race");

    const after = await readBoundaryState(pool);
    assertAllowedProductRowDeltas(before.productRowCounts, after.productRowCounts);
    assert.deepEqual(after.pairingRows, {
      identity_pairing_intent_events: 1,
      identity_pairing_intents: 2,
    });

    console.log(
      JSON.stringify(
        {
          rehearsal: "identity_pairing_isolated_branch",
          status: "passed",
          target,
          migration: MIGRATION,
          syntheticOnly: true,
          productionDatabaseWrites: 0,
          isolatedBranchSyntheticRowsCommitted: true,
          checks,
          productRowCountsSha256Before:
            before.productRowCountsSha256,
          allowedProductRowDeltas: ALLOWED_PRODUCT_ROW_DELTAS,
          pairingRowsAfter: after.pairingRows,
          isolatedBranchDeletionRequired: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

async function runRolledBackCase(pool, name, callback) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local lock_timeout = '5s'");
    await client.query("set local statement_timeout = '15s'");
    await callback(client);
  } catch (error) {
    throw new Error(`Rolled-back rehearsal case failed: ${name}`, {
      cause: error,
    });
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
}

async function createConcurrencyFixtures(pool) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const lockWaitUserId = await insertAppUser(client);
    const lockWaitIdentityId = await insertIdentity(
      client,
      lockWaitUserId,
      "neon_auth",
    );
    const lockWaitIntentId = await insertIntent(
      client,
      lockWaitUserId,
      "short",
    );

    const raceUserId = await insertAppUser(client);
    const raceIdentityId = await insertIdentity(
      client,
      raceUserId,
      "neon_auth",
    );
    const raceIntentId = await insertIntent(client, raceUserId, "valid");
    await client.query("commit");

    return {
      lockWait: {
        identityId: lockWaitIdentityId,
        intentId: lockWaitIntentId,
      },
      consumeRebind: {
        identityId: raceIdentityId,
        intentId: raceIntentId,
      },
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function runLockWaitExpiry(pool, fixture) {
  const locker = await pool.connect();
  const consumer = await pool.connect();
  try {
    await locker.query("begin");
    await consumer.query("begin");
    await consumer.query("set local lock_timeout = '10s'");
    await consumer.query("set local statement_timeout = '15s'");
    await locker.query(
      "select id from auth_identities where id = $1 for update",
      [fixture.identityId],
    );

    let settled = false;
    const consume = insertConsumedEvent(
      consumer,
      fixture.intentId,
      fixture.identityId,
      "lock-wait-expiry",
    ).finally(() => {
      settled = true;
    });
    await delay(250);
    assert.equal(settled, false, "Consume did not wait on the identity lock.");
    await delay(5_250);
    await locker.query("commit");

    try {
      await consume;
      assert.fail("Expired consume unexpectedly committed after lock wait.");
    } catch (error) {
      assertDatabaseError(
        error,
        "23514",
        "not valid at database time",
      );
    }
  } finally {
    await locker.query("rollback").catch(() => {});
    await consumer.query("rollback").catch(() => {});
    locker.release();
    consumer.release();
  }
}

async function runConsumeRebindRace(pool, fixture) {
  const consumer = await pool.connect();
  const rebinder = await pool.connect();
  const originalSubject = await readIdentitySubject(
    consumer,
    fixture.identityId,
  );
  try {
    await consumer.query("begin");
    await rebinder.query("begin");
    await rebinder.query("set local lock_timeout = '10s'");
    await rebinder.query("set local statement_timeout = '15s'");

    await insertConsumedEvent(
      consumer,
      fixture.intentId,
      fixture.identityId,
      "consume-rebind-race",
    );

    let settled = false;
    const rebind = rebinder
      .query(
        `update auth_identities
            set provider_subject = $1
          where id = $2`,
        [syntheticSubject("race-update"), fixture.identityId],
      )
      .finally(() => {
        settled = true;
      });
    await delay(250);
    assert.equal(settled, false, "Rebind did not wait on the consume lock.");
    await consumer.query("commit");

    try {
      await rebind;
      assert.fail("Rebind unexpectedly committed after consume.");
    } catch (error) {
      assertDatabaseError(
        error,
        "23514",
        "owner, provider, and provider subject are immutable",
      );
    }
    await rebinder.query("rollback");

    assert.equal(
      await readIdentitySubject(consumer, fixture.identityId),
      originalSubject,
      "The consume/rebind race changed the provider subject.",
    );
  } finally {
    await consumer.query("rollback").catch(() => {});
    await rebinder.query("rollback").catch(() => {});
    consumer.release();
    rebinder.release();
  }
}

async function insertAppUser(client) {
  const { rows } = await client.query(
    `insert into app_users (status, role)
     values ('provisioning', 'user')
     returning id`,
  );
  return rows[0].id;
}

async function insertIdentity(client, appUserId, provider) {
  const { rows } = await client.query(
    `insert into auth_identities (
       app_user_id,
       provider,
       provider_subject
     ) values ($1, $2, $3)
     returning id`,
    [appUserId, provider, syntheticSubject(provider)],
  );
  return rows[0].id;
}

async function insertIntent(client, targetAppUserId, mode) {
  const windows = {
    valid: ["clock_timestamp() - interval '1 minute'", "clock_timestamp() + interval '8 minutes'"],
    future: ["clock_timestamp() + interval '1 minute'", "clock_timestamp() + interval '2 minutes'"],
    expired: ["clock_timestamp() - interval '2 minutes'", "clock_timestamp() - interval '1 minute'"],
    short: ["clock_timestamp() - interval '1 second'", "clock_timestamp() + interval '5 seconds'"],
  };
  const window = windows[mode];
  assert.ok(window, `Unsupported intent time mode: ${mode}`);
  const claimDigest = digest("bootstrap-claim-sha256-v1", randomUUID());
  const { rows } = await client.query(
    `insert into identity_pairing_intents (
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
       $1,
       'neon_auth',
       'bootstrap_claim_sha256_v1',
       $2,
       'single_provisioning_user_explicit_review_v1',
       ${window[0]},
       ${window[1]}
     )
     returning id`,
    [targetAppUserId, claimDigest],
  );
  return rows[0].id;
}

async function insertConsumedEvent(client, intentId, identityId, label) {
  const { rows } = await client.query(
    `insert into identity_pairing_intent_events (
       identity_pairing_intent_id,
       event_type,
       auth_identity_id,
       subject_binding_version,
       subject_binding,
       identity_link_planner_policy_id,
       identity_link_plan_binding_version,
       identity_link_plan_binding
     ) values (
       $1,
       'consumed',
       $2,
       'provider_subject_hmac_sha256_v1',
       $3,
       'initial_identity_link_planner_v1',
       'identity_link_plan_hmac_sha256_v1',
       $4
     )
     returning id`,
    [
      intentId,
      identityId,
      digest("hmac-sha256-v1", `${label}:subject`),
      digest(
        "identity-link-plan-hmac-sha256-v1",
        `${label}:identity-link-plan`,
      ),
    ],
  );
  return rows[0].id;
}

async function expectDatabaseError(
  client,
  operation,
  expectedCode,
  expectedMessage,
) {
  const savepoint = `expected_${randomUUID().replaceAll("-", "")}`;
  await client.query(`savepoint ${savepoint}`);
  try {
    await operation();
    assert.fail(`Expected PostgreSQL error ${expectedCode}.`);
  } catch (error) {
    assertDatabaseError(error, expectedCode, expectedMessage);
  } finally {
    await client.query(`rollback to savepoint ${savepoint}`);
    await client.query(`release savepoint ${savepoint}`);
  }
}

function assertDatabaseError(error, expectedCode, expectedMessage) {
  assert.equal(
    databaseErrorCode(error),
    expectedCode,
    `Unexpected PostgreSQL error: ${sanitizeErrorMessage(error)}`,
  );
  assert.match(
    sanitizeErrorMessage(error),
    new RegExp(escapeRegExp(expectedMessage), "i"),
  );
}

async function assertReviewedMigration(pool) {
  const { rows } = await pool.query(
    `select hash, created_at::text as created_at
       from drizzle.__drizzle_migrations
      where created_at = $1`,
    [MIGRATION.createdAt],
  );
  assert.equal(rows.length, 1, "Reviewed 0021 ledger entry is missing.");
  assert.equal(String(rows[0].hash), MIGRATION.drizzleHash);
}

async function readBoundaryState(pool) {
  const { rows: tables } = await pool.query(
    `select table_name
       from information_schema.tables
      where table_schema = 'public'
        and table_type = 'BASE TABLE'
      order by table_name`,
  );
  const publicTables = tables.map(({ table_name }) => String(table_name));
  for (const table of PAIRING_TABLES) {
    assert.ok(publicTables.includes(table), `Missing pairing table: ${table}`);
  }

  const productRowCounts = [];
  for (const table of publicTables.filter(
    (table) => !PAIRING_TABLES.includes(table),
  )) {
    assert.match(table, /^[a-z0-9_]+$/);
    const { rows } = await pool.query(
      `select count(*)::int as row_count from "${table}"`,
    );
    productRowCounts.push({
      table,
      rowCount: Number(rows[0].row_count),
    });
  }

  const pairingRows = {};
  for (const table of PAIRING_TABLES) {
    const { rows } = await pool.query(
      `select count(*)::int as row_count from "${table}"`,
    );
    pairingRows[table] = Number(rows[0].row_count);
  }

  return {
    productRowCounts,
    productRowCountsSha256: createHash("sha256")
      .update(JSON.stringify(productRowCounts))
      .digest("hex"),
    pairingRows,
  };
}

function assertAllowedProductRowDeltas(before, after) {
  assert.deepEqual(
    before.map(({ table }) => table),
    after.map(({ table }) => table),
  );
  for (let index = 0; index < before.length; index += 1) {
    const expectedDelta = ALLOWED_PRODUCT_ROW_DELTAS[before[index].table] ?? 0;
    assert.equal(
      after[index].rowCount - before[index].rowCount,
      expectedDelta,
      `Unexpected row delta for ${before[index].table}.`,
    );
  }
}

async function readIdentitySubject(client, identityId) {
  const { rows } = await client.query(
    "select provider_subject from auth_identities where id = $1",
    [identityId],
  );
  assert.equal(rows.length, 1);
  return String(rows[0].provider_subject);
}

function syntheticSubject(label) {
  return `synthetic:${label}:${randomUUID()}`;
}

function digest(prefix, value) {
  return `${prefix}:${createHash("sha256").update(value).digest("hex")}`;
}

function databaseErrorCode(error) {
  if (error && typeof error === "object" && "code" in error) {
    return String(error.code);
  }
  if (
    error &&
    typeof error === "object" &&
    "cause" in error &&
    error.cause
  ) {
    return databaseErrorCode(error.cause);
  }
  return "unknown";
}

function sanitizeErrorMessage(error) {
  const message =
    error instanceof Error ? error.message : String(error ?? "unknown error");
  return message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[database-url]");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
