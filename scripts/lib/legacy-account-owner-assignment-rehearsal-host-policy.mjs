import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";

import {
  assertResultEvidenceRunId,
  assertResultEvidenceSourceSha,
} from "./legacy-account-owner-assignment-rehearsal-result-policy.mjs";

const HOST =
  "legacy_account_owner_assignment_rehearsal_host_v1";
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;
const BRANCH_ID_PATTERN = /^br-[a-z0-9-]+$/;
const ENDPOINT_ID_PATTERN = /^ep-[a-z0-9-]+$/;
const FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/;
const BRANCH_NAME_PREFIX =
  "preview/codex/legacy-account-owner-assignment-rehearsal-";
const MISSING = Symbol("missing");
const INVALID = Symbol("invalid");
const SAFE_HOST_ERROR_CODES = new Set([
  "branch_attestation_invalid",
  "branch_create_ambiguous",
  "branch_create_reconciliation_failed",
  "branch_create_reconciliation_unresolved",
  "branch_create_result_invalid",
  "child_created_unattested_evidence_write_failed",
  "harness_context_invalid",
  "host_options_invalid",
  "production_source_attestation_invalid",
  "source_sha_invalid",
  "source_sha_mismatch",
  "stale_evidence_path",
]);

export const LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_HOST = HOST;

export class LegacyAccountOwnerAssignmentRehearsalHostError extends Error {
  constructor(code) {
    super("Legacy account owner-assignment rehearsal host failed.");
    this.name = "LegacyAccountOwnerAssignmentRehearsalHostError";
    Object.defineProperty(this, "code", {
      configurable: false,
      enumerable: true,
      value: code,
      writable: false,
    });
  }
}

export function createLegacyAccountOwnerAssignmentHostRunIdentity({
  evidenceDirectory,
  createRunId = randomUUID,
} = {}) {
  if (
    typeof evidenceDirectory !== "string" ||
    !isAbsolute(evidenceDirectory) ||
    typeof createRunId !== "function"
  ) {
    throw hostError("host_options_invalid");
  }
  let directoryStat;
  try {
    directoryStat = lstatSync(evidenceDirectory);
  } catch {
    throw hostError("host_options_invalid");
  }
  if (
    !directoryStat.isDirectory() ||
    directoryStat.isSymbolicLink()
  ) {
    throw hostError("host_options_invalid");
  }
  const runId = createRunId();
  assertResultEvidenceRunId(runId);
  const branchName = `${BRANCH_NAME_PREFIX}${runId}`;
  const evidenceFile = join(
    evidenceDirectory,
    `legacy-account-owner-assignment-rehearsal-${runId}.json`,
  );
  if (
    basename(evidenceFile) !==
    `legacy-account-owner-assignment-rehearsal-${runId}.json`
  ) {
    throw hostError("host_options_invalid");
  }
  if (existsSync(evidenceFile)) {
    throw hostError("stale_evidence_path");
  }
  return Object.freeze({ runId, branchName, evidenceFile });
}

export function assertOwnerAssignmentHostTarget({
  projectId,
  parentBranchId,
  productionEndpointId,
}) {
  return Object.freeze({
    projectId: requirePattern(
      { projectId },
      "projectId",
      PROJECT_ID_PATTERN,
      "host_options_invalid",
    ),
    parentBranchId: requirePattern(
      { parentBranchId },
      "parentBranchId",
      BRANCH_ID_PATTERN,
      "host_options_invalid",
    ),
    productionEndpointId: requirePattern(
      { productionEndpointId },
      "productionEndpointId",
      ENDPOINT_ID_PATTERN,
      "host_options_invalid",
    ),
  });
}

export function projectCreatedOwnerAssignmentChild(
  value,
  expectedBranchName,
  expectedParentBranchId,
) {
  const branchId = requirePattern(
    value,
    "branchId",
    BRANCH_ID_PATTERN,
    "branch_create_result_invalid",
  );
  const branchName = requireExact(
    value,
    "branchName",
    expectedBranchName,
    "branch_create_result_invalid",
  );
  if (branchId === expectedParentBranchId) {
    throw hostError("branch_create_result_invalid");
  }
  return Object.freeze({ branchId, branchName });
}

export function projectVerifiedOwnerAssignmentProductionSource(
  value,
  {
    expectedProjectId,
    expectedParentBranchId,
    expectedProductionEndpointId,
    expectedSourceTargetFingerprint,
  },
) {
  const result = {
    projectId: requireExact(
      value,
      "projectId",
      expectedProjectId,
      "production_source_attestation_invalid",
    ),
    branchId: requireExact(
      value,
      "branchId",
      expectedParentBranchId,
      "production_source_attestation_invalid",
    ),
    branchName: requireExact(
      value,
      "branchName",
      "main",
      "production_source_attestation_invalid",
    ),
    endpointId: requireExact(
      value,
      "endpointId",
      expectedProductionEndpointId,
      "production_source_attestation_invalid",
    ),
    endpointBranchId: requireExact(
      value,
      "endpointBranchId",
      expectedParentBranchId,
      "production_source_attestation_invalid",
    ),
    endpointType: requireExact(
      value,
      "endpointType",
      "read_write",
      "production_source_attestation_invalid",
    ),
    branchReady: requireExact(
      value,
      "branchReady",
      true,
      "production_source_attestation_invalid",
    ),
    endpointReady: requireExact(
      value,
      "endpointReady",
      true,
      "production_source_attestation_invalid",
    ),
    default: requireExact(
      value,
      "default",
      true,
      "production_source_attestation_invalid",
    ),
    primary: requireExact(
      value,
      "primary",
      true,
      "production_source_attestation_invalid",
    ),
    protected: requireExact(
      value,
      "protected",
      false,
      "production_source_attestation_invalid",
    ),
    sourceTargetFingerprint: requirePattern(
      { sourceTargetFingerprint: expectedSourceTargetFingerprint },
      "sourceTargetFingerprint",
      FINGERPRINT_PATTERN,
      "production_source_attestation_invalid",
    ),
  };
  return Object.freeze(result);
}

export function projectVerifiedOwnerAssignmentChild(
  value,
  {
    createdChild,
    expectedProjectId,
    expectedParentBranchId,
    expectedProductionEndpointId,
  },
) {
  requirePattern(
    { projectId: expectedProjectId },
    "projectId",
    PROJECT_ID_PATTERN,
    "branch_attestation_invalid",
  );
  requirePattern(
    { parentBranchId: expectedParentBranchId },
    "parentBranchId",
    BRANCH_ID_PATTERN,
    "branch_attestation_invalid",
  );
  requirePattern(
    { productionEndpointId: expectedProductionEndpointId },
    "productionEndpointId",
    ENDPOINT_ID_PATTERN,
    "branch_attestation_invalid",
  );

  const result = {
    projectId: requireExact(
      value,
      "projectId",
      expectedProjectId,
      "branch_attestation_invalid",
    ),
    parentBranchId: requireExact(
      value,
      "parentBranchId",
      expectedParentBranchId,
      "branch_attestation_invalid",
    ),
    branchId: requireExact(
      value,
      "branchId",
      createdChild.branchId,
      "branch_attestation_invalid",
    ),
    branchName: requireExact(
      value,
      "branchName",
      createdChild.branchName,
      "branch_attestation_invalid",
    ),
    endpointId: requirePattern(
      value,
      "endpointId",
      ENDPOINT_ID_PATTERN,
      "branch_attestation_invalid",
    ),
    endpointBranchId: requireExact(
      value,
      "endpointBranchId",
      createdChild.branchId,
      "branch_attestation_invalid",
    ),
    productionEndpointId: requireExact(
      value,
      "productionEndpointId",
      expectedProductionEndpointId,
      "branch_attestation_invalid",
    ),
    endpointType: requireExact(
      value,
      "endpointType",
      "read_write",
      "branch_attestation_invalid",
    ),
    branchReady: requireExact(
      value,
      "branchReady",
      true,
      "branch_attestation_invalid",
    ),
    endpointReady: requireExact(
      value,
      "endpointReady",
      true,
      "branch_attestation_invalid",
    ),
    default: requireExact(
      value,
      "default",
      false,
      "branch_attestation_invalid",
    ),
    primary: requireExact(
      value,
      "primary",
      false,
      "branch_attestation_invalid",
    ),
    protected: requireExact(
      value,
      "protected",
      false,
      "branch_attestation_invalid",
    ),
    autoExpires: requireExact(
      value,
      "autoExpires",
      true,
      "branch_attestation_invalid",
    ),
  };
  if (result.endpointId === result.productionEndpointId) {
    throw hostError("branch_attestation_invalid");
  }
  return Object.freeze(result);
}

export function createOwnerAssignmentPreparedControlPlaneEvidence({
  attestation,
  sourceAttestation,
  targetGuard,
}) {
  const projectFingerprint = fingerprint(attestation.projectId);
  const branchIdFingerprint = fingerprint(attestation.branchId);
  const branchNameFingerprint = fingerprint(attestation.branchName);
  const endpointFingerprint = fingerprint(attestation.endpointId);
  if (
    targetGuard?.integrationProjectFingerprint !==
      projectFingerprint ||
    targetGuard?.branchIdFingerprint !== branchIdFingerprint ||
    targetGuard?.branchNameFingerprint !== branchNameFingerprint ||
    targetGuard?.endpointFingerprint !== endpointFingerprint ||
    targetGuard?.sourceTargetFingerprint !==
      sourceAttestation?.sourceTargetFingerprint
  ) {
    throw hostError("harness_context_invalid");
  }
  return Object.freeze({
    projectFingerprint,
    parentBranchFingerprint: fingerprint(
      attestation.parentBranchId,
    ),
    branchIdFingerprint,
    branchNameFingerprint,
    endpointFingerprint,
    productionEndpointFingerprint: fingerprint(
      attestation.productionEndpointId,
    ),
    sourceTargetFingerprint:
      targetGuard.sourceTargetFingerprint,
    targetFingerprint: targetGuard.targetFingerprint,
    endpointType: "read_write",
    endpointReady: true,
    productionEndpointSeparated: true,
    default: false,
    primary: false,
    protected: false,
    autoExpires: true,
  });
}

export function createOwnerAssignmentUnattestedChildEvidence({
  createdChild,
  sourceAttestation,
  target,
}) {
  const projectId = requirePattern(
    target,
    "projectId",
    PROJECT_ID_PATTERN,
    "branch_create_result_invalid",
  );
  const parentBranchId = requirePattern(
    target,
    "parentBranchId",
    BRANCH_ID_PATTERN,
    "branch_create_result_invalid",
  );
  const productionEndpointId = requirePattern(
    target,
    "productionEndpointId",
    ENDPOINT_ID_PATTERN,
    "branch_create_result_invalid",
  );
  const branchId = requirePattern(
    createdChild,
    "branchId",
    BRANCH_ID_PATTERN,
    "branch_create_result_invalid",
  );
  const branchName = requirePattern(
    createdChild,
    "branchName",
    new RegExp(`^${BRANCH_NAME_PREFIX}[0-9a-f-]+$`),
    "branch_create_result_invalid",
  );
  const sourceTargetFingerprint = requirePattern(
    sourceAttestation,
    "sourceTargetFingerprint",
    FINGERPRINT_PATTERN,
    "branch_create_result_invalid",
  );
  return Object.freeze({
    projectFingerprint: fingerprint(projectId),
    parentBranchFingerprint: fingerprint(parentBranchId),
    branchIdFingerprint: fingerprint(branchId),
    branchNameFingerprint: fingerprint(branchName),
    productionEndpointFingerprint: fingerprint(
      productionEndpointId,
    ),
    sourceTargetFingerprint,
  });
}

export function ownerAssignmentHostFailure(
  code,
  {
    runId = null,
    branchCreateInvocations = 0,
    exactNameReconciliations = 0,
    cleanup = null,
    evidencePersisted = null,
    lastPersistedPhase = null,
    evidence = null,
  } = {},
) {
  return Object.freeze({
    host: HOST,
    status: "failed",
    code,
    runId,
    invocationCounts: Object.freeze({
      branchCreate: branchCreateInvocations,
      exactNameReconciliation: exactNameReconciliations,
      branchDelete: cleanup?.deleteInvocations ?? 0,
      exactIdNotFoundCheck:
        cleanup?.exactIdGetInvocations ?? 0,
    }),
    cleanup,
    ...(evidencePersisted === null
      ? {}
      : {
          evidencePersisted,
          lastPersistedPhase:
            lastPersistedPhase ?? "none",
          ...(evidence === null ? {} : { evidence }),
        }),
  });
}

export function assertOwnerAssignmentHostSourceSha(value) {
  try {
    assertResultEvidenceSourceSha(value);
  } catch {
    throw hostError("source_sha_invalid");
  }
  return value;
}

export function hostError(code) {
  return new LegacyAccountOwnerAssignmentRehearsalHostError(code);
}

export function safeOwnerAssignmentHostErrorCode(
  error,
  fallback,
) {
  const code = ownDataValue(error, "code");
  return typeof code === "string" &&
    SAFE_HOST_ERROR_CODES.has(code)
    ? code
    : fallback;
}

function requirePattern(value, key, pattern, code) {
  const item = ownDataValue(value, key);
  if (typeof item !== "string" || !pattern.test(item)) {
    throw hostError(code);
  }
  return item;
}

function requireExact(value, key, expected, code) {
  const item = ownDataValue(value, key);
  if (item !== expected) throw hostError(code);
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

function fingerprint(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
