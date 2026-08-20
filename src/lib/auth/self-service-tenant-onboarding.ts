export const SELF_SERVICE_TENANT_ONBOARDING_POLICY = Object.freeze({
  policyId: "authenticated_empty_tenant_onboarding_v1",
  provider: "neon_auth",
  appUserStatus: "active",
  appUserRole: "user",
  identityStatus: "active",
  confirmationValue: "create_empty_portfolio",
  transactionIsolation: "read_committed",
  lockTimeoutMs: 2_000,
  statementTimeoutMs: 8_000,
  retryCount: 0,
} as const);

export type SelfServiceTenantOnboardingActionState = Readonly<{
  status:
    | "idle"
    | "success"
    | "already_ready"
    | "invalid"
    | "unauthorized"
    | "conflict"
    | "error";
  message: string;
}>;

export const INITIAL_SELF_SERVICE_TENANT_ONBOARDING_STATE = Object.freeze({
  status: "idle",
  message: "",
}) satisfies SelfServiceTenantOnboardingActionState;

export type SelfServiceTenantOnboardingWriteEvidence = Readonly<{
  existingIdentityCount: number;
  insertedAppUserCount: number;
  insertedIdentityCount: number;
  identityStatus: string | null;
  appUserStatus: string | null;
  appUserRole: string | null;
  mappedAppUserMatches: boolean | null;
}>;

export type SelfServiceTenantOnboardingWriteOutcome =
  | "created"
  | "already_ready"
  | "blocked";

export function parseSelfServiceTenantOnboardingInput(formData: FormData) {
  return formData.get("confirmation") ===
    SELF_SERVICE_TENANT_ONBOARDING_POLICY.confirmationValue
    ? Object.freeze({ ok: true as const })
    : Object.freeze({
        ok: false as const,
        message: "Confirm that you want to create a new empty portfolio.",
      });
}

export function classifySelfServiceTenantOnboardingWrite(
  evidence: SelfServiceTenantOnboardingWriteEvidence,
): SelfServiceTenantOnboardingWriteOutcome {
  if (
    evidence.existingIdentityCount === 0 &&
    evidence.insertedAppUserCount === 1 &&
    evidence.insertedIdentityCount === 1
  ) {
    return "created";
  }

  if (
    evidence.existingIdentityCount === 1 &&
    evidence.insertedAppUserCount === 0 &&
    evidence.insertedIdentityCount === 0 &&
    evidence.identityStatus === "active" &&
    evidence.appUserStatus === "active" &&
    (evidence.appUserRole === "user" || evidence.appUserRole === "admin") &&
    evidence.mappedAppUserMatches === true
  ) {
    return "already_ready";
  }

  return "blocked";
}
