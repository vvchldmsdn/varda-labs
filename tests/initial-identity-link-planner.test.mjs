import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  canSourceReviewedTarget,
  canTransportProviderSubject,
  IDENTITY_LINK_TARGET_SOURCE_POLICY,
  PROVIDER_SUBJECT_TRANSPORT_POLICY,
} from "../src/lib/initial-identity-link-policy.ts";
import {
  planInitialIdentityLink,
  prepareVerifiedProviderSubjectPort,
  projectInitialIdentityLinkPlanForBoundary,
} from "../src/lib/initial-identity-link-planner.ts";
import { resolveSessionToAppUser } from "../src/lib/session-resolver-contract.ts";
import { TENANT_WRITER_REGISTRY } from "../src/lib/tenant-writer-registry.ts";
import { auditInitialIdentityLinkPlanner } from "../scripts/lib/initial-identity-link-planner-audit.mjs";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";

describe("reviewed initial identity-link planner Phase 1G1-A", () => {
  it("normalizes provider but preserves opaque subject case", () => {
    const port = prepareVerifiedProviderSubjectPort({
      provider: "  NEON_AUTH ",
      subject: "  Subject-With-Case  ",
      verified: true,
    });

    assert.deepEqual(port, {
      state: "verified",
      provider: "neon_auth",
      subject: "Subject-With-Case",
      verificationSource: "server_verified_session",
    });
  });

  it("does not retain missing or unverified subject values", () => {
    assert.deepEqual(
      prepareVerifiedProviderSubjectPort({
        provider: "neon_auth",
        subject: "",
        verified: true,
      }),
      { state: "missing" },
    );
    assert.deepEqual(
      prepareVerifiedProviderSubjectPort({
        provider: "neon_auth",
        subject: "unverified-marker",
        verified: false,
      }),
      { state: "unverified" },
    );
  });

  it("plans one link without enabling identity or app-user DML", () => {
    assert.deepEqual(planInitialIdentityLink(validInput()), {
      outcome: "planned_link",
      reason: null,
      appUserMutation: "none",
      identityDmlEnabled: false,
    });
  });

  it("blocks missing or unverified provider subject", () => {
    for (const providerSubject of [
      { state: "missing" },
      { state: "unverified" },
    ]) {
      assertBlocked(
        planInitialIdentityLink({ ...validInput(), providerSubject }),
        "verified_provider_subject_required",
      );
    }
    assertBlocked(
      planInitialIdentityLink({
        ...validInput(),
        providerSubject: {
          state: "verified",
          provider: " NEON_AUTH ",
          subject: " Subject-With-Case ",
          verificationSource: "forged",
        },
      }),
      "verified_provider_subject_required",
    );
  });

  it("blocks missing, ambiguous, non-provisioning, or non-user targets", () => {
    for (const reviewedTarget of [
      { state: "missing" },
      { state: "ambiguous" },
    ]) {
      assertBlocked(
        planInitialIdentityLink({ ...validInput(), reviewedTarget }),
        "reviewed_target_required",
      );
    }

    for (const status of ["active", "disabled"]) {
      assertBlocked(
        planInitialIdentityLink({
          ...validInput(),
          reviewedTarget: reviewedTarget({ appUserStatus: status }),
        }),
        "target_status_not_provisioning",
      );
    }
    assertBlocked(
      planInitialIdentityLink({
        ...validInput(),
        reviewedTarget: reviewedTarget({ appUserRole: "admin" }),
      }),
      "target_role_not_user",
    );
    assertBlocked(
      planInitialIdentityLink({
        ...validInput(),
        reviewedTarget: reviewedTarget({ candidateCount: 2 }),
      }),
      "target_cardinality_mismatch",
    );
    assertBlocked(
      planInitialIdentityLink({
        ...validInput(),
        reviewedTarget: reviewedTarget({ reviewSource: "singleton" }),
      }),
      "target_review_source_invalid",
    );
    assertBlocked(
      planInitialIdentityLink({
        ...validInput(),
        reviewedTarget: reviewedTarget({ appUserId: "not-a-uuid" }),
      }),
      "target_uuid_invalid",
    );
  });

  it("blocks provider-subject collision with another app user", () => {
    assertBlocked(
      planInitialIdentityLink({
        ...validInput(),
        existingLinks: [identityLink({ appUserId: OWNER_B })],
      }),
      "provider_subject_collision",
    );
  });

  it("returns already_linked only for the exact active link", () => {
    assert.deepEqual(
      planInitialIdentityLink({
        ...validInput(),
        existingLinks: [identityLink()],
      }),
      {
        outcome: "already_linked",
        reason: null,
        appUserMutation: "none",
        identityDmlEnabled: false,
      },
    );
    assertBlocked(
      planInitialIdentityLink({
        ...validInput(),
        existingLinks: [identityLink({ status: "disabled" })],
      }),
      "existing_link_disabled",
    );
  });

  it("blocks a different active subject already linked to the target provider", () => {
    assertBlocked(
      planInitialIdentityLink({
        ...validInput(),
        existingLinks: [identityLink({ subject: "Different-Subject" })],
      }),
      "target_provider_collision",
    );
  });

  it("preserves subject case when checking uniqueness", () => {
    assert.equal(
      planInitialIdentityLink({
        ...validInput(),
        existingLinks: [
          identityLink({
            subject: "subject-with-case",
            appUserId: OWNER_B,
          }),
        ],
      }).outcome,
      "planned_link",
    );
  });

  it("blocks duplicate or malformed identity evidence", () => {
    const duplicate = identityLink();
    assertBlocked(
      planInitialIdentityLink({
        ...validInput(),
        existingLinks: [duplicate, { ...duplicate }],
      }),
      "duplicate_identity_evidence",
    );
    assertBlocked(
      planInitialIdentityLink({
        ...validInput(),
        existingLinks: [identityLink({ appUserId: "not-a-uuid" })],
      }),
      "identity_evidence_invalid",
    );
    assertBlocked(
      planInitialIdentityLink({
        ...validInput(),
        existingLinks: [null],
      }),
      "identity_evidence_invalid",
    );
  });

  it("forbids fallback target sources and subject transports", () => {
    assert.equal(
      IDENTITY_LINK_TARGET_SOURCE_POLICY.filter(({ allowed }) => allowed).length,
      1,
    );
    assert.equal(canSourceReviewedTarget("explicit_reviewed_app_user_id"), true);
    for (const source of [
      "singleton_app_users",
      "email",
      "basic_auth_username",
      "account_scope",
      "legacy_owner_value",
      "url_owner_value",
      "body_owner_value",
      "header_owner_value",
      "machine_secret",
    ]) {
      assert.equal(canSourceReviewedTarget(source), false, source);
    }

    assert.equal(
      PROVIDER_SUBJECT_TRANSPORT_POLICY.filter(({ allowed }) => allowed).length,
      1,
    );
    assert.equal(canTransportProviderSubject("verified_server_session_port"), true);
    for (const transport of [
      "cli_argument",
      "environment_variable",
      "url",
      "request_body",
      "request_header",
      "log",
    ]) {
      assert.equal(canTransportProviderSubject(transport), false, transport);
    }
  });

  it("keeps identifiers and subject material out of plan projections", () => {
    const plan = planInitialIdentityLink(validInput());
    const projection = projectInitialIdentityLinkPlanForBoundary(plan);
    const serialized = `${JSON.stringify(plan)}${JSON.stringify(projection)}`;

    assert.deepEqual(projection, { outcome: "planned_link", reason: null });
    for (const forbidden of [
      OWNER_A,
      "Subject-With-Case",
      "neon_auth",
      "email",
      "fingerprint",
    ]) {
      assert.equal(serialized.includes(forbidden), false);
    }
  });

  it("keeps a synthetically linked provisioning user blocked in G0", () => {
    const result = resolveSessionToAppUser({
      providerSession: { state: "authenticated" },
      identityMapping: {
        state: "mapped",
        appUserId: OWNER_A,
        identityStatus: "active",
      },
      appUser: {
        state: "loaded",
        id: OWNER_A,
        status: "provisioning",
        role: "user",
      },
    });

    assert.deepEqual(result, {
      ok: false,
      failure: { code: "app_user_not_active", httpStatus: 403 },
    });
  });

  it("has no production import, DML, SDK, subject CLI, or runtime call", () => {
    const result = auditInitialIdentityLinkPlanner({
      root: process.cwd(),
      writerRegistry: TENANT_WRITER_REGISTRY,
    });

    assert.equal(result.status, "passed");
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.evidence, {
      pureContractViolations: 0,
      identityDmlMatches: 0,
      productionImports: 0,
      subjectCliEntrypoints: 0,
      authSdkDependencies: 0,
      basicAuthBoundaryIntact: true,
      databaseQueries: 0,
      databaseWrites: 0,
      providerCalls: 0,
      routeCalls: 0,
      appUserStatusChanges: 0,
    });

    const auditCli = readFileSync(
      "scripts/audit-initial-identity-link-planner.mjs",
      "utf8",
    );
    assert.doesNotMatch(
      auditCli,
      /process\.argv|process\.env|--provider|--subject|DATABASE_URL|\bfetch\s*\(/,
    );
  });
});

function validInput() {
  return {
    providerSubject: prepareVerifiedProviderSubjectPort({
      provider: "neon_auth",
      subject: "Subject-With-Case",
      verified: true,
    }),
    reviewedTarget: reviewedTarget(),
    existingLinks: [],
  };
}

function reviewedTarget(overrides = {}) {
  return {
    state: "reviewed",
    appUserId: OWNER_A,
    appUserStatus: "provisioning",
    appUserRole: "user",
    candidateCount: 1,
    reviewSource: "explicit_review",
    ...overrides,
  };
}

function identityLink(overrides = {}) {
  return {
    provider: "neon_auth",
    subject: "Subject-With-Case",
    appUserId: OWNER_A,
    status: "active",
    ...overrides,
  };
}

function assertBlocked(plan, reason) {
  assert.deepEqual(plan, {
    outcome: "blocked",
    reason,
    appUserMutation: "none",
    identityDmlEnabled: false,
  });
}
