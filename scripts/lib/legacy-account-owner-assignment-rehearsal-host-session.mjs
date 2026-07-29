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
  assertOwnerAssignmentHostTarget,
  assertOwnerAssignmentHostSourceSha,
  createLegacyAccountOwnerAssignmentHostRunIdentity,
  createOwnerAssignmentPreparedControlPlaneEvidence,
  createOwnerAssignmentUnattestedChildEvidence,
  hostError,
  ownerAssignmentHostFailure,
  projectCreatedOwnerAssignmentChild,
  projectVerifiedOwnerAssignmentChild,
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
  createRunId,
  executeHarness =
    executeLegacyAccountOwnerAssignmentRehearsal,
  productionDatabasePolicy,
  expectedProductionSourceTargetFingerprint,
  previewDatabasePolicy,
  poolFactory,
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
      executeHarness,
    ].every((item) => typeof item === "function") ||
    (createRunId !== undefined &&
      typeof createRunId !== "function") ||
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
  } catch {
    return ownerAssignmentHostFailure("source_sha_invalid");
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
      reconcileChildByExactName,
      attestChild,
      deleteChild,
      checkChildNotFound,
    });
  }

  let attestation;
  let evidenceJournal;
  let unattestedChildEvidence;
  try {
    evidenceJournal =
      createLegacyAccountOwnerAssignmentResultEvidenceJournal({
        evidenceFile: run.evidenceFile,
        runId: run.runId,
        sourceSha,
      });
    unattestedChildEvidence =
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
        evidencePersisted: false,
        lastPersistedPhase: "none",
      },
    );
  }

  try {
    attestation = projectVerifiedOwnerAssignmentChild(
      await attestChild({
        projectId: target.projectId,
        branchId: createdChild.branchId,
        branchName: createdChild.branchName,
      }),
      {
        createdChild,
        expectedProjectId: target.projectId,
        expectedParentBranchId: target.parentBranchId,
        expectedProductionEndpointId:
          target.productionEndpointId,
      },
    );
  } catch {
    return ownerAssignmentHostFailure("branch_attestation_invalid", {
      runId: run.runId,
      branchCreateInvocations: 1,
      evidencePersisted: true,
      lastPersistedPhase: unattestedChildEvidence.phase,
      evidence: unattestedChildEvidence,
    });
  }

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
    return ownerAssignmentHostFailure("harness_context_invalid", {
      runId: run.runId,
      branchCreateInvocations: 1,
      cleanup,
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

async function handleAmbiguousCreate({
  run,
  target,
  reconcileChildByExactName,
  attestChild,
  deleteChild,
  checkChildNotFound,
}) {
  let reconciled = null;
  try {
    const value = await reconcileChildByExactName({
      projectId: target.projectId,
      branchName: run.branchName,
    });
    if (value !== null) {
      reconciled = projectCreatedOwnerAssignmentChild(
        value,
        run.branchName,
        target.parentBranchId,
      );
    }
  } catch {
    return ownerAssignmentHostFailure(
      "branch_create_reconciliation_failed",
      {
        runId: run.runId,
        branchCreateInvocations: 1,
        exactNameReconciliations: 1,
      },
    );
  }

  if (reconciled === null) {
    return ownerAssignmentHostFailure("branch_create_ambiguous", {
      runId: run.runId,
      branchCreateInvocations: 1,
      exactNameReconciliations: 1,
    });
  }

  let attestation;
  try {
    attestation = projectVerifiedOwnerAssignmentChild(
      await attestChild({
        projectId: target.projectId,
        branchId: reconciled.branchId,
        branchName: reconciled.branchName,
      }),
      {
        createdChild: reconciled,
        expectedProjectId: target.projectId,
        expectedParentBranchId: target.parentBranchId,
        expectedProductionEndpointId:
          target.productionEndpointId,
      },
    );
  } catch {
    return ownerAssignmentHostFailure(
      "branch_create_reconciliation_unresolved",
      {
        runId: run.runId,
        branchCreateInvocations: 1,
        exactNameReconciliations: 1,
      },
    );
  }

  const cleanup = await cleanupExactChild({
    projectId: target.projectId,
    branchId: attestation.branchId,
    deleteChild,
    checkChildNotFound,
  });
  return ownerAssignmentHostFailure("branch_create_ambiguous", {
    runId: run.runId,
    branchCreateInvocations: 1,
    exactNameReconciliations: 1,
    cleanup,
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
