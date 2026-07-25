import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  planIdentityBootstrapClaim,
  projectIdentityBootstrapClaimPlan,
} from "../src/lib/identity-bootstrap-claim-authority.ts";
import {
  canAuthorizeIdentityBootstrapClaim,
  IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY,
} from "../src/lib/identity-bootstrap-claim-authority-policy.ts";
import { auditIdentityBootstrapClaimAuthority } from "../scripts/lib/identity-bootstrap-claim-authority-audit.mjs";
import { TENANT_WRITER_REGISTRY } from "../src/lib/tenant-writer-registry.ts";

const TARGET = "11111111-1111-4111-8111-111111111111";
const OTHER_TARGET = "22222222-2222-4222-8222-222222222222";
const INTENT = "33333333-3333-4333-8333-333333333333";
const CLAIM_DIGEST =
  `bootstrap-claim-sha256-v1:${"a".repeat(64)}`;
const SUBJECT_BINDING =
  `hmac-sha256-v1:${"b".repeat(64)}`;
const PLAN_BINDING =
  `identity-link-plan-hmac-sha256-v1:${"c".repeat(64)}`;

describe("preissued identity bootstrap claim authority", () => {
  it("prepares only a synthetic dry-run without mutation authority", () => {
    assert.deepEqual(planIdentityBootstrapClaim(validInput()), {
      outcome: "synthetic_dry_run_ready",
      reason: null,
      policyId: "preissued_bootstrap_claim_authority_v1",
      runtimeTrustStatus: "not_established",
      identityDmlEnabled: false,
      intentConsumptionEnabled: false,
      appUserMutation: "none",
    });
  });

  it("requires a separately preissued claim instead of session or Basic Auth", () => {
    assert.equal(
      canAuthorizeIdentityBootstrapClaim("preissued_bootstrap_claim"),
      true,
    );
    for (const authorizationSource of [
      "verified_subject_session",
      "basic_auth",
      "machine_secret",
      "request_target",
    ]) {
      assert.equal(
        canAuthorizeIdentityBootstrapClaim(authorizationSource),
        false,
      );
      assertBlocked(
        planIdentityBootstrapClaim({
          ...validInput(),
          claim: { ...validInput().claim, authorizationSource },
        }),
        "verified_claim_invalid",
      );
    }
  });

  it("rejects missing, unverified, or malformed claim evidence", () => {
    for (const claim of [
      { state: "missing" },
      { state: "unverified" },
    ]) {
      assertBlocked(
        planIdentityBootstrapClaim({ ...validInput(), claim }),
        "verified_claim_required",
      );
    }
    assertBlocked(
      planIdentityBootstrapClaim({
        ...validInput(),
        claim: {
          ...validInput().claim,
          claimDigest: "bootstrap-claim-sha256-v1:invalid",
        },
      }),
      "verified_claim_invalid",
    );
  });

  it("requires a verified provider session", () => {
    for (const subjectSession of [
      { state: "missing" },
      { state: "unverified" },
      {
        ...validInput().subjectSession,
        verificationSource: "not_server_verified",
      },
    ]) {
      assertBlocked(
        planIdentityBootstrapClaim({
          ...validInput(),
          subjectSession,
        }),
        "verified_subject_required",
      );
    }
  });

  it("requires exactly one explicitly reviewed provisioning user", () => {
    for (const reviewedTarget of [
      { state: "missing" },
      { state: "ambiguous" },
    ]) {
      assertBlocked(
        planIdentityBootstrapClaim({
          ...validInput(),
          reviewedTarget,
        }),
        "reviewed_target_required",
      );
    }
    for (const reviewedTarget of [
      { ...validInput().reviewedTarget, candidateCount: 2 },
      { ...validInput().reviewedTarget, appUserStatus: "active" },
      { ...validInput().reviewedTarget, appUserRole: "admin" },
      { ...validInput().reviewedTarget, appUserId: "not-a-uuid" },
    ]) {
      assertBlocked(
        planIdentityBootstrapClaim({
          ...validInput(),
          reviewedTarget,
        }),
        "reviewed_target_invalid",
      );
    }
  });

  it("binds the preissued claim to the reviewed target", () => {
    for (const claimIntent of [
      { ...validInput().claimIntent, targetAppUserId: OTHER_TARGET },
      {
        ...validInput().claimIntent,
        claimDigest:
          `bootstrap-claim-sha256-v1:${"d".repeat(64)}`,
      },
    ]) {
      assertBlocked(
        planIdentityBootstrapClaim({
          ...validInput(),
          claimIntent,
        }),
        "claim_intent_binding_mismatch",
      );
    }
    assertBlocked(
      planIdentityBootstrapClaim({
        ...validInput(),
        claimIntent: {
          ...validInput().claimIntent,
          provider: "other_auth",
        },
      }),
      "claim_intent_invalid",
    );
  });

  it("blocks used or inactive claim intents", () => {
    for (const [state, reason] of [
      ["missing", "claim_intent_required"],
      ["consumed", "claim_intent_consumed"],
      ["revoked", "claim_intent_revoked"],
      ["expired", "claim_intent_expired"],
    ]) {
      assertBlocked(
        planIdentityBootstrapClaim({
          ...validInput(),
          claimIntent: { state },
        }),
        reason,
      );
    }
  });

  it("enforces strict UTC timing and the ten-minute lifetime", () => {
    assertBlocked(
      planIdentityBootstrapClaim({
        ...validInput(),
        evaluationTime: "2026-07-25T10:59:59.999Z",
      }),
      "claim_intent_not_yet_valid",
    );
    assertBlocked(
      planIdentityBootstrapClaim({
        ...validInput(),
        evaluationTime: "2026-07-25T11:10:00.000Z",
      }),
      "claim_intent_expired",
    );
    assertBlocked(
      planIdentityBootstrapClaim({
        ...validInput(),
        claimIntent: {
          ...validInput().claimIntent,
          expiresAt: "2026-07-25T11:10:00.001Z",
        },
      }),
      "claim_intent_lifetime_exceeded",
    );
  });

  it("binds the G1-A commitment to the same session and target", () => {
    for (const identityLinkPlan of [
      {
        ...validInput().identityLinkPlan,
        subjectBinding:
          `hmac-sha256-v1:${"d".repeat(64)}`,
      },
      {
        ...validInput().identityLinkPlan,
        targetAppUserId: OTHER_TARGET,
      },
    ]) {
      assertBlocked(
        planIdentityBootstrapClaim({
          ...validInput(),
          identityLinkPlan,
        }),
        "identity_link_plan_binding_mismatch",
      );
    }
    assertBlocked(
      planIdentityBootstrapClaim({
        ...validInput(),
        identityLinkPlan: {
          ...validInput().identityLinkPlan,
          outcome: "already_linked",
        },
      }),
      "identity_already_linked",
    );
  });

  it("projects no target, claim, subject, or plan evidence", () => {
    const projection = projectIdentityBootstrapClaimPlan(
      planIdentityBootstrapClaim(validInput()),
    );
    assert.deepEqual(projection, {
      outcome: "synthetic_dry_run_ready",
      reason: null,
    });
    assert.deepEqual(Object.keys(projection).sort(), ["outcome", "reason"]);
  });

  it("keeps the approved policy constants exact", () => {
    assert.deepEqual(IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY, {
      policyId: "preissued_bootstrap_claim_authority_v1",
      provider: "neon_auth",
      claimDigestVersion: "bootstrap_claim_sha256_v1",
      targetReviewPolicyId:
        "single_provisioning_user_explicit_review_v1",
      subjectBindingVersion: "provider_subject_hmac_sha256_v1",
      identityLinkPlannerPolicyId: "initial_identity_link_planner_v1",
      identityLinkPlanBindingVersion:
        "identity_link_plan_hmac_sha256_v1",
      maxIntentLifetimeMs: 600000,
      authorizationSource: "preissued_bootstrap_claim",
      intentPersistence: "server_durable_single_use_record",
    });
  });

  it("remains disconnected from production runtime and writers", () => {
    const audit = auditIdentityBootstrapClaimAuthority({
      root: process.cwd(),
      writerRegistry: TENANT_WRITER_REGISTRY,
    });
    assert.equal(audit.status, "passed");
    assert.deepEqual(audit.findings, []);
    assert.deepEqual(
      {
        productionImports: audit.evidence.productionImports,
        databaseQueries: audit.evidence.databaseQueries,
        databaseWrites: audit.evidence.databaseWrites,
        identityWrites: audit.evidence.identityWrites,
        appUserStatusChanges: audit.evidence.appUserStatusChanges,
      },
      {
        productionImports: 0,
        databaseQueries: 0,
        databaseWrites: 0,
        identityWrites: 0,
        appUserStatusChanges: 0,
      },
    );
  });
});

function validInput() {
  return {
    claim: {
      state: "verified",
      authorizationSource: "preissued_bootstrap_claim",
      claimDigestVersion: "bootstrap_claim_sha256_v1",
      claimDigest: CLAIM_DIGEST,
      verificationSource: "server_verified_claim_digest",
    },
    subjectSession: {
      state: "verified",
      provider: "neon_auth",
      subjectBindingVersion: "provider_subject_hmac_sha256_v1",
      subjectBinding: SUBJECT_BINDING,
      verificationSource: "server_verified_session",
    },
    reviewedTarget: {
      state: "reviewed",
      appUserId: TARGET,
      appUserStatus: "provisioning",
      appUserRole: "user",
      candidateCount: 1,
      reviewSource: "explicit_review",
      targetReviewPolicyId:
        "single_provisioning_user_explicit_review_v1",
    },
    claimIntent: {
      state: "pending",
      intentId: INTENT,
      authorityPolicyId: "preissued_bootstrap_claim_authority_v1",
      targetAppUserId: TARGET,
      provider: "neon_auth",
      claimDigestVersion: "bootstrap_claim_sha256_v1",
      claimDigest: CLAIM_DIGEST,
      targetReviewPolicyId:
        "single_provisioning_user_explicit_review_v1",
      issuedAt: "2026-07-25T11:00:00.000Z",
      expiresAt: "2026-07-25T11:10:00.000Z",
      persistence: "server_durable_single_use_record",
    },
    identityLinkPlan: {
      state: "verified",
      outcome: "planned_link",
      identityDmlEnabled: false,
      appUserMutation: "none",
      plannerPolicyId: "initial_identity_link_planner_v1",
      provider: "neon_auth",
      subjectBindingVersion: "provider_subject_hmac_sha256_v1",
      subjectBinding: SUBJECT_BINDING,
      targetAppUserId: TARGET,
      planBindingVersion: "identity_link_plan_hmac_sha256_v1",
      planBinding: PLAN_BINDING,
      commitmentSource: "server_verified_g1a_commitment",
    },
    evaluationTime: "2026-07-25T11:05:00.000Z",
  };
}

function assertBlocked(plan, reason) {
  assert.deepEqual(plan, {
    outcome: "blocked",
    reason,
    policyId: "preissued_bootstrap_claim_authority_v1",
    runtimeTrustStatus: "not_established",
    identityDmlEnabled: false,
    intentConsumptionEnabled: false,
    appUserMutation: "none",
  });
}
