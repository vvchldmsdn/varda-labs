import type { TenantContext } from "./session-resolver-contract.ts";
import type { SimulationScenarioVectorRow } from "./simulation-scenario-vector-review-serialization.ts";

export type SimulationScenarioSelector = Readonly<{
  scenarioId: string;
  scenarioVersion: string;
}>;

export type SimulationApprovalLifecycleStatus =
  | "approved"
  | "revoked"
  | "superseded";

export type SimulationApprovalAuditStatus =
  | "verified"
  | "invalid"
  | "unavailable";

export type SimulationApprovalAuditEnvelope = Readonly<{
  version: "scenario_vector_approval_audit_v1";
  decisionKind: "explicit_approval";
  approvalRevision: number;
  approvedAt: string;
}>;

export type SimulationOwnerScopedApprovalRecord = Readonly<{
  canonicalOwnerUserId: string;
  portfolioPathPolicyId: string;
  gate0ApprovalCommit: string;
  scenarioId: string;
  scenarioVersion: string;
  canonicalVector: readonly SimulationScenarioVectorRow[];
  scenarioVectorHash: string;
  approvalRevision: number;
  approvedAt: string;
  lifecycleStatus: SimulationApprovalLifecycleStatus;
  auditEnvelope: SimulationApprovalAuditEnvelope;
}>;

export type SimulationScenarioVectorRepositoryPortResult =
  | Readonly<{ state: "not_requested" }>
  | Readonly<{ state: "not_found" }>
  | Readonly<{ state: "not_current" }>
  | Readonly<{ state: "unavailable" }>
  | Readonly<{ state: "collision" }>
  | Readonly<{
      state: "loaded";
      record: SimulationOwnerScopedApprovalRecord;
      auditStatus: SimulationApprovalAuditStatus;
    }>;

export type SimulationScenarioVectorResolverInput = Readonly<{
  tenantContext: TenantContext | null;
  selector: SimulationScenarioSelector | null;
  repositoryResult: SimulationScenarioVectorRepositoryPortResult;
}>;

export type SimulationScenarioVectorEvidencePort = Readonly<{
  portfolioPathPolicyId: string;
  gate0ApprovalCommit: string;
  scenarioId: string;
  scenarioVersion: string;
  canonicalVector: readonly SimulationScenarioVectorRow[];
  scenarioVectorHash: string;
}>;

export type SimulationScenarioVectorResolverBlockerReason =
  | "tenant_context_invalid"
  | "scenario_selector_invalid"
  | "resolver_state_invalid"
  | "scenario_not_found"
  | "scenario_not_current"
  | "repository_unavailable"
  | "approval_collision"
  | "loaded_record_owner_mismatch"
  | "loaded_record_selector_mismatch"
  | "approval_audit_invalid"
  | "approval_audit_unavailable"
  | "approval_policy_mismatch"
  | "approval_lifecycle_invalid"
  | "approval_revision_invalid"
  | "approval_audit_envelope_invalid"
  | "scenario_vector_invalid"
  | "scenario_vector_hash_mismatch";

export type SimulationScenarioVectorResolverBlocker = Readonly<{
  reason: SimulationScenarioVectorResolverBlockerReason;
}>;

export type SimulationScenarioVectorResolverResult =
  | Readonly<{
      resolutionStatus: "resolved";
      runtimeTrustStatus: "not_established";
      evidence: SimulationScenarioVectorEvidencePort;
      blocker: null;
    }>
  | Readonly<{
      resolutionStatus: "blocked";
      runtimeTrustStatus: "not_established";
      evidence: null;
      blocker: SimulationScenarioVectorResolverBlocker;
    }>;

export type ValidatedSimulationScenarioVectorApproval = Readonly<{
  evidence: SimulationScenarioVectorEvidencePort;
}>;

export type SimulationLoadedApprovalValidationResult = Readonly<{
  validated: ValidatedSimulationScenarioVectorApproval | null;
  blocker: SimulationScenarioVectorResolverBlockerReason | null;
}>;
