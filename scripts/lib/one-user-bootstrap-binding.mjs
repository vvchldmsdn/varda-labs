import { IDENTITY_BOOTSTRAP_CLAIM_POLICY } from "../../src/lib/identity-bootstrap-claim.ts";
import { SESSION_SUBJECT_BINDING_POLICY } from "../../src/lib/auth/session-subject-binding.ts";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const CLAIM_DIGEST_PATTERN =
  /^bootstrap-claim-sha256-v1:[0-9a-f]{64}$/;
const SUBJECT_BINDING_PATTERN = /^hmac-sha256-v1:[0-9a-f]{64}$/;
const SAFE_ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,79}$/;

export const CLAIM_BINDING_KEYS = Object.freeze([
  "targetAppUserSha256",
  "provider",
  "claimDigestVersion",
  "claimDigest",
  "identityPairingIntentSha256",
]);
export const SESSION_BINDING_KEYS = Object.freeze([
  ...CLAIM_BINDING_KEYS,
  "subjectBindingVersion",
  "subjectBinding",
]);
export const FULL_BINDING_KEYS = Object.freeze([
  ...SESSION_BINDING_KEYS,
  "candidateSetDigest",
  "eligibleSetDigest",
]);

export class OneUserBootstrapExecutionError extends Error {
  constructor(code) {
    super("One-user bootstrap execution failed");
    this.name = "OneUserBootstrapExecutionError";
    this.code = code;
  }
}

export function readClaimBinding(value) {
  const binding = Object.freeze({
    targetAppUserSha256: readRequiredString(
      value,
      "targetAppUserSha256",
      "execution_binding_invalid",
    ),
    provider: readRequiredString(
      value,
      "provider",
      "execution_binding_invalid",
    ),
    claimDigestVersion: readRequiredString(
      value,
      "claimDigestVersion",
      "execution_binding_invalid",
    ),
    claimDigest: readRequiredString(
      value,
      "claimDigest",
      "execution_binding_invalid",
    ),
    identityPairingIntentSha256: readRequiredString(
      value,
      "identityPairingIntentSha256",
      "execution_binding_invalid",
    ),
  });
  if (
    !SHA256_PATTERN.test(binding.targetAppUserSha256) ||
    binding.provider !== IDENTITY_BOOTSTRAP_CLAIM_POLICY.provider ||
    binding.claimDigestVersion !==
      IDENTITY_BOOTSTRAP_CLAIM_POLICY.claimDigestVersion ||
    !CLAIM_DIGEST_PATTERN.test(binding.claimDigest) ||
    !SHA256_PATTERN.test(binding.identityPairingIntentSha256)
  ) {
    throw new OneUserBootstrapExecutionError(
      "execution_binding_invalid",
    );
  }
  return binding;
}

export function readSessionBinding(value) {
  const claimBinding = readClaimBinding(value);
  const binding = Object.freeze({
    ...claimBinding,
    subjectBindingVersion: readRequiredString(
      value,
      "subjectBindingVersion",
      "execution_binding_invalid",
    ),
    subjectBinding: readRequiredString(
      value,
      "subjectBinding",
      "execution_binding_invalid",
    ),
  });
  if (
    binding.subjectBindingVersion !==
      SESSION_SUBJECT_BINDING_POLICY.subjectBindingVersion ||
    !SUBJECT_BINDING_PATTERN.test(binding.subjectBinding)
  ) {
    throw new OneUserBootstrapExecutionError(
      "execution_binding_invalid",
    );
  }
  return binding;
}

export function readFullBinding(value) {
  const sessionBinding = readSessionBinding(value);
  const binding = Object.freeze({
    ...sessionBinding,
    candidateSetDigest: readRequiredString(
      value,
      "candidateSetDigest",
      "execution_binding_invalid",
    ),
    eligibleSetDigest: readRequiredString(
      value,
      "eligibleSetDigest",
      "execution_binding_invalid",
    ),
  });
  if (
    !SHA256_PATTERN.test(binding.candidateSetDigest) ||
    !SHA256_PATTERN.test(binding.eligibleSetDigest)
  ) {
    throw new OneUserBootstrapExecutionError(
      "execution_binding_invalid",
    );
  }
  return binding;
}

export function assertBindingMatches(actual, expected, keys) {
  if (keys.some((key) => actual[key] !== expected[key])) {
    throw new OneUserBootstrapExecutionError(
      "execution_binding_mismatch",
    );
  }
}

export function assertSha256Fingerprint(value, code) {
  if (!SHA256_PATTERN.test(value)) {
    throw new OneUserBootstrapExecutionError(code);
  }
}

export function safeErrorCode(error, fallback) {
  const code = readOptionalOwnString(error, "code");
  return code !== null && SAFE_ERROR_CODE_PATTERN.test(code)
    ? code
    : fallback;
}

export function readRequiredMethod(value, key, code) {
  const method = readOwnDataValue(value, key);
  if (typeof method !== "function") {
    throw new OneUserBootstrapExecutionError(code);
  }
  return method;
}

export function readRequiredObject(value, key, code) {
  const result = readOwnDataValue(value, key);
  if (result === null || typeof result !== "object") {
    throw new OneUserBootstrapExecutionError(code);
  }
  return result;
}

export function readRequiredString(value, key, code) {
  const result = readOwnDataValue(value, key);
  if (typeof result !== "string") {
    throw new OneUserBootstrapExecutionError(code);
  }
  return result;
}

export function readRequiredBoolean(value, key, code) {
  const result = readOwnDataValue(value, key);
  if (typeof result !== "boolean") {
    throw new OneUserBootstrapExecutionError(code);
  }
  return result;
}

function readOptionalOwnString(value, key) {
  const result = readOwnDataValue(value, key);
  return typeof result === "string" ? result : null;
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
