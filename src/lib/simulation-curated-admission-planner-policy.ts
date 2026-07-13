export const SIMULATION_CURATED_ADMISSION_PLANNER_POLICY = Object.freeze({
  policyId: "curated_vector_synthetic_admission_planner_v1",
  policyVersion: 1,
  mode: "synthetic_only",
  runtimeTrustStatus: "not_established",
  readinessStatus: "not_ready",
  evidenceSource: "caller_supplied_synthetic_unverified",
  supportedIntent: "initial_approval",
  supportedActorMode: "tenant_self_approval_v1",
  confirmationPolicyId: "curated_vector_self_confirmation_v1",
  vectorHashVersion: "simulation_scenario_vector_hash_v2",
  approvalEnvelopeDigestVersion:
    "curated_vector_approval_envelope_digest_v1",
  portfolioPathPolicyId: "gross_normalized_buy_and_hold_v1",
  gate0ApprovalCommit: "652b9ea9c9b48f51dc4c68e8f148132ca8893d7e",
  writeSafetyApprovalCommit:
    "c0a2f584e167f153db0dedb6cfc418d76b2fc5bd",
  contractApprovalCommit: "38e7981cc2c2e61b9ce50c2e52edc09770b0d70a",
  maxVectorRows: 64,
  requiredWeightTotalBps: 10_000,
  maxCanonicalInputBytes: 32_768,
} as const);

export const SIMULATION_CURATED_ADMISSION_PLANNER_BLOCKER_ORDER =
  Object.freeze([
    "invalid_synthetic_input",
    "unsupported_evidence_source",
    "policy_binding_mismatch",
    "unsupported_actor_mode",
    "synthetic_session_not_verified_active",
    "synthetic_identity_mapping_not_exactly_one_active",
    "synthetic_app_user_not_active",
    "synthetic_actor_owner_mismatch",
    "invalid_exact_identity",
    "unsupported_admission_intent",
    "source_vector_empty",
    "source_vector_row_cap_exceeded",
    "invalid_instrument_identity",
    "duplicate_instrument_identity",
    "source_vector_not_canonical_order",
    "invalid_weight_bps",
    "source_vector_total_not_10000_bps",
    "scenario_vector_hash_mismatch",
    "approval_envelope_digest_mismatch",
    "invalid_synthetic_instant",
    "confirmation_policy_mismatch",
    "confirmation_owner_binding_mismatch",
    "confirmation_instance_mismatch",
    "confirmation_not_pending",
    "confirmation_not_yet_valid",
    "confirmation_expired",
    "synthetic_current_approval_exists",
    "synthetic_prior_revision_exists",
    "synthetic_competing_challenge",
    "synthetic_durable_state_unproven",
  ] as const);

export type SimulationCuratedAdmissionPlannerBlocker =
  (typeof SIMULATION_CURATED_ADMISSION_PLANNER_BLOCKER_ORDER)[number];

export const SIMULATION_CURATED_ADMISSION_PLANNER_CHECK_KEYS = Object.freeze([
  "policyBinding",
  "actorAssumptions",
  "exactIdentityShape",
  "sourceVector",
  "vectorHash",
  "approvalEnvelope",
  "confirmationAssumptions",
  "durableStateAssumptions",
] as const);

export const SIMULATION_CURATED_ADMISSION_PLANNER_DESCRIPTOR_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
export const SIMULATION_CURATED_ADMISSION_PLANNER_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const SIMULATION_CURATED_ADMISSION_PLANNER_COMMIT_PATTERN =
  /^[0-9a-f]{40}$/;
export const SIMULATION_CURATED_ADMISSION_PLANNER_SHA256_PATTERN =
  /^sha256:[0-9a-f]{64}$/;
export const SIMULATION_CURATED_ADMISSION_PLANNER_MARKET_PATTERN =
  /^[a-z][a-z0-9._:-]{0,19}$/;
export const SIMULATION_CURATED_ADMISSION_PLANNER_TICKER_PATTERN =
  /^[A-Z0-9][A-Z0-9._:-]{0,49}$/;
export const SIMULATION_CURATED_ADMISSION_PLANNER_CHALLENGE_LABEL_PATTERN =
  /^[A-Za-z0-9._:-]{1,64}$/;

type ComparableInstrument = Readonly<{
  market: string;
  currency: string;
  ticker: string;
}>;

export function compareSimulationCuratedAdmissionInstruments(
  left: ComparableInstrument,
  right: ComparableInstrument,
) {
  return (
    compareAscii(left.market, right.market) ||
    compareAscii(left.currency, right.currency) ||
    compareAscii(left.ticker, right.ticker)
  );
}

function compareAscii(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
