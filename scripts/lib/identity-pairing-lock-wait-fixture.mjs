import {
  IdentityPairingConsumeError,
} from "./identity-pairing-consume-writer.mjs";
import {
  IdentityPairingRehearsalFixtureError,
} from "./identity-pairing-rehearsal-evidence.mjs";

const MAX_EXPIRY_WAIT_MILLISECONDS = 1_250;
const EXPIRY_SETTLEMENT_MARGIN_MILLISECONDS = 100;

export async function confirmIdentityPairingDatabaseExpiry({
  readRemainingMilliseconds,
  delay,
  readExpiryReached,
}) {
  const remainingMilliseconds = Number(
    await readRemainingMilliseconds(),
  );
  assertFixture(
    Number.isInteger(remainingMilliseconds) &&
      remainingMilliseconds >= 0 &&
      remainingMilliseconds <= MAX_EXPIRY_WAIT_MILLISECONDS,
    "lock_wait_expiry_not_confirmed",
  );

  await delay(
    remainingMilliseconds + EXPIRY_SETTLEMENT_MARGIN_MILLISECONDS,
  );

  assertFixture(
    (await readExpiryReached()) === true,
    "lock_wait_expiry_not_confirmed",
  );
}

export async function finalizeIdentityPairingLockWaitFixture({
  blockerTransactionOpen,
  writerStarted,
  claimCreated,
  expiresAt,
  primaryFailure,
  confirmExpiry,
  rollbackBlocker,
  releaseBlocker,
  releaseWriterIfUnused,
  settleWriter,
  assertPostState,
}) {
  let cleanupFailure = null;
  let writerOutcome = null;
  let writerSettlementCompleted = false;
  let destroyBlockerConnection = false;

  if (blockerTransactionOpen) {
    if (writerStarted && expiresAt !== null) {
      try {
        await confirmExpiry();
      } catch {
        cleanupFailure = fixtureError(
          "lock_wait_expiry_not_confirmed",
        );
      }
    }

    try {
      await rollbackBlocker();
    } catch {
      cleanupFailure = fixtureError("lock_wait_release_failed");
      destroyBlockerConnection = true;
    }
  }

  try {
    releaseBlocker(destroyBlockerConnection);
  } catch {
    cleanupFailure = fixtureError("lock_wait_release_failed");
  }

  try {
    releaseWriterIfUnused();
  } catch {
    cleanupFailure ??= fixtureError(
      "lock_wait_writer_session_unavailable",
    );
  }

  if (writerStarted) {
    try {
      writerOutcome = await settleWriter();
      writerSettlementCompleted = true;
    } catch (error) {
      cleanupFailure ??= error;
    }
  }

  if (claimCreated) {
    try {
      await assertPostState();
    } catch {
      cleanupFailure = fixtureError("lock_wait_post_state_invalid");
    }
  }

  let writerFailure = null;
  if (writerStarted && writerSettlementCompleted) {
    try {
      assertExpectedConsumeFailure(writerOutcome, [
        "claim_intent_expired",
      ]);
    } catch (error) {
      writerFailure = error;
    }
  }

  if (cleanupFailure !== null) throw cleanupFailure;
  if (writerFailure !== null) throw writerFailure;
  if (primaryFailure !== null) throw primaryFailure;
}

function assertExpectedConsumeFailure(outcome, expectedCodes) {
  if (outcome?.status === "fulfilled") {
    throw fixtureError("lock_wait_writer_unexpected_success");
  }
  if (outcome?.status !== "rejected") {
    throw fixtureError("lock_wait_writer_unexpected_failure");
  }
  if (
    outcome.error instanceof IdentityPairingConsumeError &&
    expectedCodes.includes(outcome.error.code)
  ) {
    return;
  }
  if (outcome.error instanceof IdentityPairingConsumeError) {
    throw outcome.error;
  }
  throw fixtureError("lock_wait_writer_unexpected_failure");
}

function assertFixture(condition, code) {
  if (!condition) throw fixtureError(code);
}

function fixtureError(code) {
  return new IdentityPairingRehearsalFixtureError(code);
}
