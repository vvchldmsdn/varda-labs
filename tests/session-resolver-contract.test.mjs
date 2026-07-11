import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  SESSION_RESOLUTION_FAILURE_CONTRACT,
  projectSessionResolutionForBoundary,
  resolveSessionToAppUser,
} from "../src/lib/session-resolver-contract.ts";
import {
  REQUEST_SCOPED_RESOLVER_CACHE_CONTRACT,
  SESSION_CREDENTIAL_BOUNDARY,
  SESSION_TENANT_SOURCE_POLICY,
  canSourceTenant,
  credentialHasCapability,
} from "../src/lib/session-resolver-policy.ts";
import { TENANT_WRITER_REGISTRY } from "../src/lib/tenant-writer-registry.ts";
import { auditSessionResolverContract } from "../scripts/lib/session-resolver-contract-audit.mjs";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";

describe("provider-neutral session resolver Phase 1G0", () => {
  it("freezes every typed failure code and HTTP status", () => {
    assert.deepEqual(SESSION_RESOLUTION_FAILURE_CONTRACT, [
      { code: "unauthenticated", httpStatus: 401 },
      { code: "auth_provider_unavailable", httpStatus: 503 },
      { code: "identity_unlinked", httpStatus: 403 },
      { code: "identity_mapping_collision", httpStatus: 500 },
      { code: "identity_not_active", httpStatus: 403 },
      { code: "app_user_not_active", httpStatus: 403 },
      { code: "identity_mapping_integrity", httpStatus: 500 },
      { code: "resolver_state_invalid", httpStatus: 500 },
    ]);
  });

  it("separates unauthenticated and provider-outage failures", () => {
    assertFailure(
      resolveSessionToAppUser(notStarted("unauthenticated")),
      "unauthenticated",
      401,
    );
    assertFailure(
      resolveSessionToAppUser(notStarted("unavailable")),
      "auth_provider_unavailable",
      503,
    );
  });

  it("fails closed for unlinked, collision, and disabled identity states", () => {
    assertFailure(
      resolveSessionToAppUser(authenticated({ state: "unlinked" })),
      "identity_unlinked",
      403,
    );
    assertFailure(
      resolveSessionToAppUser(authenticated({ state: "collision" })),
      "identity_mapping_collision",
      500,
    );
    assertFailure(
      resolveSessionToAppUser(
        authenticated({
          state: "mapped",
          appUserId: OWNER_A,
          identityStatus: "disabled",
        }),
      ),
      "identity_not_active",
      403,
    );
  });

  it("does not implicitly link by profile fields or singleton app-user fallback", () => {
    const result = resolveSessionToAppUser({
      ...authenticated({ state: "unlinked" }),
      providerSubject: "subject-marker",
      email: "email-marker",
      singletonAppUser: {
        id: OWNER_A,
        status: "active",
        role: "user",
      },
    });

    assertFailure(result, "identity_unlinked", 403);
  });

  it("blocks provisioning and disabled app users with app_user_not_active", () => {
    for (const status of ["provisioning", "disabled"]) {
      assertFailure(
        resolveSessionToAppUser(activeMapping({
          state: "loaded",
          id: OWNER_A,
          status,
          role: "user",
        })),
        "app_user_not_active",
        403,
      );
    }
  });

  it("rejects missing, malformed, or mismatched app-user mappings", () => {
    assertFailure(
      resolveSessionToAppUser(activeMapping({ state: "missing" })),
      "identity_mapping_integrity",
      500,
    );
    assertFailure(
      resolveSessionToAppUser(activeMapping({
        state: "loaded",
        id: "not-a-uuid",
        status: "active",
        role: "user",
      })),
      "identity_mapping_integrity",
      500,
    );
    assertFailure(
      resolveSessionToAppUser(activeMapping({
        state: "loaded",
        id: OWNER_B,
        status: "active",
        role: "user",
      })),
      "identity_mapping_integrity",
      500,
    );
  });

  it("fails closed for unknown runtime port variants", () => {
    assertFailure(
      resolveSessionToAppUser({
        ...activeMapping({
          state: "loaded",
          id: OWNER_A,
          status: "active",
          role: "user",
        }),
        providerSession: { state: "unknown" },
      }),
      "resolver_state_invalid",
      500,
    );
    assertFailure(
      resolveSessionToAppUser({
        ...activeMapping({
          state: "loaded",
          id: OWNER_A,
          status: "active",
          role: "user",
        }),
        identityMapping: {
          state: "mapped",
          appUserId: OWNER_A,
          identityStatus: "unknown",
        },
      }),
      "resolver_state_invalid",
      500,
    );
  });

  it("returns an internal TenantContext only for one active mapped user", () => {
    const result = resolveSessionToAppUser(activeMapping({
      state: "loaded",
      id: OWNER_A,
      status: "active",
      role: "user",
    }));

    assert.deepEqual(result, {
      ok: true,
      tenantContext: { ownerUserId: OWNER_A, role: "user" },
    });
  });

  it("keeps internal identity out of the public boundary projection", () => {
    const internal = resolveSessionToAppUser({
      ...activeMapping({
        state: "loaded",
        id: OWNER_A,
        status: "active",
        role: "admin",
      }),
      email: "email-marker",
      providerSubject: "subject-marker",
      token: "token-marker",
      cookie: "cookie-marker",
    });
    const projected = projectSessionResolutionForBoundary(internal);
    const serialized = JSON.stringify(projected);

    assert.deepEqual(projected, { ok: true, status: "resolved" });
    for (const forbidden of [
      OWNER_A,
      "email-marker",
      "subject-marker",
      "token-marker",
      "cookie-marker",
    ]) {
      assert.equal(serialized.includes(forbidden), false);
    }
  });

  it("allows only a verified active mapping to source a tenant", () => {
    assert.equal(
      SESSION_TENANT_SOURCE_POLICY.filter(({ canSourceTenant }) =>
        canSourceTenant
      ).length,
      1,
    );
    assert.equal(canSourceTenant("verified_active_identity_mapping"), true);
    for (const source of [
      "account_scope",
      "basic_auth_username",
      "email",
      "provider_subject_direct",
      "url_owner_value",
      "body_owner_value",
      "header_owner_value",
      "machine_secret",
    ]) {
      assert.equal(canSourceTenant(source), false, source);
    }

    assert.equal(
      SESSION_TENANT_SOURCE_POLICY.find(
        ({ source }) => source === "account_scope",
      )?.usage,
      "secondary_filter_only",
    );
  });

  it("keeps user and machine authorization capabilities separate", () => {
    assert.equal(SESSION_CREDENTIAL_BOUNDARY.length, 3);
    assert.equal(
      credentialHasCapability(
        "mapped_active_user_session",
        "resolve_user_tenant",
      ),
      true,
    );
    assert.equal(
      credentialHasCapability(
        "mapped_active_user_session",
        "authorize_machine_job",
      ),
      false,
    );
    assert.equal(
      credentialHasCapability("machine_secret", "resolve_user_tenant"),
      false,
    );
    assert.equal(
      credentialHasCapability("machine_secret", "authorize_machine_job"),
      true,
    );
    assert.equal(
      credentialHasCapability("basic_auth", "resolve_user_tenant"),
      false,
    );
  });

  it("leaves request dedupe and provider cookie TTL as interface-only work", () => {
    assert.deepEqual(REQUEST_SCOPED_RESOLVER_CACHE_CONTRACT, {
      implementationStatus: "interface_only",
      scope: "request_only",
      dedupeKey: "implicit_current_request",
      providerCookieTtl: "deferred_until_sdk_integration",
      crossRequestCache: "forbidden",
    });
  });

  it("has no production import, SDK, DB, route, identity write, or cache implementation", () => {
    const result = auditSessionResolverContract({
      root: process.cwd(),
      writerRegistry: TENANT_WRITER_REGISTRY,
    });

    assert.equal(result.status, "passed");
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.evidence, {
      pureContractViolations: 0,
      identityDmlMatches: 0,
      productionImports: 0,
      authSdkDependencies: 0,
      basicAuthBoundaryIntact: true,
      databaseQueries: 0,
      databaseWrites: 0,
      providerCalls: 0,
      routeCalls: 0,
      cacheImplementations: 0,
    });

    const auditCliSource = readFileSync(
      "scripts/audit-session-resolver-contract.mjs",
      "utf8",
    );
    const auditLibrarySource = readFileSync(
      "scripts/lib/session-resolver-contract-audit.mjs",
      "utf8",
    );
    const importSpecifiers = [...`${auditCliSource}\n${auditLibrarySource}`.matchAll(
      /from\s+["']([^"']+)["']/g,
    )].map((match) => match[1]);

    assert.deepEqual(importSpecifiers.sort(), [
      "../src/lib/tenant-writer-registry.ts",
      "./lib/session-resolver-contract-audit.mjs",
      "node:fs",
      "node:path",
    ]);
    assert.doesNotMatch(auditCliSource, /DATABASE_URL|process\.env|\bfetch\s*\(/);
  });
});

function notStarted(providerState) {
  return {
    providerSession: { state: providerState },
    identityMapping: { state: "not_requested" },
    appUser: { state: "not_requested" },
  };
}

function authenticated(identityMapping) {
  return {
    providerSession: { state: "authenticated" },
    identityMapping,
    appUser: { state: "not_requested" },
  };
}

function activeMapping(appUser) {
  return {
    providerSession: { state: "authenticated" },
    identityMapping: {
      state: "mapped",
      appUserId: OWNER_A,
      identityStatus: "active",
    },
    appUser,
  };
}

function assertFailure(result, code, httpStatus) {
  assert.deepEqual(result, {
    ok: false,
    failure: { code, httpStatus },
  });
  assert.deepEqual(projectSessionResolutionForBoundary(result), {
    ok: false,
    code,
    httpStatus,
  });
}
