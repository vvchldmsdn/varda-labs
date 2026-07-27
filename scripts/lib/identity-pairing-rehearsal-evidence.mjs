import {
  IdentityPairingConsumeError,
} from "./identity-pairing-consume-writer.mjs";
import {
  IDENTITY_PAIRING_CATALOG_PREFLIGHT_FAILURE_CODES,
} from "./identity-pairing-catalog-preflight.mjs";

export const IDENTITY_PAIRING_REHEARSAL_STAGES = Object.freeze([
  "target_guard",
  "catalog_preflight",
  "pool_readiness",
  "schema_empty",
  "successful_consume",
  "expired_claim",
  "lock_wait_expiry",
  "duplicate_consume",
  "subject_collision",
  "target_drift",
  "same_claim_race",
  "same_subject_different_targets_race",
  "same_target_different_subjects_race",
  "terminal_insert_full_rollback",
]);

export const IDENTITY_PAIRING_LOCK_WAIT_FAILURE_CODES = Object.freeze([
  "lock_wait_blocker_session_invalid",
  "lock_wait_claim_timing_invalid",
  "lock_wait_intent_dispatch_unobserved",
  "lock_wait_not_observed",
  "lock_wait_observed_after_expiry",
  "lock_wait_query_start_invalid",
  "lock_wait_query_started_at_or_after_expiry",
  "lock_wait_expiry_not_confirmed",
  "lock_wait_release_failed",
  "lock_wait_writer_session_unavailable",
  "lock_wait_writer_settlement_timeout",
  "lock_wait_writer_unexpected_failure",
  "lock_wait_writer_unexpected_success",
  "lock_wait_post_state_invalid",
]);

export class IdentityPairingRehearsalFixtureError extends Error {
  constructor(code) {
    super("Identity pairing rehearsal fixture failed");
    this.name = "IdentityPairingRehearsalFixtureError";
    Object.defineProperty(this, "code", {
      configurable: false,
      enumerable: true,
      value: code,
      writable: false,
    });
  }
}

const SAFE_CONSUME_ERROR_CODES = new Set([
  "binding_key_invalid",
  "claim_format_invalid",
  "claim_intent_already_terminal",
  "claim_intent_expired",
  "claim_intent_invalid",
  "claim_intent_not_found",
  "claim_intent_not_yet_valid",
  "claim_lifecycle_unavailable",
  "concurrent_state_conflict",
  "database_constraint_violation",
  "database_port_invalid",
  "database_timeout",
  "database_transaction_failed",
  "identity_insert_failed",
  "identity_link_existing_link_disabled",
  "identity_link_provider_subject_collision",
  "identity_link_target_provider_collision",
  "plan_binding_generation_failed",
  "reviewed_target_not_found",
  "reviewed_target_state_mismatch",
  "target_activation_failed",
  "terminal_event_insert_failed",
  "verified_subject_disabled",
  "verified_subject_port_invalid",
  "verified_subject_required",
  "verified_subject_unavailable",
]);

const SAFE_SQLSTATES = new Set([
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "23505",
  "23514",
  "40P01",
  "55P03",
  "57014",
]);
const SAFE_CATALOG_PREFLIGHT_FAILURE_CODES = new Set(
  IDENTITY_PAIRING_CATALOG_PREFLIGHT_FAILURE_CODES,
);
const SAFE_LOCK_WAIT_FAILURE_CODES = new Set(
  IDENTITY_PAIRING_LOCK_WAIT_FAILURE_CODES,
);

const STAGE_INDEX = new Map(
  IDENTITY_PAIRING_REHEARSAL_STAGES.map((stage, index) => [stage, index]),
);

export function createIdentityPairingRehearsalEvidence() {
  let stage = IDENTITY_PAIRING_REHEARSAL_STAGES[0];
  let lastCompletedCheck = "none";
  let poolReadiness = false;
  let disposableBranchDmlAttempted = false;

  return Object.freeze({
    begin(nextStage) {
      assertStage(nextStage);
      const expectedIndex =
        lastCompletedCheck === "none"
          ? 0
          : STAGE_INDEX.get(lastCompletedCheck) + 1;
      if (STAGE_INDEX.get(nextStage) !== expectedIndex) {
        throw new Error("Identity pairing rehearsal stage order is invalid.");
      }
      stage = nextStage;
    },
    complete(completedStage) {
      assertStage(completedStage);
      if (completedStage !== stage) {
        throw new Error(
          "Identity pairing rehearsal completion stage is invalid.",
        );
      }
      lastCompletedCheck = completedStage;
    },
    markPoolReady() {
      if (stage !== "pool_readiness") {
        throw new Error(
          "Identity pairing rehearsal Pool readiness stage is invalid.",
        );
      }
      poolReadiness = true;
    },
    markDisposableBranchDmlAttempted() {
      if (stage !== "successful_consume") {
        throw new Error(
          "Identity pairing rehearsal DML boundary is invalid.",
        );
      }
      disposableBranchDmlAttempted = true;
    },
    failure(error) {
      const code = safeFailureCode(error, stage);
      const lockWaitOutcome = safeLockWaitOutcome(
        error,
        stage,
        code,
      );
      return Object.freeze({
        rehearsal: "identity_pairing_atomic_consume_disposable_branch",
        status: "failed",
        stage,
        lastCompletedCheck,
        poolReadiness,
        disposableBranchDmlAttempted,
        code,
        ...(lockWaitOutcome === null
          ? {}
          : { lockWaitOutcome }),
        productionDatabaseWrites: 0,
        branchDeletionRequired: true,
      });
    },
    success() {
      return Object.freeze({
        stage: "completed",
        lastCompletedCheck,
        poolReadiness,
        disposableBranchDmlAttempted,
      });
    },
  });
}

function safeFailureCode(error, stage) {
  const code = readOwnPrimitiveStringCode(error);
  if (
    stage === "catalog_preflight" &&
    code !== null &&
    SAFE_CATALOG_PREFLIGHT_FAILURE_CODES.has(code)
  ) {
    return code;
  }
  if (
    isIdentityPairingConsumeError(error) &&
    code !== null &&
    SAFE_CONSUME_ERROR_CODES.has(code)
  ) {
    return `consume_${code}`;
  }
  if (
    stage === "lock_wait_expiry" &&
    isIdentityPairingRehearsalFixtureError(error) &&
    code !== null &&
    SAFE_LOCK_WAIT_FAILURE_CODES.has(code)
  ) {
    return code;
  }

  if (code !== null && SAFE_SQLSTATES.has(code)) {
    return `sqlstate_${code.toLowerCase()}`;
  }

  return `${stage}_failed`;
}

function readOwnPrimitiveStringCode(error) {
  return readOwnPrimitiveString(error, "code");
}

function readOwnPrimitiveString(value, property) {
  if (!value || typeof value !== "object") return null;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, property);
  } catch {
    return null;
  }
  if (!descriptor || !("value" in descriptor)) return null;
  return typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

function safeLockWaitOutcome(error, stage, code) {
  if (
    stage !== "lock_wait_expiry" ||
    code !== "lock_wait_observed_after_expiry" ||
    !isIdentityPairingRehearsalFixtureError(error)
  ) {
    return null;
  }

  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(
      error,
      "lockWaitOutcome",
    );
  } catch {
    return null;
  }
  if (!descriptor || !("value" in descriptor)) return null;

  const outcome = descriptor.value;
  const observationStatus = readOwnPrimitiveString(
    outcome,
    "observationStatus",
  );
  const writerStatus = readOwnPrimitiveString(
    outcome,
    "writerStatus",
  );
  const postStateStatus = readOwnPrimitiveString(
    outcome,
    "postStateStatus",
  );
  if (
    observationStatus !== "observer_late_before_expiry_proof" ||
    writerStatus !== "claim_intent_expired" ||
    postStateStatus !== "unconsumed"
  ) {
    return null;
  }

  return Object.freeze({
    observationStatus,
    writerStatus,
    postStateStatus,
  });
}

function isIdentityPairingConsumeError(error) {
  try {
    return error instanceof IdentityPairingConsumeError;
  } catch {
    return false;
  }
}

function isIdentityPairingRehearsalFixtureError(error) {
  try {
    return error instanceof IdentityPairingRehearsalFixtureError;
  } catch {
    return false;
  }
}

function assertStage(stage) {
  if (!STAGE_INDEX.has(stage)) {
    throw new Error("Identity pairing rehearsal stage is not allowlisted.");
  }
}
