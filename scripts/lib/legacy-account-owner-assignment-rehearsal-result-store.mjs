import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

import {
  assertResultEvidenceRunId,
  assertResultEvidenceSourceSha,
  createBranchCreateRequestedEvidenceSnapshot,
  createRecoveryCleanupEvidenceSnapshot,
  createResultEvidenceSnapshot,
  createUnattestedChildEvidenceSnapshot,
  isResultEvidenceSessionCode,
  projectRehearsalCleanupResult,
  projectRehearsalHarnessResult,
  projectResultControlPlane,
  resultEvidenceError,
  resultInvocationCounts,
} from "./legacy-account-owner-assignment-rehearsal-result-policy.mjs";

const EVIDENCE_FILE_PATTERN =
  /^legacy-account-owner-assignment-rehearsal-[a-z0-9-]+\.json$/;

export function createLegacyAccountOwnerAssignmentResultEvidenceJournal({
  evidenceFile,
  runId,
  sourceSha,
  writeSnapshot = writeAtomicEvidenceSnapshot,
} = {}) {
  assertResultEvidenceRunId(runId);
  assertEvidenceFile(evidenceFile, runId);
  assertResultEvidenceSourceSha(sourceSha);
  if (typeof writeSnapshot !== "function") {
    throw resultEvidenceError("prepared_result_invalid");
  }

  let latestSnapshot = null;
  let persistedSnapshot = null;
  let evidenceFileOwned = false;

  function persist(snapshot, failureCode, { create = false } = {}) {
    latestSnapshot = snapshot;
    try {
      if (!create && !evidenceFileOwned) {
        throw resultEvidenceError(failureCode);
      }
      writeSnapshot(evidenceFile, snapshot, { create });
      if (create) evidenceFileOwned = true;
      persistedSnapshot = snapshot;
    } catch {
      throw resultEvidenceError(failureCode);
    }
    return snapshot;
  }

  return Object.freeze({
    recordCreateRequested(value) {
      if (latestSnapshot !== null) {
        throw resultEvidenceError("prepared_result_invalid");
      }
      return persist(
        createBranchCreateRequestedEvidenceSnapshot({
          runId,
          sourceSha,
          recovery: value,
        }),
        "create_requested_evidence_write_failed",
        { create: true },
      );
    },
    recordChildCreatedUnattested(
      value,
      { exactNameReconciliations = 0 } = {},
    ) {
      const createsEvidenceFile = latestSnapshot === null;
      if (
        !createsEvidenceFile &&
        latestSnapshot?.phase !== "create_requested"
      ) {
        throw resultEvidenceError("prepared_result_invalid");
      }
      return persist(
        createUnattestedChildEvidenceSnapshot({
          runId,
          sourceSha,
          recovery: value,
          exactNameReconciliations,
        }),
        "child_created_unattested_evidence_write_failed",
        { create: createsEvidenceFile },
      );
    },
    recordChildAttestationOutcome(readiness) {
      if (
        latestSnapshot?.phase !== "child_created_unattested"
      ) {
        throw resultEvidenceError("prepared_result_invalid");
      }
      return persist(
        createUnattestedChildEvidenceSnapshot({
          runId,
          sourceSha,
          recovery: latestSnapshot.recovery,
          exactNameReconciliations:
            latestSnapshot.invocationCounts
              .exactNameReconciliation,
          readiness,
        }),
        "child_attestation_evidence_write_failed",
      );
    },
    recordPrepared(value) {
      const createsEvidenceFile = latestSnapshot === null;
      if (
        !createsEvidenceFile &&
        latestSnapshot?.phase !== "child_created_unattested"
      ) {
        throw resultEvidenceError("prepared_result_invalid");
      }
      const controlPlane = projectResultControlPlane(value);
      return persist(
        createResultEvidenceSnapshot({
          runId,
          sourceSha,
          phase: "prepared",
          status: "in_progress",
          code: null,
          invocationCounts: resultInvocationCounts(1, 0, 0, 0),
          controlPlane,
          harness: null,
          cleanup: null,
        }),
        "prepared_evidence_write_failed",
        { create: createsEvidenceFile },
      );
    },
    recordRecoveryCleanupResult(value, { code } = {}) {
      if (latestSnapshot?.phase !== "child_created_unattested") {
        throw resultEvidenceError("cleanup_result_invalid");
      }
      return persist(
        createRecoveryCleanupEvidenceSnapshot({
          runId,
          sourceSha,
          recovery: latestSnapshot.recovery,
          cleanup: value,
          code,
          exactNameReconciliations:
            latestSnapshot.invocationCounts
              .exactNameReconciliation,
          readiness: latestSnapshot.readiness,
        }),
        "cleanup_result_evidence_write_failed",
      );
    },
    recordHarnessResult(value) {
      if (latestSnapshot?.phase !== "prepared") {
        throw resultEvidenceError("harness_result_invalid");
      }
      const harness = projectRehearsalHarnessResult(
        value,
        latestSnapshot.controlPlane,
      );
      return persist(
        createResultEvidenceSnapshot({
          runId,
          sourceSha,
          phase: "harness_result",
          status:
            harness.status === "passed" ? "in_progress" : "failed",
          code: harness.status === "failed" ? harness.code : null,
          invocationCounts: resultInvocationCounts(1, 1, 0, 0),
          controlPlane: latestSnapshot.controlPlane,
          harness,
          cleanup: null,
        }),
        "harness_result_evidence_write_failed",
      );
    },
    recordCleanupResult(value, { sessionCode = null } = {}) {
      if (
        !["prepared", "harness_result"].includes(
          latestSnapshot?.phase,
        ) ||
        (sessionCode !== null &&
          !isResultEvidenceSessionCode(sessionCode))
      ) {
        throw resultEvidenceError("cleanup_result_invalid");
      }
      const cleanup = projectRehearsalCleanupResult(value);
      const harness = latestSnapshot.harness;
      const code =
        sessionCode ??
        (harness?.status === "failed" ? harness.code : null) ??
        (cleanup.status === "failed" ? cleanup.code : null) ??
        (harness === null ? "harness_execution_failed" : null);
      return persist(
        createResultEvidenceSnapshot({
          runId,
          sourceSha,
          phase: "cleanup_result",
          status: code === null ? "passed" : "failed",
          code,
          invocationCounts: resultInvocationCounts(
            1,
            harness === null ? 0 : 1,
            cleanup.deleteInvocations,
            cleanup.exactIdGetInvocations,
          ),
          controlPlane: latestSnapshot.controlPlane,
          harness,
          cleanup,
        }),
        "cleanup_result_evidence_write_failed",
      );
    },
    latest() {
      return latestSnapshot;
    },
    persisted() {
      return persistedSnapshot;
    },
  });
}

function writeAtomicEvidenceSnapshot(
  evidenceFile,
  snapshot,
  { create = false } = {},
) {
  if (!snapshot || typeof snapshot !== "object") {
    throw resultEvidenceError("cleanup_result_invalid");
  }
  if (create && existsSync(evidenceFile)) {
    throw resultEvidenceError("prepared_evidence_write_failed");
  }
  if (!create && !existsSync(evidenceFile)) {
    throw resultEvidenceError("cleanup_result_evidence_write_failed");
  }
  if (!create) {
    const stat = lstatSync(evidenceFile);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw resultEvidenceError("cleanup_result_invalid");
    }
  }

  const temporaryFile = join(
    dirname(evidenceFile),
    `.${basename(evidenceFile)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let descriptor = null;
  try {
    descriptor = openSync(temporaryFile, "wx", 0o600);
    writeFileSync(
      descriptor,
      `${JSON.stringify(snapshot)}\n`,
      { encoding: "utf8" },
    );
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    if (create) {
      linkSync(temporaryFile, evidenceFile);
      unlinkSync(temporaryFile);
    } else {
      renameSync(temporaryFile, evidenceFile);
    }
  } finally {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch {
        // The primary filesystem failure remains authoritative.
      }
    }
    try {
      unlinkSync(temporaryFile);
    } catch {
      // The rename path no longer exists after a successful replace.
    }
  }
}

function assertEvidenceFile(value, runId) {
  if (
    typeof value !== "string" ||
    !isAbsolute(value) ||
    !EVIDENCE_FILE_PATTERN.test(basename(value)) ||
    basename(value) !==
      `legacy-account-owner-assignment-rehearsal-${runId}.json`
  ) {
    throw resultEvidenceError("prepared_result_invalid");
  }
}
