import { join } from "node:path";

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import {
  assessTenantDatabaseRoleSecurity,
  guardTenantDatabaseRoleBoundary,
} from "../src/lib/deployment/tenant-database-role-boundary.ts";
import { parseNeonDatabaseUrl } from "../src/lib/deployment/preview-database-target.ts";
import { guardProductionDatabaseTarget } from "../src/lib/deployment/production-database-target.ts";
import {
  readCurrentDatabaseRoleEvidence,
  readNamedDatabaseRoleState,
} from "./lib/tenant-database-role-evidence.mjs";
import {
  TENANT_DATABASE_ROLE_ADVISORY_LOCK,
  TENANT_DATABASE_ROLE_NAME,
  TenantRoleProvisioningError,
  buildTenantDatabaseUrl,
  buildTenantRoleProvisioningPlan,
  buildTenantRoleWriteStatements,
  ensureTenantUrlInEnvLocal,
  generateTenantDatabasePassword,
  parseTenantRoleProvisioningArgs,
  readTenantPasswordFromUrl,
  sanitizedProvisioningFailure,
} from "./lib/tenant-database-role-provisioning.mjs";

const repositoryRoot = process.cwd();
const envLocalPath = join(repositoryRoot, ".env.local");
config({ path: envLocalPath, quiet: true });

await main();

async function main() {
  let args;
  try {
    args = parseTenantRoleProvisioningArgs(process.argv.slice(2));
  } catch (error) {
    printFailure(error, {
      localEnvironmentUpdated: false,
      databaseWriteAttempted: false,
      databaseWriteCompleted: false,
    });
    return;
  }

  let localEnvironmentUpdated = false;
  let databaseWriteAttempted = false;
  let databaseWriteCompleted = false;
  try {
    const privilegedUrl = requiredEnvironmentValue("DATABASE_URL");
    const privilegedUnpooledUrl = requiredEnvironmentValue(
      "DATABASE_URL_UNPOOLED",
    );
    const productionTarget = guardProductionDatabaseTarget(process.env);
    const privilegedSql = neon(privilegedUnpooledUrl);
    const initialState = await readNamedDatabaseRoleState(
      privilegedSql,
      TENANT_DATABASE_ROLE_NAME,
    );
    let tenantUrl = process.env.TENANT_DATABASE_URL?.trim() || null;

    if (tenantUrl) guardTenantDatabaseRoleBoundary(process.env);
    const plan = buildTenantRoleProvisioningPlan({
      roleState: initialState,
      tenantCredentialConfigured: tenantUrl !== null,
    });

    if (!args.write) {
      console.log(
        JSON.stringify(
          {
            ...plan,
            targetFingerprint: productionTarget.targetFingerprint,
          },
          null,
          2,
        ),
      );
      if (plan.result === "blocked") process.exitCode = 1;
      return;
    }

    if (plan.result === "blocked") {
      console.log(JSON.stringify({ ...plan, mode: "write" }, null, 2));
      process.exitCode = 1;
      return;
    }

    if (!tenantUrl) {
      tenantUrl = buildTenantDatabaseUrl(
        privilegedUrl,
        generateTenantDatabasePassword(),
      );
      localEnvironmentUpdated = ensureTenantUrlInEnvLocal(
        envLocalPath,
        tenantUrl,
      ).updated;
      process.env.TENANT_DATABASE_URL = tenantUrl;
    }

    const boundary = guardTenantDatabaseRoleBoundary(process.env);

    if (plan.result === "planned_create") {
      const databaseName = parseNeonDatabaseUrl(privilegedUrl).databaseName;
      const password = readTenantPasswordFromUrl(tenantUrl);
      const statements = buildTenantRoleWriteStatements({
        databaseName,
        password,
      });
      databaseWriteAttempted = true;
      await privilegedSql.transaction((txn) => [
        txn.query("set local lock_timeout = '2s'"),
        txn.query("set local statement_timeout = '8s'"),
        txn.query("select pg_advisory_xact_lock(hashtext($1))", [
          TENANT_DATABASE_ROLE_ADVISORY_LOCK,
        ]),
        ...statements.map((statement) => txn.query(statement)),
      ]);
      databaseWriteCompleted = true;
    }

    const finalState = await readNamedDatabaseRoleState(
      privilegedSql,
      TENANT_DATABASE_ROLE_NAME,
    );
    const finalPlan = buildTenantRoleProvisioningPlan({
      roleState: finalState,
      tenantCredentialConfigured: true,
    });
    if (finalPlan.result !== "already_provisioned") {
      throw new TenantRoleProvisioningError("postflight_role_state_blocked");
    }

    const tenantSql = neon(tenantUrl);
    const tenantEvidence = await readCurrentDatabaseRoleEvidence(tenantSql);
    const security = assessTenantDatabaseRoleSecurity(
      boundary,
      tenantEvidence,
    );
    if (security.status !== "role_boundary_passed") {
      throw new TenantRoleProvisioningError("tenant_connection_audit_blocked");
    }

    console.log(
      JSON.stringify(
        {
          operation: "tenant_database_role_provisioning",
          mode: "write",
          result:
            plan.result === "planned_create" ? "created" : "already_provisioned",
          targetFingerprint: productionTarget.targetFingerprint,
          roleFingerprint: security.roleFingerprint,
          localEnvironmentUpdated,
          roleBoundaryStatus: security.status,
          tablePrivilegesGranted: false,
          rlsPoliciesChanged: false,
          applicationRowsChanged: 0,
          committed: true,
          databaseSideEffects: plan.result === "planned_create",
        },
        null,
        2,
      ),
    );
  } catch (error) {
    printFailure(error, {
      localEnvironmentUpdated,
      databaseWriteAttempted,
      databaseWriteCompleted,
    });
  }
}

function requiredEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new TenantRoleProvisioningError("database_not_configured");
  return value;
}

function printFailure(error, state) {
  const code =
    error instanceof TenantRoleProvisioningError
      ? error.code
      : "provisioning_preflight_or_write_failed";
  console.log(
    JSON.stringify(
      sanitizedProvisioningFailure(code, state),
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
