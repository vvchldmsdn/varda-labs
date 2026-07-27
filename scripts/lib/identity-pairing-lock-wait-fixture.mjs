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
  queryStartedAt,
  observedAt,
}) {
  const lockedAtMilliseconds = readTimestampMilliseconds(lockedAt);
  const expiresAtMilliseconds = readTimestampMilliseconds(expiresAt);
  const queryStartedAtMilliseconds = readTimestampMilliseconds(
    queryStartedAt,
    "lock_wait_query_start_invalid",
  );
  const observedAtMilliseconds = readTimestampMilliseconds(observedAt);

  assertFixture(
    expiresAtMilliseconds - lockedAtMilliseconds >=
      MINIMUM_LOCK_LIFETIME_MILLISECONDS,
    "lock_wait_claim_timing_invalid",
  );
  assertFixture(
    queryStartedAtMilliseconds >= lockedAtMilliseconds &&
      observedAtMilliseconds >= queryStartedAtMilliseconds,
    "lock_wait_query_start_invalid",
  );

  const queryStartRemainingMilliseconds =
    expiresAtMilliseconds - queryStartedAtMilliseconds;
  const observationRemainingMilliseconds =
    expiresAtMilliseconds - observedAtMilliseconds;
  return Object.freeze({
    status:
      queryStartRemainingMilliseconds > 0
        ? "query_started_before_expiry"
        : "query_started_at_or_after_expiry",
    queryStartRemainingMilliseconds,
    observationStatus:
      observationRemainingMilliseconds > 0
        ? "observed_before_expiry"
        : queryStartRemainingMilliseconds > 0
          ? "observer_late_after_query_start_proof"
          : "observer_late_without_pre_expiry_query_start",
    observationRemainingMilliseconds,
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

function readTimestampMilliseconds(
  value,
  errorCode = "lock_wait_claim_timing_invalid",
) {
  let milliseconds = Number.NaN;
  try {
    if (
      value instanceof Date ||
      typeof value === "string" ||
      typeof value === "number"
    ) {
      milliseconds =
        value instanceof Date
          ? value.getTime()
          : new Date(value).getTime();
    }
  } catch {
    milliseconds = Number.NaN;
  }
  assertFixture(Number.isFinite(milliseconds), errorCode);
  return milliseconds;
}
