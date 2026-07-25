import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assessPreviewAuthEnvironment,
  isPreviewAuthApiRequestAllowed,
  PREVIEW_AUTH_ALLOWED_API_ENDPOINTS,
  PREVIEW_AUTH_ALLOWED_GIT_REF,
  PREVIEW_AUTH_CALLBACK_PATH,
  PREVIEW_AUTH_SESSION_CACHE_SECONDS,
} from "../src/lib/auth/preview-auth-policy.ts";
import { auditPreviewAuthRuntime } from "../scripts/lib/preview-auth-runtime-audit.mjs";

describe("preview auth session transport smoke", () => {
  it("stays disabled outside Preview even when credentials exist", () => {
    assert.deepEqual(
      assessPreviewAuthEnvironment({
        VERCEL_ENV: "production",
        VERCEL_GIT_COMMIT_REF: PREVIEW_AUTH_ALLOWED_GIT_REF,
        NEON_AUTH_BASE_URL: "https://auth.example.invalid/project/auth",
        NEON_AUTH_COOKIE_SECRET: "x".repeat(48),
      }),
      { state: "disabled" },
    );
  });

  it("stays disabled on every other Preview branch", () => {
    assert.deepEqual(
      assessPreviewAuthEnvironment({
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "feature/unrelated-preview",
        NEON_AUTH_BASE_URL: "https://auth.example.invalid/project/auth",
        NEON_AUTH_COOKIE_SECRET: "x".repeat(48),
      }),
      { state: "disabled" },
    );
  });

  it("fails closed without reflecting invalid configuration values", () => {
    const marker = "must-not-be-reflected";
    const result = assessPreviewAuthEnvironment({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: PREVIEW_AUTH_ALLOWED_GIT_REF,
      NEON_AUTH_BASE_URL: `http://${marker}.invalid/auth`,
      NEON_AUTH_COOKIE_SECRET: marker,
    });

    assert.deepEqual(result, { state: "misconfigured" });
    assert.equal(JSON.stringify(result).includes(marker), false);
  });

  it("accepts only a complete Preview server configuration", () => {
    assert.deepEqual(
      assessPreviewAuthEnvironment({
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: PREVIEW_AUTH_ALLOWED_GIT_REF,
        NEON_AUTH_BASE_URL: "https://auth.example.invalid/project/auth",
        NEON_AUTH_COOKIE_SECRET: "x".repeat(48),
      }),
      { state: "ready" },
    );
    assert.equal(PREVIEW_AUTH_SESSION_CACHE_SECONDS, 60);
    assert.equal(PREVIEW_AUTH_CALLBACK_PATH, "/auth/session");
  });

  it("allows only the three reviewed Google session transport requests", () => {
    assert.deepEqual(PREVIEW_AUTH_ALLOWED_API_ENDPOINTS, [
      { method: "GET", path: ["get-session"] },
      {
        method: "POST",
        path: ["sign-in", "social"],
        socialProvider: "google",
      },
      { method: "POST", path: ["sign-out"] },
    ]);

    assert.equal(
      isPreviewAuthApiRequestAllowed({
        method: "GET",
        path: ["get-session"],
      }),
      true,
    );
    assert.equal(
      isPreviewAuthApiRequestAllowed({
        method: "POST",
        path: ["sign-in", "social"],
        socialProvider: "google",
      }),
      true,
    );
    assert.equal(
      isPreviewAuthApiRequestAllowed({
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
      assert.equal(isPreviewAuthApiRequestAllowed(request), false);
    }
  });

  it("keeps the smoke runtime outside product data and production auth", () => {
    const result = auditPreviewAuthRuntime(process.cwd());

    assert.equal(result.status, "passed");
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.evidence, {
      requiredFiles: 8,
      presentFiles: 8,
      inspectedRuntimeGraphFiles: 8,
      productDatabaseBoundaryFiles: 0,
      publicAuthEnvironmentReferences: 0,
      previewAuthSdkPinned: true,
      previewGitRefGatePresent: true,
      allowedAuthApiEndpoints: 3,
      googleSocialProviderRestricted: true,
      basicAuthBoundaryIntact: true,
      oauthCallbackExchangeProxyPresent: true,
      previewAuthRouteBypassesBasicAuth: true,
      managedAuthSchemaOwnedByDrizzle: false,
      managedAuthSessionIoExpected: true,
    });
  });
});
