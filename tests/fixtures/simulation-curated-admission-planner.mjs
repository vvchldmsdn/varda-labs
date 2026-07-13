export const SYNTHETIC_CURATED_ADMISSION_OWNER_ID =
  "11111111-1111-4111-8111-111111111111";

export const SYNTHETIC_CURATED_ADMISSION_V2_DIGEST =
  "sha256:80282313cbdf944335ad0136fe9fa7120bacd8e95dcc159fd8472f215d9aabc1";

export const SYNTHETIC_CURATED_ADMISSION_ENVELOPE_DIGEST =
  "sha256:850fc98f8f0155dd8e0379513323105f8d998050346895b3fd24695b57f58527";

export const SYNTHETIC_CURATED_ADMISSION_ENVELOPE_JSON =
  '{"approvalEnvelopeDigestVersion":"curated_vector_approval_envelope_digest_v1","actorMode":"tenant_self_approval_v1","confirmationPolicyId":"curated_vector_self_confirmation_v1","intent":"initial_approval","ownerUserId":"11111111-1111-4111-8111-111111111111","portfolioPathPolicyId":"gross_normalized_buy_and_hold_v1","gate0ApprovalCommit":"652b9ea9c9b48f51dc4c68e8f148132ca8893d7e","scenarioId":"synthetic-punctuation-order","scenarioVersion":"v2-fixture-1","vectorHashVersion":"simulation_scenario_vector_hash_v2","scenarioVectorHash":"sha256:80282313cbdf944335ad0136fe9fa7120bacd8e95dcc159fd8472f215d9aabc1","vector":[{"market":"us","currency":"USD","ticker":"A.B","weightBps":5000},{"market":"us","currency":"USD","ticker":"A:B","weightBps":5000}]}';

export function createSyntheticCuratedAdmissionPlannerInput(overrides = {}) {
  const base = {
    policyEvidence: {
      evidenceSource: "caller_supplied_synthetic_unverified",
      plannerPolicyId: "curated_vector_synthetic_admission_planner_v1",
      plannerPolicyVersion: 1,
      actorMode: "tenant_self_approval_v1",
      confirmationPolicyId: "curated_vector_self_confirmation_v1",
      portfolioPathPolicyId: "gross_normalized_buy_and_hold_v1",
      gate0ApprovalCommit: "652b9ea9c9b48f51dc4c68e8f148132ca8893d7e",
      vectorHashVersion: "simulation_scenario_vector_hash_v2",
      approvalEnvelopeDigestVersion:
        "curated_vector_approval_envelope_digest_v1",
    },
    actorAssumptions: {
      sessionAssumption: "verified_active",
      identityMappingAssumption: "exactly_one_active",
      appUserAssumption: "active",
      actorOwnerAssumption: "same_canonical_owner",
      syntheticOwnerUserId: SYNTHETIC_CURATED_ADMISSION_OWNER_ID,
    },
    exactIdentity: {
      ownerUserId: SYNTHETIC_CURATED_ADMISSION_OWNER_ID,
      portfolioPathPolicyId: "gross_normalized_buy_and_hold_v1",
      gate0ApprovalCommit: "652b9ea9c9b48f51dc4c68e8f148132ca8893d7e",
      scenarioId: "synthetic-punctuation-order",
      scenarioVersion: "v2-fixture-1",
      intent: "initial_approval",
    },
    vector: [
      { market: "us", currency: "USD", ticker: "A.B", weightBps: 5_000 },
      { market: "us", currency: "USD", ticker: "A:B", weightBps: 5_000 },
    ],
    scenarioVectorHash: SYNTHETIC_CURATED_ADMISSION_V2_DIGEST,
    confirmationAssumptions: {
      state: "pending",
      ownerBindingAssumption: "matches",
      expectedChallengeInstanceLabel: "synthetic-challenge-1",
      presentedChallengeInstanceLabel: "synthetic-challenge-1",
      expectedApprovalEnvelopeDigest:
        SYNTHETIC_CURATED_ADMISSION_ENVELOPE_DIGEST,
      presentedApprovalEnvelopeDigest:
        SYNTHETIC_CURATED_ADMISSION_ENVELOPE_DIGEST,
      issuedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-01T00:10:00.000Z",
      syntheticEvaluationTime: "2026-01-01T00:05:00.000Z",
    },
    durableStateAssumptions: {
      approvalRevisionAssumption: "no_prior_revision",
      competingChallengeAssumption: "none",
    },
  };

  return {
    policyEvidence: {
      ...base.policyEvidence,
      ...overrides.policyEvidence,
    },
    actorAssumptions: {
      ...base.actorAssumptions,
      ...overrides.actorAssumptions,
    },
    exactIdentity: {
      ...base.exactIdentity,
      ...overrides.exactIdentity,
    },
    vector: Object.hasOwn(overrides, "vector")
      ? overrides.vector
      : base.vector.map((row) => ({ ...row })),
    scenarioVectorHash: Object.hasOwn(overrides, "scenarioVectorHash")
      ? overrides.scenarioVectorHash
      : base.scenarioVectorHash,
    confirmationAssumptions: {
      ...base.confirmationAssumptions,
      ...overrides.confirmationAssumptions,
    },
    durableStateAssumptions: {
      ...base.durableStateAssumptions,
      ...overrides.durableStateAssumptions,
    },
  };
}

export function createSyntheticCuratedAdmissionRows(count, zeroRows = false) {
  return Array.from({ length: count }, (_, index) => ({
    market: "us",
    currency: "USD",
    ticker: `T${String(index).padStart(2, "0")}`,
    weightBps: zeroRows ? (index === 0 ? 10_000 : 0) : index === 0 ? 10_001 - count : 1,
  }));
}
