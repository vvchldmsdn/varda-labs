import "server-only";

import {
  createNeonAuth,
  type NeonAuth,
} from "@neondatabase/auth/next/server";

import {
  assessAuthTransportEnvironment,
  AUTH_TRANSPORT_SESSION_CACHE_SECONDS,
} from "@/lib/auth/auth-transport-policy";

type AuthTransportRuntime =
  | Readonly<{ state: "disabled" }>
  | Readonly<{ state: "misconfigured" }>
  | Readonly<{ state: "ready"; auth: NeonAuth }>;

let authSingleton: NeonAuth | undefined;

export function getAuthTransportRuntimeState() {
  return assessAuthTransportEnvironment({
    VERCEL_ENV: process.env.VERCEL_ENV,
    NEON_AUTH_BASE_URL: process.env.NEON_AUTH_BASE_URL,
    NEON_AUTH_COOKIE_SECRET: process.env.NEON_AUTH_COOKIE_SECRET,
  });
}

export function getAuthTransportRuntime(): AuthTransportRuntime {
  const assessment = getAuthTransportRuntimeState();
  if (assessment.state !== "ready") return assessment;

  if (!authSingleton) {
    authSingleton = createNeonAuth({
      baseUrl: process.env.NEON_AUTH_BASE_URL!.trim(),
      cookies: {
        secret: process.env.NEON_AUTH_COOKIE_SECRET!.trim(),
        sessionDataTtl: AUTH_TRANSPORT_SESSION_CACHE_SECONDS,
      },
      logLevel: "silent",
    });
  }

  return Object.freeze({ state: "ready", auth: authSingleton });
}
