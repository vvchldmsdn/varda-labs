import { runTenantTableRlsAudit } from "./lib/audit-tenant-table-rls.ts";

void runTenantTableRlsAudit({
  operation: "event_ledger_entries_tenant_rls_audit",
  policyName: "event_ledger_entries_tenant_select_v1",
  successStatus: "event_ledger_entries_tenant_rls_passed",
  tableName: "event_ledger_entries",
});
