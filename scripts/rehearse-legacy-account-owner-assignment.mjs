import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";

import {
  guardLegacyAccountOwnerAssignmentRehearsalTarget,
  prepareLegacyAccountOwnerAssignmentRehearsalEnvironment,
  readLegacyAccountOwnerAssignmentRehearsalOptions,
} from "../src/lib/deployment/legacy-account-owner-assignment-rehearsal-target.ts";
import {
  LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_CASES,
} from "./lib/legacy-account-owner-assignment-rehearsal-cases.mjs";
import {
  createLegacyAccountOwnerAssignmentRehearsalEvidence,
} from "./lib/legacy-account-owner-assignment-rehearsal-evidence.mjs";
import {
  assertOwnerAssignmentAccountBaseline,
  assertOwnerAssignmentRehearsalCatalogPreflight,
  assertOwnerAssignmentRehearsalPoolReady,
  assertOwnerAssignmentTemporaryObjectsAbsent,
  dropOwnerAssignmentPartialUpdateObjects,
  ownerAssignmentFixtureError,
  restoreOwnerAssignmentAccountBaseline,
} from "./lib/legacy-account-owner-assignment-rehearsal-fixture.mjs";

const REHEARSAL =
  "legacy_account_owner_assignment_disposable_branch_v1";

export const LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_ROOT = resolve(
  fileURLToPath(new URL("../", import.meta.url)),
);

export async function runLegacyAccountOwnerAssignmentRehearsalCli({
  args = process.argv.slice(2),
  baseEnv = process.env,
  loadEnvironment = () =>
    config({
      path: join(
        LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_ROOT,
        ".env.local",
      ),
      quiet: true,
    }),
  poolFactory = (connectionString) =>
    new Pool({ connectionString, max: 8 }),
  productionDatabasePolicy,
  expectedProductionSourceTargetFingerprint,
  previewDatabasePolicy,
  write = (value) => console.log(JSON.stringify(value)),
  writeError = (value) => console.error(JSON.stringify(value)),
} = {}) {
  let options;
  try {
    options =
      readLegacyAccountOwnerAssignmentRehearsalOptions(args);
    loadEnvironment();
  } catch {
    const failure = cliFailure("rehearsal_options_invalid");
    writeError(failure);
    return failure;
  }

  let env;
  try {
    env =
      prepareLegacyAccountOwnerAssignmentRehearsalEnvironment({
        baseEnv,
        options,
        productionDatabasePolicy,
        expectedProductionSourceTargetFingerprint,
      });
  } catch {
    const failure = cliFailure("rehearsal_configuration_invalid");
    writeError(failure);
    return failure;
  }

  const result = await executeLegacyAccountOwnerAssignmentRehearsal({
    env,
    poolFactory,
    previewDatabasePolicy,
  });
  if (result.status === "passed") write(result);
  else writeError(result);
  return result;
}

export async function executeLegacyAccountOwnerAssignmentRehearsal({
  env,
  poolFactory = (connectionString) =>
    new Pool({ connectionString, max: 8 }),
  previewDatabasePolicy,
}) {
  const evidence =
    createLegacyAccountOwnerAssignmentRehearsalEvidence();
  try {
    return await runRehearsal({
      env,
      poolFactory,
      previewDatabasePolicy,
      evidence,
    });
  } catch (error) {
    return evidence.failure(error);
  }
}

async function runRehearsal({
  env,
  poolFactory,
  previewDatabasePolicy,
  evidence,
}) {
  evidence.begin("target_guard");
  const target =
    guardLegacyAccountOwnerAssignmentRehearsalTarget(
      env,
      previewDatabasePolicy,
    );
  evidence.complete("target_guard");
  const connectionString =
    env
      .LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_DATABASE_URL_UNPOOLED;
  assert.ok(connectionString, "The guarded rehearsal URL is unavailable.");

  let pool = null;
  let baselineAccounts = null;
  let operationError = null;
  const checks = [];

  try {
    evidence.begin("pool_readiness");
    pool = poolFactory(connectionString);
    await assertOwnerAssignmentRehearsalPoolReady(pool);
    evidence.markPoolReady();
    evidence.complete("pool_readiness");

    evidence.begin("catalog_preflight");
    baselineAccounts =
      await assertOwnerAssignmentRehearsalCatalogPreflight(pool);
    evidence.complete("catalog_preflight");

    for (const rehearsalCase of
      LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_CASES) {
      evidence.begin(rehearsalCase.stage);
      if (rehearsalCase.stage === "successful_assignment") {
        evidence.markDisposableBranchDmlAttempted();
      }
      await rehearsalCase.run(pool, baselineAccounts);
      checks.push(rehearsalCase.stage);
      evidence.complete(rehearsalCase.stage);
    }

    evidence.begin("fixture_cleanup");
    await restoreOwnerAssignmentAccountBaseline(
      pool,
      baselineAccounts,
    );
    evidence.markAccountBaselineRestored();
    await dropOwnerAssignmentPartialUpdateObjects(pool);
    await assertOwnerAssignmentTemporaryObjectsAbsent(pool);
    evidence.markTemporaryDatabaseObjectsRemoved();
    await assertOwnerAssignmentAccountBaseline(
      pool,
      baselineAccounts,
    );
    evidence.complete("fixture_cleanup");
  } catch (error) {
    operationError = error;
  } finally {
    if (pool !== null) {
      if (baselineAccounts !== null) {
        try {
          await restoreOwnerAssignmentAccountBaseline(
            pool,
            baselineAccounts,
          );
          evidence.markAccountBaselineRestored();
        } catch {
          if (operationError === null) {
            operationError = ownerAssignmentFixtureError(
              "account_baseline_restore_failed",
            );
          }
        }
      }
      try {
        await dropOwnerAssignmentPartialUpdateObjects(pool);
        evidence.markTemporaryDatabaseObjectsRemoved();
      } catch {
        if (operationError === null) {
          operationError = ownerAssignmentFixtureError(
            "temporary_object_cleanup_failed",
          );
        }
      }
      try {
        await pool.end();
      } catch {
        if (operationError === null) {
          operationError = ownerAssignmentFixtureError(
            "temporary_object_cleanup_failed",
          );
        }
      }
    }
  }

  if (operationError !== null) throw operationError;
  return Object.freeze({
    rehearsal: REHEARSAL,
    status: "passed",
    checks: Object.freeze(checks),
    ...evidence.success(),
    retryCount: 0,
    dbMigrateInvocations: 0,
    productionDatabaseWrites: 0,
    syntheticRowsMayRemainUntilBranchDeletion: true,
    cleanupAuthority: "exact_branch_deletion",
    controlPlaneVerificationRequired:
      target.controlPlaneVerificationRequired,
    branchIdFingerprint: target.branchIdFingerprint,
    branchNameFingerprint: target.branchNameFingerprint,
    sourceTargetFingerprint: target.sourceTargetFingerprint,
    endpointFingerprint: target.endpointFingerprint,
    targetFingerprint: target.targetFingerprint,
    branchDeletionRequired: true,
  });
}

function cliFailure(code) {
  return Object.freeze({
    rehearsal: REHEARSAL,
    status: "failed",
    stage: "host_configuration",
    lastCompletedCheck: "none",
    poolReadiness: false,
    disposableBranchDmlAttempted: false,
    accountBaselineRestored: false,
    temporaryDatabaseObjectsRemoved: false,
    code,
    retryCount: 0,
    dbMigrateInvocations: 0,
    productionDatabaseWrites: 0,
    syntheticRowsMayRemainUntilBranchDeletion: false,
    cleanupAuthority: "exact_branch_deletion",
    branchDeletionRequired: true,
  });
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entryUrl === import.meta.url) {
  const result = await runLegacyAccountOwnerAssignmentRehearsalCli();
  if (result.status === "failed") process.exitCode = 1;
}
