declare const opaqueProviderSubjectBrand: unique symbol;

export type OpaqueProviderSubject = string & {
  readonly [opaqueProviderSubjectBrand]: true;
};

export type VerifiedProviderSubjectPort =
  | Readonly<{ state: "missing" }>
  | Readonly<{ state: "unverified" }>
  | Readonly<{
      state: "verified";
      provider: string;
      subject: OpaqueProviderSubject;
      verificationSource: "server_verified_session";
    }>;

export type ReviewedAppUserTargetPort =
  | Readonly<{ state: "missing" }>
  | Readonly<{ state: "ambiguous" }>
  | Readonly<{
      state: "reviewed";
      appUserId: string;
      appUserStatus: "provisioning" | "active" | "disabled";
      appUserRole: "user" | "admin";
      candidateCount: number;
      reviewSource: "explicit_review";
    }>;

export type ExistingIdentityLinkEvidence = Readonly<{
  provider: string;
  subject: string;
  appUserId: string;
  status: "active" | "disabled";
}>;

export type IdentityLinkBlockedReason =
  | "verified_provider_subject_required"
  | "reviewed_target_required"
  | "target_cardinality_mismatch"
  | "target_review_source_invalid"
  | "target_uuid_invalid"
  | "target_status_not_provisioning"
  | "target_role_not_user"
  | "identity_evidence_invalid"
  | "duplicate_identity_evidence"
  | "provider_subject_collision"
  | "target_provider_collision"
  | "existing_link_disabled";

export type InitialIdentityLinkPlan = Readonly<{
  outcome: "planned_link" | "already_linked" | "blocked";
  reason: IdentityLinkBlockedReason | null;
  appUserMutation: "none";
  identityDmlEnabled: false;
}>;

export type PublicInitialIdentityLinkPlan = Readonly<{
  outcome: InitialIdentityLinkPlan["outcome"];
  reason: IdentityLinkBlockedReason | null;
}>;

export type InitialIdentityLinkPlannerInput = Readonly<{
  providerSubject: VerifiedProviderSubjectPort;
  reviewedTarget: ReviewedAppUserTargetPort;
  existingLinks: readonly ExistingIdentityLinkEvidence[];
}>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function prepareVerifiedProviderSubjectPort(input: Readonly<{
  provider?: string | null;
  subject?: string | null;
  verified: boolean;
}>): VerifiedProviderSubjectPort {
  const provider = normalizeProvider(input.provider);
  const subject = normalizeSubject(input.subject);

  if (provider === null || subject === null) {
    return Object.freeze({ state: "missing" });
  }
  if (!input.verified) {
    return Object.freeze({ state: "unverified" });
  }

  return Object.freeze({
    state: "verified",
    provider,
    subject: subject as OpaqueProviderSubject,
    verificationSource: "server_verified_session",
  });
}

export function planInitialIdentityLink(
  input: InitialIdentityLinkPlannerInput,
): InitialIdentityLinkPlan {
  const { providerSubject, reviewedTarget } = input;

  if (providerSubject.state !== "verified") {
    return blocked("verified_provider_subject_required");
  }
  const provider = normalizeProvider(providerSubject.provider);
  const subject = normalizeSubject(providerSubject.subject);
  if (
    provider === null ||
    subject === null ||
    provider !== providerSubject.provider ||
    subject !== providerSubject.subject ||
    providerSubject.verificationSource !== "server_verified_session"
  ) {
    return blocked("verified_provider_subject_required");
  }
  if (reviewedTarget.state !== "reviewed") {
    return blocked("reviewed_target_required");
  }
  if (
    !Number.isSafeInteger(reviewedTarget.candidateCount) ||
    reviewedTarget.candidateCount !== 1
  ) {
    return blocked("target_cardinality_mismatch");
  }
  if (reviewedTarget.reviewSource !== "explicit_review") {
    return blocked("target_review_source_invalid");
  }

  const targetAppUserId = normalizeUuid(reviewedTarget.appUserId);
  if (targetAppUserId === null) return blocked("target_uuid_invalid");
  if (reviewedTarget.appUserStatus !== "provisioning") {
    return blocked("target_status_not_provisioning");
  }
  if (reviewedTarget.appUserRole !== "user") {
    return blocked("target_role_not_user");
  }

  if (!Array.isArray(input.existingLinks)) {
    return blocked("identity_evidence_invalid");
  }
  const normalizedLinks = input.existingLinks.map(normalizeExistingLink);
  if (normalizedLinks.some((link) => link === null)) {
    return blocked("identity_evidence_invalid");
  }
  const links = normalizedLinks.filter(
    (link): link is NormalizedIdentityLink => link !== null,
  );
  if (hasDuplicateEvidence(links)) {
    return blocked("duplicate_identity_evidence");
  }

  const exactLinks = links.filter(
    (link) =>
      link.provider === provider && link.subject === subject,
  );
  if (exactLinks.length > 1) {
    return blocked("duplicate_identity_evidence");
  }

  const targetProviderActiveLinks = links.filter(
    (link) =>
      link.provider === provider &&
      link.appUserId === targetAppUserId &&
      link.status === "active",
  );
  if (targetProviderActiveLinks.length > 1) {
    return blocked("duplicate_identity_evidence");
  }

  const exactLink = exactLinks[0];
  if (exactLink) {
    if (exactLink.appUserId !== targetAppUserId) {
      return blocked("provider_subject_collision");
    }
    if (exactLink.status !== "active") {
      return blocked("existing_link_disabled");
    }
    if (
      targetProviderActiveLinks.length !== 1 ||
      targetProviderActiveLinks[0] !== exactLink
    ) {
      return blocked("duplicate_identity_evidence");
    }
    return allowed("already_linked");
  }

  if (targetProviderActiveLinks.length !== 0) {
    return blocked("target_provider_collision");
  }

  return allowed("planned_link");
}

export function projectInitialIdentityLinkPlanForBoundary(
  plan: InitialIdentityLinkPlan,
): PublicInitialIdentityLinkPlan {
  return Object.freeze({ outcome: plan.outcome, reason: plan.reason });
}

type NormalizedIdentityLink = Readonly<{
  provider: string;
  subject: string;
  appUserId: string;
  status: "active" | "disabled";
}>;

function normalizeExistingLink(
  link: ExistingIdentityLinkEvidence,
): NormalizedIdentityLink | null {
  if (!link || typeof link !== "object") return null;
  const provider = normalizeProvider(link.provider);
  const subject = normalizeSubject(link.subject);
  const appUserId = normalizeUuid(link.appUserId);
  if (
    provider === null ||
    subject === null ||
    appUserId === null ||
    (link.status !== "active" && link.status !== "disabled")
  ) {
    return null;
  }
  return Object.freeze({ provider, subject, appUserId, status: link.status });
}

function hasDuplicateEvidence(links: readonly NormalizedIdentityLink[]) {
  const identities = new Set<string>();
  for (const link of links) {
    const identity = [
      link.provider,
      link.subject,
      link.appUserId,
      link.status,
    ].join("\u0000");
    if (identities.has(identity)) return true;
    identities.add(identity);
  }
  return false;
}

function normalizeProvider(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized ? normalized : null;
}

function normalizeSubject(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeUuid(value: string) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function allowed(
  outcome: "planned_link" | "already_linked",
): InitialIdentityLinkPlan {
  return Object.freeze({
    outcome,
    reason: null,
    appUserMutation: "none",
    identityDmlEnabled: false,
  });
}

function blocked(reason: IdentityLinkBlockedReason): InitialIdentityLinkPlan {
  return Object.freeze({
    outcome: "blocked",
    reason,
    appUserMutation: "none",
    identityDmlEnabled: false,
  });
}
