export type TenantSourceCandidate =
  | "verified_active_identity_mapping"
  | "account_scope"
  | "basic_auth_username"
  | "email"
  | "provider_subject_direct"
  | "url_owner_value"
  | "body_owner_value"
  | "header_owner_value"
  | "machine_secret";

export const SESSION_TENANT_SOURCE_POLICY = Object.freeze([
  Object.freeze({
    source: "verified_active_identity_mapping",
    canSourceTenant: true,
    usage: "canonical_tenant_context",
  }),
  Object.freeze({
    source: "account_scope",
    canSourceTenant: false,
    usage: "secondary_filter_only",
  }),
  Object.freeze({
    source: "basic_auth_username",
    canSourceTenant: false,
    usage: "outer_access_gate_only",
  }),
  Object.freeze({ source: "email", canSourceTenant: false, usage: "forbidden" }),
  Object.freeze({
    source: "provider_subject_direct",
    canSourceTenant: false,
    usage: "mapping_lookup_key_only",
  }),
  Object.freeze({
    source: "url_owner_value",
    canSourceTenant: false,
    usage: "untrusted_request_input",
  }),
  Object.freeze({
    source: "body_owner_value",
    canSourceTenant: false,
    usage: "untrusted_request_input",
  }),
  Object.freeze({
    source: "header_owner_value",
    canSourceTenant: false,
    usage: "untrusted_request_input",
  }),
  Object.freeze({
    source: "machine_secret",
    canSourceTenant: false,
    usage: "machine_authorization_only",
  }),
] as const);

export type CredentialKind =
  | "mapped_active_user_session"
  | "machine_secret"
  | "basic_auth";
export type AuthorizationCapability =
  | "resolve_user_tenant"
  | "authorize_machine_job";

export const SESSION_CREDENTIAL_BOUNDARY = Object.freeze([
  Object.freeze({
    credential: "mapped_active_user_session",
    resolveUserTenant: true,
    authorizeMachineJob: false,
  }),
  Object.freeze({
    credential: "machine_secret",
    resolveUserTenant: false,
    authorizeMachineJob: true,
  }),
  Object.freeze({
    credential: "basic_auth",
    resolveUserTenant: false,
    authorizeMachineJob: false,
  }),
] as const);

export const REQUEST_SCOPED_RESOLVER_CACHE_CONTRACT = Object.freeze({
  implementationStatus: "interface_only",
  scope: "request_only",
  dedupeKey: "implicit_current_request",
  providerCookieTtl: "deferred_until_sdk_integration",
  crossRequestCache: "forbidden",
} as const);

export interface RequestScopedSessionResolverCachePort<Result> {
  getOrLoad(load: () => Promise<Result>): Promise<Result>;
}

export function canSourceTenant(source: TenantSourceCandidate) {
  return SESSION_TENANT_SOURCE_POLICY.find(
    (policy) => policy.source === source,
  )?.canSourceTenant === true;
}

export function credentialHasCapability(
  credential: CredentialKind,
  capability: AuthorizationCapability,
) {
  const policy = SESSION_CREDENTIAL_BOUNDARY.find(
    (candidate) => candidate.credential === credential,
  );
  if (!policy) return false;
  return capability === "resolve_user_tenant"
    ? policy.resolveUserTenant
    : policy.authorizeMachineJob;
}
