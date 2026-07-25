import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assessAuthTransportEnvironment,
  isAuthTransportApiRequestAllowed,
  AUTH_TRANSPORT_ALLOWED_API_ENDPOINTS,
  AUTH_TRANSPORT_ALLOWED_ENVIRONMENTS,
  AUTH_TRANSPORT_CALLBACK_PATH,
  AUTH_TRANSPORT_SESSION_CACHE_SECONDS,
} from "../src/lib/auth/auth-transport-policy.ts";
import { auditAuthTransportRuntime } from "../scripts/lib/auth-transport-runtime-audit.mjs";

describe("auth session transport smoke", () => {
  it("stays disabled outside Vercel Preview and Production", () => {
    assert.deepEqual(
      assessAuthTransportEnvironment({
        VERCEL_ENV: "development",
        NEON_AUTH_BASE_URL: "https://auth.example.invalid/project/auth",
        NEON_AUTH_COOKIE_SECRET: "x".repeat(48),
      }),
      { state: "disabled" },
    );
  });

  it("allows both isolated Preview and Production auth transports", () => {
    assert.deepEqual(AUTH_TRANSPORT_ALLOWED_ENVIRONMENTS, [
      "preview",
      "production",
    ]);

    for (const VERCEL_ENV of AUTH_TRANSPORT_ALLOWED_ENVIRONMENTS) {
      assert.deepEqual(
        assessAuthTransportEnvironment({
          VERCEL_ENV,
          NEON_AUTH_BASE_URL: "https://auth.example.invalid/project/auth",
          NEON_AUTH_COOKIE_SECRET: "x".repeat(48),
        }),
        { state: "ready" },
      );
    }
  });

  it("fails closed without reflecting invalid configuration values", () => {
    const marker = "must-not-be-reflected";
    const result = assessAuthTransportEnvironment({
      VERCEL_ENV: "production",
      NEON_AUTH_BASE_URL: `http://${marker}.invalid/auth`,
      NEON_AUTH_COOKIE_SECRET: marker,
    });

    assert.deepEqual(result, { state: "misconfigured" });
    assert.equal(JSON.stringify(result).includes(marker), false);
  });

  it("requires a complete server configuration in every enabled environment", () => {
    assert.deepEqual(
      assessAuthTransportEnvironment({
        VERCEL_ENV: "production",
        NEON_AUTH_BASE_URL: "https://auth.example.invalid/project/auth",
        NEON_AUTH_COOKIE_SECRET: "",
      }),
      { state: "misconfigured" },
    );
    assert.equal(AUTH_TRANSPORT_SESSION_CACHE_SECONDS, 60);
    assert.equal(AUTH_TRANSPORT_CALLBACK_PATH, "/auth/session");
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

  it("keeps the transport outside product data and identity authority", () => {
    const result = auditAuthTransportRuntime(process.cwd());

    assert.equal(result.status, "passed");
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.evidence, {
      requiredFiles: 8,
      presentFiles: 8,
      inspectedRuntimeGraphFiles: 8,
      productDatabaseBoundaryFiles: 0,
      publicAuthEnvironmentReferences: 0,
      authSdkPinned: true,
      previewRuntimeEnabled: true,
      productionRuntimeEnabled: true,
      allowedAuthApiEndpoints: 2,
      googleSocialProviderRestricted: true,
      basicAuthBoundaryIntact: true,
      oauthCallbackExchangeProxyPresent: true,
      basicAuthSignInApiGatePresent: true,
      authCallbackBypassesBasicAuth: true,
      managedAuthSchemaOwnedByDrizzle: false,
      managedAuthSessionIoExpected: true,
    });
  });
});
