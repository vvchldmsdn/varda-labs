import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_CONFIRMATION,
  guardLegacyAccountOwnerAssignmentRehearsalTarget,
  prepareLegacyAccountOwnerAssignmentRehearsalEnvironment,
  readLegacyAccountOwnerAssignmentRehearsalOptions,
} from "../src/lib/deployment/legacy-account-owner-assignment-rehearsal-target.ts";
import {
  executeLegacyAccountOwnerAssignmentRehearsal,
  runLegacyAccountOwnerAssignmentRehearsalCli,
} from "../scripts/rehearse-legacy-account-owner-assignment.mjs";
import {
  createLegacyAccountOwnerAssignmentRehearsalEvidence,
  LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_STAGES,
} from "../scripts/lib/legacy-account-owner-assignment-rehearsal-evidence.mjs";
import {
  LegacyAccountOwnerAssignmentError,
} from "../scripts/lib/legacy-account-owner-assignment-writer.mjs";

const PROJECT_ID = "synthetic-project";
const ENDPOINT_ID = "ep-synthetic-owner-rehearsal";
const USERNAME = "synthetic-user";
const PASSWORD = "synthetic-password";
const DATABASE = "synthetic-db";
const BRANCH_ID = "br-synthetic-owner-rehearsal";
const BRANCH_NAME =
  "preview/codex/legacy-account-owner-assignment-rehearsal-synthetic";
const PREVIEW_POLICY = {
  policyId: "preview_database_target_operational_guard_v2",
  expectedNeonIntegrationProjectSha256: fingerprint(PROJECT_ID),
  productionEndpointSha256: fingerprint("ep-production"),
};

describe("legacy account owner-assignment disposable rehearsal", () => {
  it("accepts only one named non-Production Neon target", () => {
    const result =
      guardLegacyAccountOwnerAssignmentRehearsalTarget(
        fixtureEnvironment(),
        PREVIEW_POLICY,
      );

    assert.equal(
      result.status,
      "disposable_rehearsal_target_guard_passed",
    );
    assert.equal(result.controlPlaneVerificationRequired, true);
    assert.equal(result.branchEndpointAttestation, "not_established");
    assert.match(result.branchIdFingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.match(result.branchNameFingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.match(result.endpointFingerprint, /^sha256:[0-9a-f]{64}$/);

    const serialized = JSON.stringify(result);
    for (const forbidden of [
      PROJECT_ID,
      ENDPOINT_ID,
      USERNAME,
      PASSWORD,
      DATABASE,
      "postgres",
      "neon.tech",
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }

    assert.throws(() =>
      guardLegacyAccountOwnerAssignmentRehearsalTarget(
        {
          ...fixtureEnvironment(),
          LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_BRANCH_NAME:
            "preview/codex/identity-pairing-consume-rehearsal",
        },
        PREVIEW_POLICY,
      ),
    );
    assert.throws(() =>
      guardLegacyAccountOwnerAssignmentRehearsalTarget(
        {
          ...fixtureEnvironment(),
          LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_DATABASE_URL_UNPOOLED:
            databaseUrl("ep-unrelated", false),
        },
        PREVIEW_POLICY,
      ),
    );
    assert.throws(
      () =>
        guardLegacyAccountOwnerAssignmentRehearsalTarget(
          fixtureEnvironment(),
          {
            ...PREVIEW_POLICY,
            productionEndpointSha256: fingerprint(ENDPOINT_ID),
          },
        ),
      /Production Neon endpoint/,
    );
  });

  it("parses one exact confirmation and rewrites only the endpoint", () => {
    const options =
      readLegacyAccountOwnerAssignmentRehearsalOptions([
        "--branch-id",
        BRANCH_ID,
        "--branch-name",
        BRANCH_NAME,
        "--endpoint-id",
        ENDPOINT_ID,
        LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_CONFIRMATION,
      ]);
    const env =
      prepareLegacyAccountOwnerAssignmentRehearsalEnvironment({
        baseEnv: {
          DATABASE_URL: databaseUrl("ep-production", true),
          DATABASE_URL_UNPOOLED: databaseUrl(
            "ep-production",
            false,
          ),
          NEON_PROJECT_ID: PROJECT_ID,
          KIS_APP_SECRET: "must-not-reach-rehearsal",
          ADMIN_JOB_SECRET: "must-not-reach-rehearsal",
          LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_DATABASE_URL:
            "stale-target",
        },
        options,
      });

    assert.equal(
      new URL(
        env.LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_DATABASE_URL,
      ).hostname,
      `${ENDPOINT_ID}-pooler.us-east-1.aws.neon.tech`,
    );
    assert.equal(
      new URL(
        env
          .LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_DATABASE_URL_UNPOOLED,
      ).hostname,
      `${ENDPOINT_ID}.us-east-1.aws.neon.tech`,
    );
    assert.equal(
      "DATABASE_URL" in env || "DATABASE_URL_UNPOOLED" in env,
      false,
    );
    assert.equal("KIS_APP_SECRET" in env, false);
    assert.equal("ADMIN_JOB_SECRET" in env, false);
    assert.throws(() =>
      readLegacyAccountOwnerAssignmentRehearsalOptions([
        "--branch-id",
        BRANCH_ID,
        "--branch-name",
        BRANCH_NAME,
        "--endpoint-id",
        ENDPOINT_ID,
      ]),
    );
    assert.throws(() =>
      readLegacyAccountOwnerAssignmentRehearsalOptions([
        "--branch-id",
        BRANCH_ID,
        "--branch-name",
        BRANCH_NAME,
        "--endpoint-id",
        ENDPOINT_ID,
        LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_CONFIRMATION,
        LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_CONFIRMATION,
      ]),
    );
  });

  it("sanitizes failures and preserves only reviewed error codes", () => {
    const evidence = progressToSuccessfulAssignment();
    const secretError = new Error(
      "postgresql://secret-user:secret@secret-host",
    );
    secretError.cause = {
      sql: "select secret",
      providerSubject: "secret-subject",
    };
    const failure = evidence.failure(secretError);

    assert.equal(failure.status, "failed");
    assert.equal(failure.code, "successful_assignment_failed");
    assert.equal(failure.retryCount, 0);
    assert.equal(failure.dbMigrateInvocations, 0);
    assert.equal(failure.productionDatabaseWrites, 0);
    assert.equal(failure.branchDeletionRequired, true);
    const serialized = JSON.stringify(failure);
    for (const forbidden of [
      "secret-user",
      "secret-host",
      "select secret",
      "secret-subject",
      "postgresql://",
      "stack",
      "cause",
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }

    assert.equal(
      progressToSuccessfulAssignment().failure(
        new LegacyAccountOwnerAssignmentError(
          "account_evidence_digest_drift",
        ),
      ).code,
      "assignment_account_evidence_digest_drift",
    );
    assert.equal(
      progressToSuccessfulAssignment().failure(
        Object.assign(new Error("secret"), { code: "08006" }),
      ).code,
      "sqlstate_08006",
    );

    let codeReads = 0;
    const accessorError = new Error("secret");
    Object.defineProperty(accessorError, "code", {
      get() {
        codeReads += 1;
        return "08006";
      },
    });
    assert.equal(
      progressToSuccessfulAssignment().failure(accessorError).code,
      "successful_assignment_failed",
    );
    assert.equal(codeReads, 0);
  });

  it("keeps connection failure before the disposable DML boundary", async () => {
    const result =
      await executeLegacyAccountOwnerAssignmentRehearsal({
        env: fixtureEnvironment(),
        previewDatabasePolicy: PREVIEW_POLICY,
        poolFactory() {
          throw Object.assign(new Error("secret connection"), {
            code: "08006",
          });
        },
      });

    assert.equal(result.status, "failed");
    assert.equal(result.stage, "pool_readiness");
    assert.equal(result.code, "sqlstate_08006");
    assert.equal(result.poolReadiness, false);
    assert.equal(result.disposableBranchDmlAttempted, false);
    assert.equal(result.productionDatabaseWrites, 0);
    assert.equal(result.branchDeletionRequired, true);
  });

  it("rejects bad CLI input before loading env or creating a Pool", async () => {
    let environmentLoads = 0;
    let poolCreates = 0;
    const result = await runLegacyAccountOwnerAssignmentRehearsalCli({
      args: [],
      baseEnv: {},
      loadEnvironment() {
        environmentLoads += 1;
      },
      poolFactory() {
        poolCreates += 1;
        throw new Error("must not run");
      },
      writeError() {},
    });

    assert.equal(result.status, "failed");
    assert.equal(result.code, "rehearsal_options_invalid");
    assert.equal(environmentLoads, 0);
    assert.equal(poolCreates, 0);
  });

  it("fixes stage order, DML boundary, and cleanup evidence", () => {
    const evidence =
      createLegacyAccountOwnerAssignmentRehearsalEvidence();
    for (const stage of LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_STAGES) {
      evidence.begin(stage);
      if (stage === "pool_readiness") evidence.markPoolReady();
      if (stage === "successful_assignment") {
        evidence.markDisposableBranchDmlAttempted();
      }
      if (stage === "fixture_cleanup") {
        evidence.markAccountBaselineRestored();
        evidence.markTemporaryDatabaseObjectsRemoved();
      }
      evidence.complete(stage);
    }

    assert.deepEqual(evidence.success(), {
      stage: "completed",
      lastCompletedCheck: "fixture_cleanup",
      poolReadiness: true,
      disposableBranchDmlAttempted: true,
      accountBaselineRestored: true,
      temporaryDatabaseObjectsRemoved: true,
    });
    assert.throws(() =>
      createLegacyAccountOwnerAssignmentRehearsalEvidence().begin(
        "catalog_preflight",
      ),
    );
  });

  it("pins the entrypoint to eight cases and no migration or route", () => {
    const source = readFileSync(
      "scripts/rehearse-legacy-account-owner-assignment.mjs",
      "utf8",
    );
    const targetSource = readFileSync(
      "src/lib/deployment/legacy-account-owner-assignment-rehearsal-target.ts",
      "utf8",
    );
    const casesSource = readFileSync(
      "scripts/lib/legacy-account-owner-assignment-rehearsal-cases.mjs",
      "utf8",
    );
    const fixtureSource = readFileSync(
      "scripts/lib/legacy-account-owner-assignment-rehearsal-fixture.mjs",
      "utf8",
    );
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

    assert.equal(
      packageJson.scripts["rehearse:legacy-account-owner-assignment"],
      "node --no-warnings scripts/rehearse-legacy-account-owner-assignment.mjs",
    );
    assert.match(
      targetSource,
      /--confirm-isolated-legacy-account-owner-assignment-rehearsal/,
    );
    assert.match(
      source,
      /LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_DATABASE_URL_UNPOOLED/,
    );
    assert.match(
      source,
      /guardLegacyAccountOwnerAssignmentRehearsalTarget/,
    );
    assert.match(source, /productionDatabaseWrites: 0/);
    assert.match(source, /branchDeletionRequired: true/);
    assert.match(source, /retryCount: 0/);
    assert.match(source, /dbMigrateInvocations: 0/);
    assert.match(source, /restoreOwnerAssignmentAccountBaseline/);
    assert.match(source, /assertOwnerAssignmentTemporaryObjectsAbsent/);
    assert.match(
      fixtureSource,
      /OWNER_ASSIGNMENT_REHEARSAL_ACCOUNT_COUNT = 4/,
    );
    for (const check of [
      "successful_assignment",
      "already_applied",
      "missing_consumed_evidence",
      "digest_drift",
      "foreign_owner",
      "same_target_race",
      "partial_update_rollback",
      "lock_timeout_rollback",
    ]) {
      assert.match(casesSource, new RegExp(`stage: "${check}"`));
    }
    assert.doesNotMatch(
      `${source}\n${casesSource}\n${fixtureSource}`,
      /db:migrate|guardProductionDatabaseTarget|consumeIdentityPairingClaim/,
    );
    assert.doesNotMatch(
      `${source}\n${casesSource}\n${fixtureSource}`,
      /src[\\/]app[\\/]|route\.ts|provider_subject\s+as/,
    );
  });
});

function progressToSuccessfulAssignment() {
  const evidence =
    createLegacyAccountOwnerAssignmentRehearsalEvidence();
  for (const stage of [
    "target_guard",
    "pool_readiness",
    "catalog_preflight",
  ]) {
    evidence.begin(stage);
    if (stage === "pool_readiness") evidence.markPoolReady();
    evidence.complete(stage);
  }
  evidence.begin("successful_assignment");
  return evidence;
}

function fixtureEnvironment() {
  return {
    LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_BRANCH_ID: BRANCH_ID,
    LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_BRANCH_NAME:
      BRANCH_NAME,
    LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_DATABASE_URL:
      databaseUrl(ENDPOINT_ID, true),
    LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_DATABASE_URL_UNPOOLED:
      databaseUrl(ENDPOINT_ID, false),
    NEON_PROJECT_ID: PROJECT_ID,
  };
}

function databaseUrl(endpointId, pooled) {
  const host = `${endpointId}${pooled ? "-pooler" : ""}.us-east-1.aws.neon.tech`;
  return `postgresql://${USERNAME}:${PASSWORD}@${host}/${DATABASE}?sslmode=require`;
}

function fingerprint(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
