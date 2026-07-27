import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createIdentityPairingRehearsalEvidence,
  IdentityPairingRehearsalFixtureError,
  IDENTITY_PAIRING_LOCK_WAIT_FAILURE_CODES,
  IDENTITY_PAIRING_REHEARSAL_STAGES,
} from "../scripts/lib/identity-pairing-rehearsal-evidence.mjs";
import {
  IdentityPairingConsumeError,
} from "../scripts/lib/identity-pairing-consume-writer.mjs";

describe("identity pairing rehearsal failure evidence", () => {
  it("records allowlisted progress without exposing failure details", () => {
    const evidence = createIdentityPairingRehearsalEvidence();
    evidence.begin("target_guard");
    evidence.complete("target_guard");
    evidence.begin("catalog_preflight");
    evidence.complete("catalog_preflight");
    evidence.begin("pool_readiness");

    const error = new Error("postgresql://secret-user:secret@secret-host");
    error.cause = {
      subject: "secret-subject",
      claim: "secret-claim",
      sql: "select secret",
    };
    const result = evidence.failure(error);

    assert.deepEqual(result, {
      rehearsal: "identity_pairing_atomic_consume_disposable_branch",
      status: "failed",
      stage: "pool_readiness",
      lastCompletedCheck: "catalog_preflight",
      poolReadiness: false,
      disposableBranchDmlAttempted: false,
      code: "pool_readiness_failed",
      productionDatabaseWrites: 0,
      branchDeletionRequired: true,
    });

    const serialized = JSON.stringify(result);
    for (const forbidden of [
      "secret-user",
      "secret-host",
      "secret-subject",
      "secret-claim",
      "select secret",
      "postgresql://",
      "stack",
      "cause",
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  });

  it("preserves only allowlisted consume and SQLSTATE codes", () => {
    const consumeEvidence = progressToSuccessfulConsume();
    assert.equal(
      consumeEvidence.failure(
        new IdentityPairingConsumeError("claim_intent_expired"),
      ).code,
      "consume_claim_intent_expired",
    );
    assert.equal(
      consumeEvidence.failure(
        new IdentityPairingConsumeError("secret_internal_reason"),
      ).code,
      "successful_consume_failed",
    );

    const sqlstateEvidence = progressToSuccessfulConsume();
    assert.equal(
      sqlstateEvidence.failure(
        Object.assign(new Error("secret"), { code: "08006" }),
      ).code,
      "sqlstate_08006",
    );
    assert.equal(
      sqlstateEvidence.failure(
        Object.assign(new Error("secret"), { code: "SECRET" }),
      ).code,
      "successful_consume_failed",
    );

    let codeReads = 0;
    const accessorCode = new Error("secret");
    Object.defineProperty(accessorCode, "code", {
      enumerable: true,
      get() {
        codeReads += 1;
        return "08006";
      },
    });
    assert.equal(
      progressToSuccessfulConsume().failure(accessorCode).code,
      "successful_consume_failed",
    );
    assert.equal(codeReads, 0);

    let consumeCodeReads = 0;
    const accessorConsume = new IdentityPairingConsumeError(
      "claim_intent_expired",
    );
    delete accessorConsume.code;
    Object.defineProperty(accessorConsume, "code", {
      enumerable: true,
      get() {
        consumeCodeReads += 1;
        return "claim_intent_expired";
      },
    });
    assert.equal(
      progressToSuccessfulConsume().failure(accessorConsume).code,
      "successful_consume_failed",
    );
    assert.equal(consumeCodeReads, 0);

    let codeCoercions = 0;
    const objectCode = new Error("secret");
    Object.defineProperty(objectCode, "code", {
      value: {
        toString() {
          codeCoercions += 1;
          return "08006";
        },
      },
    });
    assert.equal(
      progressToSuccessfulConsume().failure(objectCode).code,
      "successful_consume_failed",
    );
    assert.equal(codeCoercions, 0);
  });

  it("preserves only allowlisted catalog preflight codes", () => {
    const allowlisted = progressToCatalogPreflight();
    assert.equal(
      allowlisted.failure(
        Object.assign(new Error("secret"), {
          code: "catalog_preflight_child_database_read_failed",
        }),
      ).code,
      "catalog_preflight_child_database_read_failed",
    );

    const unknown = progressToCatalogPreflight();
    assert.equal(
      unknown.failure(
        Object.assign(new Error("secret"), {
          code: "catalog_preflight_secret_internal_reason",
        }),
      ).code,
      "catalog_preflight_failed",
    );
  });

  it("preserves only typed allowlisted lock-wait fixture codes", () => {
    for (const code of IDENTITY_PAIRING_LOCK_WAIT_FAILURE_CODES) {
      assert.equal(
        progressToLockWaitExpiry().failure(
          new IdentityPairingRehearsalFixtureError(code),
        ).code,
        code,
      );
    }

    assert.equal(
      progressToLockWaitExpiry().failure(
        new IdentityPairingRehearsalFixtureError(
          "lock_wait_secret_internal_reason",
        ),
      ).code,
      "lock_wait_expiry_failed",
    );
    assert.equal(
      progressToLockWaitExpiry().failure(
        Object.assign(new Error("secret"), {
          code: "lock_wait_post_state_invalid",
        }),
      ).code,
      "lock_wait_expiry_failed",
    );
  });

  it("exposes only the exact late-observer outcome statuses", () => {
    const error = new IdentityPairingRehearsalFixtureError(
      "lock_wait_observed_after_expiry",
    );
    Object.defineProperty(error, "lockWaitOutcome", {
      value: Object.freeze({
        observationStatus: "observer_late_before_expiry_proof",
        writerStatus: "claim_intent_expired",
        postStateStatus: "unconsumed",
      }),
    });

    const result = progressToLockWaitExpiry().failure(error);
    assert.deepEqual(result.lockWaitOutcome, {
      observationStatus: "observer_late_before_expiry_proof",
      writerStatus: "claim_intent_expired",
      postStateStatus: "unconsumed",
    });

    let accessorReads = 0;
    const accessorError = new IdentityPairingRehearsalFixtureError(
      "lock_wait_observed_after_expiry",
    );
    Object.defineProperty(accessorError, "lockWaitOutcome", {
      get() {
        accessorReads += 1;
        return result.lockWaitOutcome;
      },
    });
    assert.equal(
      progressToLockWaitExpiry().failure(accessorError)
        .lockWaitOutcome,
      undefined,
    );
    assert.equal(accessorReads, 0);
  });

  it("tracks Pool readiness and the first disposable DML boundary", () => {
    const evidence = progressToSuccessfulConsume();
    const beforeDml = evidence.failure(new Error("synthetic"));
    assert.equal(beforeDml.poolReadiness, true);
    assert.equal(beforeDml.disposableBranchDmlAttempted, false);

    evidence.markDisposableBranchDmlAttempted();
    const afterDml = evidence.failure(new Error("synthetic"));
    assert.equal(afterDml.poolReadiness, true);
    assert.equal(afterDml.disposableBranchDmlAttempted, true);
  });

  it("rejects skipped, repeated, and unknown stages", () => {
    const evidence = createIdentityPairingRehearsalEvidence();
    assert.throws(() => evidence.begin("catalog_preflight"), /order/);
    assert.throws(() => evidence.begin("secret_stage"), /allowlisted/);
    assert.throws(() => evidence.complete("catalog_preflight"), /completion/);

    evidence.begin("target_guard");
    evidence.complete("target_guard");
    assert.throws(() => evidence.begin("pool_readiness"), /order/);
    assert.throws(
      () => evidence.markPoolReady(),
      /Pool readiness stage/,
    );
    assert.throws(
      () => evidence.markDisposableBranchDmlAttempted(),
      /DML boundary/,
    );
  });

  it("completes the fixed stage list without runtime data", () => {
    const evidence = createIdentityPairingRehearsalEvidence();
    for (const stage of IDENTITY_PAIRING_REHEARSAL_STAGES) {
      evidence.begin(stage);
      if (stage === "pool_readiness") evidence.markPoolReady();
      if (stage === "successful_consume") {
        evidence.markDisposableBranchDmlAttempted();
      }
      evidence.complete(stage);
    }

    assert.deepEqual(evidence.success(), {
      stage: "completed",
      lastCompletedCheck: "terminal_insert_full_rollback",
      poolReadiness: true,
      disposableBranchDmlAttempted: true,
    });
  });
});

function progressToSuccessfulConsume() {
  const evidence = createIdentityPairingRehearsalEvidence();
  for (const stage of [
    "target_guard",
    "catalog_preflight",
    "pool_readiness",
    "schema_empty",
  ]) {
    evidence.begin(stage);
    if (stage === "pool_readiness") evidence.markPoolReady();
    evidence.complete(stage);
  }
  evidence.begin("successful_consume");
  return evidence;
}

function progressToCatalogPreflight() {
  const evidence = createIdentityPairingRehearsalEvidence();
  evidence.begin("target_guard");
  evidence.complete("target_guard");
  evidence.begin("catalog_preflight");
  return evidence;
}

function progressToLockWaitExpiry() {
  const evidence = createIdentityPairingRehearsalEvidence();
  for (const stage of [
    "target_guard",
    "catalog_preflight",
    "pool_readiness",
    "schema_empty",
    "successful_consume",
    "expired_claim",
  ]) {
    evidence.begin(stage);
    if (stage === "pool_readiness") evidence.markPoolReady();
    if (stage === "successful_consume") {
      evidence.markDisposableBranchDmlAttempted();
    }
    evidence.complete(stage);
  }
  evidence.begin("lock_wait_expiry");
  return evidence;
}
