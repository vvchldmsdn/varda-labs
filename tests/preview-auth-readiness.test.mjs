import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  NEON_AUTH_EVIDENCE_SNAPSHOT,
  PAIRING_HANDOFF_POLICY,
  PREVIEW_AUTH_ROUTE_TOPOLOGY,
  assessPreviewAuthReadiness,
  canSourcePairingTarget,
} from "../src/lib/preview-auth-readiness-policy.ts";
import {
  auditPreviewAuthReadiness,
  inspectLocalAuthEnvironment,
} from "../scripts/lib/preview-auth-readiness-audit.mjs";

const VALID_ENVIRONMENT = Object.freeze({
  baseUrl: "valid",
  cookieSecret: "valid",
  browserAuthUrl: "missing",
});
const UNVERIFIED_ENVIRONMENT = Object.freeze({
  baseUrl: "unverified",
  cookieSecret: "unverified",
  browserAuthUrl: "unverified",
});

describe("preview auth integration readiness Phase 1G1-B0", () => {
  it("records date-scoped official compatibility evidence without enabling runtime", () => {
    assert.deepEqual(NEON_AUTH_EVIDENCE_SNAPSHOT, {
      checkedAt: "2026-07-11",
      lifecycle: "beta",
      packageVersion: "0.4.2-beta",
      nextPeerMinimumMajor: 16,
      sessionCacheDefaultSeconds: 300,
    });
  });

  it("keeps auth handlers and product data access in separate route classes", () => {
    const authHandler = PREVIEW_AUTH_ROUTE_TOPOLOGY.find(
      ({ route }) => route === "/api/auth/[...path]",
    );
    assert.deepEqual(authHandler, {
      route: "/api/auth/[...path]",
      responsibility: "auth_handler_only",
      productDatabaseAccess: false,
      basicAuthOuterGate: false,
    });

    const productRoutes = PREVIEW_AUTH_ROUTE_TOPOLOGY.find(
      ({ route }) => route === "product_routes",
    );
    assert.equal(productRoutes?.basicAuthOuterGate, true);
    assert.equal(productRoutes?.productDatabaseAccess, true);
  });

  it("allows only a reviewed server-side pairing target", () => {
    assert.equal(PAIRING_HANDOFF_POLICY.filter(({ allowed }) => allowed).length, 1);
    assert.equal(canSourcePairingTarget("reviewed_server_side_target"), true);
    for (const source of [
      "singleton_fallback",
      "machine_secret_selection",
      "basic_auth_username",
      "email",
      "legacy_owner_value",
      "url",
      "request_body",
      "request_header",
      "environment_variable",
      "log",
    ]) {
      assert.equal(canSourcePairingTarget(source), false, source);
    }
  });

  it("passes the frozen B0 scope while blocking B1 readiness", () => {
    const result = assessPreviewAuthReadiness(currentFrozenInput());

    assert.equal(result.auditStatus, "passed");
    assert.equal(result.previewDecision, "blocked");
    assert.equal(result.productionDecision, "held_while_neon_auth_is_beta");
    assert.deepEqual(result.scopeViolations, []);
    assert.deepEqual(result.blockers, [
      "local_cookie_secret_missing_or_invalid",
      "preview_environment_unverified",
      "production_isolation_unverified",
      "provider_subject_source_unresolved",
      "reviewed_operator_handoff_unresolved",
    ]);
  });

  it("requires a separate approval even when every preview prerequisite is met", () => {
    const result = assessPreviewAuthReadiness({
      ...currentFrozenInput(),
      localEnvironment: VALID_ENVIRONMENT,
      previewEnvironment: VALID_ENVIRONMENT,
      productionEnvironment: {
        baseUrl: "missing",
        cookieSecret: "missing",
        browserAuthUrl: "missing",
      },
      productionAuthRuntime: "disabled",
      providerSubjectSource: "verified_server_session",
      operatorHandoff: "reviewed_server_side_target",
    });

    assert.equal(result.auditStatus, "passed");
    assert.equal(result.previewDecision, "ready_for_separate_g1b1_approval");
    assert.equal(result.productionDecision, "held_while_neon_auth_is_beta");
  });

  it("fails the B0 audit if runtime, Basic Auth, managed schema, or public env drifts", () => {
    const result = assessPreviewAuthReadiness({
      ...currentFrozenInput(),
      authSdkInstalled: true,
      authRoutePresent: true,
      authRuntimeImports: 1,
      basicAuthBoundaryIntact: false,
      managedNeonAuthSchemaOwnedByDrizzle: true,
      publicAuthEnvironmentReferences: 1,
    });

    assert.equal(result.auditStatus, "failed");
    assert.deepEqual(result.scopeViolations, [
      "auth_sdk_installed_during_b0",
      "auth_route_added_during_b0",
      "auth_runtime_import_added_during_b0",
      "basic_auth_boundary_drift",
      "managed_neon_auth_schema_owned_by_drizzle",
      "public_auth_environment_reference",
    ]);
  });

  it("reports only local environment classifications, never values", () => {
    const root = mkdtempSync(join(tmpdir(), "varda-auth-readiness-"));
    const baseMarker = "https://auth.example.invalid/project/auth";
    const cookieMarker = "x".repeat(48);
    try {
      writeFileSync(
        join(root, ".env.local"),
        [
          `NEON_AUTH_BASE_URL=${baseMarker}`,
          `NEON_AUTH_COOKIE_SECRET=${cookieMarker}`,
          "VITE_NEON_AUTH_URL=https://browser.example.invalid/auth",
        ].join("\n"),
      );

      const result = inspectLocalAuthEnvironment(root);
      assert.deepEqual(result, {
        baseUrl: "valid",
        cookieSecret: "valid",
        browserAuthUrl: "valid",
      });
      const serialized = JSON.stringify(result);
      assert.equal(serialized.includes(baseMarker), false);
      assert.equal(serialized.includes(cookieMarker), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the current repository frozen and returns aggregate blockers only", () => {
    const result = auditPreviewAuthReadiness({
      root: process.cwd(),
      localEnvironment: VALID_ENVIRONMENT,
    });

    assert.equal(result.status, "passed");
    assert.equal(result.previewReadiness, "blocked");
    assert.equal(result.evidence.authSdkDependencies, 0);
    assert.equal(result.evidence.authRoutePresent, false);
    assert.equal(result.evidence.authRuntimeImports, 0);
    assert.equal(result.evidence.basicAuthBoundaryIntact, true);
    assert.equal(result.evidence.managedNeonAuthSchemaOwnedByDrizzle, false);
    assert.equal(result.evidence.publicAuthEnvironmentReferences, 0);
    assert.deepEqual(result.blockers, [
      "preview_environment_unverified",
      "production_isolation_unverified",
      "provider_subject_source_unresolved",
      "reviewed_operator_handoff_unresolved",
    ]);
    assert.doesNotMatch(JSON.stringify(result), /[0-9a-f]{8}-[0-9a-f-]{27,}/i);
  });
});

function currentFrozenInput() {
  return {
    nextVersion: "16.2.10",
    authSdkInstalled: false,
    authRoutePresent: false,
    authRuntimeImports: 0,
    basicAuthBoundaryIntact: true,
    managedNeonAuthSchemaOwnedByDrizzle: false,
    publicAuthEnvironmentReferences: 0,
    localEnvironment: {
      baseUrl: "valid",
      cookieSecret: "missing",
      browserAuthUrl: "valid",
    },
    previewEnvironment: UNVERIFIED_ENVIRONMENT,
    productionEnvironment: UNVERIFIED_ENVIRONMENT,
    productionAuthRuntime: "unverified",
    providerSubjectSource: "unresolved",
    operatorHandoff: "unresolved",
  };
}
