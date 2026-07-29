import { spawnSync } from "node:child_process";

import {
  guardLegacyAccountOwnerAssignmentProductionSource,
  guardLegacyAccountOwnerAssignmentRehearsalTarget,
  prepareLegacyAccountOwnerAssignmentRehearsalEnvironment,
} from "../../src/lib/deployment/legacy-account-owner-assignment-rehearsal-target.ts";
import {
  executeLegacyAccountOwnerAssignmentRehearsal,
} from "../rehearse-legacy-account-owner-assignment.mjs";
import {
  createLegacyAccountOwnerAssignmentResultEvidenceJournal,
  runLegacyAccountOwnerAssignmentResultEvidenceSession,
} from "./legacy-account-owner-assignment-rehearsal-result-evidence.mjs";
import {
  waitForOwnerAssignmentChildByExactName,
  waitForOwnerAssignmentChildReadiness,
} from "./legacy-account-owner-assignment-readiness.mjs";
import {
  assertOwnerAssignmentHostTarget,
  assertOwnerAssignmentHostSourceSha,
  createLegacyAccountOwnerAssignmentHostRunIdentity,
  createOwnerAssignmentCreateRequestedEvidence,
  createOwnerAssignmentPreparedControlPlaneEvidence,
  createOwnerAssignmentUnattestedChildEvidence,
  hostError,
  ownerAssignmentHostFailure,
  projectCreatedOwnerAssignmentChild,
  projectVerifiedOwnerAssignmentProductionSource,
  safeOwnerAssignmentHostErrorCode,
} from "./legacy-account-owner-assignment-rehearsal-host-policy.mjs";

export async function runLegacyAccountOwnerAssignmentRehearsalHost({
  expectedSourceSha,
  repositoryRoot,
  evidenceDirectory,
  baseEnv,
  projectId,
  parentBranchId,
  productionEndpointId,
  attestProductionSource,
  createChild,
  reconcileChildByExactName,
  attestChild,
  deleteChild,
  checkChildNotFound,
  readSourceSha = readRepositoryHeadSha,
  readTrackedWorktreeClean =
    readRepositoryTrackedWorktreeClean,
  createRunId,
  executeHarness =
    executeLegacyAccountOwnerAssignmentRehearsal,
  productionDatabasePolicy,
  expectedProductionSourceTargetFingerprint,
  previewDatabasePolicy,
  poolFactory,
  createEvidenceJournal =
    createLegacyAccountOwnerAssignmentResultEvidenceJournal,
  readinessMonotonicNow,
  readinessSleep,
} = {}) {
  if (
    ![
      createChild,
      attestProductionSource,
      reconcileChildByExactName,
      attestChild,
      deleteChild,
      checkChildNotFound,
      readSourceSha,
      readTrackedWorktreeClean,
      executeHarness,
      createEvidenceJournal,
    ].every((item) => typeof item === "function") ||
    (createRunId !== undefined &&
      typeof createRunId !== "function") ||
    (readinessMonotonicNow !== undefined &&
      typeof readinessMonotonicNow !== "function") ||
    (readinessSleep !== undefined &&
      typeof readinessSleep !== "function") ||
    typeof repositoryRoot !== "string" ||
    !baseEnv ||
    typeof baseEnv !== "object"
  ) {
    return ownerAssignmentHostFailure("host_options_invalid");
  }

  let target;
  try {
    target = assertOwnerAssignmentHostTarget({
      projectId,
      parentBranchId,
      productionEndpointId,
    });
  } catch {
    return ownerAssignmentHostFailure("host_options_invalid");
  }

  let sourceSha;
  try {
    assertOwnerAssignmentHostSourceSha(expectedSourceSha);
    sourceSha = assertOwnerAssignmentHostSourceSha(
      await readSourceSha({ repositoryRoot }),
    );
    if (
      (await readTrackedWorktreeClean({
        repositoryRoot,
      })) !== true
    ) {
      throw hostError("source_worktree_dirty");
    }
  } catch (error) {
    return ownerAssignmentHostFailure(
      safeOwnerAssignmentHostErrorCode(
        error,
        "source_sha_invalid",
      ),
    );
  }
  if (sourceSha !== expectedSourceSha) {
    return ownerAssignmentHostFailure("source_sha_mismatch");
  }

  let run;
  try {
    run = createLegacyAccountOwnerAssignmentHostRunIdentity({
      evidenceDirectory,
      ...(createRunId === undefined ? {} : { createRunId }),
    });
  } catch (error) {
    return ownerAssignmentHostFailure(
      safeOwnerAssignmentHostErrorCode(
        error,
        "host_options_invalid",
      ),
    );
  }

  let sourceAttestation;
  try {
    const guardedSource =
      guardLegacyAccountOwnerAssignmentProductionSource({
        baseEnv,
        productionDatabasePolicy,
        expectedProductionSourceTargetFingerprint,
      });
    if (guardedSource.projectId !== target.projectId) {
      throw hostError("production_source_attestation_invalid");
    }
    sourceAttestation =
      projectVerifiedOwnerAssignmentProductionSource(
        await attestProductionSource({
          projectId: target.projectId,
          parentBranchId: target.parentBranchId,
          productionEndpointId: target.productionEndpointId,
        }),
        {
          expectedProjectId: target.projectId,
          expectedParentBranchId: target.parentBranchId,
          expectedProductionEndpointId:
            target.productionEndpointId,
          expectedSourceTargetFingerprint:
            guardedSource.sourceTargetFingerprint,
        },
      );
  } catch {
    return ownerAssignmentHostFailure(
      "production_source_attestation_invalid",
      { runId: run.runId },
    );
  }

  let evidenceJournal;
  try {
    evidenceJournal = createEvidenceJournal({
      evidenceFile: run.evidenceFile,
      runId: run.runId,
      sourceSha,
    });
    evidenceJournal.recordCreateRequested(
      createOwnerAssignmentCreateRequestedEvidence({
        branchName: run.branchName,
        sourceAttestation,
        target,
      }),
    );
  } catch {
    return ownerAssignmentHostFailure(
      "create_requested_evidence_write_failed",
      {
        runId: run.runId,
        ...journalEvidenceState(evidenceJournal),
      },
    );
  }

  let createdChild;
  try {
    createdChild = projectCreatedOwnerAssignmentChild(
      await createChild({
        runId: run.runId,
        branchName: run.branchName,
        projectId: target.projectId,
        parentBranchId: target.parentBranchId,
      }),
      run.branchName,
      target.parentBranchId,
    );
  } catch {
    return handleAmbiguousCreate({
      run,
      target,
      sourceAttestation,
      evidenceJournal,
      reconcileChildByExactName,
      attestChild,
      deleteChild,
      checkChildNotFound,
      readinessMonotonicNow,
      readinessSleep,
    });
  }

  let attestation;
  try {
    evidenceJournal.recordChildCreatedUnattested(
      createOwnerAssignmentUnattestedChildEvidence({
        createdChild,
        sourceAttestation,
        target,
      }),
    );
  } catch {
    return ownerAssignmentHostFailure(
      "child_created_unattested_evidence_write_failed",
      {
        runId: run.runId,
        branchCreateInvocations: 1,
        ...journalEvidenceState(evidenceJournal),
      },
    );
  }

  const readiness = await waitForOwnerAssignmentChildReadiness({
    attestChild,
    createdChild,
    target,
    ...(readinessMonotonicNow === undefined
      ? {}
      : { monotonicNow: readinessMonotonicNow }),
    ...(readinessSleep === undefined
      ? {}
      : { sleep: readinessSleep }),
  });
  if (readiness.status !== "ready") {
    return handleChildReadinessFailure({
      readiness,
      run,
      target,
      evidenceJournal,
      deleteChild,
      checkChildNotFound,
    });
  }
  attestation = readiness.attestation;

  let harnessEnvironment;
  let preparedControlPlane;
  try {
    harnessEnvironment =
      prepareLegacyAccountOwnerAssignmentRehearsalEnvironment({
        baseEnv,
        options: {
          branchId: attestation.branchId,
          branchName: attestation.branchName,
          endpointId: attestation.endpointId,
        },
        productionDatabasePolicy,
        expectedProductionSourceTargetFingerprint,
      });
    const targetGuard =
      guardLegacyAccountOwnerAssignmentRehearsalTarget(
        harnessEnvironment,
        previewDatabasePolicy,
      );
    preparedControlPlane =
      createOwnerAssignmentPreparedControlPlaneEvidence({
        attestation,
        readinessPollCount: readiness.pollCount,
        sourceAttestation,
        targetGuard,
      });
  } catch {
    const cleanup = await cleanupExactChild({
      projectId: target.projectId,
      branchId: attestation.branchId,
      deleteChild,
      checkChildNotFound,
    });
    let recoveryEvidence;
    try {
      recoveryEvidence =
        evidenceJournal.recordRecoveryCleanupResult(cleanup, {
          code: "harness_context_invalid",
        });
    } catch {
      return ownerAssignmentHostFailure(
        "cleanup_result_evidence_write_failed",
        {
          runId: run.runId,
          branchCreateInvocations: 1,
          cleanup,
          ...journalEvidenceState(evidenceJournal),
        },
      );
    }
    return ownerAssignmentHostFailure("harness_context_invalid", {
      runId: run.runId,
      branchCreateInvocations: 1,
      cleanup,
      evidencePersisted: true,
      lastPersistedPhase: recoveryEvidence.phase,
      evidence: recoveryEvidence,
    });
  }

  let cleanupResult = null;
  let harnessInvocations = 0;
  const session =
    await runLegacyAccountOwnerAssignmentResultEvidenceSession({
      evidenceFile: run.evidenceFile,
      runId: run.runId,
      sourceSha,
      prepare: async () => preparedControlPlane,
      runHarness: async () => {
        harnessInvocations += 1;
        return executeHarness({
          env: harnessEnvironment,
          poolFactory,
          previewDatabasePolicy,
        });
      },
      cleanup: async () => {
        cleanupResult = await cleanupExactChild({
          projectId: target.projectId,
          branchId: attestation.branchId,
          deleteChild,
          checkChildNotFound,
        });
        return cleanupResult;
      },
      createJournal: () => evidenceJournal,
    });

  return Object.freeze({
    host:
      "legacy_account_owner_assignment_rehearsal_host_v1",
    runId: run.runId,
    ...session,
    invocationCounts:
      session.evidence?.invocationCounts ??
      Object.freeze({
        branchCreate: 1,
        harness: harnessInvocations,
        branchDelete: cleanupResult?.deleteInvocations ?? 0,
        exactIdNotFoundCheck:
          cleanupResult?.exactIdGetInvocations ?? 0,
      }),
    cleanup: session.evidence?.cleanup ?? cleanupResult,
  });
}

export function readRepositoryHeadSha({
  repositoryRoot,
  spawn = spawnSync,
} = {}) {
  const result = spawn("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (
    !result ||
    result.status !== 0 ||
    result.signal !== null ||
    typeof result.stdout !== "string" ||
    result.stderr !== ""
  ) {
    throw hostError("source_sha_invalid");
  }
  return result.stdout.trim();
}

export function readRepositoryTrackedWorktreeClean({
  repositoryRoot,
  spawn = spawnSync,
} = {}) {
  for (const args of [
    ["diff", "--quiet", "--no-ext-diff", "--"],
    ["diff", "--cached", "--quiet", "--no-ext-diff", "--"],
  ]) {
    const result = spawn("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      windowsHide: true,
    });
    if (
      !result ||
      result.signal !== null ||
      result.stdout !== "" ||
      result.stderr !== "" ||
      ![0, 1].includes(result.status)
    ) {
      throw hostError("source_worktree_state_invalid");
    }
    if (result.status === 1) return false;
  }
  return true;
}

async function handleAmbiguousCreate({
  run,
  target,
  sourceAttestation,
  evidenceJournal,
  reconcileChildByExactName,
  attestChild,
  deleteChild,
  checkChildNotFound,
  readinessMonotonicNow,
  readinessSleep,
}) {
  let reconciliation;
  try {
    reconciliation =
      await waitForOwnerAssignmentChildByExactName({
        reconcileChildByExactName,
        branchName: run.branchName,
        target,
        ...(readinessMonotonicNow === undefined
          ? {}
          : { monotonicNow: readinessMonotonicNow }),
        ...(readinessSleep === undefined
          ? {}
          : { sleep: readinessSleep }),
      });
  } catch {
    return ownerAssignmentHostFailure(
      "branch_create_reconciliation_failed",
      {
        runId: run.runId,
        branchCreateInvocations: 1,
        exactNameReconciliations: 1,
        ...journalEvidenceState(evidenceJournal),
      },
    );
  }

  if (reconciliation.status === "failed") {
    let reconciliationEvidence;
    try {
      reconciliationEvidence =
        evidenceJournal.recordCreateReconciliationOutcome(
          readinessEvidence(reconciliation),
        );
    } catch {
      return ownerAssignmentHostFailure(
        "create_reconciliation_result_evidence_write_failed",
        {
          runId: run.runId,
          branchCreateInvocations: 1,
          exactNameReconciliations: 1,
          ...journalEvidenceState(evidenceJournal),
        },
      );
    }
    return ownerAssignmentHostFailure(
      "branch_create_reconciliation_failed",
      {
        runId: run.runId,
        branchCreateInvocations: 1,
        exactNameReconciliations: 1,
        evidencePersisted: true,
        lastPersistedPhase: reconciliationEvidence.phase,
        evidence: reconciliationEvidence,
      },
    );
  }
  if (reconciliation.status === "not_found") {
    let reconciliationEvidence;
    try {
      reconciliationEvidence =
        evidenceJournal.recordCreateReconciliationOutcome(
          readinessEvidence(reconciliation),
        );
    } catch {
      return ownerAssignmentHostFailure(
        "create_reconciliation_result_evidence_write_failed",
        {
          runId: run.runId,
          branchCreateInvocations: 1,
          exactNameReconciliations: 1,
          ...journalEvidenceState(evidenceJournal),
        },
      );
    }
    return ownerAssignmentHostFailure("branch_create_ambiguous", {
      runId: run.runId,
      branchCreateInvocations: 1,
      exactNameReconciliations: 1,
      evidencePersisted: true,
      lastPersistedPhase: reconciliationEvidence.phase,
      evidence: reconciliationEvidence,
    });
  }

  let reconciled;
  try {
    reconciled = projectCreatedOwnerAssignmentChild(
      reconciliation.child,
      run.branchName,
      target.parentBranchId,
    );
  } catch {
    return ownerAssignmentHostFailure(
      "branch_create_reconciliation_failed",
      {
        runId: run.runId,
        branchCreateInvocations: 1,
        exactNameReconciliations: 1,
        ...journalEvidenceState(evidenceJournal),
      },
    );
  }

  try {
    evidenceJournal.recordChildCreatedUnattested(
      createOwnerAssignmentUnattestedChildEvidence({
        createdChild: reconciled,
        sourceAttestation,
        target,
      }),
      { exactNameReconciliations: 1 },
    );
  } catch {
    return ownerAssignmentHostFailure(
      "child_created_unattested_evidence_write_failed",
      {
        runId: run.runId,
        branchCreateInvocations: 1,
        exactNameReconciliations: 1,
        ...journalEvidenceState(evidenceJournal),
      },
    );
  }

  const readiness = await waitForOwnerAssignmentChildReadiness({
    attestChild,
    createdChild: reconciled,
    target,
    ...(readinessMonotonicNow === undefined
      ? {}
      : { monotonicNow: readinessMonotonicNow }),
    ...(readinessSleep === undefined
      ? {}
      : { sleep: readinessSleep }),
  });
  if (readiness.status !== "ready") {
    let failureEvidence;
    try {
      failureEvidence =
        evidenceJournal.recordChildAttestationOutcome(
          readinessEvidence(readiness),
        );
    } catch {
      return ownerAssignmentHostFailure(
        "child_attestation_evidence_write_failed",
        {
          runId: run.runId,
          branchCreateInvocations: 1,
          exactNameReconciliations: 1,
          ...journalEvidenceState(evidenceJournal),
        },
      );
    }
    if (readiness.staticAttestation !== null) {
      const cleanup = await cleanupExactChild({
        projectId: target.projectId,
        branchId: readiness.staticAttestation.branchId,
        deleteChild,
        checkChildNotFound,
      });
      let recoveryEvidence;
      try {
        recoveryEvidence =
          evidenceJournal.recordRecoveryCleanupResult(cleanup, {
            code: "branch_create_ambiguous",
          });
      } catch {
        return ownerAssignmentHostFailure(
          "cleanup_result_evidence_write_failed",
          {
            runId: run.runId,
            branchCreateInvocations: 1,
            exactNameReconciliations: 1,
            cleanup,
            ...journalEvidenceState(evidenceJournal),
          },
        );
      }
      return ownerAssignmentHostFailure(
        "branch_create_ambiguous",
        {
          runId: run.runId,
          branchCreateInvocations: 1,
          exactNameReconciliations: 1,
          cleanup,
          evidencePersisted: true,
          lastPersistedPhase: recoveryEvidence.phase,
          evidence: recoveryEvidence,
        },
      );
    }
    return ownerAssignmentHostFailure(
      "branch_create_reconciliation_unresolved",
      {
        runId: run.runId,
        branchCreateInvocations: 1,
        exactNameReconciliations: 1,
        evidencePersisted: true,
        lastPersistedPhase: failureEvidence.phase,
        evidence: failureEvidence,
      },
    );
  }
  const attestation = readiness.attestation;
  try {
    evidenceJournal.recordChildAttestationOutcome(
      readinessEvidence(readiness),
    );
  } catch {
    return ownerAssignmentHostFailure(
      "child_attestation_evidence_write_failed",
      {
        runId: run.runId,
        branchCreateInvocations: 1,
        exactNameReconciliations: 1,
        ...journalEvidenceState(evidenceJournal),
      },
    );
  }

  const cleanup = await cleanupExactChild({
    projectId: target.projectId,
    branchId: attestation.branchId,
    deleteChild,
    checkChildNotFound,
  });
  let recoveryEvidence;
  try {
    recoveryEvidence =
      evidenceJournal.recordRecoveryCleanupResult(cleanup, {
        code: "branch_create_ambiguous",
      });
  } catch {
    return ownerAssignmentHostFailure(
      "cleanup_result_evidence_write_failed",
      {
        runId: run.runId,
        branchCreateInvocations: 1,
        exactNameReconciliations: 1,
        cleanup,
        ...journalEvidenceState(evidenceJournal),
      },
    );
  }
  return ownerAssignmentHostFailure("branch_create_ambiguous", {
    runId: run.runId,
    branchCreateInvocations: 1,
    exactNameReconciliations: 1,
    cleanup,
    evidencePersisted: true,
    lastPersistedPhase: recoveryEvidence.phase,
    evidence: recoveryEvidence,
  });
}

async function handleChildReadinessFailure({
  readiness,
  run,
  target,
  evidenceJournal,
  deleteChild,
  checkChildNotFound,
}) {
  const code = readinessFailureCode(readiness.outcome);
  let failureEvidence;
  try {
    failureEvidence =
      evidenceJournal.recordChildAttestationOutcome(
        readinessEvidence(readiness),
      );
  } catch {
    return ownerAssignmentHostFailure(
      "child_attestation_evidence_write_failed",
      {
        runId: run.runId,
        branchCreateInvocations: 1,
        ...journalEvidenceState(evidenceJournal),
      },
    );
  }

  if (readiness.staticAttestation === null) {
    return ownerAssignmentHostFailure(code, {
      runId: run.runId,
      branchCreateInvocations: 1,
      evidencePersisted: true,
      lastPersistedPhase: failureEvidence.phase,
      evidence: failureEvidence,
    });
  }

  const cleanup = await cleanupExactChild({
    projectId: target.projectId,
    branchId: readiness.staticAttestation.branchId,
    deleteChild,
    checkChildNotFound,
  });
  let recoveryEvidence;
  try {
    recoveryEvidence =
      evidenceJournal.recordRecoveryCleanupResult(cleanup, {
        code,
      });
  } catch {
    return ownerAssignmentHostFailure(
      "cleanup_result_evidence_write_failed",
      {
        runId: run.runId,
        branchCreateInvocations: 1,
        cleanup,
        ...journalEvidenceState(evidenceJournal),
      },
    );
  }
  return ownerAssignmentHostFailure(code, {
    runId: run.runId,
    branchCreateInvocations: 1,
    cleanup,
    evidencePersisted: true,
    lastPersistedPhase: recoveryEvidence.phase,
    evidence: recoveryEvidence,
  });
}

function readinessFailureCode(outcome) {
  if (outcome === "read_failed") {
    return "branch_readiness_read_failed";
  }
  if (outcome === "state_invalid") {
    return "branch_readiness_invalid";
  }
  if (outcome === "timeout") {
    return "branch_readiness_timeout";
  }
  return "branch_attestation_invalid";
}

function readinessEvidence(readiness) {
  return Object.freeze({
    outcome: readiness.outcome,
    pollCount: readiness.pollCount,
    ...(readiness.readDiagnostic === undefined
      ? {}
      : { readDiagnostic: readiness.readDiagnostic }),
  });
}

function journalEvidenceState(journal) {
  let evidence = null;
  try {
    evidence = journal?.persisted?.() ?? null;
  } catch {
    evidence = null;
  }
  return Object.freeze({
    evidencePersisted: evidence !== null,
    lastPersistedPhase: evidence?.phase ?? "none",
    ...(evidence === null ? {} : { evidence }),
  });
}

async function cleanupExactChild({
  projectId,
  branchId,
  deleteChild,
  checkChildNotFound,
}) {
  let deleteInvocations = 0;
  let exactIdGetInvocations = 0;
  let exactIdNotFound = false;

  try {
    deleteInvocations = 1;
    await deleteChild({ projectId, branchId });
  } catch {
    // An exact-ID read remains authoritative after an ambiguous delete.
  }
  try {
    exactIdGetInvocations = 1;
    exactIdNotFound =
      (await checkChildNotFound({ projectId, branchId })) === true;
  } catch {
    exactIdNotFound = false;
  }

  return Object.freeze({
    status: exactIdNotFound ? "passed" : "failed",
    deleteInvocations,
    exactIdGetInvocations,
    exactIdNotFound,
    ...(exactIdNotFound
      ? {}
      : { code: "cleanup_execution_failed" }),
  });
}
