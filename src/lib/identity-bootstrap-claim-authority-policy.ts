export const IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY = Object.freeze({
  policyId: "preissued_bootstrap_claim_authority_v1",
  provider: "neon_auth",
  claimDigestVersion: "bootstrap_claim_sha256_v1",
  targetReviewPolicyId: "single_provisioning_user_explicit_review_v1",
  subjectBindingVersion: "provider_subject_hmac_sha256_v1",
  identityLinkPlannerPolicyId: "initial_identity_link_planner_v1",
  identityLinkPlanBindingVersion: "identity_link_plan_hmac_sha256_v1",
  maxIntentLifetimeMs: 10 * 60 * 1000,
  authorizationSource: "preissued_bootstrap_claim",
  intentPersistence: "server_durable_single_use_record",
} as const);

export type BootstrapClaimAuthorizationSource =
  | "preissued_bootstrap_claim"
  | "verified_subject_session"
  | "basic_auth"
  | "machine_secret"
  | "request_target";

export function canAuthorizeIdentityBootstrapClaim(
  source: BootstrapClaimAuthorizationSource,
) {
  return (
    source ===
    IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.authorizationSource
  );
}
