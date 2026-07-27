import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  guardIdentityPairingRehearsalTarget,
} from "../src/lib/deployment/identity-pairing-rehearsal-target.ts";

const PROJECT_ID = "synthetic-project";
const ENDPOINT_ID = "ep-synthetic-rehearsal";
const USERNAME = "synthetic-user";
const PASSWORD = "synthetic-password";
const DATABASE = "synthetic-db";
const PREVIEW_POLICY = {
  policyId: "preview_database_target_operational_guard_v2",
  expectedNeonIntegrationProjectSha256: fingerprint(PROJECT_ID),
  productionEndpointSha256: fingerprint("ep-production"),
};

describe("identity pairing rehearsal target guard", () => {
  it("accepts one named disposable Neon branch without exposing URLs", () => {
    const result = guardIdentityPairingRehearsalTarget(
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
  });

  it("rejects invalid names, mismatched URLs, and Production endpoints", () => {
    const cases = [
      {
        IDENTITY_PAIRING_REHEARSAL_BRANCH_ID: "invalid",
      },
      {
        IDENTITY_PAIRING_REHEARSAL_BRANCH_NAME:
          "preview/codex/unrelated",
      },
      {
        IDENTITY_PAIRING_REHEARSAL_DATABASE_URL_UNPOOLED:
          databaseUrl("ep-other", false),
      },
    ];

    for (const changed of cases) {
      assert.throws(() =>
        guardIdentityPairingRehearsalTarget(
          { ...fixtureEnvironment(), ...changed },
          PREVIEW_POLICY,
        ),
      );
    }

    const productionPolicy = {
      ...PREVIEW_POLICY,
      productionEndpointSha256: fingerprint(ENDPOINT_ID),
    };
    assert.throws(
      () =>
        guardIdentityPairingRehearsalTarget(
          fixtureEnvironment(),
          productionPolicy,
        ),
      /Production Neon endpoint/,
    );
  });

  it("keeps the rehearsal explicit, disposable, and off Production URLs", () => {
    const source = readFileSync(
      "scripts/rehearse-identity-pairing-consume-writer.mjs",
      "utf8",
    );
    assert.match(
      source,
      /--confirm-isolated-identity-pairing-rehearsal/,
    );
    assert.match(
      source,
      /IDENTITY_PAIRING_REHEARSAL_DATABASE_URL_UNPOOLED/,
    );
    assert.match(source, /productionDatabaseWrites: 0/);
    assert.match(source, /branchDeletionRequired: true/);
    assert.match(source, /assertSchemaReadyAndEmpty\(pool\)/);
    assert.match(
      source,
      /begin\("pool_readiness"\)[\s\S]*new Pool\(/,
    );
    assert.match(source, /if \(pool !== null\)[\s\S]*pool\.end\(\)/);
    assert.match(source, /planPreviewMigrations/);
    assert.match(source, /readMigrationFiles/);
    assert.match(source, /allowedPendingMigrations: \[\]/);
    assert.match(source, /lock_wait_expiry/);
    assert.match(source, /audit-identity-pairing-schema\.mjs/);
    assert.match(source, /assertReviewedCatalogPreflight\(\)/);
    assert.match(
      source,
      /clock_timestamp\(\) \+ interval '1\.25 seconds'/,
    );
    assert.match(source, /from identity_pairing_intents[\s\S]*for update/);
    assert.match(source, /select pg_backend_pid\(\)::integer/);
    assert.match(source, /from pg_stat_activity/);
    assert.match(source, /wait_event_type === "Lock"/);
    assert.match(source, /pg_blocking_pids\(pid\)/);
    assert.match(source, /blocked_by_expected_session === true/);
    assert.match(source, /clock_timestamp\(\) as observed_at/);
    assert.match(source, /new Date\(lockWaitObservedAt\)/);
    assert.match(source, /waitUntilAfterDatabaseExpiry/);
    assert.doesNotMatch(
      source,
      /update identity_pairing_intents[\s\S]*set expires_at/,
    );
    assert.doesNotMatch(
      source,
      /process\.env\.(?:DATABASE_URL|DATABASE_URL_UNPOOLED)\b/,
    );

    const catalogAudit = readFileSync(
      "scripts/audit-identity-pairing-schema.mjs",
      "utf8",
    );
    assert.match(catalogAudit, /guardIdentityPairingRehearsalTarget/);
    assert.match(
      catalogAudit,
      /IDENTITY_PAIRING_REHEARSAL_DATABASE_URL_UNPOOLED/,
    );
    assert.match(catalogAudit, /expectedColumns\(\)/);
    assert.match(catalogAudit, /expectedConstraints\(\)/);
    assert.match(catalogAudit, /expectedIndexes\(\)/);
    assert.match(catalogAudit, /expectedTriggers\(\)/);
    assert.match(catalogAudit, /expectedFunctions\(\)/);
    assert.doesNotMatch(
      catalogAudit,
      /process\.env\.(?:DATABASE_URL|DATABASE_URL_UNPOOLED)\b/,
    );
  });
});

function fixtureEnvironment() {
  return {
    IDENTITY_PAIRING_REHEARSAL_BRANCH_ID:
      "br-identity-pairing-rehearsal",
    IDENTITY_PAIRING_REHEARSAL_BRANCH_NAME:
      "preview/codex/identity-pairing-consume-rehearsal-20260727",
    IDENTITY_PAIRING_REHEARSAL_DATABASE_URL: databaseUrl(
      ENDPOINT_ID,
      true,
    ),
    IDENTITY_PAIRING_REHEARSAL_DATABASE_URL_UNPOOLED: databaseUrl(
      ENDPOINT_ID,
      false,
    ),
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
