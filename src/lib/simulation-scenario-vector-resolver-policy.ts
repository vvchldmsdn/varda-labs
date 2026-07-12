import {
  SIMULATION_PORTFOLIO_PATH_GATE0_APPROVAL_COMMIT,
  SIMULATION_PORTFOLIO_PATH_POLICY_ID,
} from "./simulation-scenario-vector-review-serialization.ts";

export const SIMULATION_SCENARIO_SELECTOR_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

export const SIMULATION_APPROVAL_AUDIT_ENVELOPE_VERSION =
  "scenario_vector_approval_audit_v1" as const;

export const SIMULATION_SCENARIO_VECTOR_RESOLVER_POLICY = Object.freeze({
  version: "simulation_scenario_vector_resolver_v1",
  portfolioPathPolicyId: SIMULATION_PORTFOLIO_PATH_POLICY_ID,
  gate0ApprovalCommit: SIMULATION_PORTFOLIO_PATH_GATE0_APPROVAL_COMMIT,
  selectorEquality: "exact_case_sensitive_canonical",
  repositoryStates: Object.freeze([
    "not_requested",
    "not_found",
    "not_current",
    "unavailable",
    "collision",
    "loaded",
  ] as const),
  auditEnvelopeVersion: SIMULATION_APPROVAL_AUDIT_ENVELOPE_VERSION,
  auditDecisionKind: "explicit_approval",
  runtimeTrustStatus: "not_established",
  outputKind: "minimized_scenario_vector_evidence_port",
  rawRecordOutput: "forbidden",
  repositoryAccess: "forbidden_in_pure_helper",
  productionVectorAccess: "forbidden",
} as const);
