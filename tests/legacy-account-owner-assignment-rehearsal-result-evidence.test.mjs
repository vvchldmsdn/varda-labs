import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  createLegacyAccountOwnerAssignmentResultEvidenceJournal,
  LEGACY_ACCOUNT_OWNER_ASSIGNMENT_RESULT_EVIDENCE_VERSION,
  runLegacyAccountOwnerAssignmentResultEvidenceSession,
} from "../scripts/lib/legacy-account-owner-assignment-rehearsal-result-evidence.mjs";

const SOURCE_SHA = "d5d7a82d44f8b2b5517462f3bf5f9bb1e74a6698";
const RUN_ID = "11111111-1111-4111-8111-111111111111";
const CHECKS = Object.freeze([
  "successful_assignment",
  "already_applied",
  "missing_consumed_evidence",
  "digest_drift",
  "foreign_owner",
  "same_target_race",
  "partial_update_rollback",
  "lock_timeout_rollback",
]);

describe("legacy account owner-assignment result evidence", () => {
  it("atomically replaces one fixed-schema file through all phases", () => {
    withEvidenceFile((evidenceFile) => {
      const journal =
        createLegacyAccountOwnerAssignmentResultEvidenceJournal({
          evidenceFile,
          runId: RUN_ID,
          sourceSha: SOURCE_SHA,
        });

      journal.recordPrepared(preparedEvidence());
      assert.equal(readEvidence(evidenceFile).phase, "prepared");

      journal.recordHarnessResult(passedHarnessEvidence());
      assert.equal(
        readEvidence(evidenceFile).phase,
        "harness_result",
      );

      const final = journal.recordCleanupResult(passedCleanup());
      const stored = readEvidence(evidenceFile);
      assert.deepEqual(stored, final);
      assert.equal(
        stored.evidenceVersion,
        LEGACY_ACCOUNT_OWNER_ASSIGNMENT_RESULT_EVIDENCE_VERSION,
      );
      assert.equal(stored.runId, RUN_ID);
      assert.equal(stored.phase, "cleanup_result");
      assert.equal(stored.status, "passed");
      assert.deepEqual(stored.invocationCounts, {
        branchCreate: 1,
        harness: 1,
        branchDelete: 1,
        exactIdNotFoundCheck: 1,
      });
      assert.equal(stored.harness.checkCount, 8);
      assert.equal(stored.cleanup.exactIdNotFound, true);
    });
  });

  it("does not reflect raw fields or execute caller accessors", () => {
    withEvidenceFile((evidenceFile) => {
      let getterCalls = 0;
      const prepared = preparedEvidence();
      prepared.rawDatabaseUrl = "postgresql://user:secret@host/db";
      prepared.apiKey = "must-not-persist";
      Object.defineProperty(prepared, "toJSON", {
        get() {
          getterCalls += 1;
          throw new Error("must not execute");
        },
      });
      const harness = passedHarnessEvidence();
      harness.authorization = "must-not-persist";
      harness.providerSubject = "must-not-persist";
      const cleanup = {
        ...passedCleanup(),
        rawCliOutput: "token=must-not-persist",
      };

      const journal =
        createLegacyAccountOwnerAssignmentResultEvidenceJournal({
          evidenceFile,
          runId: RUN_ID,
          sourceSha: SOURCE_SHA,
        });
      journal.recordPrepared(prepared);
      journal.recordHarnessResult(harness);
      journal.recordCleanupResult(cleanup);

      const raw = readFileSync(evidenceFile, "utf8");
      assert.equal(getterCalls, 0);
      for (const forbidden of [
        "postgresql",
        "secret",
        "apiKey",
        "authorization",
        "providerSubject",
        "rawCliOutput",
        "token",
      ]) {
        assert.equal(raw.includes(forbidden), false, forbidden);
      }
    });
  });

  it("blocks accessors on required fields without invoking them", () => {
    withEvidenceFile((evidenceFile) => {
      let getterCalls = 0;
      const prepared = preparedEvidence();
      Object.defineProperty(prepared, "endpointFingerprint", {
        configurable: true,
        get() {
          getterCalls += 1;
          return fingerprint("child-endpoint");
        },
      });
      const journal =
        createLegacyAccountOwnerAssignmentResultEvidenceJournal({
          evidenceFile,
          runId: RUN_ID,
          sourceSha: SOURCE_SHA,
        });
      assert.throws(
        () => journal.recordPrepared(prepared),
        (error) => error.code === "prepared_result_invalid",
      );
      assert.equal(getterCalls, 0);
    });
  });

  it("cleans up and records failure when harness output is malformed", async () => {
    await withEvidenceFileAsync(async (evidenceFile) => {
      let prepareCalls = 0;
      let harnessCalls = 0;
      let cleanupCalls = 0;
      const result =
        await runLegacyAccountOwnerAssignmentResultEvidenceSession({
          evidenceFile,
          runId: RUN_ID,
          sourceSha: SOURCE_SHA,
          async prepare() {
            prepareCalls += 1;
            return preparedEvidence();
          },
          async runHarness() {
            harnessCalls += 1;
            return {
              ...passedHarnessEvidence(),
              productionDatabaseWrites: 1,
            };
          },
          async cleanup() {
            cleanupCalls += 1;
            return passedCleanup();
          },
        });

      assert.equal(prepareCalls, 1);
      assert.equal(harnessCalls, 1);
      assert.equal(cleanupCalls, 1);
      assert.equal(result.status, "failed");
      assert.equal(result.code, "harness_result_invalid");
      assert.equal(result.cleanupInvoked, true);
      assert.equal(result.evidence.phase, "cleanup_result");
      assert.equal(result.evidence.harness, null);
      assert.equal(
        result.evidence.cleanup.exactIdNotFound,
        true,
      );
    });
  });

  it("skips the harness but still cleans up after prepared evidence write failure", async () => {
    await withEvidenceFileAsync(async (evidenceFile) => {
      let harnessCalls = 0;
      let cleanupCalls = 0;
      let writeCalls = 0;
      const snapshots = [];
      const result =
        await runLegacyAccountOwnerAssignmentResultEvidenceSession({
          evidenceFile,
          runId: RUN_ID,
          sourceSha: SOURCE_SHA,
          prepare: async () => preparedEvidence(),
          async runHarness() {
            harnessCalls += 1;
            return passedHarnessEvidence();
          },
          async cleanup() {
            cleanupCalls += 1;
            return passedCleanup();
          },
          createJournal(options) {
            return createLegacyAccountOwnerAssignmentResultEvidenceJournal({
              ...options,
              writeSnapshot(_file, snapshot) {
                writeCalls += 1;
                snapshots.push(snapshot);
                if (writeCalls === 1) throw new Error("synthetic");
              },
            });
          },
        });

      assert.equal(harnessCalls, 0);
      assert.equal(cleanupCalls, 1);
      assert.equal(writeCalls, 1);
      assert.equal(result.status, "failed");
      assert.equal(result.code, "prepared_evidence_write_failed");
      assert.equal(result.evidencePersisted, false);
      assert.equal(result.lastPersistedPhase, "none");
      assert.equal(snapshots.at(-1).phase, "prepared");
    });
  });

  it("retains the sanitized harness result when its phase write fails", async () => {
    await withEvidenceFileAsync(async (evidenceFile) => {
      let cleanupCalls = 0;
      const snapshots = [];
      const result =
        await runLegacyAccountOwnerAssignmentResultEvidenceSession({
          evidenceFile,
          runId: RUN_ID,
          sourceSha: SOURCE_SHA,
          prepare: async () => preparedEvidence(),
          runHarness: async () => passedHarnessEvidence(),
          async cleanup() {
            cleanupCalls += 1;
            return passedCleanup();
          },
          createJournal(options) {
            return createLegacyAccountOwnerAssignmentResultEvidenceJournal({
              ...options,
              writeSnapshot(_file, snapshot) {
                snapshots.push(snapshot);
                if (snapshot.phase === "harness_result") {
                  throw new Error("synthetic");
                }
              },
            });
          },
        });

      assert.equal(cleanupCalls, 1);
      assert.equal(result.status, "failed");
      assert.equal(
        result.code,
        "harness_result_evidence_write_failed",
      );
      assert.equal(result.evidencePersisted, true);
      assert.equal(result.evidence.harness.status, "passed");
      assert.equal(snapshots.at(-1).phase, "cleanup_result");
    });
  });

  it("sanitizes a thrown harness failure and still records cleanup", async () => {
    await withEvidenceFileAsync(async (evidenceFile) => {
      let cleanupCalls = 0;
      const result =
        await runLegacyAccountOwnerAssignmentResultEvidenceSession({
          evidenceFile,
          runId: RUN_ID,
          sourceSha: SOURCE_SHA,
          prepare: async () => preparedEvidence(),
          async runHarness() {
            throw new Error(
              "postgresql://user:secret@host/db token=secret",
            );
          },
          async cleanup() {
            cleanupCalls += 1;
            return passedCleanup();
          },
        });

      assert.equal(cleanupCalls, 1);
      assert.equal(result.status, "failed");
      assert.equal(result.code, "harness_execution_failed");
      const raw = readFileSync(evidenceFile, "utf8");
      assert.equal(raw.includes("postgresql"), false);
      assert.equal(raw.includes("secret"), false);
      assert.equal(raw.includes("token"), false);
    });
  });

  it("records a sanitized cleanup failure without a second cleanup call", async () => {
    await withEvidenceFileAsync(async (evidenceFile) => {
      let cleanupCalls = 0;
      const result =
        await runLegacyAccountOwnerAssignmentResultEvidenceSession({
          evidenceFile,
          runId: RUN_ID,
          sourceSha: SOURCE_SHA,
          prepare: async () => preparedEvidence(),
          runHarness: async () => passedHarnessEvidence(),
          async cleanup() {
            cleanupCalls += 1;
            throw new Error("authorization=secret");
          },
        });

      assert.equal(cleanupCalls, 1);
      assert.equal(result.status, "failed");
      assert.equal(result.code, "cleanup_execution_failed");
      assert.deepEqual(result.evidence.cleanup, {
        status: "failed",
        deleteInvocations: 1,
        exactIdGetInvocations: 0,
        exactIdNotFound: false,
        code: "cleanup_execution_failed",
      });
      const raw = readFileSync(evidenceFile, "utf8");
      assert.equal(raw.includes("authorization"), false);
      assert.equal(raw.includes("secret"), false);
    });
  });

  it("reports a final write failure after cleanup without retrying callbacks", async () => {
    await withEvidenceFileAsync(async (evidenceFile) => {
      let prepareCalls = 0;
      let harnessCalls = 0;
      let cleanupCalls = 0;
      const result =
        await runLegacyAccountOwnerAssignmentResultEvidenceSession({
          evidenceFile,
          runId: RUN_ID,
          sourceSha: SOURCE_SHA,
          async prepare() {
            prepareCalls += 1;
            return preparedEvidence();
          },
          async runHarness() {
            harnessCalls += 1;
            return passedHarnessEvidence();
          },
          async cleanup() {
            cleanupCalls += 1;
            return passedCleanup();
          },
          createJournal(options) {
            return createLegacyAccountOwnerAssignmentResultEvidenceJournal({
              ...options,
              writeSnapshot(_file, snapshot) {
                if (snapshot.phase === "cleanup_result") {
                  throw new Error("synthetic");
                }
              },
            });
          },
        });

      assert.equal(prepareCalls, 1);
      assert.equal(harnessCalls, 1);
      assert.equal(cleanupCalls, 1);
      assert.equal(result.status, "failed");
      assert.equal(
        result.code,
        "cleanup_result_evidence_write_failed",
      );
      assert.equal(result.evidencePersisted, false);
      assert.equal(result.lastPersistedPhase, "harness_result");
    });
  });

  it("refuses a stale run file without replacing it", () => {
    withEvidenceFile((evidenceFile) => {
      writeFileSync(evidenceFile, "stale-evidence\n", "utf8");
      const journal =
        createLegacyAccountOwnerAssignmentResultEvidenceJournal({
          evidenceFile,
          runId: RUN_ID,
          sourceSha: SOURCE_SHA,
        });

      assert.throws(
        () => journal.recordPrepared(preparedEvidence()),
        (error) =>
          error.code === "prepared_evidence_write_failed",
      );
      assert.equal(
        readFileSync(evidenceFile, "utf8"),
        "stale-evidence\n",
      );
    });
  });

  it("requires the run id to match the evidence file name", () => {
    withEvidenceFile((evidenceFile) => {
      assert.throws(
        () =>
          createLegacyAccountOwnerAssignmentResultEvidenceJournal({
            evidenceFile,
            runId: "22222222-2222-4222-8222-222222222222",
            sourceSha: SOURCE_SHA,
          }),
        (error) => error.code === "prepared_result_invalid",
      );
      assert.equal(existsSync(evidenceFile), false);
    });
  });
});

function preparedEvidence() {
  return {
    projectFingerprint: fingerprint("project"),
    parentBranchFingerprint: fingerprint("parent"),
    branchIdFingerprint: fingerprint("child-branch"),
    branchNameFingerprint: fingerprint("child-name"),
    endpointFingerprint: fingerprint("child-endpoint"),
    productionEndpointFingerprint: fingerprint(
      "production-endpoint",
    ),
    sourceTargetFingerprint: fingerprint("source-target"),
    targetFingerprint: fingerprint("target"),
    endpointType: "read_write",
    endpointReady: true,
    productionEndpointSeparated: true,
    default: false,
    primary: false,
    protected: false,
    autoExpires: true,
  };
}

function passedHarnessEvidence() {
  const prepared = preparedEvidence();
  return {
    rehearsal:
      "legacy_account_owner_assignment_disposable_branch_v1",
    status: "passed",
    stage: "completed",
    lastCompletedCheck: "fixture_cleanup",
    checks: [...CHECKS],
    poolReadiness: true,
    disposableBranchDmlAttempted: true,
    accountBaselineRestored: true,
    temporaryDatabaseObjectsRemoved: true,
    retryCount: 0,
    dbMigrateInvocations: 0,
    productionDatabaseWrites: 0,
    syntheticRowsMayRemainUntilBranchDeletion: true,
    cleanupAuthority: "exact_branch_deletion",
    branchDeletionRequired: true,
    branchIdFingerprint: prepared.branchIdFingerprint,
    branchNameFingerprint: prepared.branchNameFingerprint,
    endpointFingerprint: prepared.endpointFingerprint,
    sourceTargetFingerprint: prepared.sourceTargetFingerprint,
    targetFingerprint: prepared.targetFingerprint,
  };
}

function passedCleanup() {
  return {
    status: "passed",
    deleteInvocations: 1,
    exactIdGetInvocations: 1,
    exactIdNotFound: true,
  };
}

function readEvidence(evidenceFile) {
  return JSON.parse(readFileSync(evidenceFile, "utf8"));
}

function fingerprint(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function withEvidenceFile(run) {
  const directory = mkdtempSync(
    join(tmpdir(), "varda-owner-result-evidence-"),
  );
  const evidenceFile = join(
    directory,
    `legacy-account-owner-assignment-rehearsal-${RUN_ID}.json`,
  );
  try {
    return run(evidenceFile);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

async function withEvidenceFileAsync(run) {
  const directory = mkdtempSync(
    join(tmpdir(), "varda-owner-result-evidence-"),
  );
  const evidenceFile = join(
    directory,
    `legacy-account-owner-assignment-rehearsal-${RUN_ID}.json`,
  );
  try {
    return await run(evidenceFile);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}
