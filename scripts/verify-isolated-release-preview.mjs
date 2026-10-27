import assert from "node:assert/strict";
import { neon } from "@neondatabase/serverless";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { isIsolatedReleasePreview } from "../src/lib/deployment/isolated-release-preview.ts";
import { assessAuthTransportEnvironment } from "../src/lib/auth/auth-transport-policy.ts";
import { assessTenantDatabaseRoleSecurity, guardTenantDatabaseRoleBoundary } from "../src/lib/deployment/tenant-database-role-boundary.ts";
import { readCurrentDatabaseRoleEvidence } from "./lib/tenant-database-role-evidence.mjs";

// Read-only build gate: this release's test DB is provisioned separately. Never migrate
// an integration-generated branch or fall back to an ambient Production connection.
let stage = "target";
try {
  assert.ok(isIsolatedReleasePreview(process.env));
  assert.equal(assessAuthTransportEnvironment(process.env).state, "ready");
  assert.equal(process.env.VARDA_AUTH_EMAIL_PASSWORD_ENABLED, "true");
  const admin = neon(process.env.DATABASE_URL_UNPOOLED), tenant = neon(process.env.TENANT_DATABASE_URL);
  const expected = readMigrationFiles({ migrationsFolder: "drizzle" });
  stage = "migration journal";
  const recorded = await admin.query("select hash,created_at from drizzle.__drizzle_migrations order by id");
  assert.equal(recorded.length, expected.length);
  expected.forEach((entry, index) => { assert.equal(recorded[index].hash, entry.hash); assert.equal(Number(recorded[index].created_at), entry.folderMillis); });
  stage = "tenant role";
  const roleSecurity = assessTenantDatabaseRoleSecurity(guardTenantDatabaseRoleBoundary(process.env), await readCurrentDatabaseRoleEvidence(tenant));
  assert.equal(roleSecurity.status, "role_boundary_passed");
  const [role] = await tenant.query("select current_database() as db,current_user as role,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb from pg_roles where rolname=current_user");
  assert.deepEqual(role, { db: "neondb", role: "varda_tenant_app", rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false });
  const tables = await admin.query("select relname,relrowsecurity,relforcerowsecurity from pg_class where relnamespace='public'::regnamespace and relname=any($1::text[])", [["accounts","assets","event_ledger_entries","daily_portfolio_snapshots","simulation_executions","simulation_execution_chunks","native_contribution_plans"]]);
  assert.equal(tables.length, 7);
  const forced = new Set(["simulation_executions", "simulation_execution_chunks", "native_contribution_plans"]);
  // Legacy service-owned financial tables retain their existing SECURITY DEFINER
  // writer policy. The ordinary tenant role must not own them or bypass their RLS.
  assert.ok(tables.every(row => row.relrowsecurity && row.relforcerowsecurity === forced.has(row.relname)));
  const [ownership] = await tenant.query("select count(*)::int as owned from pg_class c join pg_roles r on r.oid=c.relowner where c.relnamespace='public'::regnamespace and r.rolname=current_user");
  assert.equal(ownership.owned, 0);
  const [permissions] = await tenant.query("select has_table_privilege(current_user,'accounts','UPDATE') as account_update, has_table_privilege(current_user,'assets','UPDATE') as asset_update, has_function_privilege(current_user,'apply_native_portfolio_tenant_mutation(uuid,uuid,jsonb,jsonb)','EXECUTE') as native_execute");
  assert.deepEqual(permissions, { account_update: false, asset_update: false, native_execute: true });
  console.log(`[release-preview] verified isolated DB, ${recorded.length} migrations, tenant role and RLS; no migration performed`);
} catch {
  // Driver errors can contain connection strings, SQL parameters or credentials.
  console.error(`[release-preview] Isolated ${stage} verification failed; build stopped.`);
  process.exitCode = 1;
}
