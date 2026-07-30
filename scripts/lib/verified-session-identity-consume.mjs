import {
  digestIdentityBootstrapClaim,
  isCanonicalIdentityBootstrapClaim,
} from "../../src/lib/identity-bootstrap-claim.ts";
import {
  assertBindingMatches,
  OneUserBootstrapExecutionError,
  readRequiredMethod,
  readRequiredObject,
  readRequiredString,
  readSessionBinding,
  safeErrorCode,
  SESSION_BINDING_KEYS,
} from "./one-user-bootstrap-binding.mjs";

export const VERIFIED_SESSION_IDENTITY_CONSUME_POLICY = Object.freeze({
  operation: "verified_session_identity_consume_v1",
  sessionReadsPerAttempt: 1,
  claimContinuationTakesPerAttempt: 1,
  writerInvocationsPerAttempt: 1,
  retryCount: 0,
});

export async function executeVerifiedSessionIdentityConsume(
  input,
  dependencies,
) {
  const executionBinding = readSessionBinding(
    readRequiredObject(
      input,
      "executionBinding",
      "execution_binding_invalid",
    ),
  );
  const claimContinuationPort = readRequiredObject(
    input,
    "claimContinuationPort",
    "claim_continuation_port_invalid",
  );
  const takeClaim = readRequiredMethod(
    claimContinuationPort,
    "take",
    "claim_continuation_port_invalid",
  );
  const pool = readRequiredObject(
    input,
    "pool",
    "database_port_invalid",
  );
  if (typeof readOwnDataValue(pool, "connect") !== "function") {
    throw new OneUserBootstrapExecutionError("database_port_invalid");
  }

  const createSessionCapability = readRequiredMethod(
    dependencies,
    "createSessionCapability",
    "session_capability_factory_invalid",
  );
  const consumeIdentityPairingClaim = readRequiredMethod(
    dependencies,
    "consumeIdentityPairingClaim",
    "identity_consume_writer_invalid",
  );

  let sessionCapability;
  try {
    sessionCapability = await Reflect.apply(
      createSessionCapability,
      undefined,
      [],
    );
  } catch (error) {
    return blockedResult(
      safeErrorCode(error, "verified_session_unavailable"),
    );
  }

  const sessionState = readOwnDataValue(sessionCapability, "state");
  if (
    sessionState === "disabled" ||
    sessionState === "missing" ||
    sessionState === "unavailable"
  ) {
    return blockedResult(`verified_session_${sessionState}`);
  }
  if (sessionState !== "verified") {
    destroyCapability(sessionCapability);
    return blockedResult("verified_session_unavailable");
  }

  const capabilityBinding = readRequiredObject(
    sessionCapability,
    "binding",
    "session_capability_invalid",
  );
  if (
    readOwnDataValue(capabilityBinding, "subjectBindingVersion") !==
      executionBinding.subjectBindingVersion ||
    readOwnDataValue(capabilityBinding, "subjectBinding") !==
      executionBinding.subjectBinding
  ) {
    destroyCapability(sessionCapability);
    return blockedResult("session_binding_mismatch");
  }

  let rawClaim = null;
  let claimContinuationTaken = false;
  try {
    const continuation = await Reflect.apply(
      takeClaim,
      claimContinuationPort,
      [Object.freeze({ executionBinding })],
    );
    claimContinuationTaken = true;
    const continuationBinding = readSessionBinding(
      readRequiredObject(
        continuation,
        "executionBinding",
        "claim_continuation_invalid",
      ),
    );
    assertBindingMatches(
      continuationBinding,
      executionBinding,
      SESSION_BINDING_KEYS,
    );
    rawClaim = readRequiredString(
      continuation,
      "rawClaim",
      "claim_continuation_invalid",
    );
    if (!isCanonicalIdentityBootstrapClaim(rawClaim)) {
      throw new OneUserBootstrapExecutionError(
        "claim_continuation_invalid",
      );
    }
    if (digestIdentityBootstrapClaim(rawClaim) !== executionBinding.claimDigest) {
      throw new OneUserBootstrapExecutionError(
        "execution_binding_mismatch",
      );
    }
  } catch (error) {
    destroyCapability(sessionCapability);
    return blockedResult(
      safeErrorCode(error, "claim_continuation_unavailable"),
      claimContinuationTaken,
    );
  }

  try {
    const consumeCapability = readRequiredMethod(
      sessionCapability,
      "consume",
      "session_capability_invalid",
    );
    const writerResult = await Reflect.apply(
      consumeCapability,
      sessionCapability,
      [
        Object.freeze({
          subjectBindingVersion:
            executionBinding.subjectBindingVersion,
          subjectBinding: executionBinding.subjectBinding,
          async execute({
            verifiedSessionSubjectPort,
            hmacKey,
          }) {
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
      ],
    );
    return readConsumedResult(writerResult);
  } catch (error) {
    return partialResult(
      safeErrorCode(error, "identity_consume_failed"),
    );
  } finally {
    rawClaim = null;
    destroyCapability(sessionCapability);
  }
}

function readConsumedResult(value) {
  if (
    readRequiredString(
      value,
      "result",
      "identity_consume_result_invalid",
    ) !== "consumed" ||
    readOwnDataValue(value, "committed") !== true
  ) {
    throw new OneUserBootstrapExecutionError(
      "identity_consume_result_invalid",
    );
  }

  return Object.freeze({
    operation: VERIFIED_SESSION_IDENTITY_CONSUME_POLICY.operation,
    result: "consumed",
    committed: true,
    retryCount: VERIFIED_SESSION_IDENTITY_CONSUME_POLICY.retryCount,
  });
}

function blockedResult(blocker, claimContinuationTaken = false) {
  return Object.freeze({
    operation: VERIFIED_SESSION_IDENTITY_CONSUME_POLICY.operation,
    result: "blocked",
    blocker,
    claimContinuationTaken,
    writerInvoked: false,
    restartRequired: claimContinuationTaken,
    retryCount: VERIFIED_SESSION_IDENTITY_CONSUME_POLICY.retryCount,
  });
}

function partialResult(blocker) {
  return Object.freeze({
    operation: VERIFIED_SESSION_IDENTITY_CONSUME_POLICY.operation,
    result: "partial",
    failedPhase: "identity_consume",
    blocker,
    committedPhases: Object.freeze([]),
    crossPhaseRollbackAttempted: false,
    restartRequired: true,
    retryCount: VERIFIED_SESSION_IDENTITY_CONSUME_POLICY.retryCount,
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
