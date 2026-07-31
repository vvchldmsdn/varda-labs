import {
  isCanonicalIdentityBootstrapClaim,
} from "../../src/lib/identity-bootstrap-claim.ts";
import {
  SESSION_SUBJECT_BINDING_POLICY,
} from "../../src/lib/auth/session-subject-binding.ts";

const SUBJECT_BINDING_PATTERN = /^hmac-sha256-v1:[0-9a-f]{64}$/;

export const CROSS_PROCESS_IDENTITY_PAIRING_CLAIM_PRESENTATION_POLICY =
  Object.freeze({
    operation: "cross_process_identity_pairing_claim_presentation_v1",
    claimSource: "canonical_http_request_body",
    clientBindingFields: 0,
    sessionReadsPerAttempt: 1,
    writerInvocationsPerAttempt: 1,
    retryCount: 0,
  });

export async function executeCrossProcessIdentityPairingClaimPresentation(
  input,
  dependencies,
) {
  const rawClaim = readOwnDataValue(input, "rawClaim");
  if (!isCanonicalIdentityBootstrapClaim(rawClaim)) {
    return blockedResult("claim_invalid");
  }

  const pool = readOwnDataValue(input, "pool");
  if (!pool || typeof readOwnDataValue(pool, "connect") !== "function") {
    return blockedResult("database_port_invalid");
  }

  const createSessionCapability = readOwnDataValue(
    dependencies,
    "createSessionCapability",
  );
  const consumeIdentityPairingClaim = readOwnDataValue(
    dependencies,
    "consumeIdentityPairingClaim",
  );
  if (
    typeof createSessionCapability !== "function" ||
    typeof consumeIdentityPairingClaim !== "function"
  ) {
    return blockedResult("composition_invalid");
  }

  let capability;
  try {
    capability = await Reflect.apply(
      createSessionCapability,
      undefined,
      [],
    );
  } catch {
    return blockedResult("verified_session_unavailable");
  }

  try {
    if (readOwnDataValue(capability, "state") !== "verified") {
      return blockedResult("verified_session_unavailable");
    }

    const binding = readOwnDataValue(capability, "binding");
    const subjectBindingVersion = readOwnDataValue(
      binding,
      "subjectBindingVersion",
    );
    const subjectBinding = readOwnDataValue(binding, "subjectBinding");
    const consume = readOwnDataValue(capability, "consume");
    if (
      subjectBindingVersion !==
        SESSION_SUBJECT_BINDING_POLICY.subjectBindingVersion ||
      typeof subjectBinding !== "string" ||
      !SUBJECT_BINDING_PATTERN.test(subjectBinding) ||
      typeof consume !== "function"
    ) {
      return blockedResult("session_capability_invalid");
    }

    let writerInvoked = false;
    let writerResult;
    try {
      writerResult = await Reflect.apply(consume, capability, [
        Object.freeze({
          subjectBindingVersion,
          subjectBinding,
          async execute({ verifiedSessionSubjectPort, hmacKey }) {
            writerInvoked = true;
            return Reflect.apply(
              consumeIdentityPairingClaim,
              undefined,
              [
                Object.freeze({
                  pool,
                  rawClaim,
                  verifiedSessionSubjectPort,
                  hmacKey,
                }),
              ],
            );
          },
        }),
      ]);
    } catch {
      return failedResult(writerInvoked);
    }

    if (
      readOwnDataValue(writerResult, "result") !== "consumed" ||
      readOwnDataValue(writerResult, "committed") !== true
    ) {
      return failedResult(writerInvoked);
    }

    return Object.freeze({
      operation:
        CROSS_PROCESS_IDENTITY_PAIRING_CLAIM_PRESENTATION_POLICY.operation,
      result: "consumed",
      committed: true,
      writerInvoked: true,
      retryCount:
        CROSS_PROCESS_IDENTITY_PAIRING_CLAIM_PRESENTATION_POLICY.retryCount,
    });
  } finally {
    destroyCapability(capability);
  }
}

function blockedResult(blocker) {
  return Object.freeze({
    operation:
      CROSS_PROCESS_IDENTITY_PAIRING_CLAIM_PRESENTATION_POLICY.operation,
    result: "blocked",
    blocker,
    committed: false,
    writerInvoked: false,
    retryCount:
      CROSS_PROCESS_IDENTITY_PAIRING_CLAIM_PRESENTATION_POLICY.retryCount,
  });
}

function failedResult(writerInvoked) {
  return Object.freeze({
    operation:
      CROSS_PROCESS_IDENTITY_PAIRING_CLAIM_PRESENTATION_POLICY.operation,
    result: "failed",
    blocker: "identity_consume_failed",
    committed: false,
    writerInvoked,
    retryCount:
      CROSS_PROCESS_IDENTITY_PAIRING_CLAIM_PRESENTATION_POLICY.retryCount,
  });
}

function destroyCapability(value) {
  const destroy = readOwnDataValue(value, "destroy");
  if (typeof destroy !== "function") return;
  try {
    Reflect.apply(destroy, value, []);
  } catch {
    // The original fail-closed outcome remains authoritative.
  }
}

function readOwnDataValue(value, key) {
  if (value === null || typeof value !== "object") return undefined;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
  return descriptor && "value" in descriptor
    ? descriptor.value
    : undefined;
}
