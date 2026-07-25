export const IDENTITY_PAIRING_AUTHORITY_POLICY = Object.freeze({
  policyId: "identity_pairing_authority_v1",
  provider: "neon_auth",
  subjectBindingVersion: "provider_subject_hmac_sha256_v1",
  principalBindingVersion: "auth_principal_hmac_sha256_v1",
  operatorBindingVersion: "operator_session_hmac_sha256_v1",
  identityLinkPlannerPolicyId: "initial_identity_link_planner_v1",
  identityLinkPlanBindingVersion: "identity_link_plan_hmac_sha256_v1",
  maxIntentLifetimeMs: 10 * 60 * 1000,
  operatorAuthorizationSource: "server_verified_operator_session",
  intentPersistence: "server_durable_single_use_record",
  challengeTransport: "http_only_same_site_strict_cookie",
} as const);

export type PairingOperatorAuthorizationSource =
  | "server_verified_operator_session"
  | "preview_subject_session"
  | "basic_auth"
  | "machine_secret"
  | "request_claim";

export type PairingChallengeTransport =
  | "http_only_same_site_strict_cookie"
  | "url"
  | "request_body"
  | "request_header"
  | "local_storage";

export function canAuthorizeIdentityPairing(
  source: PairingOperatorAuthorizationSource,
) {
  return (
    source === IDENTITY_PAIRING_AUTHORITY_POLICY.operatorAuthorizationSource
  );
}

export function canTransportIdentityPairingChallenge(
  transport: PairingChallengeTransport,
) {
  return transport === IDENTITY_PAIRING_AUTHORITY_POLICY.challengeTransport;
}
