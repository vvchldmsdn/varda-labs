import { z } from "zod";
import {
  AUTH_EMAIL_VERIFIED_PATH,
  AUTH_MAX_PASSWORD_LENGTH,
  AUTH_MIN_NEW_PASSWORD_LENGTH,
  AUTH_PASSWORD_RESET_PATH,
} from "./auth-methods.ts";
import {
  isSameOriginAuthRequest,
  readBoundedAuthBody,
} from "./auth-request-validation.ts";
import {
  AUTH_TRANSPORT_CALLBACK_PATH,
  AUTH_TRANSPORT_SESSION_PATH,
} from "./auth-transport-routes.ts";

export const AUTH_TRANSPORT_SIGN_IN_ERROR_PATH = "/auth/sign-in";
export const AUTH_TRANSPORT_MAX_SOCIAL_SIGN_IN_BODY_BYTES = 1_024;

export function createSocialSignInBody(provider: "google" | "github") {
  return {
    provider,
    callbackURL: AUTH_TRANSPORT_CALLBACK_PATH,
    newUserCallbackURL: AUTH_TRANSPORT_CALLBACK_PATH,
    errorCallbackURL: AUTH_TRANSPORT_SIGN_IN_ERROR_PATH,
  } as const;
}

export const AUTH_TRANSPORT_GOOGLE_SOCIAL_SIGN_IN_BODY = Object.freeze(
  createSocialSignInBody("google"),
);

const email = z.string().trim().max(254).email();
const password = z.string().min(1).max(AUTH_MAX_PASSWORD_LENGTH);
const newPassword = password.min(AUTH_MIN_NEW_PASSWORD_LENGTH);
const token = z
  .string()
  .min(16)
  .max(512)
  .regex(/^[A-Za-z0-9._~-]+$/);
const schemas = {
  "sign-in/social": z.strictObject({
    provider: z.enum(["google", "github"]),
    callbackURL: z.literal(AUTH_TRANSPORT_CALLBACK_PATH),
    newUserCallbackURL: z.literal(AUTH_TRANSPORT_CALLBACK_PATH),
    errorCallbackURL: z.literal(AUTH_TRANSPORT_SIGN_IN_ERROR_PATH),
  }),
  "sign-in/email": z.strictObject({
    email,
    password,
    callbackURL: z.literal(AUTH_TRANSPORT_SESSION_PATH),
  }),
  "sign-up/email": z.strictObject({
    name: z.string().trim().min(1).max(80),
    email,
    password: newPassword,
    callbackURL: z.literal(AUTH_EMAIL_VERIFIED_PATH),
  }),
  "send-verification-email": z.strictObject({
    email,
    callbackURL: z.literal(AUTH_EMAIL_VERIFIED_PATH),
  }),
  "request-password-reset": z.strictObject({
    email,
    redirectTo: z.literal(AUTH_PASSWORD_RESET_PATH),
  }),
  "reset-password": z.strictObject({ newPassword, token }),
  "sign-out": z.strictObject({}),
} as const;

export type ReviewedAuthRequest = Readonly<{
  request: Request;
  kind: "social" | "email" | "sign-out";
  socialProvider: "google" | "github" | null;
}>;

export async function createReviewedAuthRequest(
  request: Request,
  path: readonly string[],
): Promise<ReviewedAuthRequest | null> {
  const route = path.join("/");
  const url = new URL(request.url);
  if (
    request.method !== "POST" ||
    url.search !== "" ||
    url.pathname !== `/api/auth/${route}` ||
    !isSameOriginAuthRequest(request) ||
    !Object.hasOwn(schemas, route)
  )
    return null;

  const rawBody = await readBoundedAuthBody(request);
  if (rawBody === null) return null;
  const isSignOut = route === "sign-out";
  if (
    !(isSignOut && rawBody === "") &&
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() !== "application/json"
  )
    return null;
  if (
    route === "sign-in/social" &&
    new TextEncoder().encode(rawBody).byteLength >
      AUTH_TRANSPORT_MAX_SOCIAL_SIGN_IN_BODY_BYTES
  )
    return null;

  let input: unknown;
  try {
    input = isSignOut && rawBody === "" ? {} : JSON.parse(rawBody);
  } catch {
    return null;
  }
  const parsed = schemas[route as keyof typeof schemas].safeParse(input);
  if (!parsed.success) return null;
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");
  // Email links must return to this application, not the managed Auth host.
  const forwardedBody = {
    ...parsed.data,
    ...(route !== "sign-in/social" && "callbackURL" in parsed.data
      ? { callbackURL: new URL(parsed.data.callbackURL, url.origin).href }
      : {}),
    ...("redirectTo" in parsed.data
      ? { redirectTo: new URL(parsed.data.redirectTo, url.origin).href }
      : {}),
  };
  return {
    request: new Request(request.url, {
      method: "POST",
      headers,
      body: JSON.stringify(forwardedBody),
      signal: request.signal,
    }),
    kind: isSignOut
      ? "sign-out"
      : route === "sign-in/social"
        ? "social"
        : "email",
    socialProvider: "provider" in parsed.data ? parsed.data.provider : null,
  };
}

export async function createReviewedGoogleSocialSignInRequest(
  request: Request,
) {
  const result = await createReviewedAuthRequest(request, [
    "sign-in",
    "social",
  ]);
  return result?.socialProvider === "google" ? result.request : null;
}
