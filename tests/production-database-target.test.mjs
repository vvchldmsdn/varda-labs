import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  guardProductionDatabaseTarget,
  PRODUCTION_DATABASE_TARGET_GUARD_POLICY,
} from "../src/lib/deployment/production-database-target.ts";
import { sha256Fingerprint } from "../src/lib/deployment/preview-database-target.ts";

const PROJECT_ID = "synthetic-neon-project";
const PRODUCTION_ENDPOINT = "ep-production-synthetic";
const OTHER_ENDPOINT = "ep-other-synthetic";
const POLICY = {
  policyId: "production_database_target_operational_guard_v1",
  expectedNeonIntegrationProjectSha256: sha256Fingerprint(PROJECT_ID),
  productionEndpointSha256: sha256Fingerprint(PRODUCTION_ENDPOINT),
};

describe("Production database target operational guard", () => {
  it("accepts one exact pinned pooled and unpooled target", () => {
    const result = guardProductionDatabaseTarget(
      environment(PRODUCTION_ENDPOINT),
      POLICY,
    );

    assert.equal(result.status, "production_target_guard_passed");
    assert.equal(
      result.integrationProjectFingerprint,
      sha256Fingerprint(PROJECT_ID),
    );
    assert.equal(
      result.endpointFingerprint,
      sha256Fingerprint(PRODUCTION_ENDPOINT),
    );
    assert.match(result.targetFingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.equal(
      result.endpointProjectBinding,
      "pinned_vercel_neon_integration_control",
    );
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /production_user/);
    assert.doesNotMatch(serialized, /production_password/);
    assert.doesNotMatch(serialized, /neondb/);
  });

  it("requires both pooled and unpooled database URLs", () => {
    const environmentWithBothUrls = environment(PRODUCTION_ENDPOINT);

    assert.throws(
      () =>
        guardProductionDatabaseTarget(
          {
            ...environmentWithBothUrls,
            DATABASE_URL: undefined,
          },
          POLICY,
        ),
      /DATABASE_URL is required/,
    );
    assert.throws(
      () =>
        guardProductionDatabaseTarget(
          {
            ...environmentWithBothUrls,
            DATABASE_URL_UNPOOLED: undefined,
          },
          POLICY,
        ),
      /DATABASE_URL_UNPOOLED is required/,
    );
  });

  it("blocks a non-Production endpoint and project drift", () => {
    assert.throws(
      () =>
        guardProductionDatabaseTarget(environment(OTHER_ENDPOINT), POLICY),
      /pinned Production endpoint/,
    );
    assert.throws(
      () =>
        guardProductionDatabaseTarget(
          {
            ...environment(PRODUCTION_ENDPOINT),
            NEON_PROJECT_ID: "unexpected-project",
          },
          POLICY,
        ),
      /does not match the pinned integration/,
    );
  });

  it("blocks pooled and unpooled identity drift", () => {
    for (const DATABASE_URL_UNPOOLED of [
      databaseUrl(OTHER_ENDPOINT, false),
      databaseUrl(PRODUCTION_ENDPOINT, false, {
        username: "other_user",
      }),
      databaseUrl(PRODUCTION_ENDPOINT, false, {
        password: "other_password",
      }),
      databaseUrl(PRODUCTION_ENDPOINT, false, {
        databaseName: "other_database",
      }),
    ]) {
      assert.throws(
        () =>
          guardProductionDatabaseTarget(
            {
              ...environment(PRODUCTION_ENDPOINT),
              DATABASE_URL_UNPOOLED,
            },
            POLICY,
          ),
        /do not identify one database target/,
      );
    }
  });

  it("keeps the committed Production policy fingerprint-only", () => {
    const serialized = JSON.stringify(
      PRODUCTION_DATABASE_TARGET_GUARD_POLICY,
    );

    assert.doesNotMatch(serialized, /postgres(?:ql)?:\/\//i);
    assert.doesNotMatch(serialized, /\.neon\.tech/i);
    assert.match(
      PRODUCTION_DATABASE_TARGET_GUARD_POLICY
        .expectedNeonIntegrationProjectSha256,
      /^sha256:[0-9a-f]{64}$/,
    );
    assert.match(
      PRODUCTION_DATABASE_TARGET_GUARD_POLICY.productionEndpointSha256,
      /^sha256:[0-9a-f]{64}$/,
    );
  });

  it("guards before opening the preflight database client", () => {
    const source = readFileSync(
      "scripts/preflight-legacy-account-ownership.mjs",
      "utf8",
    );
    const guardIndex = source.indexOf("guardProductionDatabaseTarget(");
    const clientIndex = source.indexOf("neon(databaseUrl)");

    assert.ok(guardIndex >= 0);
    assert.ok(clientIndex > guardIndex);
    assert.match(source, /production_database_target_guard_failed/);
    assert.match(source, /targetFingerprint/);
  });
});

function environment(endpoint) {
  return {
    NEON_PROJECT_ID: PROJECT_ID,
    DATABASE_URL: databaseUrl(endpoint, true),
    DATABASE_URL_UNPOOLED: databaseUrl(endpoint, false),
  };
}

function databaseUrl(endpoint, pooled, overrides = {}) {
  const username = overrides.username ?? "production_user";
  const password = overrides.password ?? "production_password";
  const databaseName = overrides.databaseName ?? "neondb";
  return `postgresql://${username}:${password}@${endpoint}${pooled ? "-pooler" : ""}.us-east-1.aws.neon.tech/${databaseName}?sslmode=require`;
}
