import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assessPreviewAuthEnvironment,
  PREVIEW_AUTH_ALLOWED_GIT_REF,
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
  });

  it("keeps the smoke runtime outside product data and production auth", () => {
    const result = auditPreviewAuthRuntime(process.cwd());

    assert.equal(result.status, "passed");
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.evidence, {
      requiredFiles: 6,
      presentFiles: 6,
      inspectedRuntimeGraphFiles: 6,
      productDatabaseBoundaryFiles: 0,
      publicAuthEnvironmentReferences: 0,
      previewAuthSdkPinned: true,
      previewGitRefGatePresent: true,
      basicAuthBoundaryIntact: true,
      managedAuthSchemaOwnedByDrizzle: false,
      managedAuthSessionIoExpected: true,
    });
  });
});
