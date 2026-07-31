import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  assignLegacyAccountsToConsumedIdentity,
  LegacyAccountOwnerAssignmentError,
  planLegacyAccountOwnerAssignment,
} from "../scripts/lib/legacy-account-owner-assignment-writer.mjs";
import {
  buildLegacyAccountOwnershipPreflight,
  fingerprintAppUserId,
  fingerprintLegacyOwner,
} from "../scripts/lib/legacy-account-ownership-preflight.mjs";

const TARGET = "11111111-1111-4111-8111-111111111111";
const OTHER_TARGET = "22222222-2222-4222-8222-222222222222";
const INTENT = "33333333-3333-4333-8333-333333333333";
const CLAIM_DIGEST =
  `bootstrap-claim-sha256-v1:${"a".repeat(64)}`;
const EVENT = "44444444-4444-4444-8444-444444444444";
const IDENTITY = "55555555-5555-4555-8555-555555555555";
const LEGACY_OWNER = "base44-owner-synthetic";
const ACCOUNT_IDS = Object.freeze([
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
]);
const TARGET_SHA256 = fingerprintAppUserId(TARGET);
const LEGACY_OWNER_SHA256 = fingerprintLegacyOwner(LEGACY_OWNER);
const REVIEWED_EVIDENCE = buildLegacyAccountOwnershipPreflight({
  appUsers: [{ id: TARGET, status: "provisioning", role: "user" }],
  accounts: initialAccounts().map((row) => ({
    id: row.id,
    legacyOwnerUserId: row.legacy_owner_user_id,
    canonicalOwnerUserId: row.canonical_owner_user_id,
  })),
  targetAppUserSha256: TARGET_SHA256,
  legacyOwnerSha256: LEGACY_OWNER_SHA256,
});

describe("post-consume legacy account owner assignment writer", () => {
  it("locks consumed evidence and assigns exactly four accounts once", async () => {
    const database = fakeDatabase();
    const result = await assignLegacyAccountsToConsumedIdentity(
      writerInput(database.pool),
    );

    assert.equal(result.result, "assigned");
    assert.equal(result.mode, "write");
    assert.equal(result.committed, true);
    assert.deepEqual(result.plannedWrites, {
      accounts: 4,
      identityTables: 0,
      otherProductTables: 0,
    });
    assert.deepEqual(result.actualWrites, {
      accounts: 4,
      identityTables: 0,
      otherProductTables: 0,
    });
    assert.deepEqual(
      {
        transactionIsolation: result.policy.transactionIsolation,
        lockTimeoutMs: result.policy.lockTimeoutMs,
        statementTimeoutMs: result.policy.statementTimeoutMs,
        retryCount: result.policy.retryCount,
      },
      {
        transactionIsolation: "read_committed",
        lockTimeoutMs: 2_000,
        statementTimeoutMs: 8_000,
        retryCount: 0,
      },
    );
    assert.equal(database.commits, 1);
    assert.equal(database.rollbacks, 0);
    assert.equal(database.releases, 1);
    assert.equal(database.updateAttempts, 1);
    assert.deepEqual(
      database.accounts.map(({ canonical_owner_user_id }) =>
        canonical_owner_user_id,
      ),
      Array(4).fill(TARGET),
    );
    assert.deepEqual(database.queries.map(queryKind), [
      "begin",
      "lock_timeout",
      "statement_timeout",
      "intent_lock",
      "target_lock",
      "event_lock",
      "identity_lock",
      "account_locks",
      "account_update",
      "assignment_verification",
      "commit",
    ]);

    const output = JSON.stringify(result);
    for (const privateValue of [
      TARGET,
      INTENT,
      EVENT,
      IDENTITY,
      LEGACY_OWNER,
      CLAIM_DIGEST,
      "provider_subject",
    ]) {
      assert.equal(output.includes(privateValue), false, privateValue);
    }
  });

  it("uses the same locked evidence path for dry-run and rolls it back", async () => {
    const database = fakeDatabase();
    const result = await planLegacyAccountOwnerAssignment(
      writerInput(database.pool),
    );

    assert.equal(result.mode, "dry_run");
    assert.equal(result.result, "planned");
    assert.equal(result.committed, false);
    assert.deepEqual(result.plannedWrites, {
      accounts: 4,
      identityTables: 0,
      otherProductTables: 0,
    });
    assert.deepEqual(result.actualWrites, {
      accounts: 0,
      identityTables: 0,
      otherProductTables: 0,
    });
    assert.equal(database.commits, 0);
    assert.equal(database.rollbacks, 1);
    assert.equal(database.updateAttempts, 0);
    assert.deepEqual(database.queries.map(queryKind), [
      "begin",
      "lock_timeout",
      "statement_timeout",
      "intent_lock",
      "target_lock",
      "event_lock",
      "identity_lock",
      "account_locks",
      "rollback",
    ]);
  });

  it("accepts only the all-four already-applied state as idempotent", async () => {
    const database = fakeDatabase({
      accounts: initialAccounts(TARGET),
    });
    const result = await assignLegacyAccountsToConsumedIdentity(
      writerInput(database.pool),
    );

    assert.equal(result.result, "already_applied");
    assert.deepEqual(result.actualWrites, {
      accounts: 0,
      identityTables: 0,
      otherProductTables: 0,
    });
    assert.equal(database.updateAttempts, 0);
    assert.equal(database.commits, 1);
    assert.equal(database.rollbacks, 0);
    assert.equal(
      database.queries.some((query) => /\bupdate accounts\b/i.test(query)),
      false,
    );
  });

  it("rejects invalid authority input before connecting", async () => {
    for (const [overrides, expectedCode] of [
      [
        { claimDigest: `${CLAIM_DIGEST} ` },
        "claim_digest_invalid",
      ],
      [
        { targetAppUserSha256: "sha256:not-a-digest" },
        "target_app_user_fingerprint_invalid",
      ],
      [
        { candidateSetDigest: "invalid" },
        "candidate_set_digest_invalid",
      ],
    ]) {
      const database = fakeDatabase();
      await assert.rejects(
        () =>
          assignLegacyAccountsToConsumedIdentity(
            writerInput(database.pool, overrides),
          ),
        isAssignmentError(expectedCode),
      );
      assert.equal(database.connects, 0, expectedCode);
    }
  });

  it("blocks wrong or missing post-consume identity evidence", async () => {
    const cases = [
      [{ intentMissing: true }, "consumed_intent_not_found"],
      [{ intentTarget: OTHER_TARGET }, "consumed_intent_invalid"],
      [
        {
          intentClaimDigest:
            `bootstrap-claim-sha256-v1:${"b".repeat(64)}`,
        },
        "consumed_intent_invalid",
      ],
      [{ targetStatus: "provisioning" }, "consumed_target_state_mismatch"],
      [{ eventMissing: true }, "consumed_event_not_found"],
      [{ eventType: "revoked" }, "consumed_event_invalid"],
      [{ identityMissing: true }, "consumed_identity_not_found"],
      [{ identityTarget: OTHER_TARGET }, "consumed_identity_invalid"],
      [{ identityStatus: "disabled" }, "consumed_identity_invalid"],
    ];

    for (const [options, expectedCode] of cases) {
      const database = fakeDatabase(options);
      await assert.rejects(
        () =>
          assignLegacyAccountsToConsumedIdentity(
            writerInput(database.pool),
          ),
        isAssignmentError(expectedCode),
      );
      assert.equal(database.commits, 0, expectedCode);
      assert.equal(database.rollbacks, 1, expectedCode);
      assert.equal(database.updateAttempts, 0, expectedCode);
    }
  });

  it("blocks digest drift, extra rows, foreign owners, and mixed states", async () => {
    const extraAccount = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5",
      legacy_owner_user_id: LEGACY_OWNER,
      canonical_owner_user_id: null,
    };
    const cases = [
      [
        {},
        {
          eligibleSetDigest: `sha256:${"0".repeat(64)}`,
        },
        "account_evidence_digest_drift",
      ],
      [
        { accounts: [...initialAccounts(), extraAccount] },
        {},
        "account_scope_count_mismatch",
      ],
      [
        {
          accounts: initialAccounts().map((row, index) => ({
            ...row,
            canonical_owner_user_id:
              index === 0 ? OTHER_TARGET : null,
          })),
        },
        {},
        "foreign_owner_conflict",
      ],
      [
        {
          accounts: initialAccounts().map((row, index) => ({
            ...row,
            canonical_owner_user_id: index === 0 ? TARGET : null,
          })),
        },
        {},
        "account_assignment_state_mismatch",
      ],
    ];

    for (const [options, inputOverrides, expectedCode] of cases) {
      const database = fakeDatabase(options);
      await assert.rejects(
        () =>
          assignLegacyAccountsToConsumedIdentity(
            writerInput(database.pool, inputOverrides),
          ),
        isAssignmentError(expectedCode),
      );
      assert.equal(database.commits, 0, expectedCode);
      assert.equal(database.rollbacks, 1, expectedCode);
    }
  });

  it("rolls back a partial guarded update without retaining assignments", async () => {
    const database = fakeDatabase({ updateRowCount: 3 });

    await assert.rejects(
      () =>
        assignLegacyAccountsToConsumedIdentity(
          writerInput(database.pool),
        ),
      isAssignmentError("account_update_count_mismatch"),
    );

    assert.equal(database.updateAttempts, 1);
    assert.equal(database.commits, 0);
    assert.equal(database.rollbacks, 1);
    assert.deepEqual(
      database.accounts.map(({ canonical_owner_user_id }) =>
        canonical_owner_user_id,
      ),
      Array(4).fill(null),
    );
  });

  it("maps contention without an automatic retry", async () => {
    for (const [databaseCode, expectedCode] of [
      ["23505", "concurrent_state_conflict"],
      ["40P01", "concurrent_state_conflict"],
      ["55P03", "database_timeout"],
      ["57014", "database_timeout"],
      ["23514", "database_constraint_violation"],
      ["23503", "database_constraint_violation"],
    ]) {
      const database = fakeDatabase({
        updateError: { code: databaseCode },
      });
      await assert.rejects(
        () =>
          assignLegacyAccountsToConsumedIdentity(
            writerInput(database.pool),
          ),
        isAssignmentError(expectedCode),
      );
      assert.equal(database.updateAttempts, 1, databaseCode);
      assert.equal(database.commits, 0, databaseCode);
      assert.equal(database.rollbacks, 1, databaseCode);
      assert.equal(database.connects, 1, databaseCode);
    }
  });

  it("keeps identity consume, routes, secrets, and identity events out of scope", () => {
    const source = readFileSync(
      "scripts/lib/legacy-account-owner-assignment-writer.mjs",
      "utf8",
    );
    const stateSource = readFileSync(
      "scripts/lib/legacy-account-owner-assignment-state.mjs",
      "utf8",
    );

    assert.match(source, /begin isolation level read committed/);
    assert.match(
      source,
      /from identity_pairing_intents[\s\S]*where claim_digest = \$1[\s\S]*for update/,
    );
    assert.match(source, /from identity_pairing_intent_events/);
    assert.match(source, /from auth_identities/);
    assert.match(source, /from accounts[\s\S]*order by id[\s\S]*for update/);
    assert.match(source, /update accounts/);
    assert.doesNotMatch(
      source,
      /\bprovider_subject\b|session-subject-binding|identity-bootstrap-claim|consumeIdentityPairingClaim|identityPairingIntentId/,
    );
    assert.doesNotMatch(
      source,
      /insert into identity_pairing_intent_events|update app_users|insert into auth_identities/,
    );
    assert.doesNotMatch(
      source,
      /process\.env|console\.|DATABASE_URL|VARDA_APP_PASSWORD|APP_ACCESS_PASSWORD/,
    );
    assert.doesNotMatch(
      stateSource,
      /client\.query|from accounts|update accounts|process\.env|console\./,
    );
  });
});

function writerInput(pool, overrides = {}) {
  return {
    pool,
    claimDigest: CLAIM_DIGEST,
    targetAppUserSha256: TARGET_SHA256,
    legacyOwnerSha256: LEGACY_OWNER_SHA256,
    candidateSetDigest: REVIEWED_EVIDENCE.candidateSetDigest,
    eligibleSetDigest: REVIEWED_EVIDENCE.eligibleSetDigest,
    ...overrides,
  };
}

function initialAccounts(canonicalOwnerUserId = null) {
  return ACCOUNT_IDS.map((id) => ({
    id,
    legacy_owner_user_id: LEGACY_OWNER,
    canonical_owner_user_id: canonicalOwnerUserId,
  }));
}

function fakeDatabase(options = {}) {
  const state = {
    queries: [],
    connects: 0,
    commits: 0,
    rollbacks: 0,
    releases: 0,
    updateAttempts: 0,
    accounts: cloneAccounts(options.accounts ?? initialAccounts()),
    transactionSnapshot: null,
  };

  const client = {
    async query(text, values = []) {
      const normalized = text.trim().replace(/\s+/g, " ");
      state.queries.push(normalized);

      if (/^begin\b/i.test(normalized)) {
        state.transactionSnapshot = cloneAccounts(state.accounts);
        return result();
      }
      if (/^set local\b/i.test(normalized)) return result();
      if (/^commit$/i.test(normalized)) {
        state.commits += 1;
        state.transactionSnapshot = null;
        return result();
      }
      if (/^rollback$/i.test(normalized)) {
        state.rollbacks += 1;
        if (state.transactionSnapshot !== null) {
          state.accounts = cloneAccounts(state.transactionSnapshot);
        }
        state.transactionSnapshot = null;
        return result();
      }
      if (
        /\bfrom identity_pairing_intents\b/i.test(normalized) &&
        /\bfor update\b/i.test(normalized)
      ) {
        return options.intentMissing
          ? result()
          : result([
              {
                id: INTENT,
                authority_policy_id:
                  "preissued_bootstrap_claim_authority_v1",
                target_app_user_id: options.intentTarget ?? TARGET,
                provider: "neon_auth",
                claim_digest_version:
                  options.claimDigestVersion ??
                  "bootstrap_claim_sha256_v1",
                claim_digest:
                  options.intentClaimDigest ?? CLAIM_DIGEST,
                target_review_policy_id:
                  "single_provisioning_user_explicit_review_v1",
              },
            ]);
      }
      if (
        /\bfrom app_users\b/i.test(normalized) &&
        /\bfor update\b/i.test(normalized)
      ) {
        return result([
          {
            id: values[0],
            status: options.targetStatus ?? "active",
            role: options.targetRole ?? "user",
          },
        ]);
      }
      if (
        /\bfrom identity_pairing_intent_events\b/i.test(normalized) &&
        /\bfor update\b/i.test(normalized)
      ) {
        return options.eventMissing
          ? result()
          : result([
              {
                id: EVENT,
                identity_pairing_intent_id: INTENT,
                event_type: options.eventType ?? "consumed",
                auth_identity_id: IDENTITY,
                subject_binding_version:
                  "provider_subject_hmac_sha256_v1",
                identity_link_planner_policy_id:
                  "initial_identity_link_planner_v1",
                identity_link_plan_binding_version:
                  "identity_link_plan_hmac_sha256_v1",
              },
            ]);
      }
      if (
        /\bfrom auth_identities\b/i.test(normalized) &&
        /\bfor update\b/i.test(normalized)
      ) {
        return options.identityMissing
          ? result()
          : result([
              {
                id: IDENTITY,
                app_user_id: options.identityTarget ?? TARGET,
                provider: options.identityProvider ?? "neon_auth",
                status: options.identityStatus ?? "active",
              },
            ]);
      }
      if (
        /\bfrom accounts\b/i.test(normalized) &&
        /\border by id\b/i.test(normalized) &&
        /\bfor update\b/i.test(normalized)
      ) {
        return result(cloneAccounts(state.accounts).sort(compareAccountId));
      }
      if (/\bupdate accounts\b/i.test(normalized)) {
        state.updateAttempts += 1;
        if (options.updateError) throw options.updateError;

        const [accountIds, targetId, legacyOwner] = values;
        const matchingRows = state.accounts
          .filter(
            (row) =>
              accountIds.includes(row.id) &&
              row.canonical_owner_user_id === null &&
              row.legacy_owner_user_id === legacyOwner,
          )
          .sort(compareAccountId);
        const updateRowCount =
          options.updateRowCount ?? matchingRows.length;
        const updatedRows = matchingRows.slice(0, updateRowCount);
        for (const row of updatedRows) {
          row.canonical_owner_user_id = targetId;
        }
        return result(updatedRows.map(({ id }) => ({ id })));
      }
      if (
        /\bfrom accounts\b/i.test(normalized) &&
        /\bid = any\b/i.test(normalized)
      ) {
        const accountIds = values[0];
        return result(
          cloneAccounts(
            state.accounts.filter(({ id }) => accountIds.includes(id)),
          ).sort(compareAccountId),
        );
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
    release() {
      state.releases += 1;
    },
  };

  return {
    pool: {
      async connect() {
        state.connects += 1;
        return client;
      },
    },
    get queries() {
      return state.queries;
    },
    get connects() {
      return state.connects;
    },
    get commits() {
      return state.commits;
    },
    get rollbacks() {
      return state.rollbacks;
    },
    get releases() {
      return state.releases;
    },
    get updateAttempts() {
      return state.updateAttempts;
    },
    get accounts() {
      return state.accounts;
    },
  };
}

function result(rows = []) {
  return { rowCount: rows.length, rows };
}

function cloneAccounts(accounts) {
  return accounts.map((row) => ({ ...row }));
}

function compareAccountId(left, right) {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function queryKind(query) {
  if (/^begin\b/i.test(query)) return "begin";
  if (/lock_timeout/i.test(query)) return "lock_timeout";
  if (/statement_timeout/i.test(query)) return "statement_timeout";
  if (/\bfrom identity_pairing_intents\b/i.test(query)) {
    return "intent_lock";
  }
  if (/\bfrom app_users\b/i.test(query)) return "target_lock";
  if (/\bfrom identity_pairing_intent_events\b/i.test(query)) {
    return "event_lock";
  }
  if (/\bfrom auth_identities\b/i.test(query)) return "identity_lock";
  if (
    /\bfrom accounts\b/i.test(query) &&
    /\bfor update\b/i.test(query)
  ) {
    return "account_locks";
  }
  if (/\bupdate accounts\b/i.test(query)) return "account_update";
  if (/\bfrom accounts\b/i.test(query) && /\bid = any\b/i.test(query)) {
    return "assignment_verification";
  }
  if (/^commit$/i.test(query)) return "commit";
  if (/^rollback$/i.test(query)) return "rollback";
  return "unknown";
}

function isAssignmentError(expectedCode) {
  return (error) =>
    error instanceof LegacyAccountOwnerAssignmentError &&
    error.code === expectedCode;
}
