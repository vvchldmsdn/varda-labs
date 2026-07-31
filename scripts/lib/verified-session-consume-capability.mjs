import {
  createSessionSubjectBinding,
  SESSION_SUBJECT_BINDING_POLICY,
  snapshotSessionSubjectEvidence,
} from "../../src/lib/auth/session-subject-binding.ts";

const SUBJECT_BINDING_PATTERN = /^hmac-sha256-v1:[0-9a-f]{64}$/;

export const VERIFIED_SESSION_CONSUME_CAPABILITY_POLICY = Object.freeze({
  operation: "verified_session_consume_capability_v1",
  sessionReadsPerAttempt: 1,
  consumeInvocationsPerCapability: 1,
  retryCount: 0,
});

export class VerifiedSessionConsumeCapabilityError extends Error {
  constructor(code) {
    super("Verified session consume capability failed");
    this.name = "VerifiedSessionConsumeCapabilityError";
    this.code = code;
  }
}

export async function createVerifiedSessionConsumeCapability({
  sessionPort,
  hmacKey,
}) {
  if (!sessionPort || typeof readOwnDataValue(sessionPort, "read") !== "function") {
    throw new VerifiedSessionConsumeCapabilityError(
      "verified_subject_port_invalid",
    );
  }
  if (
    !(hmacKey instanceof Uint8Array) ||
    hmacKey.byteLength !== SESSION_SUBJECT_BINDING_POLICY.hmacKeyBytes
  ) {
    throw new VerifiedSessionConsumeCapabilityError(
      "binding_key_invalid",
    );
  }

  const privateKey = Uint8Array.from(hmacKey);
  let evidence;
  try {
    evidence = await Reflect.apply(
      readOwnDataValue(sessionPort, "read"),
      sessionPort,
      [],
    );
  } catch {
    privateKey.fill(0);
    return blocked("unavailable");
  }

  const evidenceSnapshot = snapshotSessionSubjectEvidence(evidence);
  const binding = createSessionSubjectBinding({
    evidence: evidenceSnapshot,
    hmacKey: privateKey,
  });
  if (binding.state !== "verified") {
    privateKey.fill(0);
    return blocked(binding.state);
  }

  let sealedEvidence = evidenceSnapshot;
  let sealedKey = privateKey;
  let available = true;

  return Object.freeze({
    state: "verified",
    binding: Object.freeze({
      subjectBindingVersion: binding.subjectBindingVersion,
      subjectBinding: binding.subjectBinding,
    }),
    async consume(input) {
      if (!available || sealedEvidence === null || sealedKey === null) {
        throw new VerifiedSessionConsumeCapabilityError(
          "session_capability_already_consumed",
        );
      }

      available = false;
      const evidenceForConsume = sealedEvidence;
      const keyForConsume = sealedKey;
      sealedEvidence = null;
      sealedKey = null;

      let oneShotEvidence = evidenceForConsume;
      const verifiedSessionSubjectPort = Object.freeze({
        async read() {
          if (oneShotEvidence === null) {
            return Object.freeze({ state: "unavailable" });
          }
          const current = oneShotEvidence;
          oneShotEvidence = null;
          return current;
        },
      });

      try {
        assertExpectedBinding(input, binding);
        const execute = readOwnDataValue(input, "execute");
        if (typeof execute !== "function") {
          throw new VerifiedSessionConsumeCapabilityError(
            "consume_executor_invalid",
          );
        }
        return await Reflect.apply(execute, undefined, [
          Object.freeze({
            verifiedSessionSubjectPort,
            hmacKey: keyForConsume,
          }),
        ]);
      } finally {
        oneShotEvidence = null;
        keyForConsume.fill(0);
      }
    },
    destroy() {
      available = false;
      sealedEvidence = null;
      if (sealedKey !== null) sealedKey.fill(0);
      sealedKey = null;
    },
    isAvailable() {
      return available;
    },
    toJSON() {
      return Object.freeze({
        state: available ? "ready" : "consumed",
      });
    },
  });
}

function assertExpectedBinding(input, actual) {
  if (input === null || typeof input !== "object") {
    throw new VerifiedSessionConsumeCapabilityError(
      "expected_session_binding_invalid",
    );
  }
  const expectedVersion = readOwnDataValue(
    input,
    "subjectBindingVersion",
  );
  const expectedBinding = readOwnDataValue(input, "subjectBinding");
  if (
    expectedVersion !==
      SESSION_SUBJECT_BINDING_POLICY.subjectBindingVersion ||
    typeof expectedBinding !== "string" ||
    !SUBJECT_BINDING_PATTERN.test(expectedBinding)
  ) {
    throw new VerifiedSessionConsumeCapabilityError(
      "expected_session_binding_invalid",
    );
  }
  if (
    expectedVersion !== actual.subjectBindingVersion ||
    expectedBinding !== actual.subjectBinding
  ) {
    throw new VerifiedSessionConsumeCapabilityError(
      "session_binding_mismatch",
    );
  }
}

function blocked(state) {
  return Object.freeze({ state });
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
