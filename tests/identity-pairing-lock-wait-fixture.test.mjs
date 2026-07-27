import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  IdentityPairingConsumeError,
} from "../scripts/lib/identity-pairing-consume-writer.mjs";
import {
  classifyIdentityPairingLockObservation,
  confirmIdentityPairingDatabaseExpiry,
  finalizeIdentityPairingLockWaitFixture,
} from "../scripts/lib/identity-pairing-lock-wait-fixture.mjs";
import {
  IdentityPairingRehearsalFixtureError,
} from "../scripts/lib/identity-pairing-rehearsal-evidence.mjs";

describe("identity pairing lock-wait rehearsal fixture", () => {
  it("uses query start for proof and observer time only for diagnostics", () => {
    const lockedAt = "2026-07-27T00:00:00.000Z";
    const expiresAt = "2026-07-27T00:00:01.250Z";

    assert.deepEqual(
      classifyIdentityPairingLockObservation({
        lockedAt,
        expiresAt,
        queryStartedAt: "2026-07-27T00:00:00.200Z",
        observedAt: "2026-07-27T00:00:01.249Z",
      }),
      {
        status: "query_started_before_expiry",
        queryStartRemainingMilliseconds: 1_050,
        observationStatus: "observed_before_expiry",
        observationRemainingMilliseconds: 1,
      },
    );
    assert.deepEqual(
      classifyIdentityPairingLockObservation({
        lockedAt,
        expiresAt,
        queryStartedAt: "2026-07-27T00:00:00.200Z",
        observedAt: expiresAt,
      }),
      {
        status: "query_started_before_expiry",
        queryStartRemainingMilliseconds: 1_050,
        observationStatus: "observer_late_after_query_start_proof",
        observationRemainingMilliseconds: 0,
      },
    );
    assert.deepEqual(
      classifyIdentityPairingLockObservation({
        lockedAt,
        expiresAt,
        queryStartedAt: expiresAt,
        observedAt: "2026-07-27T00:00:01.251Z",
      }),
      {
        status: "query_started_at_or_after_expiry",
        queryStartRemainingMilliseconds: 0,
        observationStatus:
          "observer_late_without_pre_expiry_query_start",
        observationRemainingMilliseconds: -1,
      },
    );
  });

  it("rejects invalid or undersized claim timing", () => {
    assert.throws(
      () =>
        classifyIdentityPairingLockObservation({
          lockedAt: "2026-07-27T00:00:00.000Z",
          expiresAt: "2026-07-27T00:00:00.749Z",
          queryStartedAt: "2026-07-27T00:00:00.100Z",
          observedAt: "2026-07-27T00:00:00.100Z",
        }),
      isFixtureError("lock_wait_claim_timing_invalid"),
    );
    assert.throws(
      () =>
        classifyIdentityPairingLockObservation({
          lockedAt: "not-a-date",
          expiresAt: "2026-07-27T00:00:01.250Z",
          queryStartedAt: "2026-07-27T00:00:00.100Z",
          observedAt: "2026-07-27T00:00:00.100Z",
        }),
      isFixtureError("lock_wait_claim_timing_invalid"),
    );
  });

  it("fails closed for missing, malformed, or out-of-order query start", () => {
    const input = {
      lockedAt: "2026-07-27T00:00:00.000Z",
      expiresAt: "2026-07-27T00:00:01.250Z",
      observedAt: "2026-07-27T00:00:00.500Z",
    };

    for (const queryStartedAt of [
      null,
      "not-a-date",
      "2026-07-26T23:59:59.999Z",
      "2026-07-27T00:00:00.501Z",
    ]) {
      assert.throws(
        () =>
          classifyIdentityPairingLockObservation({
            ...input,
            queryStartedAt,
          }),
        isFixtureError("lock_wait_query_start_invalid"),
      );
    }
  });

  it("re-reads the database clock after the local delay", async () => {
    const calls = [];
    let databaseNow = 1_000;
    const expiresAt = 1_040;

    await confirmIdentityPairingDatabaseExpiry({
      async readRemainingMilliseconds() {
        calls.push("remaining");
        return Math.max(0, expiresAt - databaseNow);
      },
      async delay(milliseconds) {
        calls.push(`delay:${milliseconds}`);
        databaseNow += milliseconds;
      },
      async readExpiryReached() {
        calls.push("expiry");
        return databaseNow >= expiresAt;
      },
    });

    assert.deepEqual(calls, ["remaining", "delay:140", "expiry"]);
  });

  it("rejects when the second database-clock read is not expired", async () => {
    await assert.rejects(
      () =>
        confirmIdentityPairingDatabaseExpiry({
          async readRemainingMilliseconds() {
            return 0;
          },
          async delay() {},
          async readExpiryReached() {
            return false;
          },
        }),
      isFixtureError("lock_wait_expiry_not_confirmed"),
    );
  });

  it("finishes early-failure cleanup before preserving the primary failure", async () => {
    const calls = [];
    const primaryFailure = new Error("synthetic primary failure");

    await assert.rejects(
      () =>
        finalizeIdentityPairingLockWaitFixture(
          fixturePorts(calls, { primaryFailure }),
        ),
      (error) => error === primaryFailure,
    );

    assert.deepEqual(calls, [
      "confirm-expiry",
      "rollback-blocker",
      "release-blocker:false",
      "release-observer",
      "release-unused-writer",
      "settle-writer",
      "assert-post-state",
    ]);
  });

  it("destroys the blocker connection after rollback failure", async () => {
    const calls = [];

    await assert.rejects(
      () =>
        finalizeIdentityPairingLockWaitFixture(
          fixturePorts(calls, {
            async rollbackBlocker() {
              calls.push("rollback-blocker");
              throw new Error("synthetic rollback failure");
            },
          }),
        ),
      isFixtureError("lock_wait_release_failed"),
    );

    assert.deepEqual(calls, [
      "confirm-expiry",
      "rollback-blocker",
      "release-blocker:true",
      "release-observer",
      "release-unused-writer",
      "settle-writer",
      "assert-post-state",
    ]);
  });

  it("rejects unexpected writer success after checking post-state", async () => {
    const calls = [];
    const primaryFailure = new Error("synthetic observation failure");

    await assert.rejects(
      () =>
        finalizeIdentityPairingLockWaitFixture(
          fixturePorts(calls, {
            primaryFailure,
            async settleWriter() {
              calls.push("settle-writer");
              return Object.freeze({
                status: "fulfilled",
                value: Object.freeze({ result: "consumed" }),
              });
            },
          }),
        ),
      isFixtureError("lock_wait_writer_unexpected_success"),
    );

    assert.deepEqual(calls.slice(-2), [
      "settle-writer",
      "assert-post-state",
    ]);
  });

  it("gives invalid post-state precedence over the primary failure", async () => {
    const calls = [];

    await assert.rejects(
      () =>
        finalizeIdentityPairingLockWaitFixture(
          fixturePorts(calls, {
            primaryFailure: new Error("synthetic primary failure"),
            async assertPostState() {
              calls.push("assert-post-state");
              throw new Error("synthetic post-state failure");
            },
          }),
        ),
      isFixtureError("lock_wait_post_state_invalid"),
    );

    assert.equal(calls.at(-1), "assert-post-state");
  });

  it("does not treat a database timeout as expected expiry rejection", async () => {
    const calls = [];

    await assert.rejects(
      () =>
        finalizeIdentityPairingLockWaitFixture(
          fixturePorts(calls, {
            async settleWriter() {
              calls.push("settle-writer");
              return Object.freeze({
                status: "rejected",
                error: new IdentityPairingConsumeError(
                  "database_timeout",
                ),
              });
            },
          }),
        ),
      (error) =>
        error instanceof IdentityPairingConsumeError &&
        error.code === "database_timeout",
    );
  });
});

function fixturePorts(calls, overrides = {}) {
  return {
    blockerTransactionOpen: true,
    writerStarted: true,
    claimCreated: true,
    expiresAt: "2026-07-27T00:00:01.250Z",
    primaryFailure: null,
    async confirmExpiry() {
      calls.push("confirm-expiry");
    },
    async rollbackBlocker() {
      calls.push("rollback-blocker");
    },
    releaseBlocker(destroy) {
      calls.push(`release-blocker:${destroy}`);
    },
    releaseObserver() {
      calls.push("release-observer");
    },
    releaseWriterIfUnused() {
      calls.push("release-unused-writer");
    },
    async settleWriter() {
      calls.push("settle-writer");
      return Object.freeze({
        status: "rejected",
        error: new IdentityPairingConsumeError(
          "claim_intent_expired",
        ),
      });
    },
    async assertPostState() {
      calls.push("assert-post-state");
    },
    ...overrides,
  };
}

function isFixtureError(expectedCode) {
  return (error) =>
    error instanceof IdentityPairingRehearsalFixtureError &&
    error.code === expectedCode;
}
