import "server-only";

import {
  createNeonAuth,
  type NeonAuth,
} from "@neondatabase/auth/next/server";

import {
  assessPreviewAuthEnvironment,
  PREVIEW_AUTH_SESSION_CACHE_SECONDS,
} from "@/lib/auth/preview-auth-policy";

type PreviewAuthRuntime =
  | Readonly<{ state: "disabled" }>
  | Readonly<{ state: "misconfigured" }>
  | Readonly<{ state: "ready"; auth: NeonAuth }>;

let authSingleton: NeonAuth | undefined;

export function getPreviewAuthRuntimeState() {
  return assessPreviewAuthEnvironment({
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
    NEON_AUTH_BASE_URL: process.env.NEON_AUTH_BASE_URL,
    NEON_AUTH_COOKIE_SECRET: process.env.NEON_AUTH_COOKIE_SECRET,
  });
}

export function getPreviewAuthRuntime(): PreviewAuthRuntime {
  const assessment = getPreviewAuthRuntimeState();
  if (assessment.state !== "ready") return assessment;

  if (!authSingleton) {
    authSingleton = createNeonAuth({
      baseUrl: process.env.NEON_AUTH_BASE_URL!.trim(),
      cookies: {
        secret: process.env.NEON_AUTH_COOKIE_SECRET!.trim(),
        sessionDataTtl: PREVIEW_AUTH_SESSION_CACHE_SECONDS,
      },
      logLevel: "silent",
    });
  }

  return Object.freeze({ state: "ready", auth: authSingleton });
}
