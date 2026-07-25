import {
  canAuthorizeIdentityPairing,
  canTransportIdentityPairingChallenge,
  IDENTITY_PAIRING_AUTHORITY_POLICY,
  type PairingChallengeTransport,
  type PairingOperatorAuthorizationSource,
} from "./identity-pairing-authority-policy.ts";

export type PairingOperatorAuthorityPort =
  | Readonly<{ state: "missing" | "unauthorized" }>
  | Readonly<{
      state: "authorized";
      authorizationSource: PairingOperatorAuthorizationSource;
      actorSeparation: "verified_distinct" | "not_verified";
      operatorBindingVersion: "operator_session_hmac_sha256_v1";
      operatorBinding: string;
      reviewedTargetAppUserId: string;
    }>;

export type VerifiedPairingSubjectBindingPort =
  | Readonly<{ state: "missing" | "unverified" }>
  | Readonly<{
      state: "verified";
      provider: string;
      subjectBindingVersion: "provider_subject_hmac_sha256_v1";
      subjectBinding: string;
      verificationSource: "server_verified_session";
    }>;

export type PairingReviewedTargetPort =
  | Readonly<{ state: "missing" | "ambiguous" }>
  | Readonly<{
      state: "reviewed";
      appUserId: string;
      appUserStatus: "provisioning" | "active" | "disabled";
      appUserRole: "user" | "admin";
      candidateCount: number;
      reviewSource: "explicit_review";
    }>;

export type PairingIntentPort =
  | Readonly<{
      state: "missing" | "consumed" | "revoked" | "expired";
    }>
  | Readonly<{
      state: "pending";
      intentId: string;
      provider: string;
      subjectBindingVersion: "provider_subject_hmac_sha256_v1";
      subjectBinding: string;
      operatorBindingVersion: "operator_session_hmac_sha256_v1";
      operatorBinding: string;
      targetAppUserId: string;
      identityLinkPlannerPolicyId: "initial_identity_link_planner_v1";
      identityLinkPlanBindingVersion: "identity_link_plan_hmac_sha256_v1";
      identityLinkPlanBinding: string;
      issuedAt: string;
      expiresAt: string;
      persistence: "server_durable_single_use_record";
      challengeTransport: PairingChallengeTransport;
    }>;

export type IdentityLinkDryRunEvidence = Readonly<{
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
}>;

export type IdentityPairingAuthorityBlockedReason =
  | "operator_authority_required"
  | "operator_authority_invalid"
  | "operator_subject_separation_required"
  | "operator_binding_required"
  | "verified_subject_binding_required"
  | "reviewed_target_required"
  | "reviewed_target_invalid"
  | "operator_target_mismatch"
  | "pairing_intent_required"
  | "pairing_intent_consumed"
  | "pairing_intent_revoked"
  | "pairing_intent_expired"
  | "pairing_intent_invalid"
  | "pairing_intent_binding_mismatch"
  | "pairing_intent_not_yet_valid"
  | "pairing_intent_lifetime_exceeded"
  | "identity_link_plan_invalid"
  | "identity_link_plan_binding_mismatch"
  | "identity_link_plan_blocked"
  | "identity_already_linked";

export type IdentityPairingAuthorityPlan = Readonly<{
  outcome: "synthetic_dry_run_ready" | "blocked";
  reason: IdentityPairingAuthorityBlockedReason | null;
  policyId: "identity_pairing_authority_v1";
  runtimeTrustStatus: "not_established";
  identityDmlEnabled: false;
  intentConsumptionEnabled: false;
  appUserMutation: "none";
}>;

export type PublicIdentityPairingAuthorityPlan = Readonly<{
  outcome: IdentityPairingAuthorityPlan["outcome"];
  reason: IdentityPairingAuthorityPlan["reason"];
}>;

export type IdentityPairingAuthorityInput = Readonly<{
  operator: PairingOperatorAuthorityPort;
  subjectSession: VerifiedPairingSubjectBindingPort;
  reviewedTarget: PairingReviewedTargetPort;
  pairingIntent: PairingIntentPort;
  identityLinkPlan: IdentityLinkDryRunEvidence;
  evaluationTime: string;
}>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUBJECT_BINDING_PATTERN =
  /^hmac-sha256-v1:[0-9a-f]{64}$/;
const OPERATOR_BINDING_PATTERN =
  /^operator-hmac-sha256-v1:[0-9a-f]{64}$/;
const IDENTITY_LINK_PLAN_BINDING_PATTERN =
  /^identity-link-plan-hmac-sha256-v1:[0-9a-f]{64}$/;

export function planIdentityPairingAuthority(
  input: IdentityPairingAuthorityInput,
): IdentityPairingAuthorityPlan {
  const operator = readAuthorizedOperator(input.operator);
  if (operator === null) {
    if (
      input.operator.state === "authorized" &&
      input.operator.actorSeparation !==
        IDENTITY_PAIRING_AUTHORITY_POLICY.operatorSeparation
    ) {
      return blocked("operator_subject_separation_required");
    }
    if (
      input.operator.state === "authorized" &&
      (input.operator.operatorBindingVersion !==
        IDENTITY_PAIRING_AUTHORITY_POLICY.operatorBindingVersion ||
        !OPERATOR_BINDING_PATTERN.test(input.operator.operatorBinding))
    ) {
      return blocked("operator_binding_required");
    }
    return blocked(
      input.operator.state === "authorized"
        ? "operator_authority_invalid"
        : "operator_authority_required",
    );
  }

  const subject = readVerifiedSubjectBinding(input.subjectSession);
  if (subject === null) {
    return blocked("verified_subject_binding_required");
  }

  const target = readReviewedTarget(input.reviewedTarget);
  if (target === null) {
    return blocked(
      input.reviewedTarget.state === "reviewed"
        ? "reviewed_target_invalid"
        : "reviewed_target_required",
    );
  }
  if (operator.targetAppUserId !== target) {
    return blocked("operator_target_mismatch");
  }

  const lifecycleFailure = readIntentLifecycleFailure(input.pairingIntent);
  if (lifecycleFailure !== null) return blocked(lifecycleFailure);
  if (input.pairingIntent.state !== "pending") {
    return blocked("pairing_intent_required");
  }

  const intent = input.pairingIntent;
  if (!isValidPendingIntent(intent)) {
    return blocked("pairing_intent_invalid");
  }
  if (
    intent.provider !== subject.provider ||
    intent.subjectBindingVersion !== subject.subjectBindingVersion ||
    intent.subjectBinding !== subject.subjectBinding ||
    intent.operatorBindingVersion !== operator.operatorBindingVersion ||
    intent.operatorBinding !== operator.operatorBinding ||
    normalizeUuid(intent.targetAppUserId) !== target
  ) {
    return blocked("pairing_intent_binding_mismatch");
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
    return blocked("pairing_intent_invalid");
  }
  if (
    expiresAt - issuedAt >
    IDENTITY_PAIRING_AUTHORITY_POLICY.maxIntentLifetimeMs
  ) {
    return blocked("pairing_intent_lifetime_exceeded");
  }
  if (evaluationTime < issuedAt) {
    return blocked("pairing_intent_not_yet_valid");
  }
  if (evaluationTime >= expiresAt) {
    return blocked("pairing_intent_expired");
  }

  const identityLinkPlan = input.identityLinkPlan;
  if (!isValidIdentityLinkPlanEvidence(identityLinkPlan)) {
    return blocked("identity_link_plan_invalid");
  }
  if (
    identityLinkPlan.provider !== subject.provider ||
    identityLinkPlan.subjectBindingVersion !== subject.subjectBindingVersion ||
    identityLinkPlan.subjectBinding !== subject.subjectBinding ||
    normalizeUuid(identityLinkPlan.targetAppUserId) !== target ||
    intent.identityLinkPlannerPolicyId !== identityLinkPlan.plannerPolicyId ||
    intent.identityLinkPlanBindingVersion !==
      identityLinkPlan.planBindingVersion ||
    intent.identityLinkPlanBinding !== identityLinkPlan.planBinding
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
    policyId: IDENTITY_PAIRING_AUTHORITY_POLICY.policyId,
    runtimeTrustStatus: "not_established",
    identityDmlEnabled: false,
    intentConsumptionEnabled: false,
    appUserMutation: "none",
  });
}

export function projectIdentityPairingAuthorityPlan(
  plan: IdentityPairingAuthorityPlan,
): PublicIdentityPairingAuthorityPlan {
  return Object.freeze({ outcome: plan.outcome, reason: plan.reason });
}

function readAuthorizedOperator(port: PairingOperatorAuthorityPort) {
  if (
    port.state !== "authorized" ||
    !canAuthorizeIdentityPairing(port.authorizationSource) ||
    port.actorSeparation !==
      IDENTITY_PAIRING_AUTHORITY_POLICY.operatorSeparation ||
    port.operatorBindingVersion !==
      IDENTITY_PAIRING_AUTHORITY_POLICY.operatorBindingVersion ||
    !OPERATOR_BINDING_PATTERN.test(port.operatorBinding)
  ) {
    return null;
  }
  const targetAppUserId = normalizeUuid(port.reviewedTargetAppUserId);
  if (targetAppUserId === null) return null;
  return Object.freeze({
    targetAppUserId,
    operatorBindingVersion: port.operatorBindingVersion,
    operatorBinding: port.operatorBinding,
  });
}

function readVerifiedSubjectBinding(
  port: VerifiedPairingSubjectBindingPort,
) {
  if (
    port.state !== "verified" ||
    port.provider !== IDENTITY_PAIRING_AUTHORITY_POLICY.provider ||
    port.subjectBindingVersion !==
      IDENTITY_PAIRING_AUTHORITY_POLICY.subjectBindingVersion ||
    port.verificationSource !== "server_verified_session" ||
    !SUBJECT_BINDING_PATTERN.test(port.subjectBinding)
  ) {
    return null;
  }
  return port;
}

function readReviewedTarget(port: PairingReviewedTargetPort) {
  if (
    port.state !== "reviewed" ||
    port.candidateCount !== 1 ||
    port.reviewSource !== "explicit_review" ||
    port.appUserStatus !== "provisioning" ||
    port.appUserRole !== "user"
  ) {
    return null;
  }
  return normalizeUuid(port.appUserId);
}

function readIntentLifecycleFailure(
  intent: PairingIntentPort,
): IdentityPairingAuthorityBlockedReason | null {
  if (intent.state === "missing") return "pairing_intent_required";
  if (intent.state === "consumed") return "pairing_intent_consumed";
  if (intent.state === "revoked") return "pairing_intent_revoked";
  if (intent.state === "expired") return "pairing_intent_expired";
  return null;
}

function isValidPendingIntent(
  intent: Extract<PairingIntentPort, { state: "pending" }>,
) {
  return (
    normalizeUuid(intent.intentId) !== null &&
    intent.provider === IDENTITY_PAIRING_AUTHORITY_POLICY.provider &&
    intent.subjectBindingVersion ===
      IDENTITY_PAIRING_AUTHORITY_POLICY.subjectBindingVersion &&
    SUBJECT_BINDING_PATTERN.test(intent.subjectBinding) &&
    intent.operatorBindingVersion ===
      IDENTITY_PAIRING_AUTHORITY_POLICY.operatorBindingVersion &&
    OPERATOR_BINDING_PATTERN.test(intent.operatorBinding) &&
    normalizeUuid(intent.targetAppUserId) !== null &&
    intent.identityLinkPlannerPolicyId ===
      IDENTITY_PAIRING_AUTHORITY_POLICY.identityLinkPlannerPolicyId &&
    intent.identityLinkPlanBindingVersion ===
      IDENTITY_PAIRING_AUTHORITY_POLICY.identityLinkPlanBindingVersion &&
    IDENTITY_LINK_PLAN_BINDING_PATTERN.test(
      intent.identityLinkPlanBinding,
    ) &&
    intent.persistence ===
      IDENTITY_PAIRING_AUTHORITY_POLICY.intentPersistence &&
    canTransportIdentityPairingChallenge(intent.challengeTransport)
  );
}

function isValidIdentityLinkPlanEvidence(
  evidence: IdentityLinkDryRunEvidence,
) {
  return (
    evidence.identityDmlEnabled === false &&
    evidence.appUserMutation === "none" &&
    evidence.plannerPolicyId ===
      IDENTITY_PAIRING_AUTHORITY_POLICY.identityLinkPlannerPolicyId &&
    evidence.provider === IDENTITY_PAIRING_AUTHORITY_POLICY.provider &&
    evidence.subjectBindingVersion ===
      IDENTITY_PAIRING_AUTHORITY_POLICY.subjectBindingVersion &&
    SUBJECT_BINDING_PATTERN.test(evidence.subjectBinding) &&
    normalizeUuid(evidence.targetAppUserId) !== null &&
    evidence.planBindingVersion ===
      IDENTITY_PAIRING_AUTHORITY_POLICY.identityLinkPlanBindingVersion &&
    IDENTITY_LINK_PLAN_BINDING_PATTERN.test(evidence.planBinding)
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
  reason: IdentityPairingAuthorityBlockedReason,
): IdentityPairingAuthorityPlan {
  return Object.freeze({
    outcome: "blocked",
    reason,
    policyId: IDENTITY_PAIRING_AUTHORITY_POLICY.policyId,
    runtimeTrustStatus: "not_established",
    identityDmlEnabled: false,
    intentConsumptionEnabled: false,
    appUserMutation: "none",
  });
}
