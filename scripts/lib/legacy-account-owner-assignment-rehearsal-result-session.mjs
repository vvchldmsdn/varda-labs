import {
  createLegacyAccountOwnerAssignmentResultEvidenceJournal,
} from "./legacy-account-owner-assignment-rehearsal-result-store.mjs";
import {
  resultEvidenceSessionFailure,
  safeResultEvidenceSessionCode,
} from "./legacy-account-owner-assignment-rehearsal-result-policy.mjs";

export async function runLegacyAccountOwnerAssignmentResultEvidenceSession({
  evidenceFile,
  runId,
  sourceSha,
  prepare,
  runHarness,
  cleanup,
  createJournal =
    createLegacyAccountOwnerAssignmentResultEvidenceJournal,
} = {}) {
  if (
    typeof prepare !== "function" ||
    typeof runHarness !== "function" ||
    typeof cleanup !== "function" ||
    typeof createJournal !== "function"
  ) {
    return resultEvidenceSessionFailure("prepared_result_invalid");
  }

  let journal;
  try {
    journal = createJournal({ evidenceFile, runId, sourceSha });
  } catch (error) {
    return resultEvidenceSessionFailure(
      safeResultEvidenceSessionCode(
        error,
        "prepared_result_invalid",
      ),
    );
  }

  let preparedValue;
  let harnessValue;
  let sessionCode = null;

  try {
    try {
      preparedValue = await prepare();
    } catch {
      sessionCode = "prepared_result_invalid";
    }

    if (sessionCode === null) {
      try {
        journal.recordPrepared(preparedValue);
      } catch (error) {
        sessionCode = safeResultEvidenceSessionCode(
          error,
          "prepared_evidence_write_failed",
        );
      }
    }

    if (sessionCode === null) {
      try {
        harnessValue = await runHarness(preparedValue);
      } catch {
        sessionCode = "harness_execution_failed";
      }
    }

    if (sessionCode === null) {
      try {
        journal.recordHarnessResult(harnessValue);
      } catch (error) {
        sessionCode = safeResultEvidenceSessionCode(
          error,
          "harness_result_invalid",
        );
      }
    }
  } finally {
    let cleanupValue;
    try {
      cleanupValue = await cleanup();
    } catch {
      cleanupValue = Object.freeze({
        status: "failed",
        deleteInvocations: preparedValue === undefined ? 0 : 1,
        exactIdGetInvocations: 0,
        exactIdNotFound: false,
        code: "cleanup_execution_failed",
      });
      sessionCode ??= "cleanup_execution_failed";
    }

    if (journal.latest() !== null) {
      try {
        journal.recordCleanupResult(cleanupValue, { sessionCode });
      } catch (error) {
        sessionCode ??= safeResultEvidenceSessionCode(
          error,
          "cleanup_result_evidence_write_failed",
        );
      }
    }
  }

  const persisted = journal.persisted();
  if (persisted?.phase === "cleanup_result") {
    return Object.freeze({
      status: persisted.status,
      code: persisted.code,
      cleanupInvoked: true,
      evidencePersisted: true,
      evidence: persisted,
    });
  }
  return resultEvidenceSessionFailure(
    sessionCode ?? "cleanup_result_evidence_write_failed",
    {
      cleanupInvoked: true,
      evidencePersisted: false,
      lastPersistedPhase: persisted?.phase ?? "none",
    },
  );
}
