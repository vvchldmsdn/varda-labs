export const PREVIEW_AUTH_SESSION_CACHE_SECONDS = 60;
export const PREVIEW_AUTH_ALLOWED_GIT_REF =
  "codex/neon-auth-preview-smoke-20260721";

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

function isHttpsUrl(value: string | undefined) {
  if (!value) return false;

  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
