import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  IdentityPairingConsumeError,
} from "../scripts/lib/identity-pairing-consume-writer.mjs";
import {
  confirmIdentityPairingDatabaseExpiry,
  finalizeIdentityPairingLockWaitFixture,
} from "../scripts/lib/identity-pairing-lock-wait-fixture.mjs";
import {
  IdentityPairingRehearsalFixtureError,
} from "../scripts/lib/identity-pairing-rehearsal-evidence.mjs";

describe("identity pairing lock-wait rehearsal fixture", () => {
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
