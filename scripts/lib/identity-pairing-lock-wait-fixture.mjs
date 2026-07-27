import {
  IdentityPairingConsumeError,
} from "./identity-pairing-consume-writer.mjs";
import {
  IdentityPairingRehearsalFixtureError,
} from "./identity-pairing-rehearsal-evidence.mjs";

const MAX_EXPIRY_WAIT_MILLISECONDS = 1_250;
const EXPIRY_SETTLEMENT_MARGIN_MILLISECONDS = 100;
const MINIMUM_LOCK_LIFETIME_MILLISECONDS = 750;

export function classifyIdentityPairingLockObservation({
  lockedAt,
  expiresAt,
  observedAt,
}) {
  const lockedAtMilliseconds = readTimestampMilliseconds(lockedAt);
  const expiresAtMilliseconds = readTimestampMilliseconds(expiresAt);
  const observedAtMilliseconds = readTimestampMilliseconds(observedAt);

  assertFixture(
    expiresAtMilliseconds - lockedAtMilliseconds >=
      MINIMUM_LOCK_LIFETIME_MILLISECONDS &&
      observedAtMilliseconds >= lockedAtMilliseconds,
    "lock_wait_claim_timing_invalid",
  );

  const remainingMilliseconds =
    expiresAtMilliseconds - observedAtMilliseconds;
  return Object.freeze({
    status:
      remainingMilliseconds > 0
        ? "observed_before_expiry"
        : "observer_late_before_expiry_proof",
    remainingMilliseconds,
  });
}

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
  releaseObserver,
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
    releaseObserver();
  } catch {
    cleanupFailure ??= fixtureError("lock_wait_release_failed");
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
  let writerStatus = null;
  if (writerStarted && writerSettlementCompleted) {
    try {
      writerStatus = assertExpectedConsumeFailure(writerOutcome, [
        "claim_intent_expired",
      ]);
    } catch (error) {
      writerFailure = error;
    }
  }

  if (cleanupFailure !== null) throw cleanupFailure;
  if (writerFailure !== null) throw writerFailure;
  if (primaryFailure !== null) {
    if (
      primaryFailure instanceof IdentityPairingRehearsalFixtureError &&
      primaryFailure.code === "lock_wait_observed_after_expiry" &&
      writerStatus === "claim_intent_expired" &&
      claimCreated
    ) {
      throw lateObservationError();
    }
    throw primaryFailure;
  }
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
    return outcome.error.code;
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

function lateObservationError() {
  const error = fixtureError("lock_wait_observed_after_expiry");
  Object.defineProperty(error, "lockWaitOutcome", {
    configurable: false,
    enumerable: true,
    value: Object.freeze({
      observationStatus: "observer_late_before_expiry_proof",
      writerStatus: "claim_intent_expired",
      postStateStatus: "unconsumed",
    }),
    writable: false,
  });
  return error;
}

function readTimestampMilliseconds(value) {
  let milliseconds = Number.NaN;
  try {
    milliseconds =
      value instanceof Date
        ? value.getTime()
        : new Date(value).getTime();
  } catch {
    milliseconds = Number.NaN;
  }
  assertFixture(
    Number.isFinite(milliseconds),
    "lock_wait_claim_timing_invalid",
  );
  return milliseconds;
}
