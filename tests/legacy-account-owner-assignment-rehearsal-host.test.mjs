import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
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
        create: 0,
        reconcile: 0,
        attest: 0,
        harness: 0,
        delete: 0,
        get: 0,
      });
    });
  });

  it("fails closed when the evidence path appears after child creation", async () => {
    await withEvidenceDirectory(async (evidenceDirectory) => {
      const calls = callCounts();
      const options = hostOptions(evidenceDirectory, calls);
      const evidenceFile = expectedEvidenceFile(evidenceDirectory);
      const result =
        await runLegacyAccountOwnerAssignmentRehearsalHost({
          ...options,
          async createChild({ branchName }) {
            calls.create += 1;
            writeFileSync(evidenceFile, "raced-run\n", "utf8");
            return {
              branchId: CHILD_BRANCH_ID,
              branchName,
            };
          },
        });

      assert.equal(result.status, "failed");
      assert.equal(result.code, "prepared_evidence_write_failed");
      assert.equal(result.evidencePersisted, false);
      assert.deepEqual(result.invocationCounts, {
        branchCreate: 1,
        harness: 0,
        branchDelete: 1,
        exactIdNotFoundCheck: 1,
      });
      assert.equal(result.cleanup.status, "passed");
      assert.equal(readFileSync(evidenceFile, "utf8"), "raced-run\n");
      assert.equal(calls.harness, 0);
      assert.equal(calls.delete, 1);
      assert.equal(calls.get, 1);
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
      assert.equal(calls.create, 0);
      assert.equal(calls.harness, 0);
      assert.equal(calls.delete, 0);
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
      assert.equal(calls.attest, 0);
      assert.equal(calls.harness, 0);
      assert.equal(calls.delete, 1);
      assert.equal(calls.get, 1);
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
    productionEndpointId: PRODUCTION_ENDPOINT_ID,
    endpointType: "read_write",
    branchReady: true,
    endpointReady: true,
    default: false,
    primary: false,
    protected: false,
    autoExpires: true,
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
