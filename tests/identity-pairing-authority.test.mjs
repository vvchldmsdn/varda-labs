import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  planIdentityPairingAuthority,
  projectIdentityPairingAuthorityPlan,
} from "../src/lib/identity-pairing-authority.ts";
import {
  canAuthorizeIdentityPairing,
  canTransportIdentityPairingChallenge,
  IDENTITY_PAIRING_AUTHORITY_POLICY,
} from "../src/lib/identity-pairing-authority-policy.ts";
import { auditIdentityPairingAuthority } from "../scripts/lib/identity-pairing-authority-audit.mjs";
import { TENANT_WRITER_REGISTRY } from "../src/lib/tenant-writer-registry.ts";

const TARGET = "11111111-1111-4111-8111-111111111111";
const OTHER_TARGET = "22222222-2222-4222-8222-222222222222";
const INTENT = "33333333-3333-4333-8333-333333333333";
const BINDING = `hmac-sha256-v1:${"a".repeat(64)}`;

describe("identity pairing authority Phase 1G1-B1b", () => {
  it("prepares only a synthetic dry-run without mutation authority", () => {
    assert.deepEqual(planIdentityPairingAuthority(validInput()), {
      outcome: "synthetic_dry_run_ready",
      reason: null,
      policyId: "identity_pairing_authority_v1",
      runtimeTrustStatus: "not_established",
      identityDmlEnabled: false,
      intentConsumptionEnabled: false,
      appUserMutation: "none",
    });
  });

  it("accepts only an independent server-verified operator", () => {
    assert.equal(canAuthorizeIdentityPairing("server_verified_operator_session"), true);
    for (const authorizationSource of [
      "preview_subject_session",
      "basic_auth",
      "machine_secret",
      "request_claim",
    ]) {
      assert.equal(canAuthorizeIdentityPairing(authorizationSource), false);
      assertBlocked(
        planIdentityPairingAuthority({
          ...validInput(),
          operator: { ...validInput().operator, authorizationSource },
        }),
        "operator_authority_invalid",
      );
    }
    assertBlocked(
      planIdentityPairingAuthority({
        ...validInput(),
        operator: {
          ...validInput().operator,
          actorSeparation: "not_verified",
        },
      }),
      "operator_subject_separation_required",
    );
  });

  it("rejects missing or unverified subject binding", () => {
    for (const subjectSession of [
      { state: "missing" },
      { state: "unverified" },
    ]) {
      assertBlocked(
        planIdentityPairingAuthority({ ...validInput(), subjectSession }),
        "verified_subject_binding_required",
      );
    }
  });

  it("requires one explicit provisioning user target", () => {
    for (const reviewedTarget of [
      { state: "missing" },
      { state: "ambiguous" },
    ]) {
      assertBlocked(
        planIdentityPairingAuthority({ ...validInput(), reviewedTarget }),
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
        planIdentityPairingAuthority({ ...validInput(), reviewedTarget }),
        "reviewed_target_invalid",
      );
    }
  });

  it("binds operator, subject session, intent, and target exactly", () => {
    assertBlocked(
      planIdentityPairingAuthority({
        ...validInput(),
        operator: {
          ...validInput().operator,
          reviewedTargetAppUserId: OTHER_TARGET,
        },
      }),
      "operator_target_mismatch",
    );
    for (const pairingIntent of [
      { ...validInput().pairingIntent, targetAppUserId: OTHER_TARGET },
      {
        ...validInput().pairingIntent,
        subjectBinding: `hmac-sha256-v1:${"b".repeat(64)}`,
      },
    ]) {
      assertBlocked(
        planIdentityPairingAuthority({ ...validInput(), pairingIntent }),
        "pairing_intent_binding_mismatch",
      );
    }
  });

  it("rejects consumed, revoked, expired, future, and overlong intents", () => {
    for (const [state, reason] of [
      ["consumed", "pairing_intent_consumed"],
      ["revoked", "pairing_intent_revoked"],
      ["expired", "pairing_intent_expired"],
    ]) {
      assertBlocked(
        planIdentityPairingAuthority({
          ...validInput(),
          pairingIntent: { state },
        }),
        reason,
      );
    }
    assertBlocked(
      planIdentityPairingAuthority({
        ...validInput(),
        evaluationTime: "2026-07-25T05:59:59.000Z",
      }),
      "pairing_intent_not_yet_valid",
    );
    assertBlocked(
      planIdentityPairingAuthority({
        ...validInput(),
        evaluationTime: "2026-07-25T06:10:00.000Z",
      }),
      "pairing_intent_expired",
    );
    assertBlocked(
      planIdentityPairingAuthority({
        ...validInput(),
        pairingIntent: {
          ...validInput().pairingIntent,
          expiresAt: "2026-07-25T06:10:00.001Z",
        },
      }),
      "pairing_intent_lifetime_exceeded",
    );
  });

  it("rejects unsafe challenge transports", () => {
    assert.equal(
      canTransportIdentityPairingChallenge(
        "http_only_same_site_strict_cookie",
      ),
      true,
    );
    for (const challengeTransport of [
      "url",
      "request_body",
      "request_header",
      "local_storage",
    ]) {
      assert.equal(
        canTransportIdentityPairingChallenge(challengeTransport),
        false,
      );
      assertBlocked(
        planIdentityPairingAuthority({
          ...validInput(),
          pairingIntent: {
            ...validInput().pairingIntent,
            challengeTransport,
          },
        }),
        "pairing_intent_invalid",
      );
    }
  });

  it("does not elevate blocked or already-linked identity plans", () => {
    for (const [outcome, reason] of [
      ["blocked", "identity_link_plan_blocked"],
      ["already_linked", "identity_already_linked"],
    ]) {
      assertBlocked(
        planIdentityPairingAuthority({
          ...validInput(),
          identityLinkPlan: {
            ...validInput().identityLinkPlan,
            outcome,
          },
        }),
        reason,
      );
    }
  });

  it("keeps identifiers and bindings out of public projections", () => {
    const plan = planIdentityPairingAuthority(validInput());
    const projection = projectIdentityPairingAuthorityPlan(plan);
    const serialized = JSON.stringify(projection);

    assert.deepEqual(projection, {
      outcome: "synthetic_dry_run_ready",
      reason: null,
    });
    for (const forbidden of [TARGET, INTENT, BINDING, "neon_auth"]) {
      assert.equal(serialized.includes(forbidden), false);
    }
  });

  it("keeps the contract disconnected from runtime and persistence", () => {
    const result = auditIdentityPairingAuthority({
      root: process.cwd(),
      writerRegistry: TENANT_WRITER_REGISTRY,
    });

    assert.equal(result.status, "passed");
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.evidence, {
      pureContractViolations: 0,
      identityDmlMatches: 0,
      unexpectedImports: 0,
      productionImports: 0,
      subjectEntrypoints: 0,
      basicAuthBoundaryIntact: true,
      databaseQueries: 0,
      databaseWrites: 0,
      providerCalls: 0,
      routeCalls: 0,
      intentWrites: 0,
      appUserStatusChanges: 0,
    });
  });
});

function validInput() {
  return {
    operator: {
      state: "authorized",
      authorizationSource: "server_verified_operator_session",
      actorSeparation: "verified_distinct",
      reviewedTargetAppUserId: TARGET,
    },
    subjectSession: {
      state: "verified",
      provider: "neon_auth",
      subjectBindingVersion: "provider_subject_hmac_sha256_v1",
      subjectBinding: BINDING,
      verificationSource: "server_verified_session",
    },
    reviewedTarget: {
      state: "reviewed",
      appUserId: TARGET,
      appUserStatus: "provisioning",
      appUserRole: "user",
      candidateCount: 1,
      reviewSource: "explicit_review",
    },
    pairingIntent: {
      state: "pending",
      intentId: INTENT,
      provider: "neon_auth",
      subjectBindingVersion: "provider_subject_hmac_sha256_v1",
      subjectBinding: BINDING,
      targetAppUserId: TARGET,
      issuedAt: "2026-07-25T06:00:00.000Z",
      expiresAt: "2026-07-25T06:10:00.000Z",
      persistence: "server_durable_single_use_record",
      challengeTransport: "http_only_same_site_strict_cookie",
    },
    identityLinkPlan: {
      outcome: "planned_link",
      identityDmlEnabled: false,
      appUserMutation: "none",
    },
    evaluationTime: "2026-07-25T06:05:00.000Z",
  };
}

function assertBlocked(plan, reason) {
  assert.deepEqual(plan, {
    outcome: "blocked",
    reason,
    policyId: IDENTITY_PAIRING_AUTHORITY_POLICY.policyId,
    runtimeTrustStatus: "not_established",
    identityDmlEnabled: false,
    intentConsumptionEnabled: false,
    appUserMutation: "none",
  });
}
