import { runTenantTableRlsAudit } from "./lib/audit-tenant-table-rls.ts";

void runTenantTableRlsAudit({
  operation: "accounts_tenant_rls_audit",
  policyName: "accounts_tenant_select_v1",
  successStatus: "accounts_tenant_rls_passed",
  tableName: "accounts",
});
