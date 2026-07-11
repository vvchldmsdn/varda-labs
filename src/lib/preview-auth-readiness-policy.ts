export const NEON_AUTH_EVIDENCE_SNAPSHOT = Object.freeze({
  checkedAt: "2026-07-11",
  lifecycle: "beta",
  packageVersion: "0.4.2-beta",
  nextPeerMinimumMajor: 16,
  sessionCacheDefaultSeconds: 300,
} as const);

export type AuthEnvironmentCheck = Readonly<{
  baseUrl: "valid" | "missing" | "invalid" | "unverified";
  cookieSecret: "valid" | "missing" | "invalid" | "unverified";
  browserAuthUrl: "valid" | "missing" | "invalid" | "unverified";
}>;

export type PreviewAuthReadinessInput = Readonly<{
  nextVersion: string;
  authSdkInstalled: boolean;
  authRoutePresent: boolean;
  authRuntimeImports: number;
  basicAuthBoundaryIntact: boolean;
  managedNeonAuthSchemaOwnedByDrizzle: boolean;
  publicAuthEnvironmentReferences: number;
  localEnvironment: AuthEnvironmentCheck;
  previewEnvironment: AuthEnvironmentCheck;
  productionEnvironment: AuthEnvironmentCheck;
  productionAuthRuntime: "disabled" | "enabled" | "unverified";
  providerSubjectSource:
    | "verified_server_session"
    | "manual_transport"
    | "unresolved";
  operatorHandoff:
    | "reviewed_server_side_target"
    | "singleton_fallback"
    | "machine_secret_selection"
    | "unresolved";
}>;

export const PREVIEW_AUTH_ROUTE_TOPOLOGY = Object.freeze([
  Object.freeze({
    route: "/api/auth/[...path]",
    responsibility: "auth_handler_only",
    productDatabaseAccess: false,
    basicAuthOuterGate: false,
  }),
  Object.freeze({
    route: "/auth/[path]",
    responsibility: "preview_sign_in_ui_only",
    productDatabaseAccess: false,
    basicAuthOuterGate: false,
  }),
  Object.freeze({
    route: "product_routes",
    responsibility: "basic_auth_then_dal_authorization",
    productDatabaseAccess: true,
    basicAuthOuterGate: true,
  }),
  Object.freeze({
    route: "admin_and_cron_routes",
    responsibility: "machine_secret_only",
    productDatabaseAccess: true,
    basicAuthOuterGate: false,
  }),
] as const);

export const PAIRING_HANDOFF_POLICY = Object.freeze([
  Object.freeze({ source: "reviewed_server_side_target", allowed: true }),
  Object.freeze({ source: "singleton_fallback", allowed: false }),
  Object.freeze({ source: "machine_secret_selection", allowed: false }),
  Object.freeze({ source: "basic_auth_username", allowed: false }),
  Object.freeze({ source: "email", allowed: false }),
  Object.freeze({ source: "legacy_owner_value", allowed: false }),
  Object.freeze({ source: "url", allowed: false }),
  Object.freeze({ source: "request_body", allowed: false }),
  Object.freeze({ source: "request_header", allowed: false }),
  Object.freeze({ source: "environment_variable", allowed: false }),
  Object.freeze({ source: "log", allowed: false }),
] as const);

export type PreviewAuthScopeViolation =
  | "auth_sdk_installed_during_b0"
  | "auth_route_added_during_b0"
  | "auth_runtime_import_added_during_b0"
  | "basic_auth_boundary_drift"
  | "managed_neon_auth_schema_owned_by_drizzle"
  | "public_auth_environment_reference";

export type PreviewAuthReadinessBlocker =
  | "next_version_incompatible"
  | "local_base_url_missing_or_invalid"
  | "local_cookie_secret_missing_or_invalid"
  | "preview_environment_unverified"
  | "production_isolation_unverified"
  | "provider_subject_source_unresolved"
  | "reviewed_operator_handoff_unresolved";

export function canSourcePairingTarget(source: string) {
  return PAIRING_HANDOFF_POLICY.find((candidate) => candidate.source === source)
    ?.allowed === true;
}

export function assessPreviewAuthReadiness(input: PreviewAuthReadinessInput) {
  const scopeViolations: PreviewAuthScopeViolation[] = [];
  const blockers: PreviewAuthReadinessBlocker[] = [];

  if (input.authSdkInstalled) {
    scopeViolations.push("auth_sdk_installed_during_b0");
  }
  if (input.authRoutePresent) {
    scopeViolations.push("auth_route_added_during_b0");
  }
  if (input.authRuntimeImports !== 0) {
    scopeViolations.push("auth_runtime_import_added_during_b0");
  }
  if (!input.basicAuthBoundaryIntact) {
    scopeViolations.push("basic_auth_boundary_drift");
  }
  if (input.managedNeonAuthSchemaOwnedByDrizzle) {
    scopeViolations.push("managed_neon_auth_schema_owned_by_drizzle");
  }
  if (input.publicAuthEnvironmentReferences !== 0) {
    scopeViolations.push("public_auth_environment_reference");
  }

  if (
    majorVersion(input.nextVersion) <
    NEON_AUTH_EVIDENCE_SNAPSHOT.nextPeerMinimumMajor
  ) {
    blockers.push("next_version_incompatible");
  }
  if (input.localEnvironment.baseUrl !== "valid") {
    blockers.push("local_base_url_missing_or_invalid");
  }
  if (input.localEnvironment.cookieSecret !== "valid") {
    blockers.push("local_cookie_secret_missing_or_invalid");
  }
  if (!environmentIsValid(input.previewEnvironment)) {
    blockers.push("preview_environment_unverified");
  }
  if (
    input.productionAuthRuntime !== "disabled" ||
    environmentIsUnverified(input.productionEnvironment)
  ) {
    blockers.push("production_isolation_unverified");
  }
  if (input.providerSubjectSource !== "verified_server_session") {
    blockers.push("provider_subject_source_unresolved");
  }
  if (input.operatorHandoff !== "reviewed_server_side_target") {
    blockers.push("reviewed_operator_handoff_unresolved");
  }

  return Object.freeze({
    phase: "phase1g1b0_preview_auth_readiness",
    auditStatus: scopeViolations.length === 0 ? "passed" : "failed",
    previewDecision:
      scopeViolations.length === 0 && blockers.length === 0
        ? "ready_for_separate_g1b1_approval"
        : "blocked",
    productionDecision: "held_while_neon_auth_is_beta",
    fallback: "keep_basic_auth_and_continue_non_auth_migration",
    scopeViolations: Object.freeze(scopeViolations),
    blockers: Object.freeze(blockers),
  } as const);
}

function environmentIsValid(environment: AuthEnvironmentCheck) {
  return environment.baseUrl === "valid" && environment.cookieSecret === "valid";
}

function environmentIsUnverified(environment: AuthEnvironmentCheck) {
  return (
    environment.baseUrl === "unverified" ||
    environment.cookieSecret === "unverified" ||
    environment.browserAuthUrl === "unverified"
  );
}

function majorVersion(version: string) {
  const match = version.trim().match(/^(?:\D*)(\d+)/);
  return match ? Number.parseInt(match[1], 10) : 0;
}
