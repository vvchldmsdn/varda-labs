import {
  canAuthorizeIdentityBootstrapClaim,
  IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY,
  type BootstrapClaimAuthorizationSource,
} from "./identity-bootstrap-claim-authority-policy.ts";

export type VerifiedBootstrapClaimPort =
  | Readonly<{ state: "missing" | "unverified" }>
  | Readonly<{
      state: "verified";
      authorizationSource: BootstrapClaimAuthorizationSource;
      claimDigestVersion: "bootstrap_claim_sha256_v1";
      claimDigest: string;
      verificationSource: "server_verified_claim_digest";
    }>;

export type VerifiedBootstrapSubjectPort =
  | Readonly<{ state: "missing" | "unverified" }>
  | Readonly<{
      state: "verified";
      provider: string;
      subjectBindingVersion: "provider_subject_hmac_sha256_v1";
      subjectBinding: string;
      verificationSource: "server_verified_session";
    }>;

export type ReviewedBootstrapTargetPort =
  | Readonly<{ state: "missing" | "ambiguous" }>
  | Readonly<{
      state: "reviewed";
      appUserId: string;
      appUserStatus: "provisioning" | "active" | "disabled";
      appUserRole: "user" | "admin";
      candidateCount: number;
      reviewSource: "explicit_review";
      targetReviewPolicyId:
        "single_provisioning_user_explicit_review_v1";
    }>;

export type BootstrapClaimIntentPort =
  | Readonly<{
      state: "missing" | "consumed" | "revoked" | "expired";
    }>
  | Readonly<{
      state: "pending";
      intentId: string;
      authorityPolicyId: "preissued_bootstrap_claim_authority_v1";
      targetAppUserId: string;
      provider: string;
      claimDigestVersion: "bootstrap_claim_sha256_v1";
      claimDigest: string;
      targetReviewPolicyId:
        "single_provisioning_user_explicit_review_v1";
      issuedAt: string;
      expiresAt: string;
      persistence: "server_durable_single_use_record";
    }>;

export type BootstrapIdentityLinkPlanPort =
  | Readonly<{ state: "missing" | "unverified" }>
  | Readonly<{
      state: "verified";
      outcome: "planned_link" | "already_linked" | "blocked";
      identityDmlEnabled: false;
      appUserMutation: "none";
      plannerPolicyId: "initial_identity_link_planner_v1";
      provider: string;
      subjectBindingVersion: "provider_subject_hmac_sha256_v1";
      subjectBinding: string;
      targetAppUserId: string;
      planBindingVersion: "identity_link_plan_hmac_sha256_v1";
      planBinding: string;
      commitmentSource: "server_verified_g1a_commitment";
    }>;

export type IdentityBootstrapClaimBlockedReason =
  | "verified_claim_required"
  | "verified_claim_invalid"
  | "verified_subject_required"
  | "reviewed_target_required"
  | "reviewed_target_invalid"
  | "claim_intent_required"
  | "claim_intent_consumed"
  | "claim_intent_revoked"
  | "claim_intent_expired"
  | "claim_intent_invalid"
  | "claim_intent_binding_mismatch"
  | "claim_intent_not_yet_valid"
  | "claim_intent_lifetime_exceeded"
  | "identity_link_plan_required"
  | "identity_link_plan_invalid"
  | "identity_link_plan_binding_mismatch"
  | "identity_link_plan_blocked"
  | "identity_already_linked";

export type IdentityBootstrapClaimPlan = Readonly<{
  outcome: "synthetic_dry_run_ready" | "blocked";
  reason: IdentityBootstrapClaimBlockedReason | null;
  policyId: "preissued_bootstrap_claim_authority_v1";
  runtimeTrustStatus: "not_established";
  identityDmlEnabled: false;
  intentConsumptionEnabled: false;
  appUserMutation: "none";
}>;

export type PublicIdentityBootstrapClaimPlan = Readonly<{
  outcome: IdentityBootstrapClaimPlan["outcome"];
  reason: IdentityBootstrapClaimPlan["reason"];
}>;

export type IdentityBootstrapClaimInput = Readonly<{
  claim: VerifiedBootstrapClaimPort;
  subjectSession: VerifiedBootstrapSubjectPort;
  reviewedTarget: ReviewedBootstrapTargetPort;
  claimIntent: BootstrapClaimIntentPort;
  identityLinkPlan: BootstrapIdentityLinkPlanPort;
  evaluationTime: string;
}>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLAIM_DIGEST_PATTERN =
  /^bootstrap-claim-sha256-v1:[0-9a-f]{64}$/;
const SUBJECT_BINDING_PATTERN =
  /^hmac-sha256-v1:[0-9a-f]{64}$/;
const PLAN_BINDING_PATTERN =
  /^identity-link-plan-hmac-sha256-v1:[0-9a-f]{64}$/;

export function planIdentityBootstrapClaim(
  input: IdentityBootstrapClaimInput,
): IdentityBootstrapClaimPlan {
  const claim = readVerifiedClaim(input.claim);
  if (claim === null) {
    return blocked(
      input.claim.state === "verified"
        ? "verified_claim_invalid"
        : "verified_claim_required",
    );
  }

  const subject = readVerifiedSubject(input.subjectSession);
  if (subject === null) return blocked("verified_subject_required");

  const target = readReviewedTarget(input.reviewedTarget);
  if (target === null) {
    return blocked(
      input.reviewedTarget.state === "reviewed"
        ? "reviewed_target_invalid"
        : "reviewed_target_required",
    );
  }

  const lifecycleFailure = readIntentLifecycleFailure(input.claimIntent);
  if (lifecycleFailure !== null) return blocked(lifecycleFailure);
  if (input.claimIntent.state !== "pending") {
    return blocked("claim_intent_required");
  }

  const intent = input.claimIntent;
  if (!isValidPendingIntent(intent)) {
    return blocked("claim_intent_invalid");
  }
  if (
    intent.claimDigestVersion !== claim.claimDigestVersion ||
    intent.claimDigest !== claim.claimDigest ||
    intent.provider !== subject.provider ||
    normalizeUuid(intent.targetAppUserId) !== target ||
    intent.targetReviewPolicyId !==
      IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.targetReviewPolicyId
  ) {
    return blocked("claim_intent_binding_mismatch");
  }

  const issuedAt = parseStrictUtcInstant(intent.issuedAt);
  const expiresAt = parseStrictUtcInstant(intent.expiresAt);
  const evaluationTime = parseStrictUtcInstant(input.evaluationTime);
  if (
    issuedAt === null ||
    expiresAt === null ||
    evaluationTime === null ||
    expiresAt <= issuedAt
  ) {
    return blocked("claim_intent_invalid");
  }
  if (
    expiresAt - issuedAt >
    IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.maxIntentLifetimeMs
  ) {
    return blocked("claim_intent_lifetime_exceeded");
  }
  if (evaluationTime < issuedAt) {
    return blocked("claim_intent_not_yet_valid");
  }
  if (evaluationTime >= expiresAt) {
    return blocked("claim_intent_expired");
  }

  const identityLinkPlan = input.identityLinkPlan;
  if (identityLinkPlan.state !== "verified") {
    return blocked("identity_link_plan_required");
  }
  if (!isValidIdentityLinkPlan(identityLinkPlan)) {
    return blocked("identity_link_plan_invalid");
  }
  if (
    identityLinkPlan.provider !== subject.provider ||
    identityLinkPlan.subjectBindingVersion !==
      subject.subjectBindingVersion ||
    identityLinkPlan.subjectBinding !== subject.subjectBinding ||
    normalizeUuid(identityLinkPlan.targetAppUserId) !== target
  ) {
    return blocked("identity_link_plan_binding_mismatch");
  }
  if (identityLinkPlan.outcome === "already_linked") {
    return blocked("identity_already_linked");
  }
  if (identityLinkPlan.outcome !== "planned_link") {
    return blocked("identity_link_plan_blocked");
  }

  return Object.freeze({
    outcome: "synthetic_dry_run_ready",
    reason: null,
    policyId: IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.policyId,
    runtimeTrustStatus: "not_established",
    identityDmlEnabled: false,
    intentConsumptionEnabled: false,
    appUserMutation: "none",
  });
}

export function projectIdentityBootstrapClaimPlan(
  plan: IdentityBootstrapClaimPlan,
): PublicIdentityBootstrapClaimPlan {
  return Object.freeze({ outcome: plan.outcome, reason: plan.reason });
}

function readVerifiedClaim(port: VerifiedBootstrapClaimPort) {
  if (
    port.state !== "verified" ||
    !canAuthorizeIdentityBootstrapClaim(port.authorizationSource) ||
    port.claimDigestVersion !==
      IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.claimDigestVersion ||
    !CLAIM_DIGEST_PATTERN.test(port.claimDigest) ||
    port.verificationSource !== "server_verified_claim_digest"
  ) {
    return null;
  }
  return port;
}

function readVerifiedSubject(port: VerifiedBootstrapSubjectPort) {
  if (
    port.state !== "verified" ||
    port.provider !== IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.provider ||
    port.subjectBindingVersion !==
      IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.subjectBindingVersion ||
    !SUBJECT_BINDING_PATTERN.test(port.subjectBinding) ||
    port.verificationSource !== "server_verified_session"
  ) {
    return null;
  }
  return port;
}

function readReviewedTarget(port: ReviewedBootstrapTargetPort) {
  if (
    port.state !== "reviewed" ||
    port.candidateCount !== 1 ||
    port.reviewSource !== "explicit_review" ||
    port.targetReviewPolicyId !==
      IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.targetReviewPolicyId ||
    port.appUserStatus !== "provisioning" ||
    port.appUserRole !== "user"
  ) {
    return null;
  }
  return normalizeUuid(port.appUserId);
}

function readIntentLifecycleFailure(
  intent: BootstrapClaimIntentPort,
): IdentityBootstrapClaimBlockedReason | null {
  if (intent.state === "missing") return "claim_intent_required";
  if (intent.state === "consumed") return "claim_intent_consumed";
  if (intent.state === "revoked") return "claim_intent_revoked";
  if (intent.state === "expired") return "claim_intent_expired";
  return null;
}

function isValidPendingIntent(
  intent: Extract<BootstrapClaimIntentPort, { state: "pending" }>,
) {
  return (
    normalizeUuid(intent.intentId) !== null &&
    intent.authorityPolicyId ===
      IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.policyId &&
    normalizeUuid(intent.targetAppUserId) !== null &&
    intent.provider === IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.provider &&
    intent.claimDigestVersion ===
      IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.claimDigestVersion &&
    CLAIM_DIGEST_PATTERN.test(intent.claimDigest) &&
    intent.targetReviewPolicyId ===
      IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.targetReviewPolicyId &&
    intent.persistence ===
      IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.intentPersistence
  );
}

function isValidIdentityLinkPlan(
  evidence: Extract<BootstrapIdentityLinkPlanPort, { state: "verified" }>,
) {
  return (
    evidence.commitmentSource === "server_verified_g1a_commitment" &&
    evidence.identityDmlEnabled === false &&
    evidence.appUserMutation === "none" &&
    evidence.plannerPolicyId ===
      IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.identityLinkPlannerPolicyId &&
    evidence.provider ===
      IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.provider &&
    evidence.subjectBindingVersion ===
      IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.subjectBindingVersion &&
    SUBJECT_BINDING_PATTERN.test(evidence.subjectBinding) &&
    normalizeUuid(evidence.targetAppUserId) !== null &&
    evidence.planBindingVersion ===
      IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.identityLinkPlanBindingVersion &&
    PLAN_BINDING_PATTERN.test(evidence.planBinding)
  );
}

function parseStrictUtcInstant(value: string) {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString() === value ? timestamp : null;
}

function normalizeUuid(value: string) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function blocked(
  reason: IdentityBootstrapClaimBlockedReason,
): IdentityBootstrapClaimPlan {
  return Object.freeze({
    outcome: "blocked",
    reason,
    policyId: IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.policyId,
    runtimeTrustStatus: "not_established",
    identityDmlEnabled: false,
    intentConsumptionEnabled: false,
    appUserMutation: "none",
  });
}
