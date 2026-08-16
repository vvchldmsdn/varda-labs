import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  TENANT_DATABASE_ROLE_NAME,
  TENANT_DATABASE_ROLE_WRITE_CONFIRMATION,
  TenantRoleProvisioningError,
  buildTenantDatabaseUrl,
  buildTenantRoleProvisioningPlan,
  buildTenantRoleWriteStatements,
  ensureTenantUrlInEnvLocal,
  generateTenantDatabasePassword,
  parseTenantRoleProvisioningArgs,
  readTenantPasswordFromUrl,
  sanitizedProvisioningFailure,
} from "../scripts/lib/tenant-database-role-provisioning.mjs";

describe("Tenant database role provisioning", () => {
  it("defaults to dry-run and requires an exact write confirmation", () => {
    assert.deepEqual(parseTenantRoleProvisioningArgs([]), { write: false });
    assert.deepEqual(
      parseTenantRoleProvisioningArgs([
        "--write",
        "--confirm",
        TENANT_DATABASE_ROLE_WRITE_CONFIRMATION,
      ]),
      { write: true },
    );
    assert.throws(
      () => parseTenantRoleProvisioningArgs(["--write"]),
      (error) =>
        error instanceof TenantRoleProvisioningError &&
        error.code === "missing_write_confirmation",
    );
  });

  it("plans one role and no table, RLS, or application writes", () => {
    const plan = buildTenantRoleProvisioningPlan({
      roleState: { exists: false, roleName: TENANT_DATABASE_ROLE_NAME },
      tenantCredentialConfigured: false,
    });

    assert.equal(plan.result, "planned_create");
    assert.deepEqual(plan.plannedWrites, {
      databaseRoles: 1,
      tablePrivileges: 0,
      rlsPolicies: 0,
      applicationRows: 0,
    });
    assert.equal(plan.databaseSideEffects, false);
  });

  it("accepts only an exact existing least-privilege role", () => {
    const plan = buildTenantRoleProvisioningPlan({
      roleState: safeExistingRole(),
      tenantCredentialConfigured: true,
    });
    assert.equal(plan.result, "already_provisioned");
    assert.deepEqual(plan.blockers, []);

    const blocked = buildTenantRoleProvisioningPlan({
      roleState: {
        ...safeExistingRole(),
        roleBypassesRls: true,
        roleMembershipCount: 1,
        canCreateInPublicSchema: true,
      },
      tenantCredentialConfigured: true,
    });
    assert.equal(blocked.result, "blocked");
    assert.deepEqual(blocked.blockers, [
      "role_bypasses_rls",
      "role_has_memberships",
      "role_can_create_in_public_schema",
    ]);
  });

  it("blocks an existing role when its credential cannot be recovered", () => {
    const plan = buildTenantRoleProvisioningPlan({
      roleState: safeExistingRole(),
      tenantCredentialConfigured: false,
    });
    assert.equal(plan.result, "blocked");
    assert.deepEqual(plan.blockers, [
      "existing_role_credential_unavailable",
    ]);
  });

  it("generates a distinct tenant URL without exposing it in output", () => {
    const password = generateTenantDatabasePassword(() =>
      Buffer.alloc(32, 7),
    );
    const privileged = databaseUrl("owner", "owner-secret");
    const tenant = buildTenantDatabaseUrl(privileged, password);
    const parsed = new URL(tenant);

    assert.equal(parsed.username, TENANT_DATABASE_ROLE_NAME);
    assert.equal(parsed.password, password);
    assert.equal(readTenantPasswordFromUrl(tenant), password);
    assert.equal(parsed.hostname, new URL(privileged).hostname);
    assert.equal(parsed.pathname, "/neondb");
    assert.doesNotMatch(
      JSON.stringify(
        sanitizedProvisioningFailure("synthetic_failure", {
          localEnvironmentUpdated: true,
          databaseWriteAttempted: false,
          databaseWriteCompleted: false,
        }),
      ),
      new RegExp(password),
    );
  });

  it("does not claim no side effects after an ambiguous write failure", () => {
    const failure = sanitizedProvisioningFailure("synthetic_failure", {
      localEnvironmentUpdated: true,
      databaseWriteAttempted: true,
      databaseWriteCompleted: false,
    });

    assert.equal(failure.committed, false);
    assert.equal(failure.databaseSideEffects, "unknown");
    assert.equal(failure.requiresReadOnlyReconciliation, true);
  });

  it("builds fixed least-privilege SQL with no table or RLS statements", () => {
    const password = generateTenantDatabasePassword(() =>
      Buffer.alloc(32, 9),
    );
    const statements = buildTenantRoleWriteStatements({
      databaseName: 'tenant"database',
      password,
    });
    const sql = statements.join("\n");

    assert.match(sql, /create role "varda_tenant_app" with login password/);
    assert.match(
      sql,
      /nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls/,
    );
    assert.match(sql, /grant connect on database "tenant""database"/);
    assert.match(sql, /grant usage on schema public/);
    assert.match(sql, /revoke create on schema public/);
    assert.doesNotMatch(sql, /grant (?:select|insert|update|delete)/i);
    assert.doesNotMatch(sql, /row level security|create policy/i);
  });

  it("appends the local credential once and rejects drift", () => {
    let content = "DATABASE_URL=postgresql://owner:secret@example/neondb\n";
    const tenant = databaseUrl(TENANT_DATABASE_ROLE_NAME, "A".repeat(43));
    const adapters = {
      readFile() {
        return content;
      },
      appendFile(_path, value) {
        content += value;
      },
    };

    assert.deepEqual(
      ensureTenantUrlInEnvLocal(".env.local", tenant, adapters),
      { updated: true },
    );
    assert.deepEqual(
      ensureTenantUrlInEnvLocal(".env.local", tenant, adapters),
      { updated: false },
    );
    assert.throws(
      () =>
        ensureTenantUrlInEnvLocal(
          ".env.local",
          databaseUrl(TENANT_DATABASE_ROLE_NAME, "B".repeat(43)),
          adapters,
        ),
      (error) =>
        error instanceof TenantRoleProvisioningError &&
        error.code === "tenant_database_url_already_differs",
    );
  });

  it("keeps the operator script production-pinned and secret-free", () => {
    const source = readFileSync(
      "scripts/provision-tenant-database-role.mjs",
      "utf8",
    );
    assert.ok(
      source.indexOf("guardProductionDatabaseTarget(process.env)") <
        source.indexOf("readNamedDatabaseRoleState("),
    );
    assert.match(source, /DATABASE_URL_UNPOOLED/);
    assert.match(source, /pg_advisory_xact_lock/);
    assert.match(source, /set local lock_timeout = '2s'/);
    assert.match(source, /set local statement_timeout = '8s'/);
    assert.doesNotMatch(source, /console\.log\([^)]*tenantUrl/);
    assert.doesNotMatch(source, /console\.log\([^)]*password/);
  });
});

function safeExistingRole() {
  return {
    exists: true,
    roleName: TENANT_DATABASE_ROLE_NAME,
    roleCanLogin: true,
    roleIsSuperuser: false,
    roleBypassesRls: false,
    roleCanCreateDatabase: false,
    roleCanCreateRole: false,
    roleCanReplicate: false,
    roleInheritsPrivileges: false,
    roleOwnsPublicTableCount: 0,
    roleMembershipCount: 0,
    privilegedMembershipCount: 0,
    canConnectToDatabase: true,
    canUsePublicSchema: true,
    canCreateInPublicSchema: false,
  };
}

function databaseUrl(username, password) {
  return `postgresql://${username}:${password}@ep-production-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require`;
}
