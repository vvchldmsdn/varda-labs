import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  createSessionSubjectBinding,
} from "../src/lib/auth/session-subject-binding.ts";
import {
  digestIdentityBootstrapClaim,
  isCanonicalIdentityBootstrapClaim,
} from "../src/lib/identity-bootstrap-claim.ts";
import {
  createIdentityLinkPlanBinding,
} from "../src/lib/identity-link-plan-binding.ts";
import {
  consumeIdentityPairingClaim,
  IdentityPairingConsumeError,
} from "../scripts/lib/identity-pairing-consume-writer.mjs";

const TARGET = "11111111-1111-4111-8111-111111111111";
const OTHER_TARGET = "22222222-2222-4222-8222-222222222222";
const INTENT = "33333333-3333-4333-8333-333333333333";
const IDENTITY = "44444444-4444-4444-8444-444444444444";
const EVENT = "55555555-5555-4555-8555-555555555555";
const SUBJECT = "neon-auth-subject-synthetic";
const HMAC_KEY = Buffer.alloc(32, 7);
const RAW_CLAIM = `varda-bootstrap-claim-v1.${Buffer.alloc(32).toString(
  "base64url",
)}`;
const CLAIM_DIGEST = digestIdentityBootstrapClaim(RAW_CLAIM);

describe("identity pairing atomic consume writer", () => {
  it("requires a canonical 256-bit bootstrap claim", () => {
    assert.equal(isCanonicalIdentityBootstrapClaim(RAW_CLAIM), true);
    assert.match(
      CLAIM_DIGEST,
      /^bootstrap-claim-sha256-v1:[0-9a-f]{64}$/,
    );

    const noncanonicalAlias = `${RAW_CLAIM.slice(0, -1)}B`;
    assert.equal(
      Buffer.from(noncanonicalAlias.split(".")[1], "base64url").equals(
        Buffer.alloc(32),
      ),
      true,
    );
    assert.equal(
      isCanonicalIdentityBootstrapClaim(noncanonicalAlias),
      false,
    );

    for (const invalid of [
      `${RAW_CLAIM}=`,
      ` ${RAW_CLAIM}`,
      "varda-bootstrap-claim-v1.short",
      null,
    ]) {
      assert.equal(isCanonicalIdentityBootstrapClaim(invalid), false);
      assert.throws(
        () => digestIdentityBootstrapClaim(invalid),
        /format is invalid/,
      );
    }
  });

  it("derives deterministic domain-separated evidence bindings", () => {
    const subject = createSessionSubjectBinding({
      evidence: verifiedSubjectEvidence(),
      hmacKey: HMAC_KEY,
    });
    assert.equal(subject.state, "verified");

    const input = {
      hmacKey: HMAC_KEY,
      provider: "neon_auth",
      subjectBindingVersion: subject.subjectBindingVersion,
      subjectBinding: subject.subjectBinding,
      targetAppUserId: TARGET,
      targetStatus: "provisioning",
      targetRole: "user",
      existingLinks: [],
    };
    const first = createIdentityLinkPlanBinding(input);
    const second = createIdentityLinkPlanBinding(input);
    assert.deepEqual(first, second);
    assert.match(
      first.planBinding,
      /^identity-link-plan-hmac-sha256-v1:[0-9a-f]{64}$/,
    );
    assert.notEqual(
      first.planBinding.split(":")[1],
      subject.subjectBinding.split(":")[1],
    );

    assert.throws(
      () =>
        createIdentityLinkPlanBinding({
          ...input,
          existingLinks: [
            identityEvidence(
              "77777777-7777-4777-8777-777777777777",
            ),
            identityEvidence(
              "66666666-6666-4666-8666-666666666666",
            ),
          ],
        }),
      /order is invalid/,
    );
  });

  it("locks, replans, writes evidence, and commits once", async () => {
    const database = fakeDatabase();
    const sessionPort = syntheticSessionPort();
    const result = await consumeIdentityPairingClaim({
      pool: database.pool,
      rawClaim: RAW_CLAIM,
      verifiedSessionSubjectPort: sessionPort,
      hmacKey: HMAC_KEY,
    });

    assert.equal(sessionPort.readCount(), 1);
    assert.equal(result.result, "consumed");
    assert.equal(result.committed, true);
    assert.deepEqual(result.actualWrites, {
      authIdentities: 1,
      appUsers: 1,
      identityPairingIntentEvents: 1,
      productTables: 0,
    });
    assert.deepEqual(
      {
        isolation: result.policy.transactionIsolation,
        lockTimeoutMs: result.policy.lockTimeoutMs,
        statementTimeoutMs: result.policy.statementTimeoutMs,
        retryCount: result.policy.retryCount,
      },
      {
        isolation: "read_committed",
        lockTimeoutMs: 2_000,
        statementTimeoutMs: 8_000,
        retryCount: 0,
      },
    );
    assert.equal(database.commits, 1);
    assert.equal(database.rollbacks, 0);
    assert.equal(database.releases, 1);
    assert.deepEqual(database.queries.map(queryKind), [
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

    const output = JSON.stringify(result);
    for (const secret of [
      RAW_CLAIM,
      CLAIM_DIGEST,
      SUBJECT,
      TARGET,
      INTENT,
      IDENTITY,
      EVENT,
      "hmac-sha256-v1:",
      "identity-link-plan-hmac-sha256-v1:",
    ]) {
      assert.equal(output.includes(secret), false, secret);
    }
  });

  it("rejects invalid input before opening a database transaction", async () => {
    for (const [input, expectedCode] of [
      [
        {
          rawClaim: "invalid",
          verifiedSessionSubjectPort: syntheticSessionPort(),
          hmacKey: HMAC_KEY,
        },
        "claim_format_invalid",
      ],
      [
        {
          rawClaim: RAW_CLAIM,
          verifiedSessionSubjectPort: syntheticSessionPort({
            state: "missing",
          }),
          hmacKey: HMAC_KEY,
        },
        "verified_subject_required",
      ],
      [
        {
          rawClaim: RAW_CLAIM,
          verifiedSessionSubjectPort: syntheticSessionPort(),
          hmacKey: Buffer.alloc(31),
        },
        "binding_key_invalid",
      ],
    ]) {
      const database = fakeDatabase();
      await assert.rejects(
        () =>
          consumeIdentityPairingClaim({
            pool: database.pool,
            ...input,
          }),
        isConsumeError(expectedCode),
      );
      assert.equal(database.connects, 0, expectedCode);
    }
  });

  it("rejects accessor-backed subjects before opening a transaction", async () => {
    let subjectReads = 0;
    const evidence = {
      state: "verified",
      provider: "neon_auth",
      verificationSource: "server_verified_session",
    };
    Object.defineProperty(evidence, "subject", {
      enumerable: true,
      get() {
        subjectReads += 1;
        return subjectReads === 1 ? SUBJECT : `${SUBJECT}-changed`;
      },
    });
    const database = fakeDatabase();

    await assert.rejects(
      () =>
        consumeIdentityPairingClaim({
          pool: database.pool,
          rawClaim: RAW_CLAIM,
          verifiedSessionSubjectPort: syntheticSessionPort(evidence),
          hmacKey: HMAC_KEY,
        }),
      isConsumeError("verified_subject_unavailable"),
    );
    assert.equal(subjectReads, 0);
    assert.equal(database.connects, 0);
  });

  it("rolls back terminal, expiry, target drift, and identity conflicts", async () => {
    const cases = [
      [
        { terminalEventPresent: true },
        "claim_intent_already_terminal",
      ],
      [
        { evaluatedAt: "2026-07-27T00:11:00.000Z" },
        "claim_intent_expired",
      ],
      [
        { targetStatus: "active" },
        "reviewed_target_state_mismatch",
      ],
      [
        {
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
            rawClaim: RAW_CLAIM,
            verifiedSessionSubjectPort: syntheticSessionPort(),
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
    const database = fakeDatabase({ failTerminalInsert: true });
    await assert.rejects(
      () =>
        consumeIdentityPairingClaim({
          pool: database.pool,
          rawClaim: RAW_CLAIM,
          verifiedSessionSubjectPort: syntheticSessionPort(),
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

  it("maps database contention without automatic retry", async () => {
    for (const [databaseCode, expectedCode] of [
      ["23505", "concurrent_state_conflict"],
      ["40P01", "concurrent_state_conflict"],
      ["55P03", "database_timeout"],
      ["57014", "database_timeout"],
      ["23514", "database_constraint_violation"],
    ]) {
      const database = fakeDatabase({
        failTerminalInsert: { code: databaseCode },
      });
      await assert.rejects(
        () =>
          consumeIdentityPairingClaim({
            pool: database.pool,
            rawClaim: RAW_CLAIM,
            verifiedSessionSubjectPort: syntheticSessionPort(),
            hmacKey: HMAC_KEY,
          }),
        isConsumeError(expectedCode),
      );
      assert.equal(database.commits, 0);
      assert.equal(database.rollbacks, 1);
    }
  });

  it("keeps the writer disconnected from the disabled product route", () => {
    const writer = readFileSync(
      "scripts/lib/identity-pairing-consume-writer.mjs",
      "utf8",
    );
    const route = readFileSync(
      "src/app/api/identity/bootstrap-claim/present/route.ts",
      "utf8",
    );

    assert.match(writer, /begin isolation level read committed/);
    assert.match(writer, /for update/);
    assert.match(writer, /clock_timestamp\(\)/);
    assert.match(writer, /\brollback\b/);
    assert.doesNotMatch(
      writer,
      /process\.env|console\.|NEON_AUTH_COOKIE_SECRET|VARDA_APP_PASSWORD|APP_ACCESS_PASSWORD/,
    );
    assert.doesNotMatch(
      route,
      /identity-pairing-consume-writer|consumeIdentityPairingClaim|getSession|DATABASE_URL/,
    );
  });

  it("gates the writer before creating the short-lived intent", () => {
    const rehearsal = readFileSync(
      "scripts/rehearse-identity-pairing-consume-writer.mjs",
      "utf8",
    );

    assert.match(
      rehearsal,
      /observer = await pool\.connect\(\);[\s\S]*lockObservation = await createIntentLockObservedPool\(pool\);[\s\S]*from app_users[\s\S]*for no key update[\s\S]*intentLockGateReached[\s\S]*claim = await insertIntent\([\s\S]*"short_lived",[\s\S]*pendingClaim,[\s\S]*releaseIntentLockGate\(\);[\s\S]*targetLockDispatched/,
    );
    assert.doesNotMatch(
      rehearsal,
      /consumeObservation && blockerTransactionOpen/,
    );
  });
});

function verifiedSubjectEvidence() {
  return Object.freeze({
    state: "verified",
    provider: "neon_auth",
    subject: SUBJECT,
    verificationSource: "server_verified_session",
  });
}

function syntheticSessionPort(evidence = verifiedSubjectEvidence()) {
  let reads = 0;
  return Object.freeze({
    async read() {
      reads += 1;
      return evidence;
    },
    readCount() {
      return reads;
    },
  });
}

function identityEvidence(id) {
  return {
    id,
    appUserId: TARGET,
    provider: "neon_auth",
    subject: SUBJECT,
    status: "active",
  };
}

function fakeDatabase(options = {}) {
  const state = {
    queries: [],
    connects: 0,
    commits: 0,
    rollbacks: 0,
    releases: 0,
  };
  const issuedAt = options.issuedAt ?? "2026-07-27T00:00:00.000Z";
  const expiresAt = options.expiresAt ?? "2026-07-27T00:10:00.000Z";
  const evaluatedAt =
    options.evaluatedAt ?? "2026-07-27T00:05:00.000Z";

  const client = {
    async query(text) {
      const normalized = text.trim().replace(/\s+/g, " ");
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
            authority_policy_id:
              "preissued_bootstrap_claim_authority_v1",
            target_app_user_id: TARGET,
            provider: "neon_auth",
            claim_digest_version: "bootstrap_claim_sha256_v1",
            claim_digest: CLAIM_DIGEST,
            target_review_policy_id:
              "single_provisioning_user_explicit_review_v1",
            issued_at: issuedAt,
            expires_at: expiresAt,
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
            role: options.targetRole ?? "user",
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
            evaluated_at: evaluatedAt,
            terminal_event_present:
              options.terminalEventPresent ?? false,
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
        /\binsert into identity_pairing_intent_events\b/i.test(
          normalized,
        )
      ) {
        if (options.failTerminalInsert) {
          if (typeof options.failTerminalInsert === "object") {
            throw options.failTerminalInsert;
          }
          throw new Error("synthetic terminal insert failure");
        }
        return result([{ id: EVENT }]);
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
    release() {
      state.releases += 1;
    },
  };

  return {
    ...state,
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
  };
}

function result(rows = []) {
  return { rowCount: rows.length, rows };
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
