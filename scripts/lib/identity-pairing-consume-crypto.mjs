import { createHmac } from "node:crypto";

export const IDENTITY_PAIRING_HMAC_KEY_ENV =
  "IDENTITY_PAIRING_EVIDENCE_HMAC_KEY";
export const IDENTITY_PAIRING_HMAC_KEY_BYTES = 32;
export const IDENTITY_PAIRING_SUBJECT_BINDING_VERSION =
  "provider_subject_hmac_sha256_v1";
export const IDENTITY_PAIRING_PLAN_BINDING_VERSION =
  "identity_link_plan_hmac_sha256_v1";
export const IDENTITY_PAIRING_PLANNER_POLICY_ID =
  "initial_identity_link_planner_v1";

const SUBJECT_DOMAIN =
  "varda.identity-pairing.provider-subject-hmac-sha256.v1";
const PLAN_DOMAIN =
  "varda.identity-pairing.identity-link-plan-hmac-sha256.v1";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function decodeIdentityPairingHmacKey(encodedKey) {
  if (
    typeof encodedKey !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(encodedKey)
  ) {
    throw new Error("Identity pairing HMAC key is invalid");
  }
  const key = Buffer.from(encodedKey, "base64url");
  assertIdentityPairingHmacKey(key);
  return key;
}

export function createIdentityPairingBindings({
  hmacKey,
  provider,
  subject,
  targetAppUserId,
  targetStatus,
  targetRole,
  existingLinks,
}) {
  assertIdentityPairingHmacKey(hmacKey);
  if (provider !== "neon_auth") {
    throw new Error("Identity pairing provider is invalid");
  }
  if (
    typeof subject !== "string" ||
    subject.length === 0 ||
    subject.length > 255 ||
    subject.trim() !== subject
  ) {
    throw new Error("Identity pairing subject is invalid");
  }
  if (!UUID_PATTERN.test(targetAppUserId)) {
    throw new Error("Identity pairing target is invalid");
  }
  if (targetStatus !== "provisioning" || targetRole !== "user") {
    throw new Error("Identity pairing target state is invalid");
  }

  const canonicalLinks = canonicalizeExistingLinks(existingLinks);
  const subjectBinding = `hmac-sha256-v1:${hmacHex(
    hmacKey,
    SUBJECT_DOMAIN,
    JSON.stringify({
      provider,
      subject,
    }),
  )}`;
  const planBinding =
    `identity-link-plan-hmac-sha256-v1:${hmacHex(
      hmacKey,
      PLAN_DOMAIN,
      JSON.stringify({
        plannerPolicyId: IDENTITY_PAIRING_PLANNER_POLICY_ID,
        outcome: "planned_link",
        provider,
        subjectBindingVersion: IDENTITY_PAIRING_SUBJECT_BINDING_VERSION,
        subjectBinding,
        targetAppUserId,
        targetStatus,
        targetRole,
        existingLinks: canonicalLinks,
      }),
    )}`;

  return Object.freeze({
    subjectBindingVersion: IDENTITY_PAIRING_SUBJECT_BINDING_VERSION,
    subjectBinding,
    plannerPolicyId: IDENTITY_PAIRING_PLANNER_POLICY_ID,
    planBindingVersion: IDENTITY_PAIRING_PLAN_BINDING_VERSION,
    planBinding,
  });
}

function canonicalizeExistingLinks(existingLinks) {
  if (!Array.isArray(existingLinks)) {
    throw new Error("Identity pairing link evidence is invalid");
  }

  const canonical = existingLinks.map((link) => {
    if (
      !link ||
      typeof link !== "object" ||
      !UUID_PATTERN.test(link.id) ||
      !UUID_PATTERN.test(link.appUserId) ||
      typeof link.provider !== "string" ||
      typeof link.subject !== "string" ||
      (link.status !== "active" && link.status !== "disabled")
    ) {
      throw new Error("Identity pairing link evidence is invalid");
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
      throw new Error(
        "Identity pairing link evidence is not in stable id order",
      );
    }
  }
  return Object.freeze(canonical);
}

function assertIdentityPairingHmacKey(hmacKey) {
  if (
    !(hmacKey instanceof Uint8Array) ||
    hmacKey.byteLength !== IDENTITY_PAIRING_HMAC_KEY_BYTES
  ) {
    throw new Error("Identity pairing HMAC key is invalid");
  }
}

function hmacHex(hmacKey, domain, payload) {
  return createHmac("sha256", Buffer.from(hmacKey))
    .update(domain, "utf8")
    .update("\u0000", "utf8")
    .update(payload, "utf8")
    .digest("hex");
}
