import { runTenantTableRlsAudit } from "./lib/audit-tenant-table-rls.ts";

const audits = [
  {
    operation: "asset_groups_tenant_rls_audit",
    policyName: "asset_groups_tenant_select_v1",
    successStatus: "asset_groups_tenant_rls_passed",
    tableName: "asset_groups",
  },
  {
    operation: "asset_group_members_tenant_rls_audit",
    policyName: "asset_group_members_tenant_select_v1",
    successStatus: "asset_group_members_tenant_rls_passed",
    tableName: "asset_group_members",
  },
  {
    allowEmptyTable: true,
    operation: "portfolio_groups_tenant_rls_audit",
    policyName: "portfolio_groups_tenant_select_v1",
    successStatus: "portfolio_groups_tenant_rls_passed",
    tableName: "portfolio_groups",
  },
  {
    allowEmptyTable: true,
    operation: "portfolio_group_account_memberships_tenant_rls_audit",
    policyName: "portfolio_group_account_memberships_tenant_select_v1",
    successStatus: "portfolio_group_account_memberships_tenant_rls_passed",
    tableName: "portfolio_group_account_memberships",
  },
  {
    allowEmptyTable: true,
    operation: "portfolio_group_asset_memberships_tenant_rls_audit",
    policyName: "portfolio_group_asset_memberships_tenant_select_v1",
    successStatus: "portfolio_group_asset_memberships_tenant_rls_passed",
    tableName: "portfolio_group_asset_memberships",
  },
] as const;

async function runGroupTenantRlsAudits() {
  for (const audit of audits) {
    await runTenantTableRlsAudit(audit);
  }
}

void runGroupTenantRlsAudits();
