import { config } from "dotenv";

import { guardProductionDatabaseTarget } from "../src/lib/deployment/production-database-target.ts";
import { guardTenantDatabaseRoleBoundary } from "../src/lib/deployment/tenant-database-role-boundary.ts";

async function main() {
  config({ path: ".env.local", quiet: true });

  if (process.argv.length > 2) {
    throw new Error("This audit accepts no arguments and never writes tables");
  }

  const productionTarget = guardProductionDatabaseTarget(process.env);
  const credentialBoundary = guardTenantDatabaseRoleBoundary(process.env);
  const { auditTenantTransactionContextIsolation } = await import(
    "../src/db/tenant-transaction-context.ts"
  );
  const assessment = await auditTenantTransactionContextIsolation();

  console.log(
    JSON.stringify(
      {
        audit: "tenant_transaction_context",
        readOnly: true,
        persistentDatabaseSideEffects: false,
        publicTableReads: 0,
        targetFingerprint: productionTarget.targetFingerprint,
        credentialBoundaryStatus: credentialBoundary.status,
        transactionContext: assessment,
        nextBoundary: "rls_policy_separate_gate_not_evaluated",
      },
      null,
      2,
    ),
  );

  if (assessment.status !== "transaction_context_passed") {
    process.exitCode = 1;
  }
}

main().catch(() => {
  console.error("tenant_transaction_context_audit_failed");
  process.exitCode = 1;
});
