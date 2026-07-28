import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readMigrationFiles } from "drizzle-orm/migrator";

import {
  planPreviewMigrations,
} from "../../src/lib/deployment/preview-migration-plan.ts";
import {
  buildLegacyAccountOwnershipPreflight,
  fingerprintAppUserId,
  fingerprintLegacyOwner,
} from "./legacy-account-ownership-preflight.mjs";
import {
  assignLegacyAccountsToConsumedIdentity,
  LegacyAccountOwnerAssignmentError,
} from "./legacy-account-owner-assignment-writer.mjs";
import {
  LegacyAccountOwnerAssignmentRehearsalFixtureError,
} from "./legacy-account-owner-assignment-rehearsal-evidence.mjs";

const EXPECTED_MIGRATION_SHA256 =
  "e3590cbe4e787bb32ca6fa9fdb27ae6f50295701dcd22bfb9b3edd8997fb1553";
const EXPECTED_MIGRATION_TAG = "0021_strange_sinister_six";
const EXPECTED_MIGRATION_COUNT = 22;
export const OWNER_ASSIGNMENT_REHEARSAL_ACCOUNT_COUNT = 4;
const PARTIAL_UPDATE_FUNCTION =
  "legacy_owner_assignment_rehearsal_skip_one";
const PARTIAL_UPDATE_TRIGGER =
  "legacy_owner_assignment_rehearsal_skip_one";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIGRATIONS_FOLDER = resolve(
  fileURLToPath(new URL("../../drizzle", import.meta.url)),
);

export async function assertOwnerAssignmentRehearsalPoolReady(pool) {
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

export async function assertOwnerAssignmentRehearsalCatalogPreflight(
  pool,
) {
  try {
    await assertExactMigrationLedger(pool);
    const { rows } = await pool.query(`
      select
        to_regclass('public.accounts')::text as accounts_table,
        to_regclass('public.app_users')::text as app_users_table,
        to_regclass('public.auth_identities')::text
          as auth_identities_table,
        to_regclass('public.identity_pairing_intents')::text
          as intents_table,
        to_regclass('public.identity_pairing_intent_events')::text
          as events_table,
        (select count(*)::integer from accounts) as account_count,
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
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'accounts'
            and column_name in (
              'owner_user_id',
              'canonical_owner_user_id'
            )
        ) as owner_column_count
    `);
    assert.equal(rows.length, 1);
    const catalog = rows[0];
    assert.equal(catalog.accounts_table, "accounts");
    assert.equal(catalog.app_users_table, "app_users");
    assert.equal(catalog.auth_identities_table, "auth_identities");
    assert.equal(catalog.intents_table, "identity_pairing_intents");
    assert.equal(
      catalog.events_table,
      "identity_pairing_intent_events",
    );
    assert.equal(
      Number(catalog.account_count),
      OWNER_ASSIGNMENT_REHEARSAL_ACCOUNT_COUNT,
    );
    assert.equal(Number(catalog.intent_count), 0);
    assert.equal(Number(catalog.event_count), 0);
    assert.equal(Number(catalog.owner_column_count), 2);
    await assertOwnerAssignmentTemporaryObjectsAbsent(pool);

    const baselineAccounts = await readOwnerAssignmentAccounts(pool);
    assert.equal(
      baselineAccounts.length,
      OWNER_ASSIGNMENT_REHEARSAL_ACCOUNT_COUNT,
    );
    return baselineAccounts;
  } catch (error) {
    if (
      error instanceof
      LegacyAccountOwnerAssignmentRehearsalFixtureError
    ) {
      throw error;
    }
    throw ownerAssignmentFixtureError("catalog_preflight_failed");
  }
}

export async function withOwnerAssignmentFixture(
  pool,
  baselineAccounts,
  options,
  operation,
) {
  await restoreOwnerAssignmentAccountBaseline(pool, baselineAccounts);
  const fixture = await createFixture(pool, baselineAccounts, options);
  try {
    await operation(fixture);
  } finally {
    await restoreOwnerAssignmentAccountBaseline(
      pool,
      baselineAccounts,
    );
    await assertOwnerAssignmentAccountBaseline(
      pool,
      baselineAccounts,
    );
  }
}

export function assignOwnerAssignmentFixture(pool, fixture) {
  return assignLegacyAccountsToConsumedIdentity({
    pool,
    identityPairingIntentId: fixture.intentId,
    targetAppUserSha256: fixture.targetAppUserSha256,
    legacyOwnerSha256: fixture.legacyOwnerSha256,
    candidateSetDigest: fixture.candidateSetDigest,
    eligibleSetDigest: fixture.eligibleSetDigest,
  });
}

export async function restoreOwnerAssignmentAccountBaseline(
  pool,
  baselineAccounts,
) {
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query("begin");
    transactionOpen = true;
    for (const account of baselineAccounts) {
      const result = await client.query(
        `
          update accounts
          set owner_user_id = $2,
              canonical_owner_user_id = $3::uuid,
              updated_at = clock_timestamp()
          where id = $1::uuid
          returning id
        `,
        [
          account.id,
          account.legacy_owner_user_id,
          account.canonical_owner_user_id,
        ],
      );
      assert.equal(result.rowCount, 1);
    }
    await client.query("commit");
    transactionOpen = false;
  } catch {
    if (transactionOpen) {
      try {
        await client.query("rollback");
      } catch {
        // Preserve the baseline restore failure.
      }
    }
    throw ownerAssignmentFixtureError(
      "account_baseline_restore_failed",
    );
  } finally {
    client.release();
  }
}

export async function assertOwnerAssignmentAccountBaseline(
  pool,
  baselineAccounts,
) {
  const current = await readOwnerAssignmentAccounts(pool);
  if (
    current.length !== baselineAccounts.length ||
    current.some((row, index) => {
      const baseline = baselineAccounts[index];
      return (
        row.id !== baseline.id ||
        row.legacy_owner_user_id !== baseline.legacy_owner_user_id ||
        row.canonical_owner_user_id !==
          baseline.canonical_owner_user_id
      );
    })
  ) {
    throw ownerAssignmentFixtureError("account_baseline_drift");
  }
}

export async function readOwnerAssignmentAccounts(pool) {
  const { rows } = await pool.query(`
    select
      id::text as id,
      owner_user_id as legacy_owner_user_id,
      canonical_owner_user_id::text as canonical_owner_user_id
    from accounts
    order by id
  `);
  for (const row of rows) {
    assert.match(row.id, UUID_PATTERN);
    if (row.canonical_owner_user_id !== null) {
      assert.match(row.canonical_owner_user_id, UUID_PATTERN);
    }
  }
  return rows;
}

export async function setAllOwnerAssignmentCanonicalOwners(
  pool,
  targetAppUserId,
) {
  const result = await pool.query(
    `
      update accounts
      set canonical_owner_user_id = $1::uuid,
          updated_at = clock_timestamp()
      returning id
    `,
    [targetAppUserId],
  );
  assert.equal(
    result.rowCount,
    OWNER_ASSIGNMENT_REHEARSAL_ACCOUNT_COUNT,
  );
}

export async function assertAllOwnerAssignmentAccountsOwnedBy(
  pool,
  expectedOwnerId,
) {
  const rows = await readOwnerAssignmentAccounts(pool);
  if (
    rows.length !== OWNER_ASSIGNMENT_REHEARSAL_ACCOUNT_COUNT ||
    rows.some(
      ({ canonical_owner_user_id }) =>
        canonical_owner_user_id !== expectedOwnerId,
    )
  ) {
    throw ownerAssignmentFixtureError(
      "synthetic_case_post_state_invalid",
    );
  }
}

export async function createOwnerAssignmentPartialUpdateTrigger(
  pool,
  blockedAccountId,
) {
  assert.match(blockedAccountId, UUID_PATTERN);
  await assertOwnerAssignmentTemporaryObjectsAbsent(pool);
  try {
    await pool.query(`
      create function ${PARTIAL_UPDATE_FUNCTION}()
      returns trigger
      language plpgsql
      as $legacy_owner_assignment_rehearsal$
      begin
        return null;
      end;
      $legacy_owner_assignment_rehearsal$
    `);
    await pool.query(`
      create trigger ${PARTIAL_UPDATE_TRIGGER}
      before update of canonical_owner_user_id on accounts
      for each row
      when (old.id = '${blockedAccountId}'::uuid)
      execute function ${PARTIAL_UPDATE_FUNCTION}()
    `);
  } catch {
    throw ownerAssignmentFixtureError(
      "partial_update_fixture_failed",
    );
  }
}

export async function dropOwnerAssignmentPartialUpdateObjects(pool) {
  try {
    await pool.query(`
      drop trigger if exists ${PARTIAL_UPDATE_TRIGGER} on accounts
    `);
    await pool.query(
      `drop function if exists ${PARTIAL_UPDATE_FUNCTION}()`,
    );
  } catch {
    throw ownerAssignmentFixtureError(
      "temporary_object_cleanup_failed",
    );
  }
}

export async function assertOwnerAssignmentTemporaryObjectsAbsent(
  pool,
) {
  const { rows } = await pool.query(
    `
      select
        (
          select count(*)::integer
          from pg_trigger
          where tgname = $1
            and not tgisinternal
        ) as trigger_count,
        (
          select count(*)::integer
          from pg_proc procedure
          join pg_namespace namespace
            on namespace.oid = procedure.pronamespace
          where namespace.nspname = 'public'
            and procedure.proname = $2
            and pg_get_function_identity_arguments(procedure.oid) = ''
        ) as function_count
    `,
    [PARTIAL_UPDATE_TRIGGER, PARTIAL_UPDATE_FUNCTION],
  );
  if (
    Number(rows[0]?.trigger_count) !== 0 ||
    Number(rows[0]?.function_count) !== 0
  ) {
    throw ownerAssignmentFixtureError(
      "temporary_object_cleanup_failed",
    );
  }
}

export async function expectOwnerAssignmentError(
  operation,
  expectedCode,
) {
  try {
    await operation();
  } catch (error) {
    if (isOwnerAssignmentError(error, expectedCode)) return;
    throw error;
  }
  throw ownerAssignmentFixtureError(
    "synthetic_case_post_state_invalid",
  );
}

export function isOwnerAssignmentError(error, expectedCode) {
  return (
    error instanceof LegacyAccountOwnerAssignmentError &&
    error.code === expectedCode
  );
}

export function ownerAssignmentFixtureError(code) {
  return new LegacyAccountOwnerAssignmentRehearsalFixtureError(code);
}

async function assertExactMigrationLedger(pool) {
  const localMigrations = readLocalMigrations();
  const expectedLatest = localMigrations.at(-1);
  assert.equal(localMigrations.length, EXPECTED_MIGRATION_COUNT);
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
  assert.equal(plan.appliedCount, EXPECTED_MIGRATION_COUNT);
  assert.equal(plan.localCount, EXPECTED_MIGRATION_COUNT);
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

async function createFixture(pool, baselineAccounts, options) {
  const targetAppUserId = randomUUID();
  const foreignOwnerAppUserId = options.includeForeignOwner
    ? randomUUID()
    : null;
  const authIdentityId = randomUUID();
  const intentId = randomUUID();
  const legacyOwnerValue = `rehearsal-owner-${randomUUID()}`;
  const accountIds = baselineAccounts.map(({ id }) => id);
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    await client.query("begin");
    transactionOpen = true;
    const accountUpdate = await client.query(
      `
        update accounts
        set owner_user_id = $2,
            canonical_owner_user_id = null,
            updated_at = clock_timestamp()
        where id = any($1::uuid[])
        returning id
      `,
      [accountIds, legacyOwnerValue],
    );
    assert.equal(
      accountUpdate.rowCount,
      OWNER_ASSIGNMENT_REHEARSAL_ACCOUNT_COUNT,
    );

    await client.query(
      `
        insert into app_users (id, status, role)
        values ($1::uuid, 'active', 'user')
      `,
      [targetAppUserId],
    );
    if (foreignOwnerAppUserId !== null) {
      await client.query(
        `
          insert into app_users (id, status, role)
          values ($1::uuid, 'active', 'user')
        `,
        [foreignOwnerAppUserId],
      );
    }
    await client.query(
      `
        insert into auth_identities (
          id,
          app_user_id,
          provider,
          provider_subject,
          status
        ) values ($1::uuid, $2::uuid, 'neon_auth', $3, 'active')
      `,
      [
        authIdentityId,
        targetAppUserId,
        `rehearsal-subject-${randomUUID()}`,
      ],
    );
    await client.query(
      `
        insert into identity_pairing_intents (
          id,
          authority_policy_id,
          target_app_user_id,
          provider,
          claim_digest_version,
          claim_digest,
          target_review_policy_id,
          issued_at,
          expires_at
        ) values (
          $1::uuid,
          'preissued_bootstrap_claim_authority_v1',
          $2::uuid,
          'neon_auth',
          'bootstrap_claim_sha256_v1',
          $3,
          'single_provisioning_user_explicit_review_v1',
          clock_timestamp(),
          clock_timestamp() + interval '9 minutes'
        )
      `,
      [
        intentId,
        targetAppUserId,
        `bootstrap-claim-sha256-v1:${randomHex(32)}`,
      ],
    );
    if (options.includeConsumedEvent !== false) {
      await client.query(
        `
          insert into identity_pairing_intent_events (
            identity_pairing_intent_id,
            event_type,
            auth_identity_id,
            subject_binding_version,
            subject_binding,
            identity_link_planner_policy_id,
            identity_link_plan_binding_version,
            identity_link_plan_binding
          ) values (
            $1::uuid,
            'consumed',
            $2::uuid,
            'provider_subject_hmac_sha256_v1',
            $3,
            'initial_identity_link_planner_v1',
            'identity_link_plan_hmac_sha256_v1',
            $4
          )
        `,
        [
          intentId,
          authIdentityId,
          `hmac-sha256-v1:${randomHex(32)}`,
          `identity-link-plan-hmac-sha256-v1:${randomHex(32)}`,
        ],
      );
    }
    await client.query("commit");
    transactionOpen = false;
  } catch {
    if (transactionOpen) {
      try {
        await client.query("rollback");
      } catch {
        // The disposable branch still remains mandatory cleanup.
      }
    }
    throw ownerAssignmentFixtureError("fixture_setup_failed");
  } finally {
    client.release();
  }

  const accountRows = await readOwnerAssignmentAccounts(pool);
  const targetAppUserSha256 = fingerprintAppUserId(targetAppUserId);
  const legacyOwnerSha256 =
    fingerprintLegacyOwner(legacyOwnerValue);
  const preflight = buildLegacyAccountOwnershipPreflight({
    appUsers: [
      {
        id: targetAppUserId,
        status: "provisioning",
        role: "user",
      },
    ],
    accounts: accountRows.map((row) => ({
      id: row.id,
      legacyOwnerUserId: row.legacy_owner_user_id,
      canonicalOwnerUserId: row.canonical_owner_user_id,
    })),
    targetAppUserSha256,
    legacyOwnerSha256,
  });
  assert.equal(preflight.result, "evidence_ready");
  assert.equal(
    preflight.classifications.eligible,
    OWNER_ASSIGNMENT_REHEARSAL_ACCOUNT_COUNT,
  );

  return Object.freeze({
    targetAppUserId,
    foreignOwnerAppUserId,
    intentId,
    targetAppUserSha256,
    legacyOwnerSha256,
    candidateSetDigest: preflight.candidateSetDigest,
    eligibleSetDigest: preflight.eligibleSetDigest,
    accountIds: Object.freeze(accountIds),
  });
}

function randomHex(bytes) {
  return randomBytes(bytes).toString("hex");
}
