import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  buildIdentityBootstrapLifecyclePreflight,
  fingerprintIdentityPairingIntentId,
  IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_POLICY,
  IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_SQL,
  IdentityBootstrapLifecyclePreflightError,
  parseIdentityBootstrapLifecyclePreflightArgs,
} from "../scripts/lib/identity-bootstrap-lifecycle-preflight.mjs";
import { fingerprintAppUserId } from "../scripts/lib/legacy-account-ownership-evidence.mjs";
import {
  readIdentityBootstrapLifecycleSnapshot,
  runIdentityBootstrapLifecyclePreflight,
} from "../scripts/preflight-identity-bootstrap-lifecycle.mjs";

const TARGET = "11111111-1111-4111-8111-11111111111a";
const INTENT = "22222222-2222-4222-8222-222222222222";
const TARGET_SHA256 = fingerprintAppUserId(TARGET);
const INTENT_SHA256 = fingerprintIdentityPairingIntentId(INTENT);
const CLAIM_DIGEST =
  `bootstrap-claim-sha256-v1:${"a".repeat(64)}`;
const DATABASE_TARGET_SHA256 = `sha256:${"b".repeat(64)}`;

describe("identity bootstrap lifecycle preflight v1", () => {
  it("requires the complete reviewed target, claim, intent, and database binding", () => {
    assert.deepEqual(
      parseIdentityBootstrapLifecyclePreflightArgs(baseArgs()),
      options(),
    );

    for (const args of [
      [],
      baseArgs().slice(0, -2),
      [...baseArgs(), "--claim-digest", CLAIM_DIGEST],
      replaceArg(baseArgs(), "--target-app-user-id", TARGET.toUpperCase()),
      replaceArg(
        baseArgs(),
        "--target-app-user-sha256",
        `sha256:${"0".repeat(64)}`,
      ),
      replaceArg(baseArgs(), "--claim-digest", "not-a-claim-digest"),
      replaceArg(
        baseArgs(),
        "--reviewed-database-target-fingerprint",
        "sha256:short",
      ),
    ]) {
      assert.throws(
        () => parseIdentityBootstrapLifecyclePreflightArgs(args),
        IdentityBootstrapLifecyclePreflightError,
      );
    }
  });

  it("accepts only one expired unterminated intent for a provisioning user without identity", () => {
    const output = buildIdentityBootstrapLifecyclePreflight({
      row: readyRow(),
      options: options(),
      databaseTargetFingerprint: DATABASE_TARGET_SHA256,
    });
    const serialized = JSON.stringify(output);

    assert.equal(output.result, "ready_for_new_issue");
    assert.deepEqual(output.state, {
      target: "provisioning_user",
      providerIdentity: "absent",
      matchingIntent: "expired_unterminated",
      openIntent: "absent",
    });
    assert.deepEqual(output.blockers, []);
    assert.equal(output.readOnly, true);
    assert.equal(output.databaseSideEffects, false);
    assert.equal(output.transaction.accessMode, "read_only");
    assert.equal(output.transaction.retryCount, 0);
    assert.equal(serialized.includes(TARGET), false);
    assert.equal(serialized.includes(INTENT), false);
    assert.equal(serialized.includes(CLAIM_DIGEST), false);
  });

  it("blocks consumed, revoked, unexpired, identified, and state-drifted targets", () => {
    const fixtures = [
      [
        { terminalEventCount: 1, terminalEventType: "consumed" },
        "matching_intent_consumed",
      ],
      [
        { terminalEventCount: 1, terminalEventType: "revoked" },
        "matching_intent_revoked",
      ],
      [
        {
          expiresAt: "2026-08-01T01:05:00.000Z",
          openIntentCount: 1,
        },
        "matching_intent_unexpired",
      ],
      [{ providerIdentityCount: 1 }, "target_provider_identity_present"],
      [{ targetStatus: "active" }, "target_app_user_state_mismatch"],
      [{ intentProvider: "other" }, "matching_intent_binding_drift"],
    ];

    for (const [overrides, blocker] of fixtures) {
      const output = buildIdentityBootstrapLifecyclePreflight({
        row: readyRow(overrides),
        options: options(),
        databaseTargetFingerprint: DATABASE_TARGET_SHA256,
      });
      assert.equal(output.result, "blocked");
      assert.equal(output.blockers.includes(blocker), true);
    }
  });

  it("distinguishes a missing or ambiguous matching intent", () => {
    const missing = buildIdentityBootstrapLifecyclePreflight({
      row: readyRow({
        matchingIntentCount: 0,
        identityPairingIntentId: null,
        authorityPolicyId: null,
        intentTargetAppUserId: null,
        intentProvider: null,
        intentClaimDigestVersion: null,
        intentClaimDigest: null,
        targetReviewPolicyId: null,
        issuedAt: null,
        expiresAt: null,
      }),
      options: options(),
      databaseTargetFingerprint: DATABASE_TARGET_SHA256,
    });
    const ambiguous = buildIdentityBootstrapLifecyclePreflight({
      row: readyRow({ matchingIntentCount: 2 }),
      options: options(),
      databaseTargetFingerprint: DATABASE_TARGET_SHA256,
    });

    assert.deepEqual(missing.blockers, ["matching_intent_not_found"]);
    assert.equal(
      ambiguous.blockers.includes("matching_intent_ambiguous"),
      true,
    );
  });

  it("never invokes accessor-backed evidence", () => {
    let calls = 0;
    const row = readyRow();
    Object.defineProperty(row, "observedAt", {
      get() {
        calls += 1;
        return "2026-08-01T01:00:00.000Z";
      },
    });

    assert.throws(
      () =>
        buildIdentityBootstrapLifecyclePreflight({
          row,
          options: options(),
          databaseTargetFingerprint: DATABASE_TARGET_SHA256,
        }),
      (error) =>
        error instanceof IdentityBootstrapLifecyclePreflightError &&
        error.code === "database_snapshot_invalid",
    );
    assert.equal(calls, 0);
  });

  it("guards the reviewed Production target before creating a Pool", async () => {
    let pools = 0;
    await assert.rejects(
      runIdentityBootstrapLifecyclePreflight({
        args: baseArgs(),
        loadEnvironment: () => environment(),
        guardDatabaseTarget: () => ({
          targetFingerprint: `sha256:${"0".repeat(64)}`,
        }),
        createPool() {
          pools += 1;
        },
      }),
      (error) =>
        error instanceof IdentityBootstrapLifecyclePreflightError &&
        error.code ===
          "reviewed_database_target_fingerprint_mismatch",
    );
    assert.equal(pools, 0);
  });

  it("runs one guarded read and closes the Pool without exposing private binding values", async () => {
    const events = [];
    const output = await runIdentityBootstrapLifecyclePreflight({
      args: baseArgs(),
      loadEnvironment() {
        events.push("load_environment");
        return environment();
      },
      guardDatabaseTarget() {
        events.push("guard_target");
        return { targetFingerprint: DATABASE_TARGET_SHA256 };
      },
      createPool(connectionString) {
        events.push("create_pool");
        assert.equal(connectionString, "unpooled");
        return {
          async end() {
            events.push("pool_end");
          },
        };
      },
      async readSnapshot({ options: receivedOptions }) {
        events.push("read_snapshot");
        assert.deepEqual(receivedOptions, options());
        return [readyRow()];
      },
    });

    assert.deepEqual(events, [
      "load_environment",
      "guard_target",
      "create_pool",
      "read_snapshot",
      "pool_end",
    ]);
    assert.equal(output.result, "ready_for_new_issue");
    assert.equal(output.connectionCloseStatus, "closed");
    const serialized = JSON.stringify(output);
    assert.equal(serialized.includes(TARGET), false);
    assert.equal(serialized.includes(INTENT), false);
    assert.equal(serialized.includes(CLAIM_DIGEST), false);
  });

  it("uses exactly one repeatable-read read-only transaction and no retry", async () => {
    const calls = [];
    let released = 0;
    const rows = await readIdentityBootstrapLifecycleSnapshot({
      pool: {
        async connect() {
          return {
            async query(query, params) {
              calls.push({ query, params });
              if (query === IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_SQL) {
                return { rows: [readyRow()] };
              }
              return { rows: [] };
            },
            release() {
              released += 1;
            },
          };
        },
      },
      options: options(),
    });

    assert.equal(rows.length, 1);
    assert.equal(released, 1);
    assert.deepEqual(
      calls.map(({ query }) => query),
      [
        "begin isolation level repeatable read read only",
        "set local statement_timeout = '8s'",
        IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_SQL,
        "commit",
      ],
    );
    assert.deepEqual(calls[2].params, [
      IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_POLICY.claimDigestVersion,
      CLAIM_DIGEST,
      TARGET,
      IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_POLICY.provider,
    ]);
  });

  it("keeps the executable server-only, strict-env, SELECT-only, and retry-free", () => {
    const source = readFileSync(
      "scripts/preflight-identity-bootstrap-lifecycle.mjs",
      "utf8",
    );
    const combined = `${source}\n${IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_SQL}`;

    assert.match(source, /loadProductionDatabaseEnvironmentFromEnvLocal/);
    assert.match(source, /guardProductionDatabaseTarget/);
    assert.match(source, /repeatable read read only/);
    assert.doesNotMatch(source, /dotenv\.config|process\.env|\bfetch\s*\(/);
    assert.doesNotMatch(
      combined,
      /\b(?:insert\s+into|update\s+|delete\s+from|merge\s+into|truncate\s+)\b/i,
    );
    assert.doesNotMatch(
      source,
      /providerSubject|rawClaim|DATABASE_URL[^_U]|postgres(?:ql)?:\/\//i,
    );
    assert.equal(
      IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_POLICY.retryCount,
      0,
    );
  });
});

function baseArgs() {
  return [
    "--target-app-user-id",
    TARGET,
    "--target-app-user-sha256",
    TARGET_SHA256,
    "--claim-digest-version",
    IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_POLICY.claimDigestVersion,
    "--claim-digest",
    CLAIM_DIGEST,
    "--identity-pairing-intent-sha256",
    INTENT_SHA256,
    "--reviewed-database-target-fingerprint",
    DATABASE_TARGET_SHA256,
  ];
}

function options() {
  return Object.freeze({
    targetAppUserId: TARGET,
    targetAppUserSha256: TARGET_SHA256,
    claimDigestVersion:
      IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_POLICY.claimDigestVersion,
    claimDigest: CLAIM_DIGEST,
    identityPairingIntentSha256: INTENT_SHA256,
    reviewedDatabaseTargetFingerprint: DATABASE_TARGET_SHA256,
  });
}

function readyRow(overrides = {}) {
  return {
    observedAt: "2026-08-01T01:00:00.000Z",
    targetAppUserId: TARGET,
    targetStatus: "provisioning",
    targetRole: "user",
    providerIdentityCount: 0,
    matchingIntentCount: 1,
    identityPairingIntentId: INTENT,
    authorityPolicyId:
      IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_POLICY.authorityPolicyId,
    intentTargetAppUserId: TARGET,
    intentProvider:
      IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_POLICY.provider,
    intentClaimDigestVersion:
      IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_POLICY.claimDigestVersion,
    intentClaimDigest: CLAIM_DIGEST,
    targetReviewPolicyId:
      IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_POLICY.targetReviewPolicyId,
    issuedAt: "2026-08-01T00:40:00.000Z",
    expiresAt: "2026-08-01T00:50:00.000Z",
    terminalEventCount: 0,
    terminalEventType: null,
    openIntentCount: 0,
    ...overrides,
  };
}

function replaceArg(args, key, value) {
  const next = [...args];
  next[next.indexOf(key) + 1] = value;
  return next;
}

function environment() {
  return Object.freeze({
    DATABASE_URL: "pooled",
    DATABASE_URL_UNPOOLED: "unpooled",
    NEON_PROJECT_ID: "project",
  });
}
