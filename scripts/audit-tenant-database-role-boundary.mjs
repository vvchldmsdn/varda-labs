import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import {
  assessTenantDatabaseRoleSecurity,
  guardTenantDatabaseRoleBoundary,
} from "../src/lib/deployment/tenant-database-role-boundary.ts";
import { sha256Fingerprint } from "../src/lib/deployment/preview-database-target.ts";
import { guardProductionDatabaseTarget } from "../src/lib/deployment/production-database-target.ts";
import {
  readCurrentDatabaseRoleEvidence,
  sanitizeCurrentDatabaseRoleEvidence,
} from "./lib/tenant-database-role-evidence.mjs";

config({ path: ".env.local", quiet: true });

if (process.argv.length > 2) {
  throw new Error("This audit accepts no arguments and never writes");
}

const privilegedUrl = process.env.DATABASE_URL?.trim();
if (!privilegedUrl) throw new Error("DATABASE_URL is not set");
const productionTarget = guardProductionDatabaseTarget(process.env);

const tenantUrl = process.env.TENANT_DATABASE_URL?.trim();
if (!tenantUrl) {
  const evidence = await readCurrentDatabaseRoleEvidence(neon(privilegedUrl));
  console.log(
    JSON.stringify(
      {
        audit: "tenant_database_role_boundary",
        readOnly: true,
        databaseSideEffects: false,
        selectCount: 1,
        status: "blocked",
        targetFingerprint: productionTarget.targetFingerprint,
        boundaryStatus: "tenant_database_url_missing",
        blockers: ["tenant_database_url_missing"],
        currentConnection: sanitizeCurrentDatabaseRoleEvidence(
          evidence,
          sha256Fingerprint,
        ),
        nextRequiredEnvironmentKey: "TENANT_DATABASE_URL",
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} else {
  const boundary = guardTenantDatabaseRoleBoundary(process.env);
  const evidence = await readCurrentDatabaseRoleEvidence(neon(tenantUrl));
  const assessment = assessTenantDatabaseRoleSecurity(boundary, evidence);

  console.log(
    JSON.stringify(
      {
        audit: "tenant_database_role_boundary",
        readOnly: true,
        databaseSideEffects: false,
        selectCount: 1,
        targetFingerprint: productionTarget.targetFingerprint,
        credentialBoundary: boundary,
        roleSecurity: assessment,
      },
      null,
      2,
    ),
  );
  if (assessment.status !== "role_boundary_passed") process.exitCode = 1;
}
