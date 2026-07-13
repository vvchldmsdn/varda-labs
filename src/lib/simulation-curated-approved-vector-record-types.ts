import type { SimulationScenarioVectorHashV2InputRow } from "./simulation-scenario-vector-hash-v2.ts";

export type SimulationCuratedApprovedVectorRecordV2Selector = Readonly<{
  scenarioId: string;
  scenarioVersion: string;
}>;

export type SimulationCuratedApprovedVectorRecordV2StoredRow = Readonly<{
  approvalRevisionId: string;
  market: string;
  currency: string;
  ticker: string;
  weightBps: number;
}>;

export type SimulationCuratedApprovedVectorRecordV2LifecycleEvent = Readonly<{
  approvalRevisionId: string;
  eventSequence: number;
  auditVersion: string;
  transitionKind: string;
  previousStatus: string | null;
  resultingStatus: string;
  transitionedAt: string;
  replacementRevisionId: string | null;
}>;

export type SimulationCuratedApprovedVectorRecordV2StoredRecord = Readonly<{
  id: string;
  ownerUserId: string;
  portfolioPathPolicyId: string;
  gate0ApprovalCommit: string;
  scenarioId: string;
  scenarioVersion: string;
  approvalRevision: number;
  scenarioVectorHashVersion: string;
  scenarioVectorHash: string;
  approvedAt: string;
  lifecycleStatus: string;
  terminalAt: string | null;
  vectorRows: readonly SimulationCuratedApprovedVectorRecordV2StoredRow[];
  lifecycleEvents: readonly SimulationCuratedApprovedVectorRecordV2LifecycleEvent[];
}>;

export type SimulationCuratedApprovedVectorRecordV2Input = Readonly<{
  expectedOwnerUserId: string;
  selector: SimulationCuratedApprovedVectorRecordV2Selector;
  record: SimulationCuratedApprovedVectorRecordV2StoredRecord;
}>;

export type SimulationCuratedApprovedVectorEvidenceV2 = Readonly<{
  portfolioPathPolicyId: "gross_normalized_buy_and_hold_v1";
  gate0ApprovalCommit: "652b9ea9c9b48f51dc4c68e8f148132ca8893d7e";
  scenarioId: string;
  scenarioVersion: string;
  approvalRevision: number;
  scenarioVectorHashVersion: "simulation_scenario_vector_hash_v2";
  scenarioVectorHash: string;
  canonicalVector: readonly SimulationScenarioVectorHashV2InputRow[];
}>;

export type SimulationCuratedApprovedVectorRecordV2Blocker =
  | "invalid_input_shape"
  | "expected_owner_invalid"
  | "scenario_selector_invalid"
  | "approval_identity_invalid"
  | "approval_owner_mismatch"
  | "approval_selector_mismatch"
  | "approval_policy_mismatch"
  | "scenario_vector_hash_version_mismatch"
  | "approval_revision_invalid"
  | "approval_lifecycle_invalid"
  | "approval_audit_invalid"
  | "scenario_vector_invalid"
  | "scenario_vector_hash_mismatch";

export type SimulationCuratedApprovedVectorRecordV2Result =
  | Readonly<{
      status: "validated";
      runtimeTrustStatus: "not_established";
      evidence: SimulationCuratedApprovedVectorEvidenceV2;
      blocker: null;
    }>
  | Readonly<{
      status: "blocked";
      runtimeTrustStatus: "not_established";
      evidence: null;
      blocker: Readonly<{
        reason: SimulationCuratedApprovedVectorRecordV2Blocker;
      }>;
    }>;

export type SimulationCuratedApprovedVectorRecordV2Evaluation = Readonly<{
  evidence: SimulationCuratedApprovedVectorEvidenceV2 | null;
  blocker: SimulationCuratedApprovedVectorRecordV2Blocker | null;
}>;
