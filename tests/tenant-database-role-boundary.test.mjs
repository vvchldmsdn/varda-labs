import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  assessTenantDatabaseRoleSecurity,
  guardTenantDatabaseRoleBoundary,
} from "../src/lib/deployment/tenant-database-role-boundary.ts";

describe("Tenant database role boundary", () => {
  it("accepts a distinct role and secret on the same Neon database", () => {
    const boundary = guardTenantDatabaseRoleBoundary(environment());

    assert.equal(boundary.status, "credential_boundary_passed");
    assert.equal(boundary.credentialSeparation, "distinct_role_and_secret");
    assert.match(boundary.endpointFingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.match(boundary.databaseFingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.notEqual(
      boundary.privilegedRoleFingerprint,
      boundary.tenantRoleFingerprint,
    );
    const serialized = JSON.stringify(boundary);
    assert.doesNotMatch(serialized, /privileged_user|tenant_user/);
    assert.doesNotMatch(serialized, /privileged_secret|tenant_secret/);
    assert.doesNotMatch(serialized, /postgres(?:ql)?:\/\//i);
  });

  it("requires TENANT_DATABASE_URL and rejects target drift", () => {
    assert.throws(
      () =>
        guardTenantDatabaseRoleBoundary({
          ...environment(),
          TENANT_DATABASE_URL: undefined,
        }),
      /TENANT_DATABASE_URL is required/,
    );
    assert.throws(
      () =>
        guardTenantDatabaseRoleBoundary({
          ...environment(),
          TENANT_DATABASE_URL: databaseUrl("ep-other", "tenant_user", "tenant_secret"),
        }),
      /same Neon database target/,
    );
    assert.throws(
      () =>
        guardTenantDatabaseRoleBoundary({
          ...environment(),
          TENANT_DATABASE_URL: databaseUrl(
            "ep-production",
            "tenant_user",
            "tenant_secret",
            "other_database",
          ),
        }),
      /same Neon database target/,
    );
  });

  it("rejects a reused database role or credential secret", () => {
    assert.throws(
      () =>
        guardTenantDatabaseRoleBoundary({
          ...environment(),
          TENANT_DATABASE_URL: databaseUrl(
            "ep-production",
            "privileged_user",
            "tenant_secret",
          ),
        }),
      /database role distinct/,
    );
    assert.throws(
      () =>
        guardTenantDatabaseRoleBoundary({
          ...environment(),
          TENANT_DATABASE_URL: databaseUrl(
            "ep-production",
            "tenant_user",
            "privileged_secret",
          ),
        }),
      /credential secret distinct/,
    );
  });

  it("passes only a least-privilege tenant role", () => {
    const boundary = guardTenantDatabaseRoleBoundary(environment());
    const assessment = assessTenantDatabaseRoleSecurity(
      boundary,
      safeEvidence(),
    );

    assert.equal(assessment.status, "role_boundary_passed");
    assert.deepEqual(assessment.blockers, []);
    assert.equal(assessment.rlsPolicyStatus, "separate_gate_not_evaluated");
  });

  it("blocks owner, BYPASSRLS, membership, schema-create, and identity drift", () => {
    const boundary = guardTenantDatabaseRoleBoundary(environment());
    const assessment = assessTenantDatabaseRoleSecurity(boundary, {
      ...safeEvidence(),
      currentRole: "switched_role",
      roleIsSuperuser: true,
      roleBypassesRls: true,
      roleCanCreateDatabase: true,
      roleCanCreateRole: true,
      roleCanReplicate: true,
      roleOwnsPublicTableCount: 3,
      privilegedMembershipCount: 1,
      canCreateInPublicSchema: true,
    });

    assert.equal(assessment.status, "blocked");
    assert.deepEqual(assessment.blockers, [
      "current_role_does_not_match_tenant_credential",
      "session_role_and_current_role_differ",
      "role_is_superuser",
      "role_bypasses_rls",
      "role_can_create_database",
      "role_can_create_role",
      "role_can_replicate",
      "role_owns_public_tables",
      "role_inherits_privileged_membership",
      "role_can_create_in_public_schema",
    ]);
  });

  it("keeps tenant runtime access fail-closed with no DATABASE_URL fallback", () => {
    const source = readFileSync("src/db/tenant-client.ts", "utf8");
    const audit = readFileSync(
      "scripts/audit-tenant-database-role-boundary.mjs",
      "utf8",
    );

    assert.match(source, /guardTenantDatabaseRoleBoundary\(\s*process\.env/);
    assert.match(source, /process\.env\.TENANT_DATABASE_URL/);
    assert.doesNotMatch(
      source,
      /TENANT_DATABASE_URL\s*\?\?\s*process\.env\.DATABASE_URL/,
    );
    assert.match(audit, /readOnly: true/);
    assert.match(audit, /databaseSideEffects: false/);
    assert.doesNotMatch(audit, /console\.log\(process\.env/);
    assert.ok(
      audit.indexOf("guardProductionDatabaseTarget(process.env)") <
        audit.indexOf("readCurrentDatabaseRoleEvidence(neon(privilegedUrl))"),
    );
    assert.doesNotMatch(audit, /\b(?:insert|update|delete|alter|drop)\s+(?:into|table|from)\b/i);
  });
});

function environment() {
  return {
    DATABASE_URL: databaseUrl(
      "ep-production",
      "privileged_user",
      "privileged_secret",
    ),
    TENANT_DATABASE_URL: databaseUrl(
      "ep-production",
      "tenant_user",
      "tenant_secret",
    ),
  };
}

function safeEvidence() {
  return {
    sessionRole: "tenant_user",
    currentRole: "tenant_user",
    roleCanLogin: true,
    roleIsSuperuser: false,
    roleBypassesRls: false,
    roleCanCreateDatabase: false,
    roleCanCreateRole: false,
    roleCanReplicate: false,
    roleOwnsPublicTableCount: 0,
    privilegedMembershipCount: 0,
    canCreateInPublicSchema: false,
    publicTableCount: 40,
    rlsEnabledPublicTableCount: 0,
    rlsForcedPublicTableCount: 0,
  };
}

function databaseUrl(
  endpoint,
  username,
  password,
  databaseName = "neondb",
) {
  return `postgresql://${username}:${password}@${endpoint}-pooler.us-east-1.aws.neon.tech/${databaseName}?sslmode=require`;
}
