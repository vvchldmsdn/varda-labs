import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  LEGACY_ACCOUNT_OWNER_ASSIGNMENT_CLI_POLICY,
  LegacyAccountOwnerAssignmentCliError,
  readLegacyAccountOwnerAssignmentCliOptions,
  runLegacyAccountOwnerAssignmentCli,
} from "../scripts/assign-legacy-account-owners.mjs";

const CLAIM_DIGEST =
  `bootstrap-claim-sha256-v1:${"a".repeat(64)}`;
const TARGET_SHA256 = `sha256:${"b".repeat(64)}`;
const LEGACY_OWNER_SHA256 = `sha256:${"c".repeat(64)}`;
const CANDIDATE_SET_DIGEST = `sha256:${"d".repeat(64)}`;
const ELIGIBLE_SET_DIGEST = `sha256:${"e".repeat(64)}`;
const DATABASE_TARGET_SHA256 = `sha256:${"f".repeat(64)}`;
const PRIVATE_INTENT_ID = "11111111-1111-4111-8111-111111111111";

describe("legacy account owner assignment migration CLI", () => {
  it("defaults to dry-run and requires the exact write confirmation", () => {
    assert.deepEqual(
      readLegacyAccountOwnerAssignmentCliOptions(baseArgs()),
      {
        mode: "dry_run",
        write: false,
        claimDigest: CLAIM_DIGEST,
        targetAppUserSha256: TARGET_SHA256,
        legacyOwnerSha256: LEGACY_OWNER_SHA256,
        candidateSetDigest: CANDIDATE_SET_DIGEST,
        eligibleSetDigest: ELIGIBLE_SET_DIGEST,
        reviewedDatabaseTargetFingerprint: null,
      },
    );
    assert.deepEqual(
      readLegacyAccountOwnerAssignmentCliOptions(writeArgs()),
      {
        mode: "write",
        write: true,
        claimDigest: CLAIM_DIGEST,
        targetAppUserSha256: TARGET_SHA256,
        legacyOwnerSha256: LEGACY_OWNER_SHA256,
        candidateSetDigest: CANDIDATE_SET_DIGEST,
        eligibleSetDigest: ELIGIBLE_SET_DIGEST,
        reviewedDatabaseTargetFingerprint: DATABASE_TARGET_SHA256,
      },
    );

    for (const args of [
      [...baseArgs(), "--write"],
      [
        ...baseArgs(),
        "--write",
        LEGACY_ACCOUNT_OWNER_ASSIGNMENT_CLI_POLICY.confirmation,
      ],
      [
        ...baseArgs(),
        LEGACY_ACCOUNT_OWNER_ASSIGNMENT_CLI_POLICY.confirmation,
      ],
      [...baseArgs(), "--identity-pairing-intent-id", PRIVATE_INTENT_ID],
      [...baseArgs(), "--claim-digest", CLAIM_DIGEST],
      [
        ...baseArgs(),
        "--reviewed-database-target-fingerprint",
        DATABASE_TARGET_SHA256,
      ],
      baseArgs().filter((value) => value !== ELIGIBLE_SET_DIGEST),
    ]) {
      assert.throws(
        () => readLegacyAccountOwnerAssignmentCliOptions(args),
        (error) =>
          error instanceof LegacyAccountOwnerAssignmentCliError,
      );
    }
  });

  it("runs guarded dry-run through the writer transaction path", async () => {
    const events = [];
    let writeCalls = 0;
    const result = await runLegacyAccountOwnerAssignmentCli({
      args: baseArgs(),
      loadEnvironment() {
        events.push("load_environment");
        return environment();
      },
      guardDatabaseTarget(value) {
        events.push("guard_target");
        assert.equal(value.DATABASE_URL_UNPOOLED, "unpooled");
        return { targetFingerprint: DATABASE_TARGET_SHA256 };
      },
      createPool(connectionString) {
        events.push("create_pool");
        assert.equal(connectionString, "unpooled");
        return {
          end() {
            events.push("pool_end");
          },
        };
      },
      async planAssignment(input) {
        events.push("plan_assignment");
        assertAssignmentInput(input);
        return assignmentResult({
          mode: "dry_run",
          result: "planned",
          plannedAccounts: 4,
          actualAccounts: 0,
          committed: false,
        });
      },
      async writeAssignment() {
        writeCalls += 1;
      },
    });

    assert.deepEqual(events, [
      "load_environment",
      "guard_target",
      "create_pool",
      "plan_assignment",
      "pool_end",
    ]);
    assert.equal(writeCalls, 0);
    assert.deepEqual(result, {
      operation:
        LEGACY_ACCOUNT_OWNER_ASSIGNMENT_CLI_POLICY.operation,
      mode: "dry_run",
      result: "planned",
      databaseTargetFingerprint: DATABASE_TARGET_SHA256,
      evidence: {
        targetAppUserSha256: TARGET_SHA256,
        legacyOwnerSha256: LEGACY_OWNER_SHA256,
        candidateSetDigest: CANDIDATE_SET_DIGEST,
        eligibleSetDigest: ELIGIBLE_SET_DIGEST,
      },
      accountCounts: {
        expected: 4,
        planned: 4,
        written: 0,
      },
      committed: false,
      connectionCloseStatus: "closed",
      retryCount: 0,
    });
    const output = JSON.stringify(result);
    assert.equal(output.includes(CLAIM_DIGEST), false);
    assert.equal(output.includes(PRIVATE_INTENT_ID), false);
  });

  it("runs write exactly once only with the fixed confirmation", async () => {
    const calls = { plan: 0, write: 0, close: 0 };
    const result = await runLegacyAccountOwnerAssignmentCli({
      args: writeArgs(),
      loadEnvironment: () => environment(),
      guardDatabaseTarget: () => ({
        targetFingerprint: DATABASE_TARGET_SHA256,
      }),
      createPool: () => ({
        end() {
          calls.close += 1;
        },
      }),
      async planAssignment() {
        calls.plan += 1;
      },
      async writeAssignment(input) {
        calls.write += 1;
        assertAssignmentInput(input);
        return assignmentResult({
          mode: "write",
          result: "assigned",
          plannedAccounts: 4,
          actualAccounts: 4,
          committed: true,
        });
      },
    });

    assert.deepEqual(calls, { plan: 0, write: 1, close: 1 });
    assert.equal(result.mode, "write");
    assert.equal(result.result, "assigned");
    assert.equal(result.accountCounts.written, 4);
    assert.equal(result.committed, true);
  });

  it("requires the reviewed database target before any write dependency", async () => {
    const calls = { environment: 0, pool: 0, writer: 0 };
    await assert.rejects(
      runLegacyAccountOwnerAssignmentCli({
        args: [
          ...baseArgs(),
          "--write",
          LEGACY_ACCOUNT_OWNER_ASSIGNMENT_CLI_POLICY.confirmation,
        ],
        loadEnvironment() {
          calls.environment += 1;
          return environment();
        },
        createPool() {
          calls.pool += 1;
        },
        async writeAssignment() {
          calls.writer += 1;
        },
      }),
      (error) =>
        error instanceof LegacyAccountOwnerAssignmentCliError &&
        error.code ===
          "reviewed_database_target_fingerprint_required",
    );
    assert.deepEqual(calls, { environment: 0, pool: 0, writer: 0 });
  });

  it("blocks a changed database target before Pool or writer calls", async () => {
    const calls = { pool: 0, writer: 0 };
    await assert.rejects(
      runLegacyAccountOwnerAssignmentCli({
        args: writeArgs(),
        loadEnvironment: () => environment(),
        guardDatabaseTarget: () => ({
          targetFingerprint: `sha256:${"0".repeat(64)}`,
        }),
        createPool() {
          calls.pool += 1;
        },
        async writeAssignment() {
          calls.writer += 1;
        },
      }),
      (error) =>
        error instanceof LegacyAccountOwnerAssignmentCliError &&
        error.code ===
          "reviewed_database_target_fingerprint_mismatch",
    );
    assert.deepEqual(calls, { pool: 0, writer: 0 });
  });

  it("blocks target drift before Pool creation", async () => {
    let pools = 0;
    await assert.rejects(
      runLegacyAccountOwnerAssignmentCli({
        args: baseArgs(),
        loadEnvironment: () => environment(),
        guardDatabaseTarget() {
          throw new Error("drift");
        },
        createPool() {
          pools += 1;
        },
      }),
      (error) =>
        error instanceof LegacyAccountOwnerAssignmentCliError &&
        error.code === "production_database_target_guard_failed",
    );
    assert.equal(pools, 0);
  });

  it("closes once after a writer failure and never retries", async () => {
    const calls = { assignment: 0, close: 0 };
    await assert.rejects(
      runLegacyAccountOwnerAssignmentCli({
        args: baseArgs(),
        loadEnvironment: () => environment(),
        guardDatabaseTarget: () => ({
          targetFingerprint: DATABASE_TARGET_SHA256,
        }),
        createPool: () => ({
          end() {
            calls.close += 1;
          },
        }),
        async planAssignment() {
          calls.assignment += 1;
          const error = new Error("private detail");
          error.code = "account_evidence_digest_drift";
          throw error;
        },
      }),
      (error) =>
        error instanceof LegacyAccountOwnerAssignmentCliError &&
        error.code === "account_evidence_digest_drift" &&
        !error.message.includes("private detail"),
    );
    assert.deepEqual(calls, { assignment: 1, close: 1 });
  });

  it("reports an unconfirmed Pool close without repeating a committed write", async () => {
    let writeCalls = 0;
    const result = await runLegacyAccountOwnerAssignmentCli({
      args: writeArgs(),
      loadEnvironment: () => environment(),
      guardDatabaseTarget: () => ({
        targetFingerprint: DATABASE_TARGET_SHA256,
      }),
      createPool: () => ({
        end() {
          throw new Error("close failed");
        },
      }),
      async writeAssignment() {
        writeCalls += 1;
        return assignmentResult({
          mode: "write",
          result: "assigned",
          plannedAccounts: 4,
          actualAccounts: 4,
          committed: true,
        });
      },
    });

    assert.equal(writeCalls, 1);
    assert.equal(result.result, "assigned");
    assert.equal(result.committed, true);
    assert.equal(result.connectionCloseStatus, "unconfirmed");
  });

  it("keeps HTTP, session, issuer, raw intent IDs, and dotenv fallback out of scope", () => {
    const source = readFileSync(
      "scripts/assign-legacy-account-owners.mjs",
      "utf8",
    );
    const environmentSource = readFileSync(
      "scripts/lib/production-database-environment.mjs",
      "utf8",
    );

    assert.match(source, /guardProductionDatabaseTarget/);
    assert.match(source, /planLegacyAccountOwnerAssignment/);
    assert.match(source, /assignLegacyAccountsToConsumedIdentity/);
    assert.match(source, /--reviewed-database-target-fingerprint/);
    assert.doesNotMatch(
      source,
      /identity-bootstrap-claim-issuer|verified-session|session-subject-binding|src\/app|next\/server|\bcookies\s*\(|\bheaders\s*\(|\bfetch\s*\(|identityPairingIntentId|--identity-pairing-intent-id/,
    );
    assert.doesNotMatch(source, /dotenv\.config|process\.env/);
    assert.match(environmentSource, /parseEnvironment/);
    assert.doesNotMatch(environmentSource, /dotenv\.config|process\.env/);
  });
});

function baseArgs() {
  return [
    "--claim-digest",
    CLAIM_DIGEST,
    "--target-app-user-sha256",
    TARGET_SHA256,
    "--legacy-owner-sha256",
    LEGACY_OWNER_SHA256,
    "--candidate-set-digest",
    CANDIDATE_SET_DIGEST,
    "--eligible-set-digest",
    ELIGIBLE_SET_DIGEST,
  ];
}

function writeArgs() {
  return [
    ...baseArgs(),
    "--write",
    LEGACY_ACCOUNT_OWNER_ASSIGNMENT_CLI_POLICY.confirmation,
    "--reviewed-database-target-fingerprint",
    DATABASE_TARGET_SHA256,
  ];
}

function environment() {
  return Object.freeze({
    DATABASE_URL: "pooled",
    DATABASE_URL_UNPOOLED: "unpooled",
    NEON_PROJECT_ID: "project",
  });
}

function assertAssignmentInput(input) {
  assert.equal(typeof input.pool, "object");
  assert.equal(input.claimDigest, CLAIM_DIGEST);
  assert.equal(input.targetAppUserSha256, TARGET_SHA256);
  assert.equal(input.legacyOwnerSha256, LEGACY_OWNER_SHA256);
  assert.equal(input.candidateSetDigest, CANDIDATE_SET_DIGEST);
  assert.equal(input.eligibleSetDigest, ELIGIBLE_SET_DIGEST);
  assert.equal(Object.hasOwn(input, "identityPairingIntentId"), false);
}

function assignmentResult({
  mode,
  result,
  plannedAccounts,
  actualAccounts,
  committed,
}) {
  return Object.freeze({
    mode,
    result,
    evidence: Object.freeze({
      candidateSetDigest: CANDIDATE_SET_DIGEST,
      eligibleSetDigest: ELIGIBLE_SET_DIGEST,
    }),
    plannedWrites: Object.freeze({
      accounts: plannedAccounts,
    }),
    actualWrites: Object.freeze({
      accounts: actualAccounts,
    }),
    committed,
  });
}
