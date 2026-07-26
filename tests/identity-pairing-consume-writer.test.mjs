import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  createOneTimeIdentityBootstrapClaim,
} from "../scripts/lib/identity-bootstrap-claim-issuer.mjs";
import {
  createIdentityPairingBindings,
  decodeIdentityPairingHmacKey,
  IDENTITY_PAIRING_HMAC_KEY_ENV,
} from "../scripts/lib/identity-pairing-consume-crypto.mjs";
import {
  consumeIdentityPairingClaim,
  IdentityPairingConsumeError,
} from "../scripts/lib/identity-pairing-consume-writer.mjs";
import { TENANT_WRITER_REGISTRY } from "../src/lib/tenant-writer-registry.ts";

const TARGET = "11111111-1111-4111-8111-111111111111";
const OTHER_TARGET = "22222222-2222-4222-8222-222222222222";
const INTENT = "33333333-3333-4333-8333-333333333333";
const IDENTITY = "44444444-4444-4444-8444-444444444444";
const SUBJECT = "neon-auth-subject-synthetic";
const HMAC_KEY = Buffer.alloc(32, 7);

describe("identity pairing atomic consume writer", () => {
  it("derives deterministic, domain-separated bindings from one locked snapshot", () => {
    const input = bindingInput();
    const first = createIdentityPairingBindings(input);
    const second = createIdentityPairingBindings(input);
    assert.deepEqual(first, second);
    assert.match(first.subjectBinding, /^hmac-sha256-v1:[0-9a-f]{64}$/);
    assert.match(
      first.planBinding,
      /^identity-link-plan-hmac-sha256-v1:[0-9a-f]{64}$/,
    );
    assert.notEqual(
      first.subjectBinding.split(":")[1],
      first.planBinding.split(":")[1],
    );

    const changed = createIdentityPairingBindings({
      ...input,
      subject: `${SUBJECT}-changed`,
    });
    assert.notEqual(changed.subjectBinding, first.subjectBinding);
    assert.notEqual(changed.planBinding, first.planBinding);
    assert.equal(
      decodeIdentityPairingHmacKey(HMAC_KEY.toString("base64url")).length,
      32,
    );
    assert.throws(
      () => decodeIdentityPairingHmacKey("invalid"),
      /HMAC key is invalid/,
    );
    assert.equal(
      IDENTITY_PAIRING_HMAC_KEY_ENV,
      "IDENTITY_PAIRING_EVIDENCE_HMAC_KEY",
    );
  });

  it("rejects noncanonical identity evidence before commitment", () => {
    assert.throws(
      () =>
        createIdentityPairingBindings({
          ...bindingInput(),
          existingLinks: [
            identityEvidence(
              "55555555-5555-4555-8555-555555555555",
            ),
            identityEvidence(
              "44444444-4444-4444-8444-444444444444",
            ),
          ],
        }),
      /stable id order/,
    );
  });

  it("locks, replans, inserts, activates, and consumes in one transaction", async () => {
    const { rawClaim, claimDigest } = createOneTimeIdentityBootstrapClaim(
      () => Buffer.alloc(32, 1),
    );
    const database = fakeDatabase({ claimDigest });

    const result = await consumeIdentityPairingClaim({
      pool: database.pool,
      rawClaim,
      verifiedSubjectPort: syntheticSubjectPort(),
      hmacKey: HMAC_KEY,
    });

    assert.equal(result.result, "consumed");
    assert.equal(result.committed, true);
    assert.deepEqual(result.actualWrites, {
      authIdentities: 1,
      appUsers: 1,
      identityPairingIntentEvents: 1,
      productTables: 0,
    });
    assert.equal(result.policy.retryCount, 0);
    assert.equal(result.policy.transactionIsolation, "read_committed");
    assert.match(result.targetFingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.match(result.intentFingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.equal(database.commits, 1);
    assert.equal(database.rollbacks, 0);
    assert.equal(database.releases, 1);

    const order = database.queries.map(queryKind);
    assert.deepEqual(order, [
      "begin",
      "lock_timeout",
      "statement_timeout",
      "claim_lock",
      "target_lock",
      "identity_locks",
      "lifecycle",
      "identity_insert",
      "target_activation",
      "terminal_event_insert",
      "commit",
    ]);

    const serialized = JSON.stringify(result);
    for (const forbidden of [
      rawClaim,
      claimDigest,
      SUBJECT,
      TARGET,
      INTENT,
      IDENTITY,
      "hmac-sha256-v1:",
      "identity-link-plan-hmac-sha256-v1:",
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  });

  it("fails closed on terminal, expired, target drift, and subject collision", async () => {
    const { rawClaim, claimDigest } = createOneTimeIdentityBootstrapClaim(
      () => Buffer.alloc(32, 2),
    );
    const cases = [
      [{ claimDigest, terminalEventPresent: true }, "claim_intent_already_terminal"],
      [
        {
          claimDigest,
          evaluatedAt: "2026-07-26T00:11:00.000Z",
        },
        "claim_intent_expired",
      ],
      [
        { claimDigest, targetStatus: "active" },
        "reviewed_target_state_mismatch",
      ],
      [
        {
          claimDigest,
          identityRows: [
            {
              id: IDENTITY,
              app_user_id: OTHER_TARGET,
              provider: "neon_auth",
              provider_subject: SUBJECT,
              status: "active",
            },
          ],
        },
        "identity_link_provider_subject_collision",
      ],
    ];

    for (const [options, expectedCode] of cases) {
      const database = fakeDatabase(options);
      await assert.rejects(
        () =>
          consumeIdentityPairingClaim({
            pool: database.pool,
            rawClaim,
            verifiedSubjectPort: syntheticSubjectPort(),
            hmacKey: HMAC_KEY,
          }),
        isConsumeError(expectedCode),
      );
      assert.equal(database.commits, 0, expectedCode);
      assert.equal(database.rollbacks, 1, expectedCode);
      assert.equal(database.releases, 1, expectedCode);
    }
  });

  it("rolls back identity and activation when terminal evidence fails", async () => {
    const { rawClaim, claimDigest } = createOneTimeIdentityBootstrapClaim(
      () => Buffer.alloc(32, 3),
    );
    const database = fakeDatabase({
      claimDigest,
      failTerminalInsert: true,
    });

    await assert.rejects(
      () =>
        consumeIdentityPairingClaim({
          pool: database.pool,
          rawClaim,
          verifiedSubjectPort: syntheticSubjectPort(),
          hmacKey: HMAC_KEY,
        }),
      isConsumeError("database_transaction_failed"),
    );
    assert.equal(database.commits, 0);
    assert.equal(database.rollbacks, 1);
    assert.ok(
      database.queries.some((query) =>
        /\binsert into auth_identities\b/i.test(query),
      ),
    );
    assert.ok(
      database.queries.some((query) =>
        /\bupdate app_users\b/i.test(query),
      ),
    );
  });

  it("keeps raw identity evidence inside server-only boundaries", () => {
    const writer = readFileSync(
      "scripts/lib/identity-pairing-consume-writer.mjs",
      "utf8",
    );
    const port = readFileSync(
      "src/lib/auth/verified-neon-subject-port.ts",
      "utf8",
    );
    const rehearsal = readFileSync(
      "scripts/rehearse-identity-pairing-consume-writer.mjs",
      "utf8",
    );

    assert.match(port, /^import "server-only";/);
    assert.match(port, /runtime\.auth\.getSession\(\)/);
    assert.match(port, /verificationSource: "server_verified_session"/);
    assert.doesNotMatch(port, /console\.|logger|providerSubject/);

    assert.match(writer, /begin isolation level read committed/);
    assert.match(writer, /for update/);
    assert.match(writer, /order by id/);
    assert.match(writer, /clock_timestamp\(\)/);
    assert.match(writer, /\brollback\b/);
    assert.doesNotMatch(
      writer,
      /NEON_AUTH_COOKIE_SECRET|VARDA_APP_PASSWORD|APP_ACCESS_PASSWORD/,
    );
    assert.doesNotMatch(writer, /console\.|process\.env/);

    assert.match(rehearsal, /productionDatabaseWrites: 0/);
    assert.doesNotMatch(
      rehearsal,
      /connectionString:\s*process\.env\.DATABASE_URL\b/,
    );

    const registryEntry = TENANT_WRITER_REGISTRY.find(
      ({ id }) => id === "identity_pairing_atomic_consume",
    );
    assert.equal(registryEntry?.authorization, "server_verified_session");
    assert.deepEqual(
      registryEntry?.targets.map(({ table, operations }) => ({
        table,
        operations,
      })),
      [
        { table: "auth_identities", operations: ["insert"] },
        { table: "app_users", operations: ["update"] },
        {
          table: "identity_pairing_intent_events",
          operations: ["insert"],
        },
      ],
    );
  });
});

function bindingInput() {
  return {
    hmacKey: HMAC_KEY,
    provider: "neon_auth",
    subject: SUBJECT,
    targetAppUserId: TARGET,
    targetStatus: "provisioning",
    targetRole: "user",
    existingLinks: [],
  };
}

function identityEvidence(id) {
  return {
    id,
    appUserId: OTHER_TARGET,
    provider: "other_auth",
    subject: `subject-${id}`,
    status: "active",
  };
}

function syntheticSubjectPort() {
  return Object.freeze({
    async use(consumer) {
      const value = await consumer(
        Object.freeze({
          provider: "neon_auth",
          subject: SUBJECT,
          verificationSource: "server_verified_session",
        }),
      );
      return Object.freeze({ state: "verified", value });
    },
  });
}

function fakeDatabase(options) {
  const now = options.evaluatedAt ?? "2026-07-26T00:05:00.000Z";
  const state = {
    queries: [],
    commits: 0,
    rollbacks: 0,
    releases: 0,
  };

  const client = {
    async query(text, params = []) {
      const normalized = String(text).replace(/\s+/g, " ").trim();
      state.queries.push(normalized);

      if (/^begin\b/i.test(normalized)) return result();
      if (/^set local\b/i.test(normalized)) return result();
      if (/^commit$/i.test(normalized)) {
        state.commits += 1;
        return result();
      }
      if (/^rollback$/i.test(normalized)) {
        state.rollbacks += 1;
        return result();
      }
      if (
        /\bfrom identity_pairing_intents\b/i.test(normalized) &&
        /\bfor update\b/i.test(normalized)
      ) {
        return result([
          {
            id: INTENT,
            authority_policy_id: "preissued_bootstrap_claim_authority_v1",
            target_app_user_id: TARGET,
            provider: "neon_auth",
            claim_digest_version: "bootstrap_claim_sha256_v1",
            claim_digest: options.claimDigest,
            target_review_policy_id:
              "single_provisioning_user_explicit_review_v1",
            issued_at: new Date("2026-07-26T00:00:00.000Z"),
            expires_at: new Date("2026-07-26T00:10:00.000Z"),
          },
        ]);
      }
      if (
        /\bfrom app_users\b/i.test(normalized) &&
        /\bfor update\b/i.test(normalized)
      ) {
        return result([
          {
            id: TARGET,
            status: options.targetStatus ?? "provisioning",
            role: "user",
          },
        ]);
      }
      if (
        /\bfrom auth_identities\b/i.test(normalized) &&
        /\bfor update\b/i.test(normalized)
      ) {
        return result(options.identityRows ?? []);
      }
      if (/\bclock_timestamp\(\) as evaluated_at\b/i.test(normalized)) {
        return result([
          {
            evaluated_at: new Date(now),
            terminal_event_present:
              options.terminalEventPresent === true,
          },
        ]);
      }
      if (/\binsert into auth_identities\b/i.test(normalized)) {
        return result([{ id: IDENTITY }]);
      }
      if (/\bupdate app_users\b/i.test(normalized)) {
        return result([{ id: TARGET }]);
      }
      if (
        /\binsert into identity_pairing_intent_events\b/i.test(normalized)
      ) {
        if (options.failTerminalInsert) {
          const error = new Error("synthetic event failure");
          error.code = "23514";
          throw error;
        }
        assert.equal(params[0], INTENT);
        assert.equal(params[1], IDENTITY);
        return result([
          { id: "55555555-5555-4555-8555-555555555555" },
        ]);
      }
      throw new Error(`Unexpected synthetic query: ${normalized}`);
    },
    release() {
      state.releases += 1;
    },
  };

  return Object.assign(state, {
    pool: {
      async connect() {
        return client;
      },
    },
  });
}

function result(rows = []) {
  return { rows, rowCount: rows.length };
}

function queryKind(query) {
  if (/^begin\b/i.test(query)) return "begin";
  if (/lock_timeout/i.test(query)) return "lock_timeout";
  if (/statement_timeout/i.test(query)) return "statement_timeout";
  if (
    /\bfrom identity_pairing_intents\b/i.test(query) &&
    /\bfor update\b/i.test(query)
  ) {
    return "claim_lock";
  }
  if (/\bfrom app_users\b/i.test(query) && /\bfor update\b/i.test(query)) {
    return "target_lock";
  }
  if (
    /\bfrom auth_identities\b/i.test(query) &&
    /\bfor update\b/i.test(query)
  ) {
    return "identity_locks";
  }
  if (/\bclock_timestamp\(\) as evaluated_at\b/i.test(query)) {
    return "lifecycle";
  }
  if (/\binsert into auth_identities\b/i.test(query)) {
    return "identity_insert";
  }
  if (/\bupdate app_users\b/i.test(query)) return "target_activation";
  if (/\binsert into identity_pairing_intent_events\b/i.test(query)) {
    return "terminal_event_insert";
  }
  if (/^commit$/i.test(query)) return "commit";
  if (/^rollback$/i.test(query)) return "rollback";
  return "unknown";
}

function isConsumeError(expectedCode) {
  return (error) =>
    error instanceof IdentityPairingConsumeError &&
    error.code === expectedCode;
}
