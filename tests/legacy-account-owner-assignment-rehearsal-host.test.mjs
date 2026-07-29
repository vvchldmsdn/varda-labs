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
  guardLegacyAccountOwnerAssignmentRehearsalTarget,
} from "../src/lib/deployment/legacy-account-owner-assignment-rehearsal-target.ts";
import {
  guardProductionDatabaseTarget,
} from "../src/lib/deployment/production-database-target.ts";
import {
  createLegacyAccountOwnerAssignmentResultEvidenceJournal,
} from "../scripts/lib/legacy-account-owner-assignment-rehearsal-result-evidence.mjs";
import {
  readRepositoryTrackedWorktreeClean,
  runLegacyAccountOwnerAssignmentRehearsalHost,
} from "../scripts/lib/legacy-account-owner-assignment-rehearsal-host.mjs";

const SOURCE_SHA = "358c5545c801ff1f68d9e7a29020bf5e5b57f2d0";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "synthetic-project";
const PARENT_BRANCH_ID = "br-synthetic-production";
const PRODUCTION_ENDPOINT_ID = "ep-synthetic-production";
const CHILD_BRANCH_ID = "br-synthetic-owner-rehearsal";
const CHILD_ENDPOINT_ID = "ep-synthetic-owner-rehearsal";
const USERNAME = "synthetic-user";
const PASSWORD = "synthetic-password";
const DATABASE = "synthetic-db";
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
const PREVIEW_POLICY = Object.freeze({
  policyId: "preview_database_target_operational_guard_v2",
  expectedNeonIntegrationProjectSha256: fingerprint(PROJECT_ID),
  productionEndpointSha256: fingerprint(PRODUCTION_ENDPOINT_ID),
});
const PRODUCTION_POLICY = Object.freeze({
  policyId: "production_database_target_operational_guard_v1",
  expectedNeonIntegrationProjectSha256: fingerprint(PROJECT_ID),
  productionEndpointSha256: fingerprint(PRODUCTION_ENDPOINT_ID),
});
const PRODUCTION_SOURCE_TARGET_FINGERPRINT =
  guardProductionDatabaseTarget(
    productionEnvironment(),
    PRODUCTION_POLICY,
  ).targetFingerprint;

describe("legacy account owner-assignment rehearsal host", () => {
  it("runs one create, programmatic harness, delete, and exact-id check", async () => {
    await withEvidenceDirectory(async (evidenceDirectory) => {
      const calls = callCounts();
      const result =
        await runLegacyAccountOwnerAssignmentRehearsalHost({
          ...hostOptions(evidenceDirectory, calls),
        });

      assert.equal(result.status, "passed");
      assert.equal(result.runId, RUN_ID);
      assert.deepEqual(calls, {
        sourceSha: 1,
        sourceClean: 1,
        sourceAttest: 1,
        create: 1,
        reconcile: 0,
        attest: 1,
        harness: 1,
        delete: 1,
        get: 1,
      });
      const stored = readEvidence(evidenceDirectory);
      assert.equal(stored.phase, "cleanup_result");
      assert.equal(stored.status, "passed");
      assert.equal(stored.runId, RUN_ID);
      assert.deepEqual(stored.invocationCounts, {
        branchCreate: 1,
        harness: 1,
        branchDelete: 1,
        exactIdNotFoundCheck: 1,
      });
      const raw = JSON.stringify(stored);
      for (const forbidden of [
        PROJECT_ID,
        PARENT_BRANCH_ID,
        CHILD_BRANCH_ID,
        CHILD_ENDPOINT_ID,
        PRODUCTION_ENDPOINT_ID,
        USERNAME,
        PASSWORD,
        DATABASE,
        "postgresql",
      ]) {
        assert.equal(raw.includes(forbidden), false, forbidden);
      }
    });
  });

  it("rejects a stale evidence path before creating a child", async () => {
    await withEvidenceDirectory(async (evidenceDirectory) => {
      const evidenceFile = expectedEvidenceFile(evidenceDirectory);
      writeFileSync(evidenceFile, "stale-run\n", "utf8");
      const calls = callCounts();
      const result =
        await runLegacyAccountOwnerAssignmentRehearsalHost({
          ...hostOptions(evidenceDirectory, calls),
        });

      assert.equal(result.status, "failed");
      assert.equal(result.code, "stale_evidence_path");
      assert.equal(readFileSync(evidenceFile, "utf8"), "stale-run\n");
      assert.deepEqual(calls, {
        sourceSha: 1,
        sourceClean: 1,
        sourceAttest: 0,
        create: 0,
        reconcile: 0,
        attest: 0,
        harness: 0,
        delete: 0,
        get: 0,
      });
    });
  });

  it("rejects an invalid target before creating a child", async () => {
    await withEvidenceDirectory(async (evidenceDirectory) => {
      const calls = callCounts();
      const result =
        await runLegacyAccountOwnerAssignmentRehearsalHost({
          ...hostOptions(evidenceDirectory, calls),
          projectId: "INVALID PROJECT",
        });

      assert.equal(result.status, "failed");
      assert.equal(result.code, "host_options_invalid");
      assert.deepEqual(calls, {
        sourceSha: 0,
        sourceClean: 0,
        sourceAttest: 0,
        create: 0,
        reconcile: 0,
        attest: 0,
        harness: 0,
        delete: 0,
        get: 0,
      });
    });
  });

  it("does not create a child when create-request evidence cannot be written", async () => {
    await withEvidenceDirectory(async (evidenceDirectory) => {
      const calls = callCounts();
      const options = hostOptions(evidenceDirectory, calls);
      const result =
        await runLegacyAccountOwnerAssignmentRehearsalHost({
          ...options,
          createEvidenceJournal(journalOptions) {
            const journal =
              createLegacyAccountOwnerAssignmentResultEvidenceJournal(
                journalOptions,
              );
            return Object.freeze({
              ...journal,
              recordCreateRequested() {
                throw new Error("synthetic write failure");
              },
            });
          },
        });

      assert.equal(result.status, "failed");
      assert.equal(
        result.code,
        "create_requested_evidence_write_failed",
      );
      assert.equal(result.evidencePersisted, false);
      assert.equal(calls.create, 0);
      assert.equal(calls.attest, 0);
      assert.equal(calls.harness, 0);
      assert.equal(calls.delete, 0);
      assert.equal(calls.get, 0);
      assert.equal(
        existsSync(expectedEvidenceFile(evidenceDirectory)),
        false,
      );
    });
  });

  it("keeps create-request evidence when the child recovery transition fails", async () => {
    await withEvidenceDirectory(async (evidenceDirectory) => {
      const calls = callCounts();
      const options = hostOptions(evidenceDirectory, calls);
      const result =
        await runLegacyAccountOwnerAssignmentRehearsalHost({
          ...options,
          createEvidenceJournal(journalOptions) {
            const journal =
              createLegacyAccountOwnerAssignmentResultEvidenceJournal(
                journalOptions,
              );
            return Object.freeze({
              ...journal,
              recordChildCreatedUnattested() {
                throw new Error("synthetic transition failure");
              },
            });
          },
        });

      assert.equal(result.status, "failed");
      assert.equal(
        result.code,
        "child_created_unattested_evidence_write_failed",
      );
      assert.equal(result.evidencePersisted, true);
      assert.equal(result.lastPersistedPhase, "create_requested");
      assert.deepEqual(result.invocationCounts, {
        branchCreate: 1,
        exactNameReconciliation: 0,
        branchDelete: 0,
        exactIdNotFoundCheck: 0,
      });
      assert.equal(result.cleanup, null);
      assert.equal(calls.attest, 0);
      assert.equal(calls.harness, 0);
      assert.equal(calls.delete, 0);
      assert.equal(calls.get, 0);
      const evidence = readEvidence(evidenceDirectory);
      assert.equal(evidence.phase, "create_requested");
      assert.equal(
        evidence.resolution,
        "exact_name_reconciliation_required",
      );
    });
  });

  it("uses the verified child closure for cleanup after malformed harness evidence", async () => {
    await withEvidenceDirectory(async (evidenceDirectory) => {
      const calls = callCounts();
      const deletedIds = [];
      const options = hostOptions(evidenceDirectory, calls);
      const result =
        await runLegacyAccountOwnerAssignmentRehearsalHost({
          ...options,
          async executeHarness({ env }) {
            calls.harness += 1;
            return {
              ...passedHarness(env),
              productionDatabaseWrites: 1,
              branchId: "br-attacker-controlled",
            };
          },
          async deleteChild({ branchId }) {
            calls.delete += 1;
            deletedIds.push(branchId);
          },
        });

      assert.equal(result.status, "failed");
      assert.equal(result.code, "harness_result_invalid");
      assert.deepEqual(deletedIds, [CHILD_BRANCH_ID]);
      assert.equal(calls.harness, 1);
      assert.equal(calls.delete, 1);
      assert.equal(calls.get, 1);
    });
  });

  it("does not create a child when the repository SHA drifts", async () => {
    await withEvidenceDirectory(async (evidenceDirectory) => {
      const calls = callCounts();
      const result =
        await runLegacyAccountOwnerAssignmentRehearsalHost({
          ...hostOptions(evidenceDirectory, calls),
          async readSourceSha() {
            calls.sourceSha += 1;
            return "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
          },
        });

      assert.equal(result.status, "failed");
      assert.equal(result.code, "source_sha_mismatch");
      assert.equal(calls.sourceSha, 1);
      assert.equal(calls.sourceClean, 1);
      assert.equal(calls.sourceAttest, 0);
      assert.equal(calls.create, 0);
      assert.equal(calls.harness, 0);
      assert.equal(calls.delete, 0);
    });
  });

  it("blocks a tracked dirty worktree before control-plane reads", async () => {
    await withEvidenceDirectory(async (evidenceDirectory) => {
      const calls = callCounts();
      const result =
        await runLegacyAccountOwnerAssignmentRehearsalHost({
          ...hostOptions(evidenceDirectory, calls),
          async readTrackedWorktreeClean() {
            calls.sourceClean += 1;
            return false;
          },
        });

      assert.equal(result.status, "failed");
      assert.equal(result.code, "source_worktree_dirty");
      assert.equal(calls.sourceSha, 1);
      assert.equal(calls.sourceClean, 1);
      assert.equal(calls.sourceAttest, 0);
      assert.equal(calls.create, 0);
      assert.equal(calls.reconcile, 0);
      assert.equal(
        existsSync(expectedEvidenceFile(evidenceDirectory)),
        false,
      );
    });
  });

  it("checks only tracked staged and unstaged Git diffs", () => {
    const commands = [];
    const clean = readRepositoryTrackedWorktreeClean({
      repositoryRoot: process.cwd(),
      spawn(command, args) {
        commands.push([command, ...args]);
        return {
          status: 0,
          signal: null,
          stdout: "",
          stderr: "",
        };
      },
    });

    assert.equal(clean, true);
    assert.deepEqual(commands, [
      ["git", "diff", "--quiet", "--no-ext-diff", "--"],
      [
        "git",
        "diff",
        "--cached",
        "--quiet",
        "--no-ext-diff",
        "--",
      ],
    ]);
  });

  it("guards the Production database source before any control-plane mutation", async () => {
    await withEvidenceDirectory(async (evidenceDirectory) => {
      const calls = callCounts();
      const result =
        await runLegacyAccountOwnerAssignmentRehearsalHost({
          ...hostOptions(evidenceDirectory, calls),
          baseEnv: {
            ...productionEnvironment(),
            DATABASE_URL: databaseUrl(
              "ep-different-production",
              true,
            ),
          },
        });

      assert.equal(result.status, "failed");
      assert.equal(
        result.code,
        "production_source_attestation_invalid",
      );
      assert.equal(calls.sourceAttest, 0);
      assert.equal(calls.create, 0);
      assert.equal(calls.harness, 0);
      assert.equal(calls.delete, 0);
    });
  });

  it("rejects stale Production control-plane ownership before child creation", async () => {
    await withEvidenceDirectory(async (evidenceDirectory) => {
      const calls = callCounts();
      const options = hostOptions(evidenceDirectory, calls);
      const result =
        await runLegacyAccountOwnerAssignmentRehearsalHost({
          ...options,
          async attestProductionSource() {
            calls.sourceAttest += 1;
            return {
              ...verifiedProductionAttestation(),
              endpointBranchId: "br-stale-production",
            };
          },
        });

      assert.equal(result.status, "failed");
      assert.equal(
        result.code,
        "production_source_attestation_invalid",
      );
      assert.equal(calls.sourceAttest, 1);
      assert.equal(calls.create, 0);
      assert.equal(calls.harness, 0);
      assert.equal(calls.delete, 0);
    });
  });

  it("leaves an unattested created child unresolved without deleting it", async () => {
    await withEvidenceDirectory(async (evidenceDirectory) => {
      const calls = callCounts();
      const options = hostOptions(evidenceDirectory, calls);
      const result =
        await runLegacyAccountOwnerAssignmentRehearsalHost({
          ...options,
          async attestChild({ branchName }) {
            calls.attest += 1;
            return {
              ...verifiedAttestation(branchName),
              endpointBranchId: "br-foreign-child",
            };
          },
        });

      assert.equal(result.status, "failed");
      assert.equal(result.code, "branch_attestation_invalid");
      assert.equal(result.evidencePersisted, true);
      assert.equal(
        result.lastPersistedPhase,
        "child_created_unattested",
      );
      assert.equal(calls.create, 1);
      assert.equal(calls.attest, 1);
      assert.equal(calls.harness, 0);
      assert.equal(calls.delete, 0);
      assert.equal(calls.get, 0);

      const evidence = readEvidence(evidenceDirectory);
      assert.equal(evidence.phase, "child_created_unattested");
      assert.equal(evidence.status, "failed");
      assert.equal(evidence.code, "branch_attestation_invalid");
      assert.equal(evidence.cleanup, "unattempted");
      assert.equal(
        evidence.resolution,
        "manual_or_auto_expiry_unverified",
      );
      assert.deepEqual(evidence.invocationCounts, {
        branchCreate: 1,
        exactNameReconciliation: 0,
        harness: 0,
        branchDelete: 0,
        exactIdNotFoundCheck: 0,
      });
      assert.equal(
        evidence.recovery.branchIdFingerprint,
        fingerprint(CHILD_BRANCH_ID),
      );
      assert.equal(
        evidence.recovery.branchNameFingerprint,
        fingerprint(
          `preview/codex/legacy-account-owner-assignment-rehearsal-${RUN_ID}`,
        ),
      );
      const raw = readFileSync(
        expectedEvidenceFile(evidenceDirectory),
        "utf8",
      );
      for (const forbidden of [
        CHILD_BRANCH_ID,
        CHILD_ENDPOINT_ID,
        PRODUCTION_ENDPOINT_ID,
        USERNAME,
        PASSWORD,
      ]) {
        assert.equal(raw.includes(forbidden), false, forbidden);
      }
    });
  });

  it("polls a statically verified pending child until it is ready", async () => {
    await withEvidenceDirectory(async (evidenceDirectory) => {
      const calls = callCounts();
      const timeouts = [];
      let clock = 0;
      const options = hostOptions(evidenceDirectory, calls);
      const result =
        await runLegacyAccountOwnerAssignmentRehearsalHost({
          ...options,
          readinessMonotonicNow: () => clock,
          async readinessSleep(milliseconds) {
            clock += milliseconds;
          },
          async attestChild({ branchName, timeoutMs }) {
            calls.attest += 1;
            timeouts.push(timeoutMs);
            return {
              ...verifiedAttestation(branchName),
              endpointState:
                calls.attest === 1 ? "init" : "active",
            };
          },
        });

      assert.equal(result.status, "passed");
      assert.equal(calls.create, 1);
      assert.equal(calls.attest, 2);
      assert.equal(calls.harness, 1);
      assert.equal(calls.delete, 1);
      assert.equal(calls.get, 1);
      assert.deepEqual(timeouts, [8_000, 8_000]);
      const evidence = readEvidence(evidenceDirectory);
      assert.equal(evidence.controlPlane.readinessOutcome, "ready");
      assert.equal(evidence.controlPlane.readinessPollCount, 2);
    });
  });

  it("rejects a ready response that arrives after the hard deadline", async () => {
    await withEvidenceDirectory(async (evidenceDirectory) => {
      const calls = callCounts();
      let clock = 0;
      const options = hostOptions(evidenceDirectory, calls);
      const result =
        await runLegacyAccountOwnerAssignmentRehearsalHost({
          ...options,
          readinessMonotonicNow: () => clock,
          async readinessSleep() {
            throw new Error("sleep must not run");
          },
          async attestChild({ branchName }) {
            calls.attest += 1;
            clock = 30_000;
            return verifiedAttestation(branchName);
          },
        });

      assert.equal(result.status, "failed");
      assert.equal(result.code, "branch_readiness_timeout");
      assert.equal(calls.create, 1);
      assert.equal(calls.attest, 1);
      assert.equal(calls.harness, 0);
      assert.equal(calls.delete, 1);
      assert.equal(calls.get, 1);
      const evidence = readEvidence(evidenceDirectory);
      assert.equal(evidence.phase, "recovery_cleanup_result");
      assert.equal(evidence.readiness.outcome, "timeout");
      assert.equal(evidence.readiness.pollCount, 1);
    });
  });

  it("times out bounded readiness, cleans the verified child, and never runs the harness", async () => {
    await withEvidenceDirectory(async (evidenceDirectory) => {
      const calls = callCounts();
      let clock = 0;
      const options = hostOptions(evidenceDirectory, calls);
      const result =
        await runLegacyAccountOwnerAssignmentRehearsalHost({
          ...options,
          readinessMonotonicNow: () => clock,
          async readinessSleep(milliseconds) {
            clock += milliseconds;
          },
          async attestChild({ branchName }) {
            calls.attest += 1;
            return {
              ...verifiedAttestation(branchName),
              endpointState: "init",
            };
          },
        });

      assert.equal(result.status, "failed");
      assert.equal(result.code, "branch_readiness_timeout");
      assert.equal(calls.create, 1);
      assert.equal(calls.attest, 8);
      assert.equal(calls.harness, 0);
      assert.equal(calls.delete, 1);
      assert.equal(calls.get, 1);
      const evidence = readEvidence(evidenceDirectory);
      assert.equal(evidence.phase, "recovery_cleanup_result");
      assert.equal(evidence.readiness.outcome, "timeout");
      assert.equal(evidence.readiness.pollCount, 8);
    });
  });

  it("keeps a child unresolved when the first readiness read fails before static attestation", async () => {
    await withEvidenceDirectory(async (evidenceDirectory) => {
      const calls = callCounts();
      const options = hostOptions(evidenceDirectory, calls);
      const result =
        await runLegacyAccountOwnerAssignmentRehearsalHost({
          ...options,
          async attestChild() {
            calls.attest += 1;
            throw new Error("synthetic read failure");
          },
        });

      assert.equal(result.status, "failed");
      assert.equal(result.code, "branch_readiness_read_failed");
      assert.equal(calls.attest, 1);
      assert.equal(calls.harness, 0);
      assert.equal(calls.delete, 0);
      assert.equal(calls.get, 0);
      const evidence = readEvidence(evidenceDirectory);
      assert.equal(evidence.readiness.outcome, "read_failed");
      assert.equal(evidence.readiness.pollCount, 1);
    });
  });

  it("persists only allowlisted child-read diagnostics", async () => {
    await withEvidenceDirectory(async (evidenceDirectory) => {
      const calls = callCounts();
      const options = hostOptions(evidenceDirectory, calls);
      const result =
        await runLegacyAccountOwnerAssignmentRehearsalHost({
          ...options,
          async attestChild() {
            calls.attest += 1;
            const error = new Error(
              `private provider output ${PASSWORD}`,
            );
            Object.defineProperties(error, {
              stage: {
                enumerable: true,
                value: "endpoint_list_get",
              },
              reason: {
                enumerable: true,
                value: "execution_failed",
              },
            });
            throw error;
          },
        });

      assert.equal(result.status, "failed");
      assert.equal(result.code, "branch_readiness_read_failed");
      assert.equal(calls.harness, 0);
      assert.equal(calls.delete, 0);
      assert.equal(calls.get, 0);
      const evidence = readEvidence(evidenceDirectory);
      assert.deepEqual(evidence.readiness, {
        outcome: "read_failed",
        pollCount: 1,
        readDiagnostic: {
          stage: "endpoint_list_get",
          reason: "execution_failed",
        },
      });
      assert.equal(JSON.stringify(evidence).includes(PASSWORD), false);
    });
  });

  it("does not invoke diagnostic accessors from a thrown read error", async () => {
    await withEvidenceDirectory(async (evidenceDirectory) => {
      const calls = callCounts();
      let accessorInvocations = 0;
      const options = hostOptions(evidenceDirectory, calls);
      const result =
        await runLegacyAccountOwnerAssignmentRehearsalHost({
          ...options,
          async attestChild() {
            calls.attest += 1;
            const error = new Error("synthetic read failure");
            for (const key of ["stage", "reason"]) {
              Object.defineProperty(error, key, {
                get() {
                  accessorInvocations += 1;
                  return key === "stage"
                    ? "branch_get"
                    : "execution_failed";
                },
              });
            }
            throw error;
          },
        });

      assert.equal(result.status, "failed");
      assert.equal(result.code, "branch_readiness_read_failed");
      assert.equal(accessorInvocations, 0);
      assert.deepEqual(readEvidence(evidenceDirectory).readiness, {
        outcome: "read_failed",
        pollCount: 1,
      });
    });
  });

  it("fails closed when diagnostic descriptor inspection throws", async () => {
    await withEvidenceDirectory(async (evidenceDirectory) => {
      const calls = callCounts();
      let descriptorTraps = 0;
      const options = hostOptions(evidenceDirectory, calls);
      const result =
        await runLegacyAccountOwnerAssignmentRehearsalHost({
          ...options,
          async attestChild() {
            calls.attest += 1;
            throw new Proxy(new Error("synthetic read failure"), {
              getOwnPropertyDescriptor() {
                descriptorTraps += 1;
                throw new Error("descriptor trap");
              },
            });
          },
        });

      assert.equal(result.status, "failed");
      assert.equal(result.code, "branch_readiness_read_failed");
      assert.equal(descriptorTraps, 2);
      assert.deepEqual(readEvidence(evidenceDirectory).readiness, {
        outcome: "read_failed",
        pollCount: 1,
      });
    });
  });

  it("cleans a statically verified child when a later readiness read fails", async () => {
    await withEvidenceDirectory(async (evidenceDirectory) => {
      const calls = callCounts();
      let clock = 0;
      const options = hostOptions(evidenceDirectory, calls);
      const result =
        await runLegacyAccountOwnerAssignmentRehearsalHost({
          ...options,
          readinessMonotonicNow: () => clock,
          async readinessSleep(milliseconds) {
            clock += milliseconds;
          },
          async attestChild({ branchName }) {
            calls.attest += 1;
            if (calls.attest === 2) {
              throw new Error("synthetic later read failure");
            }
            return {
              ...verifiedAttestation(branchName),
              endpointState: "init",
            };
          },
        });

      assert.equal(result.status, "failed");
      assert.equal(result.code, "branch_readiness_read_failed");
      assert.equal(calls.attest, 2);
      assert.equal(calls.harness, 0);
      assert.equal(calls.delete, 1);
      assert.equal(calls.get, 1);
      const evidence = readEvidence(evidenceDirectory);
      assert.equal(evidence.readiness.outcome, "read_failed");
      assert.equal(evidence.readiness.pollCount, 2);
    });
  });

  it("fails closed on an unknown readiness state after static attestation", async () => {
    await withEvidenceDirectory(async (evidenceDirectory) => {
      const calls = callCounts();
      const options = hostOptions(evidenceDirectory, calls);
      const result =
        await runLegacyAccountOwnerAssignmentRehearsalHost({
          ...options,
          async attestChild({ branchName }) {
            calls.attest += 1;
            return {
              ...verifiedAttestation(branchName),
              endpointState: "unknown-provider-state",
            };
          },
        });

      assert.equal(result.status, "failed");
      assert.equal(result.code, "branch_readiness_invalid");
      assert.equal(calls.attest, 1);
      assert.equal(calls.harness, 0);
      assert.equal(calls.delete, 1);
      assert.equal(calls.get, 1);
      const evidence = readEvidence(evidenceDirectory);
      assert.equal(evidence.readiness.outcome, "state_invalid");
      assert.equal(evidence.readiness.pollCount, 1);
    });
  });

  it("uses one exact-ID read as authority after an ambiguous delete", async () => {
    await withEvidenceDirectory(async (evidenceDirectory) => {
      const calls = callCounts();
      const options = hostOptions(evidenceDirectory, calls);
      const result =
        await runLegacyAccountOwnerAssignmentRehearsalHost({
          ...options,
          async deleteChild({ branchId }) {
            calls.delete += 1;
            assert.equal(branchId, CHILD_BRANCH_ID);
            throw new Error("ambiguous delete response");
          },
        });

      assert.equal(result.status, "passed");
      assert.equal(result.cleanup.status, "passed");
      assert.equal(result.cleanup.deleteInvocations, 1);
      assert.equal(result.cleanup.exactIdGetInvocations, 1);
      assert.equal(result.cleanup.exactIdNotFound, true);
      assert.equal(calls.delete, 1);
      assert.equal(calls.get, 1);
    });
  });

  it("reconciles an ambiguous create once, cleans the exact child, and never runs the harness", async () => {
    await withEvidenceDirectory(async (evidenceDirectory) => {
      const calls = callCounts();
      const options = hostOptions(evidenceDirectory, calls);
      const result =
        await runLegacyAccountOwnerAssignmentRehearsalHost({
          ...options,
          async createChild() {
            calls.create += 1;
            throw new Error("ambiguous provider output");
          },
          async reconcileChildByExactName({ branchName }) {
            calls.reconcile += 1;
            return {
              branchId: CHILD_BRANCH_ID,
              branchName,
            };
          },
        });

      assert.equal(result.status, "failed");
      assert.equal(result.code, "branch_create_ambiguous");
      assert.deepEqual(result.invocationCounts, {
        branchCreate: 1,
        exactNameReconciliation: 1,
        branchDelete: 1,
        exactIdNotFoundCheck: 1,
      });
      assert.equal(calls.create, 1);
      assert.equal(calls.reconcile, 1);
      assert.equal(calls.attest, 1);
      assert.equal(calls.harness, 0);
      assert.equal(calls.delete, 1);
      assert.equal(calls.get, 1);
      const evidence = readEvidence(evidenceDirectory);
      assert.equal(evidence.phase, "recovery_cleanup_result");
      assert.equal(evidence.code, "branch_create_ambiguous");
      assert.equal(
        evidence.resolution,
        "exact_child_not_found_confirmed",
      );
      assert.equal(
        evidence.invocationCounts.exactNameReconciliation,
        1,
      );
      assert.deepEqual(evidence.readiness, {
        outcome: "ready",
        pollCount: 1,
      });
    });
  });

  it("does not delete an ambiguously created child that fails full attestation", async () => {
    await withEvidenceDirectory(async (evidenceDirectory) => {
      const calls = callCounts();
      const options = hostOptions(evidenceDirectory, calls);
      const result =
        await runLegacyAccountOwnerAssignmentRehearsalHost({
          ...options,
          async createChild() {
            calls.create += 1;
            throw new Error("ambiguous provider output");
          },
          async reconcileChildByExactName({ branchName }) {
            calls.reconcile += 1;
            return {
              branchId: CHILD_BRANCH_ID,
              branchName,
            };
          },
          async attestChild({ branchName }) {
            calls.attest += 1;
            return {
              ...verifiedAttestation(branchName),
              endpointBranchId: "br-foreign-child",
            };
          },
        });

      assert.equal(result.status, "failed");
      assert.equal(
        result.code,
        "branch_create_reconciliation_unresolved",
      );
      assert.equal(calls.create, 1);
      assert.equal(calls.reconcile, 1);
      assert.equal(calls.attest, 1);
      assert.equal(calls.harness, 0);
      assert.equal(calls.delete, 0);
      assert.equal(calls.get, 0);
      const evidence = readEvidence(evidenceDirectory);
      assert.equal(evidence.phase, "child_created_unattested");
      assert.equal(
        evidence.invocationCounts.exactNameReconciliation,
        1,
      );
    });
  });
});

function hostOptions(evidenceDirectory, calls) {
  return {
    expectedSourceSha: SOURCE_SHA,
    repositoryRoot: process.cwd(),
    evidenceDirectory,
    baseEnv: productionEnvironment(),
    projectId: PROJECT_ID,
    parentBranchId: PARENT_BRANCH_ID,
    productionEndpointId: PRODUCTION_ENDPOINT_ID,
    productionDatabasePolicy: PRODUCTION_POLICY,
    expectedProductionSourceTargetFingerprint:
      PRODUCTION_SOURCE_TARGET_FINGERPRINT,
    previewDatabasePolicy: PREVIEW_POLICY,
    createRunId: () => RUN_ID,
    async readSourceSha() {
      calls.sourceSha += 1;
      return SOURCE_SHA;
    },
    async readTrackedWorktreeClean() {
      calls.sourceClean += 1;
      return true;
    },
    async attestProductionSource() {
      calls.sourceAttest += 1;
      return verifiedProductionAttestation();
    },
    async createChild({ branchName }) {
      calls.create += 1;
      return {
        branchId: CHILD_BRANCH_ID,
        branchName,
      };
    },
    async reconcileChildByExactName() {
      calls.reconcile += 1;
      return null;
    },
    async attestChild({ branchName }) {
      calls.attest += 1;
      return verifiedAttestation(branchName);
    },
    async executeHarness({ env }) {
      calls.harness += 1;
      return passedHarness(env);
    },
    async deleteChild({ branchId }) {
      calls.delete += 1;
      assert.equal(branchId, CHILD_BRANCH_ID);
    },
    async checkChildNotFound({ branchId }) {
      calls.get += 1;
      assert.equal(branchId, CHILD_BRANCH_ID);
      return true;
    },
  };
}

function verifiedAttestation(branchName) {
  return {
    projectId: PROJECT_ID,
    parentBranchId: PARENT_BRANCH_ID,
    branchId: CHILD_BRANCH_ID,
    branchName,
    endpointId: CHILD_ENDPOINT_ID,
    endpointProjectId: PROJECT_ID,
    endpointBranchId: CHILD_BRANCH_ID,
    endpointType: "read_write",
    endpointDisabled: false,
    branchState: "ready",
    endpointState: "active",
    default: false,
    primary: false,
    protected: false,
    autoExpires: true,
  };
}

function verifiedProductionAttestation() {
  return {
    projectId: PROJECT_ID,
    branchId: PARENT_BRANCH_ID,
    branchName: "main",
    endpointId: PRODUCTION_ENDPOINT_ID,
    endpointBranchId: PARENT_BRANCH_ID,
    endpointType: "read_write",
    branchReady: true,
    endpointReady: true,
    default: true,
    primary: true,
    protected: false,
  };
}

function passedHarness(env) {
  assert.ok(env, "The synthetic harness environment is required.");
  const guard = guardLegacyAccountOwnerAssignmentRehearsalTarget(
    env,
    PREVIEW_POLICY,
  );
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
    branchIdFingerprint: guard.branchIdFingerprint,
    branchNameFingerprint: guard.branchNameFingerprint,
    endpointFingerprint: guard.endpointFingerprint,
    sourceTargetFingerprint: guard.sourceTargetFingerprint,
    targetFingerprint: guard.targetFingerprint,
  };
}

function productionEnvironment() {
  return {
    NEON_PROJECT_ID: PROJECT_ID,
    DATABASE_URL: databaseUrl(PRODUCTION_ENDPOINT_ID, true),
    DATABASE_URL_UNPOOLED: databaseUrl(
      PRODUCTION_ENDPOINT_ID,
      false,
    ),
  };
}

function databaseUrl(endpointId, pooled) {
  const host = `${endpointId}${pooled ? "-pooler" : ""}.us-east-1.aws.neon.tech`;
  return `postgresql://${USERNAME}:${PASSWORD}@${host}/${DATABASE}?sslmode=require`;
}

function expectedEvidenceFile(evidenceDirectory) {
  return join(
    evidenceDirectory,
    `legacy-account-owner-assignment-rehearsal-${RUN_ID}.json`,
  );
}

function readEvidence(evidenceDirectory) {
  return JSON.parse(
    readFileSync(expectedEvidenceFile(evidenceDirectory), "utf8"),
  );
}

function callCounts() {
  return {
    sourceSha: 0,
    sourceClean: 0,
    sourceAttest: 0,
    create: 0,
    reconcile: 0,
    attest: 0,
    harness: 0,
    delete: 0,
    get: 0,
  };
}

function fingerprint(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function withEvidenceDirectory(run) {
  const directory = mkdtempSync(
    join(tmpdir(), "varda-owner-host-evidence-"),
  );
  try {
    return await run(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}
