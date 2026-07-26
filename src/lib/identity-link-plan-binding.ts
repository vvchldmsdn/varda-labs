import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";

import {
  SESSION_SUBJECT_BINDING_POLICY,
  isCanonicalSessionProviderSubject,
} from "./auth/session-subject-binding.ts";

export const IDENTITY_LINK_PLAN_BINDING_POLICY = Object.freeze({
  plannerPolicyId: "initial_identity_link_planner_v1",
  planBindingVersion: "identity_link_plan_hmac_sha256_v1",
  planBindingPrefix: "identity-link-plan-hmac-sha256-v1:",
  hmacDomain:
    "varda.identity-pairing.identity-link-plan-hmac-sha256.v1",
  hmacAlgorithm: "sha256",
} as const);

export type LockedIdentityLinkEvidence = Readonly<{
  id: string;
  appUserId: string;
  provider: string;
  subject: string;
  status: "active" | "disabled";
}>;

export type IdentityLinkPlanBinding = Readonly<{
  plannerPolicyId: "initial_identity_link_planner_v1";
  planBindingVersion: "identity_link_plan_hmac_sha256_v1";
  planBinding: `identity-link-plan-hmac-sha256-v1:${string}`;
}>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SUBJECT_BINDING_PATTERN = /^hmac-sha256-v1:[0-9a-f]{64}$/;

export function createIdentityLinkPlanBinding(input: Readonly<{
  hmacKey: Uint8Array;
  provider: "neon_auth";
  subjectBindingVersion: "provider_subject_hmac_sha256_v1";
  subjectBinding: `hmac-sha256-v1:${string}`;
  targetAppUserId: string;
  targetStatus: "provisioning";
  targetRole: "user";
  existingLinks: readonly LockedIdentityLinkEvidence[];
}>): IdentityLinkPlanBinding {
  assertInput(input);
  const existingLinks = canonicalizeExistingLinks(input.existingLinks);
  const payload = JSON.stringify({
    plannerPolicyId: IDENTITY_LINK_PLAN_BINDING_POLICY.plannerPolicyId,
    outcome: "planned_link",
    provider: input.provider,
    subjectBindingVersion: input.subjectBindingVersion,
    subjectBinding: input.subjectBinding,
    targetAppUserId: input.targetAppUserId,
    targetStatus: input.targetStatus,
    targetRole: input.targetRole,
    existingLinks,
  });

  const key = Buffer.from(input.hmacKey);
  try {
    const digest = createHmac(
      IDENTITY_LINK_PLAN_BINDING_POLICY.hmacAlgorithm,
      key,
    )
      .update(IDENTITY_LINK_PLAN_BINDING_POLICY.hmacDomain, "utf8")
      .update("\u0000", "utf8")
      .update(payload, "utf8")
      .digest("hex");

    return Object.freeze({
      plannerPolicyId:
        IDENTITY_LINK_PLAN_BINDING_POLICY.plannerPolicyId,
      planBindingVersion:
        IDENTITY_LINK_PLAN_BINDING_POLICY.planBindingVersion,
      planBinding:
        `${IDENTITY_LINK_PLAN_BINDING_POLICY.planBindingPrefix}${digest}`,
    });
  } finally {
    key.fill(0);
  }
}

function assertInput(
  input: Parameters<typeof createIdentityLinkPlanBinding>[0],
) {
  if (
    !(input.hmacKey instanceof Uint8Array) ||
    input.hmacKey.byteLength !==
      SESSION_SUBJECT_BINDING_POLICY.hmacKeyBytes
  ) {
    throw new Error("Identity link plan HMAC key is invalid");
  }
  if (
    input.provider !== SESSION_SUBJECT_BINDING_POLICY.provider ||
    input.subjectBindingVersion !==
      SESSION_SUBJECT_BINDING_POLICY.subjectBindingVersion ||
    !SUBJECT_BINDING_PATTERN.test(input.subjectBinding)
  ) {
    throw new Error("Identity link subject binding is invalid");
  }
  if (
    !UUID_PATTERN.test(input.targetAppUserId) ||
    input.targetStatus !== "provisioning" ||
    input.targetRole !== "user"
  ) {
    throw new Error("Identity link target evidence is invalid");
  }
  if (!Array.isArray(input.existingLinks)) {
    throw new Error("Identity link evidence is invalid");
  }
}

function canonicalizeExistingLinks(
  links: readonly LockedIdentityLinkEvidence[],
) {
  const canonical = links.map((link) => {
    if (
      !link ||
      typeof link !== "object" ||
      !UUID_PATTERN.test(link.id) ||
      !UUID_PATTERN.test(link.appUserId) ||
      link.provider !== SESSION_SUBJECT_BINDING_POLICY.provider ||
      !isCanonicalSessionProviderSubject(link.subject) ||
      (link.status !== "active" && link.status !== "disabled")
    ) {
      throw new Error("Identity link evidence is invalid");
    }
    return Object.freeze({
      id: link.id,
      appUserId: link.appUserId,
      provider: link.provider,
      subject: link.subject,
      status: link.status,
    });
  });

  for (let index = 1; index < canonical.length; index += 1) {
    if (canonical[index - 1].id >= canonical[index].id) {
      throw new Error("Identity link evidence order is invalid");
    }
  }
  return Object.freeze(canonical);
}
