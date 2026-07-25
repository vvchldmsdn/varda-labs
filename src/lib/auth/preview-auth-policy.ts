export const PREVIEW_AUTH_SESSION_CACHE_SECONDS = 60;
export const PREVIEW_AUTH_CALLBACK_PATH = "/auth/session";
export const PREVIEW_AUTH_ALLOWED_GIT_REF =
  "codex/preview-auth-transport-convergence";

export const PREVIEW_AUTH_ALLOWED_API_ENDPOINTS = Object.freeze([
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

export type PreviewAuthEnvironment = Readonly<{
  VERCEL_ENV?: string;
  VERCEL_GIT_COMMIT_REF?: string;
  NEON_AUTH_BASE_URL?: string;
  NEON_AUTH_COOKIE_SECRET?: string;
}>;

export type PreviewAuthEnvironmentAssessment =
  | Readonly<{ state: "disabled" }>
  | Readonly<{ state: "misconfigured" }>
  | Readonly<{ state: "ready" }>;

export type PreviewAuthApiRequest = Readonly<{
  method: string;
  path: readonly string[];
  socialProvider?: string | null;
}>;

export function assessPreviewAuthEnvironment(
  environment: PreviewAuthEnvironment,
): PreviewAuthEnvironmentAssessment {
  if (
    environment.VERCEL_ENV?.trim() !== "preview" ||
    environment.VERCEL_GIT_COMMIT_REF?.trim() !==
      PREVIEW_AUTH_ALLOWED_GIT_REF
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

export function isPreviewAuthApiRequestAllowed(
  request: PreviewAuthApiRequest,
) {
  const endpoint = PREVIEW_AUTH_ALLOWED_API_ENDPOINTS.find(
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
