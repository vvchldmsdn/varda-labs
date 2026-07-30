import { isCanonicalIdentityBootstrapClaim } from "../../src/lib/identity-bootstrap-claim.ts";
import { SESSION_SUBJECT_BINDING_POLICY } from "../../src/lib/auth/session-subject-binding.ts";
import {
  assertBindingMatches,
  CLAIM_BINDING_KEYS,
  OneUserBootstrapExecutionError,
  readClaimBinding,
  readRequiredBoolean,
  readRequiredMethod,
  readRequiredObject,
  readRequiredString,
  safeErrorCode,
} from "./one-user-bootstrap-binding.mjs";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SUBJECT_BINDING_PATTERN = /^hmac-sha256-v1:[0-9a-f]{64}$/;

export const VERIFIED_SESSION_CLAIM_PRESENTATION_POLICY = Object.freeze({
  operation: "verified_session_claim_presentation_v1",
  sessionReadsPerAttempt: 1,
  issuerCreationRequiresVerifiedSession: true,
  presentationEvidence: "same_server_invocation_transient",
  retryCount: 0,
});

export async function executeVerifiedSessionClaimPresentation(
  input,
  dependencies,
) {
  const targetAppUserSha256 = readRequiredString(
    input,
    "targetAppUserSha256",
    "target_app_user_fingerprint_invalid",
  );
  if (!SHA256_PATTERN.test(targetAppUserSha256)) {
    throw new OneUserBootstrapExecutionError(
      "target_app_user_fingerprint_invalid",
    );
  }

  const createClaimIssuerPort = readRequiredMethod(
    input,
    "createClaimIssuerPort",
    "claim_issuer_factory_invalid",
  );
  const privateClaimPresentationPort = readRequiredObject(
    input,
    "privateClaimPresentationPort",
    "private_claim_presentation_port_invalid",
  );
  const presentPrivateClaim = readRequiredMethod(
    privateClaimPresentationPort,
    "present",
    "private_claim_presentation_port_invalid",
  );
  const readSessionBinding = readRequiredMethod(
    dependencies,
    "readSessionBinding",
    "session_binding_reader_invalid",
  );
  const startExecution = readRequiredMethod(
    dependencies,
    "startExecution",
    "bootstrap_execution_invalid",
  );

  const sessionGate = await readVerifiedSessionGate(readSessionBinding);
  if (sessionGate.state === "blocked") {
    return blockedResult(sessionGate.blocker);
  }

  let claimIssuerPort;
  try {
    claimIssuerPort = await Reflect.apply(
      createClaimIssuerPort,
      undefined,
      [],
    );
  } catch (error) {
    return partialResult(
      "claim_issuer_capability",
      safeErrorCode(error, "claim_issuer_capability_failed"),
    );
  }

  const claimPresentationPort = Object.freeze({
    async present(value) {
      const rawClaim = readRequiredString(
        value,
        "rawClaim",
        "claim_continuation_invalid",
      );
      if (!isCanonicalIdentityBootstrapClaim(rawClaim)) {
        throw new OneUserBootstrapExecutionError(
          "claim_continuation_invalid",
        );
      }
      const claimBinding = readClaimBinding(
        readRequiredObject(
          value,
          "executionBinding",
          "execution_binding_invalid",
        ),
      );

      const privateReceipt = await Reflect.apply(
        presentPrivateClaim,
        privateClaimPresentationPort,
        [
          Object.freeze({
            rawClaim,
            executionBinding: claimBinding,
          }),
        ],
      );
      if (
        readRequiredString(
          privateReceipt,
          "result",
          "claim_presentation_result_invalid",
        ) !== "presented" ||
        readRequiredBoolean(
          privateReceipt,
          "committed",
          "claim_presentation_result_invalid",
        ) !== true
      ) {
        throw new OneUserBootstrapExecutionError(
          "claim_presentation_result_invalid",
        );
      }
      const receiptBinding = readClaimBinding(
        readRequiredObject(
          privateReceipt,
          "executionBinding",
          "claim_presentation_result_invalid",
        ),
      );
      assertBindingMatches(
        receiptBinding,
        claimBinding,
        CLAIM_BINDING_KEYS,
      );

      return Object.freeze({
        result: "presented",
        committed: true,
        executionBinding: Object.freeze({
          ...claimBinding,
          subjectBindingVersion:
            sessionGate.binding.subjectBindingVersion,
          subjectBinding: sessionGate.binding.subjectBinding,
        }),
      });
    },
  });

  return Reflect.apply(startExecution, undefined, [
    Object.freeze({
      targetAppUserSha256,
      claimIssuerPort,
      claimPresentationPort,
    }),
  ]);
}

async function readVerifiedSessionGate(readSessionBinding) {
  let value;
  try {
    value = await Reflect.apply(readSessionBinding, undefined, []);
  } catch {
    return Object.freeze({
      state: "blocked",
      blocker: "verified_session_unavailable",
    });
  }

  const state = readOwnDataValue(value, "state");
  if (
    state === "disabled" ||
    state === "missing" ||
    state === "unavailable"
  ) {
    return Object.freeze({
      state: "blocked",
      blocker: `verified_session_${state}`,
    });
  }
  if (state !== "verified") {
    return Object.freeze({
      state: "blocked",
      blocker: "verified_session_unavailable",
    });
  }

  const provider = readOwnDataValue(value, "provider");
  const subjectBindingVersion = readOwnDataValue(
    value,
    "subjectBindingVersion",
  );
  const subjectBinding = readOwnDataValue(value, "subjectBinding");
  const verificationSource = readOwnDataValue(
    value,
    "verificationSource",
  );
  if (
    provider !== SESSION_SUBJECT_BINDING_POLICY.provider ||
    subjectBindingVersion !==
      SESSION_SUBJECT_BINDING_POLICY.subjectBindingVersion ||
    typeof subjectBinding !== "string" ||
    !SUBJECT_BINDING_PATTERN.test(subjectBinding) ||
    verificationSource !==
      SESSION_SUBJECT_BINDING_POLICY.verificationSource
  ) {
    return Object.freeze({
      state: "blocked",
      blocker: "verified_session_unavailable",
    });
  }

  return Object.freeze({
    state: "verified",
    binding: Object.freeze({
      subjectBindingVersion,
      subjectBinding,
    }),
  });
}

function blockedResult(blocker) {
  return Object.freeze({
    operation: VERIFIED_SESSION_CLAIM_PRESENTATION_POLICY.operation,
    result: "blocked",
    blocker,
    issuerCapabilityCreated: false,
    claimIssued: false,
    retryCount: VERIFIED_SESSION_CLAIM_PRESENTATION_POLICY.retryCount,
  });
}

function partialResult(failedPhase, blocker) {
  return Object.freeze({
    operation: VERIFIED_SESSION_CLAIM_PRESENTATION_POLICY.operation,
    result: "partial",
    failedPhase,
    blocker,
    committedPhases: Object.freeze([]),
    crossPhaseRollbackAttempted: false,
    restartRequired: false,
    retryCount: VERIFIED_SESSION_CLAIM_PRESENTATION_POLICY.retryCount,
  });
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
