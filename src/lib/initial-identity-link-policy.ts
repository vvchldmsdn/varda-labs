export type ReviewedTargetSource =
  | "explicit_reviewed_app_user_id"
  | "singleton_app_users"
  | "email"
  | "basic_auth_username"
  | "account_scope"
  | "legacy_owner_value"
  | "url_owner_value"
  | "body_owner_value"
  | "header_owner_value"
  | "machine_secret";

export const IDENTITY_LINK_TARGET_SOURCE_POLICY = Object.freeze([
  Object.freeze({ source: "explicit_reviewed_app_user_id", allowed: true }),
  Object.freeze({ source: "singleton_app_users", allowed: false }),
  Object.freeze({ source: "email", allowed: false }),
  Object.freeze({ source: "basic_auth_username", allowed: false }),
  Object.freeze({ source: "account_scope", allowed: false }),
  Object.freeze({ source: "legacy_owner_value", allowed: false }),
  Object.freeze({ source: "url_owner_value", allowed: false }),
  Object.freeze({ source: "body_owner_value", allowed: false }),
  Object.freeze({ source: "header_owner_value", allowed: false }),
  Object.freeze({ source: "machine_secret", allowed: false }),
] as const);

export type ProviderSubjectTransport =
  | "verified_server_session_port"
  | "cli_argument"
  | "environment_variable"
  | "url"
  | "request_body"
  | "request_header"
  | "log";

export const PROVIDER_SUBJECT_TRANSPORT_POLICY = Object.freeze([
  Object.freeze({ transport: "verified_server_session_port", allowed: true }),
  Object.freeze({ transport: "cli_argument", allowed: false }),
  Object.freeze({ transport: "environment_variable", allowed: false }),
  Object.freeze({ transport: "url", allowed: false }),
  Object.freeze({ transport: "request_body", allowed: false }),
  Object.freeze({ transport: "request_header", allowed: false }),
  Object.freeze({ transport: "log", allowed: false }),
] as const);

export function canSourceReviewedTarget(source: ReviewedTargetSource) {
  return IDENTITY_LINK_TARGET_SOURCE_POLICY.find(
    (candidate) => candidate.source === source,
  )?.allowed === true;
}

export function canTransportProviderSubject(
  transport: ProviderSubjectTransport,
) {
  return PROVIDER_SUBJECT_TRANSPORT_POLICY.find(
    (candidate) => candidate.transport === transport,
  )?.allowed === true;
}
