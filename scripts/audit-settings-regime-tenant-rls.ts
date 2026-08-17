import { runTenantTableRlsAudit } from "./lib/audit-tenant-table-rls.ts";

const audits = [
  {
    operation: "settings_tenant_rls_audit",
    policyName: "settings_tenant_select_v1",
    successStatus: "settings_tenant_rls_passed",
    tableName: "settings",
  },
  {
    operation: "market_regime_daily_tenant_rls_audit",
    policyName: "market_regime_daily_tenant_select_v1",
    successStatus: "market_regime_daily_tenant_rls_passed",
    tableName: "market_regime_daily",
  },
] as const;

async function runSettingsRegimeTenantRlsAudits() {
  for (const audit of audits) {
    await runTenantTableRlsAudit(audit);
  }
}

void runSettingsRegimeTenantRlsAudits();
