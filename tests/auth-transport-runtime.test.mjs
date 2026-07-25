import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AUTH_TRANSPORT_GOOGLE_SOCIAL_SIGN_IN_BODY,
  createReviewedGoogleSocialSignInRequest,
} from "../src/lib/auth/auth-transport-api-contract.ts";
import {
  assessAuthTransportEnvironment,
  createAuthTransportBaseUrlFingerprint,
  isAuthTransportApiRequestAllowed,
  AUTH_TRANSPORT_ALLOWED_API_ENDPOINTS,
  AUTH_TRANSPORT_ALLOWED_ENVIRONMENTS,
  AUTH_TRANSPORT_CALLBACK_PATH,
  AUTH_TRANSPORT_SESSION_PATH,
  AUTH_TRANSPORT_SESSION_CACHE_SECONDS,
} from "../src/lib/auth/auth-transport-policy.ts";
import { auditAuthTransportRuntime } from "../scripts/lib/auth-transport-runtime-audit.mjs";

const AUTH_BASE_URL = "https://auth.example.invalid/project/auth";
const AUTH_BASE_URL_SHA256 =
  createAuthTransportBaseUrlFingerprint(AUTH_BASE_URL);

describe("auth session transport smoke", () => {
  it("stays disabled outside Vercel Production", () => {
    for (const VERCEL_ENV of ["development", "preview"]) {
      assert.deepEqual(
        assessAuthTransportEnvironment({
          VERCEL_ENV,
          NEON_AUTH_BASE_URL: AUTH_BASE_URL,
          NEON_AUTH_BASE_URL_SHA256: AUTH_BASE_URL_SHA256 ?? undefined,
          NEON_AUTH_COOKIE_SECRET: "x".repeat(48),
        }),
        { state: "disabled" },
      );
    }
  });

  it("allows only the reviewed Production auth transport", () => {
    assert.deepEqual(AUTH_TRANSPORT_ALLOWED_ENVIRONMENTS, ["production"]);

    assert.deepEqual(
      assessAuthTransportEnvironment({
        VERCEL_ENV: "production",
        NEON_AUTH_BASE_URL: AUTH_BASE_URL,
        NEON_AUTH_BASE_URL_SHA256: AUTH_BASE_URL_SHA256 ?? undefined,
        NEON_AUTH_COOKIE_SECRET: "x".repeat(48),
      }),
      { state: "ready" },
    );
  });

  it("fails closed without reflecting invalid configuration values", () => {
    const marker = "must-not-be-reflected";
    const result = assessAuthTransportEnvironment({
      VERCEL_ENV: "production",
      NEON_AUTH_BASE_URL: `http://${marker}.invalid/auth`,
      NEON_AUTH_BASE_URL_SHA256: `sha256:${"0".repeat(64)}`,
      NEON_AUTH_COOKIE_SECRET: marker,
    });

    assert.deepEqual(result, { state: "misconfigured" });
    assert.equal(JSON.stringify(result).includes(marker), false);
  });

  it("fails closed when the Auth endpoint fingerprint does not match", () => {
    assert.deepEqual(
      assessAuthTransportEnvironment({
        VERCEL_ENV: "production",
        NEON_AUTH_BASE_URL: AUTH_BASE_URL,
        NEON_AUTH_BASE_URL_SHA256: `sha256:${"0".repeat(64)}`,
        NEON_AUTH_COOKIE_SECRET: "x".repeat(48),
      }),
      { state: "misconfigured" },
    );
    assert.equal(
      createAuthTransportBaseUrlFingerprint(`${AUTH_BASE_URL}/`),
      AUTH_BASE_URL_SHA256,
    );
    assert.equal(
      createAuthTransportBaseUrlFingerprint(`${AUTH_BASE_URL}?wrong=target`),
      null,
    );
  });

  it("requires a complete server configuration in every enabled environment", () => {
    assert.deepEqual(
      assessAuthTransportEnvironment({
        VERCEL_ENV: "production",
        NEON_AUTH_BASE_URL: AUTH_BASE_URL,
        NEON_AUTH_BASE_URL_SHA256: AUTH_BASE_URL_SHA256 ?? undefined,
        NEON_AUTH_COOKIE_SECRET: "",
      }),
      { state: "misconfigured" },
    );
    assert.equal(AUTH_TRANSPORT_SESSION_CACHE_SECONDS, 60);
    assert.equal(AUTH_TRANSPORT_CALLBACK_PATH, "/auth/callback");
    assert.equal(AUTH_TRANSPORT_SESSION_PATH, "/auth/session");
  });

  it("allows only the two reviewed Google session transport requests", () => {
    assert.deepEqual(AUTH_TRANSPORT_ALLOWED_API_ENDPOINTS, [
      {
        method: "POST",
        path: ["sign-in", "social"],
        socialProvider: "google",
      },
      { method: "POST", path: ["sign-out"] },
    ]);

    assert.equal(
      isAuthTransportApiRequestAllowed({
        method: "POST",
        path: ["sign-in", "social"],
        socialProvider: "google",
      }),
      true,
    );
    assert.equal(
      isAuthTransportApiRequestAllowed({
        method: "POST",
        path: ["sign-out"],
      }),
      true,
    );
  });

  it("rejects unreviewed auth methods, routes, and social providers", () => {
    const rejectedRequests = [
      { method: "POST", path: ["sign-up", "email"] },
      { method: "POST", path: ["sign-in", "email"] },
      { method: "GET", path: ["list-sessions"] },
      { method: "GET", path: ["get-session"] },
      { method: "POST", path: ["delete-user"] },
      { method: "GET", path: ["callback", "google"] },
      {
        method: "POST",
        path: ["sign-in", "social"],
        socialProvider: "github",
      },
      { method: "GET", path: ["sign-out"] },
      { method: "PATCH", path: ["get-session"] },
      { method: "GET", path: ["get-session", "extra"] },
    ];

    for (const request of rejectedRequests) {
      assert.equal(isAuthTransportApiRequestAllowed(request), false);
    }
  });

  it("rebuilds the reviewed Google redirect request from exact fields", async () => {
    const originalRequest = createSocialSignInRequest(
      AUTH_TRANSPORT_GOOGLE_SOCIAL_SIGN_IN_BODY,
    );
    const reviewedRequest =
      await createReviewedGoogleSocialSignInRequest(originalRequest);

    assert.notEqual(reviewedRequest, null);
    assert.deepEqual(
      await reviewedRequest.json(),
      AUTH_TRANSPORT_GOOGLE_SOCIAL_SIGN_IN_BODY,
    );
    assert.equal(reviewedRequest.headers.get("x-request-marker"), "preserved");
    assert.equal(reviewedRequest.headers.get("content-length"), null);
  });

  it("rejects unreviewed social sign-in modes and callback fields", async () => {
    const rejectedBodies = [
      {
        ...AUTH_TRANSPORT_GOOGLE_SOCIAL_SIGN_IN_BODY,
        requestSignUp: true,
      },
      {
        ...AUTH_TRANSPORT_GOOGLE_SOCIAL_SIGN_IN_BODY,
        idToken: { token: "unreviewed" },
      },
      {
        ...AUTH_TRANSPORT_GOOGLE_SOCIAL_SIGN_IN_BODY,
        scopes: ["unreviewed"],
      },
      {
        ...AUTH_TRANSPORT_GOOGLE_SOCIAL_SIGN_IN_BODY,
        callbackURL: "https://outside.example.invalid/callback",
      },
      {
        ...AUTH_TRANSPORT_GOOGLE_SOCIAL_SIGN_IN_BODY,
        newUserCallbackURL: "/unexpected-new-user",
      },
      {
        ...AUTH_TRANSPORT_GOOGLE_SOCIAL_SIGN_IN_BODY,
        errorCallbackURL: "/unexpected-error",
      },
      {
        ...AUTH_TRANSPORT_GOOGLE_SOCIAL_SIGN_IN_BODY,
        extra: true,
      },
      {
        ...AUTH_TRANSPORT_GOOGLE_SOCIAL_SIGN_IN_BODY,
        provider: "github",
      },
      {
        provider: "google",
      },
      null,
      [],
    ];

    for (const body of rejectedBodies) {
      assert.equal(
        await createReviewedGoogleSocialSignInRequest(
          createSocialSignInRequest(body),
        ),
        null,
      );
    }

    assert.equal(
      await createReviewedGoogleSocialSignInRequest(
        createSocialSignInRequest(
          AUTH_TRANSPORT_GOOGLE_SOCIAL_SIGN_IN_BODY,
          "?callbackURL=https://outside.example.invalid",
        ),
      ),
      null,
    );
  });

  it("keeps the transport outside product data and identity authority", () => {
    const result = auditAuthTransportRuntime(process.cwd());

    assert.equal(result.status, "passed");
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.evidence, {
      requiredFiles: 11,
      presentFiles: 11,
      inspectedRuntimeGraphFiles: 11,
      productDatabaseBoundaryFiles: 0,
      publicAuthEnvironmentReferences: 0,
      authSdkPinned: true,
      previewRuntimeDisabled: true,
      productionRuntimeEnabled: true,
      authTargetFingerprintGuardPresent: true,
      allowedAuthApiEndpoints: 2,
      googleSocialProviderRestricted: true,
      strictGoogleSocialSignInBody: true,
      basicAuthBoundaryIntact: true,
      oauthCallbackExchangeProxyPresent: true,
      basicAuthSignInApiGatePresent: true,
      authCallbackBypassesBasicAuth: true,
      sessionEvidenceRequiresBasicAuth: true,
      callbackFailureClosed: true,
      managedAuthSchemaOwnedByDrizzle: false,
      managedAuthSessionIoExpected: true,
    });
  });
});

function createSocialSignInRequest(body, search = "") {
  return new Request(
    `https://app.example.invalid/api/auth/sign-in/social${search}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-length": "999",
        "x-request-marker": "preserved",
      },
      body: JSON.stringify(body),
    },
  );
}
