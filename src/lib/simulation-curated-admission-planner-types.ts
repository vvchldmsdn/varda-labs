import type { SimulationCuratedAdmissionPlannerBlocker } from "./simulation-curated-admission-planner-policy.ts";

export type SimulationCuratedAdmissionCheckStatus =
  | "pass"
  | "blocked"
  | "not_evaluated";

export type SimulationCuratedAdmissionPolicyEvidence = Readonly<{
  evidenceSource: "caller_supplied_synthetic_unverified";
  plannerPolicyId: string;
  plannerPolicyVersion: number;
  actorMode: string;
  confirmationPolicyId: string;
  portfolioPathPolicyId: string;
  gate0ApprovalCommit: string;
  vectorHashVersion: string;
  approvalEnvelopeDigestVersion: string;
}>;

export type SimulationCuratedAdmissionActorAssumptions = Readonly<{
  sessionAssumption:
    | "verified_active"
    | "not_verified"
    | "inactive"
    | "unknown";
  identityMappingAssumption:
    | "exactly_one_active"
    | "missing"
    | "ambiguous"
    | "inactive"
    | "unknown";
  appUserAssumption:
    | "active"
    | "provisioning"
    | "disabled"
    | "missing"
    | "unknown";
  actorOwnerAssumption: "same_canonical_owner" | "mismatch" | "unknown";
  syntheticOwnerUserId: string;
}>;

export type SimulationCuratedAdmissionExactIdentity = Readonly<{
  ownerUserId: string;
  portfolioPathPolicyId: string;
  gate0ApprovalCommit: string;
  scenarioId: string;
  scenarioVersion: string;
  intent: string;
}>;

export type SimulationCuratedAdmissionVectorRow = Readonly<{
  market: string;
  currency: "KRW" | "USD";
  ticker: string;
  weightBps: number;
}>;

export type SimulationCuratedAdmissionConfirmationAssumptions = Readonly<{
  state: "pending" | "consumed" | "expired" | "invalidated" | "conflicted" | "unknown";
  ownerBindingAssumption: "matches" | "mismatch" | "unknown";
  expectedChallengeInstanceLabel: string;
  presentedChallengeInstanceLabel: string;
  expectedApprovalEnvelopeDigest: string;
  presentedApprovalEnvelopeDigest: string;
  issuedAt: string;
  expiresAt: string;
  syntheticEvaluationTime: string;
}>;

export type SimulationCuratedAdmissionDurableStateAssumptions = Readonly<{
  approvalRevisionAssumption:
    | "no_prior_revision"
    | "current_approval_exists"
    | "prior_revision_exists"
    | "unknown";
  competingChallengeAssumption:
    | "none"
    | "live_competitor_present"
    | "unknown";
}>;

export type SimulationCuratedAdmissionPlannerInput = Readonly<{
  policyEvidence: SimulationCuratedAdmissionPolicyEvidence;
  actorAssumptions: SimulationCuratedAdmissionActorAssumptions;
  exactIdentity: SimulationCuratedAdmissionExactIdentity;
  vector: readonly SimulationCuratedAdmissionVectorRow[];
  scenarioVectorHash: string;
  confirmationAssumptions: SimulationCuratedAdmissionConfirmationAssumptions;
  durableStateAssumptions: SimulationCuratedAdmissionDurableStateAssumptions;
}>;

export type SimulationCuratedAdmissionPlannerChecks = Readonly<{
  policyBinding: SimulationCuratedAdmissionCheckStatus;
  actorAssumptions: SimulationCuratedAdmissionCheckStatus;
  exactIdentityShape: SimulationCuratedAdmissionCheckStatus;
  sourceVector: SimulationCuratedAdmissionCheckStatus;
  vectorHash: SimulationCuratedAdmissionCheckStatus;
  approvalEnvelope: SimulationCuratedAdmissionCheckStatus;
  confirmationAssumptions: SimulationCuratedAdmissionCheckStatus;
  durableStateAssumptions: SimulationCuratedAdmissionCheckStatus;
}>;

export type SimulationCuratedAdmissionPlannerResult = Readonly<{
  policyId: "curated_vector_synthetic_admission_planner_v1";
  policyVersion: 1;
  mode: "synthetic_only";
  runtimeTrustStatus: "not_established";
  readinessStatus: "not_ready";
  decision: "synthetic_preconditions_satisfied" | "blocked";
  intent: "initial_approval";
  blockers: readonly SimulationCuratedAdmissionPlannerBlocker[];
  rowCount: number | null;
  totalWeightBps: number | null;
  zeroWeightRowCount: number | null;
  checks: SimulationCuratedAdmissionPlannerChecks;
}>;

export type SimulationCuratedAdmissionEnvelopeInput = Readonly<{
  approvalEnvelopeDigestVersion: string;
  actorMode: string;
  confirmationPolicyId: string;
  intent: string;
  ownerUserId: string;
  portfolioPathPolicyId: string;
  gate0ApprovalCommit: string;
  scenarioId: string;
  scenarioVersion: string;
  vectorHashVersion: string;
  scenarioVectorHash: string;
  vector: readonly SimulationCuratedAdmissionVectorRow[];
}>;

export type SimulationCuratedAdmissionPlannerEvaluation = Readonly<{
  blockers: readonly SimulationCuratedAdmissionPlannerBlocker[];
  intent: "initial_approval";
  rowCount: number | null;
  totalWeightBps: number | null;
  zeroWeightRowCount: number | null;
  checks: SimulationCuratedAdmissionPlannerChecks;
}>;
