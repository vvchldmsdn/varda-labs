import { runTenantTableRlsAudit } from "./lib/audit-tenant-table-rls.ts";

const audits = [
  {
    allowEmptyTable: true,
    operation: "holding_onboarding_evidence_tenant_rls_audit",
    policyName: "holding_onboarding_evidence_tenant_select_v1",
    successStatus: "holding_onboarding_evidence_tenant_rls_passed",
    tableName: "holding_onboarding_evidence",
  },
  {
    allowEmptyTable: true,
    operation: "holding_state_corrections_tenant_rls_audit",
    policyName: "holding_state_corrections_tenant_select_v1",
    successStatus: "holding_state_corrections_tenant_rls_passed",
    tableName: "holding_state_corrections",
  },
  {
    allowEmptyTable: true,
    operation: "holding_lifecycle_events_tenant_rls_audit",
    policyName: "holding_lifecycle_events_tenant_select_v1",
    successStatus: "holding_lifecycle_events_tenant_rls_passed",
    tableName: "holding_lifecycle_events",
  },
  {
    allowEmptyTable: true,
    operation: "simulation_scenario_revisions_tenant_rls_audit",
    ownerScope: "owner_user_id",
    policyName: "simulation_scenario_revisions_tenant_select_v1",
    successStatus: "simulation_scenario_revisions_tenant_rls_passed",
    tableName: "simulation_scenario_approval_revisions",
  },
  {
    allowEmptyTable: true,
    operation: "simulation_scenario_vector_rows_tenant_rls_audit",
    ownerScope: "simulation_scenario_approval_revision",
    policyName: "simulation_scenario_vector_rows_tenant_select_v1",
    successStatus: "simulation_scenario_vector_rows_tenant_rls_passed",
    tableName: "simulation_scenario_approval_vector_rows",
  },
  {
    allowEmptyTable: true,
    operation: "simulation_scenario_events_tenant_rls_audit",
    ownerScope: "simulation_scenario_approval_revision",
    policyName: "simulation_scenario_events_tenant_select_v1",
    successStatus: "simulation_scenario_events_tenant_rls_passed",
    tableName: "simulation_scenario_approval_lifecycle_events",
  },
] as const;

async function runEvidenceSimulationTenantRlsAudits() {
  for (const audit of audits) {
    await runTenantTableRlsAudit(audit);
  }
}

void runEvidenceSimulationTenantRlsAudits();
