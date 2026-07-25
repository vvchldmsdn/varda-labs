import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  guardIdentityPairingRehearsalTarget,
  IDENTITY_PAIRING_REHEARSAL_TARGET_POLICY,
  sha256Fingerprint,
} from "../src/lib/deployment/identity-pairing-rehearsal-target.ts";

const PROJECT_ID = "synthetic-neon-project";
const PRODUCTION_ENDPOINT = "ep-production-synthetic";
const REHEARSAL_ENDPOINT = "ep-rehearsal-synthetic";
const POLICY = {
  policyId: "identity_pairing_non_production_rehearsal_endpoint_v2",
  expectedNeonIntegrationProjectSha256: sha256Fingerprint(PROJECT_ID),
  productionEndpointSha256: sha256Fingerprint(PRODUCTION_ENDPOINT),
};

describe("identity pairing isolated branch rehearsal", () => {
  it("accepts one non-Production pooled and unpooled Neon target", () => {
    const result = guardIdentityPairingRehearsalTarget(
      environment(REHEARSAL_ENDPOINT),
      POLICY,
    );

    assert.equal(
      result.status,
      "non_production_rehearsal_endpoint_guard_passed",
    );
    assert.equal(result.branchEndpointAttestation, "not_established");
    assert.equal(result.controlPlaneVerificationRequired, true);
    assert.equal(
      result.endpointFingerprint,
      sha256Fingerprint(REHEARSAL_ENDPOINT),
    );
    assert.match(result.branchFingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.match(result.targetFingerprint, /^sha256:[0-9a-f]{64}$/);
  });

  it("blocks the Production endpoint and pooled target drift", () => {
    assert.throws(
      () =>
        guardIdentityPairingRehearsalTarget(
          environment(PRODUCTION_ENDPOINT),
          POLICY,
        ),
      /Production Neon endpoint/,
    );
    assert.throws(
      () =>
        guardIdentityPairingRehearsalTarget(
          {
            ...environment(REHEARSAL_ENDPOINT),
            IDENTITY_PAIRING_REHEARSAL_DATABASE_URL_UNPOOLED:
              databaseUrl("ep-another-rehearsal", false),
          },
          POLICY,
        ),
      /do not identify one database target/,
    );
  });

  it("requires a branch id and the pinned Neon project", () => {
    assert.throws(
      () =>
        guardIdentityPairingRehearsalTarget(
          {
            ...environment(REHEARSAL_ENDPOINT),
            IDENTITY_PAIRING_REHEARSAL_BRANCH_ID: "main",
          },
          POLICY,
        ),
      /Neon branch id/,
    );
    assert.throws(
      () =>
        guardIdentityPairingRehearsalTarget(
          {
            ...environment(REHEARSAL_ENDPOINT),
            NEON_PROJECT_ID: "another-project",
          },
          POLICY,
        ),
      /does not match the pinned integration/,
    );
  });

  it("keeps committed policy and output fingerprint-only", () => {
    assert.doesNotMatch(
      JSON.stringify(IDENTITY_PAIRING_REHEARSAL_TARGET_POLICY),
      /postgres(?:ql)?:\/\/|\.neon\.tech/i,
    );
    const output = guardIdentityPairingRehearsalTarget(
      environment(REHEARSAL_ENDPOINT),
      POLICY,
    );
    assert.doesNotMatch(JSON.stringify(output), /synthetic-neon-project/);
    assert.doesNotMatch(JSON.stringify(output), /ep-rehearsal-synthetic/);
  });

  it("pins synthetic rollback and two-connection behavior coverage", () => {
    const source = readFileSync(
      "scripts/rehearse-identity-pairing-schema.mjs",
      "utf8",
    );
    assert.match(source, /--confirm-isolated-branch-rehearsal/);
    assert.match(
      source,
      /IDENTITY_PAIRING_REHEARSAL_DATABASE_URL_UNPOOLED/,
    );
    assert.match(source, /new Pool\(/);
    assert.match(source, /lock_wait_expiry_uses_database_clock/);
    assert.match(source, /two_connection_consume_rebind_race/);
    assert.match(source, /not_yet_valid_and_expired/);
    assert.match(source, /append_only_update_delete_truncate/);
    assert.match(source, /target_and_provider_mismatch/);
    assert.match(source, /constraint_deferral_is_rejected/);
    assert.match(source, /productionDatabaseWrites: 0/);
    assert.doesNotMatch(
      source,
      /connectionString:\s*process\.env\.DATABASE_URL\b/,
    );
  });
});

function environment(rehearsalEndpoint) {
  return {
    DATABASE_URL: databaseUrl(PRODUCTION_ENDPOINT, true),
    DATABASE_URL_UNPOOLED: databaseUrl(PRODUCTION_ENDPOINT, false),
    IDENTITY_PAIRING_REHEARSAL_BRANCH_ID: "br-synthetic-rehearsal",
    IDENTITY_PAIRING_REHEARSAL_DATABASE_URL: databaseUrl(
      rehearsalEndpoint,
      true,
    ),
    IDENTITY_PAIRING_REHEARSAL_DATABASE_URL_UNPOOLED: databaseUrl(
      rehearsalEndpoint,
      false,
    ),
    NEON_PROJECT_ID: PROJECT_ID,
  };
}

function databaseUrl(endpoint, pooled) {
  return `postgresql://synthetic_user:synthetic_password@${endpoint}${pooled ? "-pooler" : ""}.us-east-1.aws.neon.tech/neondb?sslmode=require`;
}
