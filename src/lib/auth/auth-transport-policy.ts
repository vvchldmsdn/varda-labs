export const AUTH_TRANSPORT_SESSION_CACHE_SECONDS = 60;
export const AUTH_TRANSPORT_CALLBACK_PATH = "/auth/session";
export const AUTH_TRANSPORT_ALLOWED_ENVIRONMENTS = Object.freeze([
  "preview",
  "production",
] as const);

export const AUTH_TRANSPORT_ALLOWED_API_ENDPOINTS = Object.freeze([
  Object.freeze({
    method: "POST",
    path: Object.freeze(["sign-in", "social"]),
    socialProvider: "google",
  }),
  Object.freeze({
    method: "POST",
    path: Object.freeze(["sign-out"]),
  }),
] as const);

export type AuthTransportEnvironment = Readonly<{
  VERCEL_ENV?: string;
  NEON_AUTH_BASE_URL?: string;
  NEON_AUTH_COOKIE_SECRET?: string;
}>;

export type AuthTransportEnvironmentAssessment =
  | Readonly<{ state: "disabled" }>
  | Readonly<{ state: "misconfigured" }>
  | Readonly<{ state: "ready" }>;

export type AuthTransportApiRequest = Readonly<{
  method: string;
  path: readonly string[];
  socialProvider?: string | null;
}>;

export function assessAuthTransportEnvironment(
  environment: AuthTransportEnvironment,
): AuthTransportEnvironmentAssessment {
  const vercelEnvironment = environment.VERCEL_ENV?.trim();
  if (
    !AUTH_TRANSPORT_ALLOWED_ENVIRONMENTS.some(
      (candidate) => candidate === vercelEnvironment,
    )
  ) {
    return Object.freeze({ state: "disabled" });
  }

  const baseUrl = environment.NEON_AUTH_BASE_URL?.trim();
  const cookieSecret = environment.NEON_AUTH_COOKIE_SECRET?.trim();

  if (!isHttpsUrl(baseUrl) || !cookieSecret || cookieSecret.length < 32) {
    return Object.freeze({ state: "misconfigured" });
  }

  return Object.freeze({ state: "ready" });
}

export function isAuthTransportApiRequestAllowed(
  request: AuthTransportApiRequest,
) {
  const endpoint = AUTH_TRANSPORT_ALLOWED_API_ENDPOINTS.find(
    (candidate) =>
      candidate.method === request.method &&
      candidate.path.length === request.path.length &&
      candidate.path.every((segment, index) => segment === request.path[index]),
  );

  if (!endpoint) return false;

  return (
    !("socialProvider" in endpoint) ||
    endpoint.socialProvider === request.socialProvider
  );
}

function isHttpsUrl(value: string | undefined) {
  if (!value) return false;

  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
