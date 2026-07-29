import {
  LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_STAGES,
} from "./legacy-account-owner-assignment-rehearsal-evidence.mjs";

export const LEGACY_ACCOUNT_OWNER_ASSIGNMENT_RESULT_EVIDENCE_VERSION =
  "legacy_account_owner_assignment_rehearsal_result_evidence_v1";
export const LEGACY_ACCOUNT_OWNER_ASSIGNMENT_UNATTESTED_CHILD_EVIDENCE_VERSION =
  "legacy_account_owner_assignment_unattested_child_evidence_v1";
export const LEGACY_ACCOUNT_OWNER_ASSIGNMENT_RESULT_REHEARSAL =
  "legacy_account_owner_assignment_disposable_branch_v1";

const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const RUN_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SAFE_CODE_PATTERN = /^[a-z0-9_]{1,96}$/;
const MISSING = Symbol("missing");
const INVALID = Symbol("invalid");
const SAFE_STAGES = new Set([
  ...LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_STAGES,
  "completed",
  "host_configuration",
]);
const SAFE_LAST_COMPLETED_CHECKS = new Set([
  "none",
  ...LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_STAGES,
]);
const EXPECTED_CHECKS = Object.freeze([
  "successful_assignment",
  "already_applied",
  "missing_consumed_evidence",
  "digest_drift",
  "foreign_owner",
  "same_target_race",
  "partial_update_rollback",
  "lock_timeout_rollback",
]);
const SESSION_CODES = new Set([
  "cleanup_execution_failed",
  "cleanup_result_evidence_write_failed",
  "cleanup_result_invalid",
  "harness_execution_failed",
  "harness_result_evidence_write_failed",
  "harness_result_invalid",
  "prepared_evidence_write_failed",
  "prepared_result_invalid",
]);
const CONTROL_PLANE_FIELDS = Object.freeze([
  ["projectFingerprint", isFingerprint],
  ["parentBranchFingerprint", isFingerprint],
  ["branchIdFingerprint", isFingerprint],
  ["branchNameFingerprint", isFingerprint],
  ["endpointFingerprint", isFingerprint],
  ["productionEndpointFingerprint", isFingerprint],
  ["sourceTargetFingerprint", isFingerprint],
  ["targetFingerprint", isFingerprint],
  ["endpointType", isExact("read_write")],
  ["endpointReady", isExact(true)],
  ["productionEndpointSeparated", isExact(true)],
  ["default", isExact(false)],
  ["primary", isExact(false)],
  ["protected", isExact(false)],
  ["autoExpires", isExact(true)],
]);
const UNATTESTED_CHILD_FIELDS = Object.freeze([
  ["projectFingerprint", isFingerprint],
  ["parentBranchFingerprint", isFingerprint],
  ["branchIdFingerprint", isFingerprint],
  ["branchNameFingerprint", isFingerprint],
  ["productionEndpointFingerprint", isFingerprint],
  ["sourceTargetFingerprint", isFingerprint],
]);
const HARNESS_BOOLEAN_FIELDS = Object.freeze([
  "poolReadiness",
  "disposableBranchDmlAttempted",
  "accountBaselineRestored",
  "temporaryDatabaseObjectsRemoved",
  "syntheticRowsMayRemainUntilBranchDeletion",
]);
const HARNESS_TARGET_FINGERPRINT_FIELDS = Object.freeze([
  "branchIdFingerprint",
  "branchNameFingerprint",
  "endpointFingerprint",
  "sourceTargetFingerprint",
  "targetFingerprint",
]);

export class LegacyAccountOwnerAssignmentResultEvidenceError extends Error {
  constructor(code) {
    super("Legacy account owner-assignment result evidence failed.");
    this.name =
      "LegacyAccountOwnerAssignmentResultEvidenceError";
    Object.defineProperty(this, "code", {
      configurable: false,
      enumerable: true,
      value: code,
      writable: false,
    });
  }
}

export function createResultEvidenceSnapshot({
  runId,
  sourceSha,
  phase,
  status,
  code,
  invocationCounts,
  controlPlane,
  harness,
  cleanup,
}) {
  return deepFreeze({
    evidenceVersion:
      LEGACY_ACCOUNT_OWNER_ASSIGNMENT_RESULT_EVIDENCE_VERSION,
    rehearsal: LEGACY_ACCOUNT_OWNER_ASSIGNMENT_RESULT_REHEARSAL,
    runId,
    sourceSha,
    phase,
    status,
    code,
    invocationCounts,
    controlPlane,
    harness,
    cleanup,
  });
}

export function createUnattestedChildEvidenceSnapshot({
  runId,
  sourceSha,
  recovery,
}) {
  assertResultEvidenceRunId(runId);
  assertResultEvidenceSourceSha(sourceSha);
  return deepFreeze({
    evidenceVersion:
      LEGACY_ACCOUNT_OWNER_ASSIGNMENT_UNATTESTED_CHILD_EVIDENCE_VERSION,
    rehearsal: LEGACY_ACCOUNT_OWNER_ASSIGNMENT_RESULT_REHEARSAL,
    runId,
    sourceSha,
    phase: "child_created_unattested",
    status: "failed",
    code: "branch_attestation_invalid",
    invocationCounts: resultInvocationCounts(1, 0, 0, 0),
    recovery: projectFields(
      recovery,
      UNATTESTED_CHILD_FIELDS,
      "prepared_result_invalid",
    ),
    cleanup: "unattempted",
    resolution: "manual_or_auto_expiry_unverified",
  });
}

export function projectResultControlPlane(value) {
  const result = projectFields(
    value,
    CONTROL_PLANE_FIELDS,
    "prepared_result_invalid",
  );
  if (
    result.endpointFingerprint ===
    result.productionEndpointFingerprint
  ) {
    throw resultEvidenceError("prepared_result_invalid");
  }
  return result;
}

export function projectRehearsalHarnessResult(
  value,
  controlPlane,
) {
  const status = requireOneOf(
    value,
    "status",
    new Set(["passed", "failed"]),
    "harness_result_invalid",
  );
  requireExact(
    value,
    "rehearsal",
    LEGACY_ACCOUNT_OWNER_ASSIGNMENT_RESULT_REHEARSAL,
    "harness_result_invalid",
  );
  const stage = requireOneOf(
    value,
    "stage",
    SAFE_STAGES,
    "harness_result_invalid",
  );
  const lastCompletedCheck = requireOneOf(
    value,
    "lastCompletedCheck",
    SAFE_LAST_COMPLETED_CHECKS,
    "harness_result_invalid",
  );
  const checks =
    status === "passed"
      ? requireChecks(value)
      : Object.freeze([]);
  const booleans = projectBooleanFields(
    value,
    HARNESS_BOOLEAN_FIELDS,
    "harness_result_invalid",
  );
  requireExact(
    value,
    "cleanupAuthority",
    "exact_branch_deletion",
    "harness_result_invalid",
  );
  requireExact(
    value,
    "branchDeletionRequired",
    true,
    "harness_result_invalid",
  );
  for (const key of [
    "retryCount",
    "dbMigrateInvocations",
    "productionDatabaseWrites",
  ]) {
    requireExact(value, key, 0, "harness_result_invalid");
  }
  const code =
    status === "failed"
      ? requireSafeCode(value, "code", "harness_result_invalid")
      : null;

  if (status === "passed") {
    assertPassedHarness(
      value,
      controlPlane,
      stage,
      lastCompletedCheck,
      booleans,
    );
  } else if (stage === "completed") {
    throw resultEvidenceError("harness_result_invalid");
  }

  return deepFreeze({
    status,
    stage,
    lastCompletedCheck,
    checkCount: checks.length,
    checks,
    ...booleans,
    cleanupAuthority: "exact_branch_deletion",
    branchDeletionRequired: true,
    retryCount: 0,
    dbMigrateInvocations: 0,
    productionDatabaseWrites: 0,
    code,
  });
}

export function projectRehearsalCleanupResult(value) {
  const status = requireOneOf(
    value,
    "status",
    new Set(["passed", "failed"]),
    "cleanup_result_invalid",
  );
  const deleteInvocations = requireOneOf(
    value,
    "deleteInvocations",
    new Set([0, 1]),
    "cleanup_result_invalid",
  );
  const exactIdGetInvocations = requireOneOf(
    value,
    "exactIdGetInvocations",
    new Set([0, 1]),
    "cleanup_result_invalid",
  );
  const exactIdNotFound = requireBoolean(
    value,
    "exactIdNotFound",
    "cleanup_result_invalid",
  );
  const code =
    status === "failed"
      ? requireSafeCode(value, "code", "cleanup_result_invalid")
      : null;
  if (
    status === "passed" &&
    (deleteInvocations !== 1 ||
      exactIdGetInvocations !== 1 ||
      exactIdNotFound !== true)
  ) {
    throw resultEvidenceError("cleanup_result_invalid");
  }
  return deepFreeze({
    status,
    deleteInvocations,
    exactIdGetInvocations,
    exactIdNotFound,
    code,
  });
}

export function resultInvocationCounts(
  branchCreate,
  harness,
  branchDelete,
  exactIdNotFoundCheck,
) {
  return deepFreeze({
    branchCreate,
    harness,
    branchDelete,
    exactIdNotFoundCheck,
  });
}

export function resultEvidenceSessionFailure(code, details = {}) {
  return deepFreeze({
    status: "failed",
    code,
    cleanupInvoked: details.cleanupInvoked ?? false,
    evidencePersisted: details.evidencePersisted ?? false,
    lastPersistedPhase: details.lastPersistedPhase ?? "none",
  });
}

export function safeResultEvidenceSessionCode(error, fallback) {
  const code = ownDataValue(error, "code");
  return typeof code === "string" && SESSION_CODES.has(code)
    ? code
    : fallback;
}

export function assertResultEvidenceSourceSha(value) {
  if (
    typeof value !== "string" ||
    !SOURCE_SHA_PATTERN.test(value)
  ) {
    throw resultEvidenceError("prepared_result_invalid");
  }
}

export function assertResultEvidenceRunId(value) {
  if (
    typeof value !== "string" ||
    !RUN_ID_PATTERN.test(value)
  ) {
    throw resultEvidenceError("prepared_result_invalid");
  }
}

export function isResultEvidenceSessionCode(value) {
  return typeof value === "string" && SESSION_CODES.has(value);
}

export function resultEvidenceError(code) {
  return new LegacyAccountOwnerAssignmentResultEvidenceError(code);
}

function assertPassedHarness(
  value,
  controlPlane,
  stage,
  lastCompletedCheck,
  booleans,
) {
  for (const key of HARNESS_TARGET_FINGERPRINT_FIELDS) {
    if (
      requireFingerprint(
        value,
        key,
        "harness_result_invalid",
      ) !== controlPlane[key]
    ) {
      throw resultEvidenceError("harness_result_invalid");
    }
  }
  if (
    stage !== "completed" ||
    lastCompletedCheck !== "fixture_cleanup" ||
    booleans.poolReadiness !== true ||
    booleans.disposableBranchDmlAttempted !== true ||
    booleans.accountBaselineRestored !== true ||
    booleans.temporaryDatabaseObjectsRemoved !== true
  ) {
    throw resultEvidenceError("harness_result_invalid");
  }
}

function projectFields(value, policies, code) {
  const result = {};
  for (const [key, accepts] of policies) {
    const item = ownDataValue(value, key);
    if (!accepts(item)) throw resultEvidenceError(code);
    result[key] = item;
  }
  return deepFreeze(result);
}

function projectBooleanFields(value, keys, code) {
  const result = {};
  for (const key of keys) {
    result[key] = requireBoolean(value, key, code);
  }
  return result;
}

function requireChecks(value) {
  const checks = ownDataValue(value, "checks");
  const length = ownDataValue(checks, "length");
  if (!Array.isArray(checks) || length !== EXPECTED_CHECKS.length) {
    throw resultEvidenceError("harness_result_invalid");
  }
  return Object.freeze(
    EXPECTED_CHECKS.map((expected, index) => {
      const check = ownDataValue(checks, String(index));
      if (check !== expected) {
        throw resultEvidenceError("harness_result_invalid");
      }
      return check;
    }),
  );
}

function requireFingerprint(value, key, code) {
  const item = ownDataValue(value, key);
  if (!isFingerprint(item)) throw resultEvidenceError(code);
  return item;
}

function requireSafeCode(value, key, code) {
  const item = ownDataValue(value, key);
  if (
    typeof item !== "string" ||
    !SAFE_CODE_PATTERN.test(item)
  ) {
    throw resultEvidenceError(code);
  }
  return item;
}

function requireBoolean(value, key, code) {
  const item = ownDataValue(value, key);
  if (typeof item !== "boolean") throw resultEvidenceError(code);
  return item;
}

function requireExact(value, key, expected, code) {
  const item = ownDataValue(value, key);
  if (item !== expected) throw resultEvidenceError(code);
  return item;
}

function requireOneOf(value, key, allowed, code) {
  const item = ownDataValue(value, key);
  if (!allowed.has(item)) throw resultEvidenceError(code);
  return item;
}

function ownDataValue(value, key) {
  if (!value || typeof value !== "object") return MISSING;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return INVALID;
  }
  if (!descriptor || !("value" in descriptor)) return INVALID;
  return descriptor.value;
}

function isFingerprint(value) {
  return (
    typeof value === "string" &&
    FINGERPRINT_PATTERN.test(value)
  );
}

function isExact(expected) {
  return (value) => value === expected;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}
