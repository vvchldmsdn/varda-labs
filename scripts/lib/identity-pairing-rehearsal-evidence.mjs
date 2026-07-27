import {
  IdentityPairingConsumeError,
} from "./identity-pairing-consume-writer.mjs";

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
      return Object.freeze({
        rehearsal: "identity_pairing_atomic_consume_disposable_branch",
        status: "failed",
        stage,
        lastCompletedCheck,
        poolReadiness,
        disposableBranchDmlAttempted,
        code: safeFailureCode(error, stage),
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
  if (
    error instanceof IdentityPairingConsumeError &&
    SAFE_CONSUME_ERROR_CODES.has(error.code)
  ) {
    return `consume_${error.code}`;
  }

  const sqlstate = readSafeSqlstate(error);
  if (sqlstate !== null) {
    return `sqlstate_${sqlstate.toLowerCase()}`;
  }

  return `${stage}_failed`;
}

function readSafeSqlstate(error) {
  if (!error || typeof error !== "object") return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  if (!descriptor || !("value" in descriptor)) return null;
  const code = String(descriptor.value);
  return SAFE_SQLSTATES.has(code) ? code : null;
}

function assertStage(stage) {
  if (!STAGE_INDEX.has(stage)) {
    throw new Error("Identity pairing rehearsal stage is not allowlisted.");
  }
}
