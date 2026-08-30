import { createHash } from "node:crypto";

export const AUTH_TRANSPORT_SESSION_CACHE_SECONDS = 60;
export {
  AUTH_TRANSPORT_CALLBACK_PATH,
  AUTH_TRANSPORT_SESSION_PATH,
} from "./auth-transport-routes.ts";
export const AUTH_TRANSPORT_ALLOWED_ENVIRONMENTS = Object.freeze([
  "production",
] as const);

export const AUTH_TRANSPORT_ALLOWED_API_ENDPOINTS = Object.freeze([
  Object.freeze({
    method: "POST",
    path: Object.freeze(["sign-in", "social"]),
    socialProviders: Object.freeze(["google", "github"]),
  }),
  Object.freeze({
    method: "POST",
    path: Object.freeze(["sign-out"]),
  }),
  Object.freeze({ method: "POST", path: Object.freeze(["sign-in", "email"]) }),
  Object.freeze({ method: "POST", path: Object.freeze(["sign-up", "email"]) }),
  Object.freeze({ method: "POST", path: Object.freeze(["send-verification-email"]) }),
  Object.freeze({ method: "POST", path: Object.freeze(["request-password-reset"]) }),
  Object.freeze({ method: "POST", path: Object.freeze(["reset-password"]) }),
] as const);

export type AuthTransportEnvironment = Readonly<{
  VERCEL_ENV?: string;
  NEON_AUTH_BASE_URL?: string;
  NEON_AUTH_BASE_URL_SHA256?: string;
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
  const expectedBaseUrlFingerprint =
    environment.NEON_AUTH_BASE_URL_SHA256?.trim();
  const cookieSecret = environment.NEON_AUTH_COOKIE_SECRET?.trim();
  const actualBaseUrlFingerprint =
    createAuthTransportBaseUrlFingerprint(baseUrl);

  if (
    !actualBaseUrlFingerprint ||
    !isSha256Fingerprint(expectedBaseUrlFingerprint) ||
    actualBaseUrlFingerprint !== expectedBaseUrlFingerprint ||
    !cookieSecret ||
    cookieSecret.length < 32
  ) {
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
    !("socialProviders" in endpoint) ||
    endpoint.socialProviders.some((provider) => provider === request.socialProvider)
  );
}

export function createAuthTransportBaseUrlFingerprint(
  value: string | undefined,
) {
  const canonicalUrl = canonicalizeAuthTransportBaseUrl(value);
  if (!canonicalUrl) return null;

  return `sha256:${createHash("sha256")
    .update(canonicalUrl, "utf8")
    .digest("hex")}`;
}

function canonicalizeAuthTransportBaseUrl(value: string | undefined) {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.origin}${pathname}`;
  } catch {
    return null;
  }
}

function isSha256Fingerprint(value: string | undefined): value is string {
  return /^sha256:[a-f0-9]{64}$/.test(value ?? "");
}
