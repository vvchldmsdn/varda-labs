import { runTenantTableRlsAudit } from "./lib/audit-tenant-table-rls.ts";

void runTenantTableRlsAudit({
  operation: "assets_tenant_rls_audit",
  policyName: "assets_tenant_select_v1",
  successStatus: "assets_tenant_rls_passed",
  tableName: "assets",
});
