export type AppUserRole = "user" | "admin";
export type AppUserStatus = "provisioning" | "active" | "disabled";

export type ProviderSessionPortResult =
  | Readonly<{ state: "unauthenticated" }>
  | Readonly<{ state: "unavailable" }>
  | Readonly<{ state: "authenticated" }>;

export type IdentityMappingPortResult =
  | Readonly<{ state: "not_requested" }>
  | Readonly<{ state: "unlinked" }>
  | Readonly<{ state: "collision" }>
  | Readonly<{
      state: "mapped";
      appUserId: string;
      identityStatus: "active" | "disabled";
    }>;

export type AppUserPortResult =
  | Readonly<{ state: "not_requested" }>
  | Readonly<{ state: "missing" }>
  | Readonly<{
      state: "loaded";
      id: string;
      status: AppUserStatus;
      role: AppUserRole;
    }>;

export type TenantContext = Readonly<{
  ownerUserId: string;
  role: AppUserRole;
}>;

export type SessionResolutionFailureCode =
  | "unauthenticated"
  | "auth_provider_unavailable"
  | "identity_unlinked"
  | "identity_mapping_collision"
  | "identity_not_active"
  | "app_user_not_active"
  | "identity_mapping_integrity"
  | "resolver_state_invalid";

export type SessionResolutionFailure = Readonly<{
  ok: false;
  failure: Readonly<{
    code: SessionResolutionFailureCode;
    httpStatus: 401 | 403 | 500 | 503;
  }>;
}>;

export type SessionResolutionSuccess = Readonly<{
  ok: true;
  tenantContext: TenantContext;
}>;

export type SessionResolverResult =
  | SessionResolutionSuccess
  | SessionResolutionFailure;

export type SessionResolverInput = Readonly<{
  providerSession: ProviderSessionPortResult;
  identityMapping: IdentityMappingPortResult;
  appUser: AppUserPortResult;
}>;

export const SESSION_RESOLUTION_FAILURE_CONTRACT = Object.freeze([
  Object.freeze({ code: "unauthenticated", httpStatus: 401 }),
  Object.freeze({ code: "auth_provider_unavailable", httpStatus: 503 }),
  Object.freeze({ code: "identity_unlinked", httpStatus: 403 }),
  Object.freeze({ code: "identity_mapping_collision", httpStatus: 500 }),
  Object.freeze({ code: "identity_not_active", httpStatus: 403 }),
  Object.freeze({ code: "app_user_not_active", httpStatus: 403 }),
  Object.freeze({ code: "identity_mapping_integrity", httpStatus: 500 }),
  Object.freeze({ code: "resolver_state_invalid", httpStatus: 500 }),
] as const);

const FAILURE_STATUS_BY_CODE = new Map<
  SessionResolutionFailureCode,
  SessionResolutionFailure["failure"]["httpStatus"]
>(
  SESSION_RESOLUTION_FAILURE_CONTRACT.map(({ code, httpStatus }) => [
    code,
    httpStatus,
  ]),
);

export type PublicSessionResolution =
  | Readonly<{ ok: true; status: "resolved" }>
  | Readonly<{
      ok: false;
      code: SessionResolutionFailureCode;
      httpStatus: 401 | 403 | 500 | 503;
    }>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function resolveSessionToAppUser(
  input: SessionResolverInput,
): SessionResolverResult {
  const { providerSession, identityMapping, appUser } = input;

  if (providerSession.state === "unauthenticated") {
    return identityMapping.state === "not_requested" &&
      appUser.state === "not_requested"
      ? failure("unauthenticated")
      : failure("resolver_state_invalid");
  }

  if (providerSession.state === "unavailable") {
    return identityMapping.state === "not_requested" &&
      appUser.state === "not_requested"
      ? failure("auth_provider_unavailable")
      : failure("resolver_state_invalid");
  }
  if (providerSession.state !== "authenticated") {
    return failure("resolver_state_invalid");
  }

  if (identityMapping.state === "not_requested") {
    return failure("resolver_state_invalid");
  }
  if (identityMapping.state === "unlinked") {
    return appUser.state === "not_requested"
      ? failure("identity_unlinked")
      : failure("resolver_state_invalid");
  }
  if (identityMapping.state === "collision") {
    return appUser.state === "not_requested"
      ? failure("identity_mapping_collision")
      : failure("resolver_state_invalid");
  }
  if (identityMapping.state !== "mapped") {
    return failure("resolver_state_invalid");
  }
  if (identityMapping.identityStatus === "disabled") {
    return appUser.state === "not_requested"
      ? failure("identity_not_active")
      : failure("resolver_state_invalid");
  }
  if (identityMapping.identityStatus !== "active") {
    return failure("resolver_state_invalid");
  }

  if (appUser.state === "not_requested") {
    return failure("resolver_state_invalid");
  }
  if (appUser.state === "missing") {
    return failure("identity_mapping_integrity");
  }
  if (appUser.state !== "loaded") {
    return failure("resolver_state_invalid");
  }
  if (
    !UUID_PATTERN.test(identityMapping.appUserId) ||
    !UUID_PATTERN.test(appUser.id) ||
    identityMapping.appUserId !== appUser.id
  ) {
    return failure("identity_mapping_integrity");
  }
  if (appUser.status !== "active") {
    return failure("app_user_not_active");
  }
  if (appUser.role !== "user" && appUser.role !== "admin") {
    return failure("identity_mapping_integrity");
  }

  return Object.freeze({
    ok: true,
    tenantContext: Object.freeze({
      ownerUserId: appUser.id,
      role: appUser.role,
    }),
  });
}

export function projectSessionResolutionForBoundary(
  result: SessionResolverResult,
): PublicSessionResolution {
  if (result.ok) return Object.freeze({ ok: true, status: "resolved" });
  return Object.freeze({
    ok: false,
    code: result.failure.code,
    httpStatus: result.failure.httpStatus,
  });
}

function failure(code: SessionResolutionFailureCode): SessionResolutionFailure {
  const httpStatus = FAILURE_STATUS_BY_CODE.get(code);
  if (httpStatus === undefined) {
    throw new Error("Session failure contract is incomplete");
  }
  return Object.freeze({
    ok: false,
    failure: Object.freeze({ code, httpStatus }),
  });
}
