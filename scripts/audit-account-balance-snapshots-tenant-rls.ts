import { runTenantTableRlsAudit } from "./lib/audit-tenant-table-rls.ts";

void runTenantTableRlsAudit({
  operation: "account_balance_snapshots_tenant_rls_audit",
  policyName: "account_balance_snapshots_tenant_select_v1",
  successStatus: "account_balance_snapshots_tenant_rls_passed",
  tableName: "account_balance_snapshots",
});
