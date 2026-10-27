import "server-only";

import { Auth } from "@auth/core";
import { getToken } from "@auth/core/jwt";
import { cookies } from "next/headers";
import { createNaverAuthConfig } from "./naver-auth-config";
import {
  assessNaverAuthEnvironment,
  canonicalNaverAuthOrigin,
  NAVER_AUTH_BASE_PATH,
  NAVER_AUTH_SESSION_COOKIE,
} from "./naver-auth-policy";
import {
  createReviewedNaverAuthRequest,
  finalizeNaverAuthCallback,
} from "./naver-auth-request";
import {
  verifiedProviderSession,
  type CurrentSessionSubjectResult,
} from "./provider-session-contract";

export function getNaverAuthRuntimeState() {
  return assessNaverAuthEnvironment({
    VERCEL_ENV: process.env.VERCEL_ENV,
    VARDA_AUTH_NAVER_ENABLED: process.env.VARDA_AUTH_NAVER_ENABLED,
    NAVER_CLIENT_ID: process.env.NAVER_CLIENT_ID,
    NAVER_CLIENT_SECRET: process.env.NAVER_CLIENT_SECRET,
    NAVER_AUTH_SECRET: process.env.NAVER_AUTH_SECRET,
    NAVER_AUTH_ORIGIN: process.env.NAVER_AUTH_ORIGIN,
  });
}

function getNaverAuthConfig(callbackState?: string) {
  return createNaverAuthConfig({
    clientId: process.env.NAVER_CLIENT_ID!.trim(),
    clientSecret: process.env.NAVER_CLIENT_SECRET!.trim(),
    secret: process.env.NAVER_AUTH_SECRET!,
    origin: canonicalNaverAuthOrigin(process.env.NAVER_AUTH_ORIGIN)!,
    callbackState,
  });
}

export async function handleNaverAuthRequest(
  request: Request,
  path: readonly string[],
) {
  const assessment = getNaverAuthRuntimeState();
  if (assessment.state !== "ready") {
    return Response.json(
      { code: "AUTH_METHOD_UNAVAILABLE" },
      {
        status: assessment.state === "disabled" ? 404 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
  const forwarded = await createReviewedNaverAuthRequest(
    request,
    path,
    canonicalNaverAuthOrigin(process.env.NAVER_AUTH_ORIGIN)!,
  );
  if (!forwarded)
    return new Response("Not found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  const callbackState =
    path.join("/") === "callback/naver"
      ? (new URL(forwarded.url).searchParams.get("state") ?? undefined)
      : undefined;
  const response = await Auth(forwarded, getNaverAuthConfig(callbackState));
  if (path.join("/") === "callback/naver") {
    return finalizeNaverAuthCallback(
      response,
      canonicalNaverAuthOrigin(process.env.NAVER_AUTH_ORIGIN)!,
    );
  }
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function readNaverSession(): Promise<CurrentSessionSubjectResult> {
  const jar = await cookies();
  const sessionCookies = jar
    .getAll()
    .filter(
      ({ name }) =>
        name === NAVER_AUTH_SESSION_COOKIE ||
        (name.startsWith(`${NAVER_AUTH_SESSION_COOKIE}.`) &&
          /^\d+$/.test(name.slice(NAVER_AUTH_SESSION_COOKIE.length + 1))),
    );
  if (!sessionCookies.length) return { state: "unauthenticated" };
  if (getNaverAuthRuntimeState().state !== "ready")
    return { state: "unavailable" };
  const origin = canonicalNaverAuthOrigin(process.env.NAVER_AUTH_ORIGIN)!;
  try {
    const token = await getToken({
      req: new Request(`${origin}${NAVER_AUTH_BASE_PATH}/session`, {
        headers: {
          cookie: sessionCookies
            .map(({ name, value }) => `${name}=${value}`)
            .join("; "),
        },
      }),
      cookieName: NAVER_AUTH_SESSION_COOKIE,
      secret: process.env.NAVER_AUTH_SECRET!,
      secureCookie: true,
      logger: {
        error: () => undefined,
        warn: () => undefined,
        debug: () => undefined,
      },
    });
    if (!token) return { state: "unauthenticated" };
    if (token.authProvider !== "naver" || token.aud !== origin)
      return { state: "invalid" };
    return verifiedProviderSession("naver", token.sub);
  } catch {
    return { state: "unavailable" };
  }
}
