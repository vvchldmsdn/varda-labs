import { runTenantTableRlsAudit } from "./lib/audit-tenant-table-rls.ts";

void runTenantTableRlsAudit({
  operation: "daily_portfolio_snapshots_tenant_rls_audit",
  policyName: "daily_portfolio_snapshots_tenant_select_v1",
  successStatus: "daily_portfolio_snapshots_tenant_rls_passed",
  tableName: "daily_portfolio_snapshots",
});
