import { runTenantTableRlsAudit } from "./lib/audit-tenant-table-rls.ts";

const audits = [
  {
    operation: "target_policy_revisions_tenant_rls_audit",
    ownerScope: "owner_user_id",
    policyName: "target_policy_revisions_tenant_select_v1",
    successStatus: "target_policy_revisions_tenant_rls_passed",
    tableName: "target_policy_approval_revisions",
  },
  {
    operation: "target_policy_vector_rows_tenant_rls_audit",
    ownerScope: "target_policy_approval_revision",
    policyName: "target_policy_vector_rows_tenant_select_v1",
    successStatus: "target_policy_vector_rows_tenant_rls_passed",
    tableName: "target_policy_approval_vector_rows",
  },
  {
    operation: "target_policy_events_tenant_rls_audit",
    ownerScope: "target_policy_approval_revision",
    policyName: "target_policy_events_tenant_select_v1",
    successStatus: "target_policy_events_tenant_rls_passed",
    tableName: "target_policy_approval_lifecycle_events",
  },
  {
    allowEmptyTable: true,
    operation: "portfolio_target_policy_revisions_tenant_rls_audit",
    policyName: "portfolio_target_policy_revisions_tenant_select_v1",
    successStatus: "portfolio_target_policy_revisions_tenant_rls_passed",
    tableName: "portfolio_target_policy_revisions",
  },
  {
    allowEmptyTable: true,
    operation: "portfolio_target_policy_rows_tenant_rls_audit",
    policyName: "portfolio_target_policy_rows_tenant_select_v1",
    successStatus: "portfolio_target_policy_rows_tenant_rls_passed",
    tableName: "portfolio_target_policy_rows",
  },
  {
    allowEmptyTable: true,
    operation: "portfolio_target_policy_events_tenant_rls_audit",
    policyName: "portfolio_target_policy_events_tenant_select_v1",
    successStatus: "portfolio_target_policy_events_tenant_rls_passed",
    tableName: "portfolio_target_policy_lifecycle_events",
  },
] as const;

async function runTargetPolicyTenantRlsAudits() {
  for (const audit of audits) {
    await runTenantTableRlsAudit(audit);
  }
}

void runTargetPolicyTenantRlsAudits();
