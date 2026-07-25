import { AUTH_TRANSPORT_CALLBACK_PATH } from "./auth-transport-routes.ts";

export const AUTH_TRANSPORT_SIGN_IN_ERROR_PATH = "/auth/sign-in";
export const AUTH_TRANSPORT_MAX_SOCIAL_SIGN_IN_BODY_BYTES = 1_024;

export const AUTH_TRANSPORT_GOOGLE_SOCIAL_SIGN_IN_BODY = Object.freeze({
  provider: "google",
  callbackURL: AUTH_TRANSPORT_CALLBACK_PATH,
  newUserCallbackURL: AUTH_TRANSPORT_CALLBACK_PATH,
  errorCallbackURL: AUTH_TRANSPORT_SIGN_IN_ERROR_PATH,
} as const);

const AUTH_TRANSPORT_GOOGLE_SOCIAL_SIGN_IN_KEYS = Object.freeze(
  Object.keys(AUTH_TRANSPORT_GOOGLE_SOCIAL_SIGN_IN_BODY),
);

export async function createReviewedGoogleSocialSignInRequest(
  request: Request,
) {
  if (
    request.method !== "POST" ||
    new URL(request.url).search !== "" ||
    !isJsonContentType(request.headers.get("content-type"))
  ) {
    return null;
  }

  let input: unknown;
  try {
    const rawBody = await request.text();
    if (
      new TextEncoder().encode(rawBody).byteLength >
      AUTH_TRANSPORT_MAX_SOCIAL_SIGN_IN_BODY_BYTES
    ) {
      return null;
    }
    input = JSON.parse(rawBody);
  } catch {
    return null;
  }

  if (!isExactGoogleSocialSignInBody(input)) return null;

  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");

  return new Request(request.url, {
    method: "POST",
    headers,
    body: JSON.stringify(AUTH_TRANSPORT_GOOGLE_SOCIAL_SIGN_IN_BODY),
    signal: request.signal,
  });
}

function isExactGoogleSocialSignInBody(
  input: unknown,
): input is typeof AUTH_TRANSPORT_GOOGLE_SOCIAL_SIGN_IN_BODY {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }

  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (
    Object.keys(descriptors).length !==
    AUTH_TRANSPORT_GOOGLE_SOCIAL_SIGN_IN_KEYS.length
  ) {
    return false;
  }

  return AUTH_TRANSPORT_GOOGLE_SOCIAL_SIGN_IN_KEYS.every((key) => {
    const descriptor = descriptors[key];
    return (
      descriptor !== undefined &&
      "value" in descriptor &&
      descriptor.value ===
        AUTH_TRANSPORT_GOOGLE_SOCIAL_SIGN_IN_BODY[
          key as keyof typeof AUTH_TRANSPORT_GOOGLE_SOCIAL_SIGN_IN_BODY
        ]
    );
  });
}

function isJsonContentType(value: string | null) {
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}
