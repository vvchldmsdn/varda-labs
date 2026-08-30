import { z } from "zod";
import {
  isSameOriginAuthRequest,
  readBoundedAuthBody,
} from "./auth-request-validation.ts";
import { NAVER_AUTH_BASE_PATH } from "./naver-auth-policy.ts";

const postSchema = z.strictObject({
  csrfToken: z.string().regex(/^[a-f0-9]{64}$/),
  callbackUrl: z.enum(["/auth/session", "/auth/sign-in"]),
});

export function finalizeNaverAuthCallback(response: Response, origin: string) {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-type");
  headers.delete("content-encoding");
  const sessionUrl = `${origin}/auth/session`;
  headers.set(
    "location",
    headers.get("location") === sessionUrl
      ? sessionUrl
      : `${origin}/auth/sign-in?error=oauth`,
  );
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(null, { status: 302, headers });
}

export async function createReviewedNaverAuthRequest(
  request: Request,
  path: readonly string[],
  origin: string,
) {
  const url = new URL(request.url);
  const action = path.join("/");
  if (
    url.origin !== origin ||
    url.pathname !== `${NAVER_AUTH_BASE_PATH}/${action}`
  )
    return null;
  const headers = new Headers();
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  if (request.method === "GET") {
    if (action === "csrf" && !url.search) {
      return new Request(url, { headers, signal: request.signal });
    }
    if (action !== "callback/naver" || url.search.length > 4_096) return null;
    const allowed = ["code", "state", "error", "error_description"];
    for (const key of url.searchParams.keys()) {
      if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1)
        return null;
    }
    if (
      !url.searchParams.get("state") ||
      !(url.searchParams.get("code") || url.searchParams.get("error"))
    )
      return null;
    return new Request(url, { headers, signal: request.signal });
  }
  if (
    request.method !== "POST" ||
    url.search ||
    !["signin/naver", "signout"].includes(action) ||
    !isSameOriginAuthRequest(request) ||
    request.headers.get("content-type")?.split(";", 1)[0] !==
      "application/x-www-form-urlencoded"
  )
    return null;
  const body = await readBoundedAuthBody(request);
  if (body === null) return null;
  const values = new URLSearchParams(body);
  if ([...values.keys()].some((key) => values.getAll(key).length !== 1))
    return null;
  const parsed = postSchema.safeParse(Object.fromEntries(values));
  if (!parsed.success) return null;
  const callbackUrl =
    action === "signin/naver" ? "/auth/session" : "/auth/sign-in";
  if (parsed.data.callbackUrl !== callbackUrl) return null;
  headers.set("origin", origin);
  headers.set("content-type", "application/x-www-form-urlencoded");
  headers.set("X-Auth-Return-Redirect", "1");
  return new Request(url, {
    method: "POST",
    headers,
    body: new URLSearchParams({
      csrfToken: parsed.data.csrfToken,
      callbackUrl: `${origin}${callbackUrl}`,
    }),
    signal: request.signal,
  });
}
