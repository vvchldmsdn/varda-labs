import {
  LegacyAccountOwnerAssignmentError,
} from "./legacy-account-owner-assignment-writer.mjs";

export const LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_STAGES =
  Object.freeze([
    "target_guard",
    "pool_readiness",
    "catalog_preflight",
    "successful_assignment",
    "already_applied",
    "missing_consumed_evidence",
    "digest_drift",
    "foreign_owner",
    "same_target_race",
    "partial_update_rollback",
    "lock_timeout_rollback",
    "fixture_cleanup",
  ]);

const SAFE_ASSIGNMENT_ERROR_CODES = new Set([
  "account_assignment_state_mismatch",
  "account_assignment_verification_failed",
  "account_evidence_digest_drift",
  "account_evidence_invalid",
  "account_scope_count_mismatch",
  "account_update_count_mismatch",
  "candidate_set_digest_invalid",
  "concurrent_state_conflict",
  "consumed_event_invalid",
  "consumed_event_not_found",
  "consumed_identity_invalid",
  "consumed_identity_not_found",
  "consumed_intent_invalid",
  "consumed_intent_not_found",
  "consumed_target_not_found",
  "consumed_target_state_mismatch",
  "database_constraint_violation",
  "database_port_invalid",
  "database_timeout",
  "database_transaction_failed",
  "eligible_set_digest_invalid",
  "foreign_owner_conflict",
  "identity_pairing_intent_id_invalid",
  "legacy_owner_evidence_collision",
  "legacy_owner_fingerprint_invalid",
  "legacy_owner_match_count_mismatch",
  "target_app_user_fingerprint_invalid",
]);

const SAFE_SQLSTATES = new Set([
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "23503",
  "23505",
  "23514",
  "40P01",
  "55P03",
  "57014",
]);

const SAFE_FIXTURE_ERROR_CODES = new Set([
  "account_baseline_drift",
  "account_baseline_restore_failed",
  "catalog_preflight_failed",
  "fixture_setup_failed",
  "lock_timeout_fixture_failed",
  "partial_update_fixture_failed",
  "race_outcome_invalid",
  "synthetic_case_post_state_invalid",
  "temporary_object_cleanup_failed",
]);

const STAGE_INDEX = new Map(
  LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_STAGES.map(
    (stage, index) => [stage, index],
  ),
);

export class LegacyAccountOwnerAssignmentRehearsalFixtureError extends Error {
  constructor(code) {
    super("Legacy account owner-assignment rehearsal fixture failed");
    this.name =
      "LegacyAccountOwnerAssignmentRehearsalFixtureError";
    Object.defineProperty(this, "code", {
      configurable: false,
      enumerable: true,
      value: code,
      writable: false,
    });
  }
}

export function createLegacyAccountOwnerAssignmentRehearsalEvidence() {
  let stage = LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_STAGES[0];
  let lastCompletedCheck = "none";
  let poolReadiness = false;
  let disposableBranchDmlAttempted = false;
  let accountBaselineRestored = false;
  let temporaryDatabaseObjectsRemoved = false;

  return Object.freeze({
    begin(nextStage) {
      assertStage(nextStage);
      const expectedIndex =
        lastCompletedCheck === "none"
          ? 0
          : STAGE_INDEX.get(lastCompletedCheck) + 1;
      if (STAGE_INDEX.get(nextStage) !== expectedIndex) {
        throw new Error(
          "Owner-assignment rehearsal stage order is invalid.",
        );
      }
      stage = nextStage;
    },
    complete(completedStage) {
      assertStage(completedStage);
      if (completedStage !== stage) {
        throw new Error(
          "Owner-assignment rehearsal completion stage is invalid.",
        );
      }
      lastCompletedCheck = completedStage;
    },
    markPoolReady() {
      if (stage !== "pool_readiness") {
        throw new Error(
          "Owner-assignment rehearsal Pool readiness stage is invalid.",
        );
      }
      poolReadiness = true;
    },
    markDisposableBranchDmlAttempted() {
      if (stage !== "successful_assignment") {
        throw new Error(
          "Owner-assignment rehearsal DML boundary is invalid.",
        );
      }
      disposableBranchDmlAttempted = true;
    },
    markAccountBaselineRestored() {
      accountBaselineRestored = true;
    },
    markTemporaryDatabaseObjectsRemoved() {
      temporaryDatabaseObjectsRemoved = true;
    },
    failure(error) {
      return Object.freeze({
        rehearsal:
          "legacy_account_owner_assignment_disposable_branch_v1",
        status: "failed",
        stage,
        lastCompletedCheck,
        poolReadiness,
        disposableBranchDmlAttempted,
        accountBaselineRestored,
        temporaryDatabaseObjectsRemoved,
        code: safeFailureCode(error, stage),
        retryCount: 0,
        dbMigrateInvocations: 0,
        productionDatabaseWrites: 0,
        syntheticRowsMayRemainUntilBranchDeletion:
          disposableBranchDmlAttempted,
        cleanupAuthority: "exact_branch_deletion",
        branchDeletionRequired: true,
      });
    },
    success() {
      return Object.freeze({
        stage: "completed",
        lastCompletedCheck,
        poolReadiness,
        disposableBranchDmlAttempted,
        accountBaselineRestored,
        temporaryDatabaseObjectsRemoved,
      });
    },
  });
}

function safeFailureCode(error, stage) {
  const code = readOwnPrimitiveString(error, "code");
  if (
    isAssignmentError(error) &&
    code !== null &&
    SAFE_ASSIGNMENT_ERROR_CODES.has(code)
  ) {
    return `assignment_${code}`;
  }
  if (
    isFixtureError(error) &&
    code !== null &&
    SAFE_FIXTURE_ERROR_CODES.has(code)
  ) {
    return code;
  }
  if (code !== null && SAFE_SQLSTATES.has(code)) {
    return `sqlstate_${code.toLowerCase()}`;
  }
  return `${stage}_failed`;
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

function isAssignmentError(error) {
  try {
    return error instanceof LegacyAccountOwnerAssignmentError;
  } catch {
    return false;
  }
}

function isFixtureError(error) {
  try {
    return (
      error instanceof
      LegacyAccountOwnerAssignmentRehearsalFixtureError
    );
  } catch {
    return false;
  }
}

function assertStage(stage) {
  if (!STAGE_INDEX.has(stage)) {
    throw new Error(
      "Owner-assignment rehearsal stage is not allowlisted.",
    );
  }
}
