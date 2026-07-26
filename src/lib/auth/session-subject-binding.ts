import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";

export const SESSION_SUBJECT_BINDING_POLICY = Object.freeze({
  policyId: "private_session_subject_binding_v1",
  provider: "neon_auth",
  subjectBindingVersion: "provider_subject_hmac_sha256_v1",
  subjectBindingPrefix: "hmac-sha256-v1:",
  verificationSource: "server_verified_session",
  hmacAlgorithm: "sha256",
  hmacKeyBytes: 32,
  hmacDomain:
    "varda.identity-pairing.provider-subject-hmac-sha256.v1",
  maxSubjectBytes: 255,
} as const);

export type VerifiedSessionSubjectEvidence =
  | Readonly<{ state: "disabled" | "missing" | "unavailable" }>
  | Readonly<{
      state: "verified";
      provider: "neon_auth";
      subject: string;
      verificationSource: "server_verified_session";
    }>;

export type VerifiedSessionSubjectPort = Readonly<{
  read(): Promise<VerifiedSessionSubjectEvidence>;
}>;

export type SessionSubjectBindingResult =
  | Readonly<{ state: "disabled" | "missing" | "unavailable" }>
  | Readonly<{
      state: "verified";
      provider: "neon_auth";
      subjectBindingVersion: "provider_subject_hmac_sha256_v1";
      subjectBinding: `hmac-sha256-v1:${string}`;
      verificationSource: "server_verified_session";
    }>;

const CANONICAL_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function decodeSessionSubjectBindingHmacKey(
  encoded: string | undefined,
): Uint8Array | null {
  if (
    typeof encoded !== "string" ||
    !CANONICAL_BASE64URL_PATTERN.test(encoded)
  ) {
    return null;
  }

  const decoded = Buffer.from(encoded, "base64url");
  if (
    decoded.byteLength !== SESSION_SUBJECT_BINDING_POLICY.hmacKeyBytes ||
    decoded.toString("base64url") !== encoded
  ) {
    decoded.fill(0);
    return null;
  }

  const key = Uint8Array.from(decoded);
  decoded.fill(0);
  return key;
}

export async function readSessionSubjectBinding(input: Readonly<{
  sessionPort: VerifiedSessionSubjectPort;
  hmacKey: Uint8Array;
}>): Promise<SessionSubjectBindingResult> {
  if (!isValidHmacKey(input.hmacKey)) return unavailable();

  let evidence: VerifiedSessionSubjectEvidence;
  try {
    evidence = await input.sessionPort.read();
  } catch {
    return unavailable();
  }

  if (
    evidence.state === "disabled" ||
    evidence.state === "missing" ||
    evidence.state === "unavailable"
  ) {
    return Object.freeze({ state: evidence.state });
  }
  if (
    evidence.state !== "verified" ||
    evidence.provider !== SESSION_SUBJECT_BINDING_POLICY.provider ||
    evidence.verificationSource !==
      SESSION_SUBJECT_BINDING_POLICY.verificationSource
  ) {
    return unavailable();
  }
  if (!isCanonicalProviderSubject(evidence.subject)) {
    return Object.freeze({ state: "missing" });
  }

  const payload = JSON.stringify({
    provider: SESSION_SUBJECT_BINDING_POLICY.provider,
    subject: evidence.subject,
  });
  const subjectBinding = `${SESSION_SUBJECT_BINDING_POLICY.subjectBindingPrefix}${createHmac(
    SESSION_SUBJECT_BINDING_POLICY.hmacAlgorithm,
    Buffer.from(input.hmacKey),
  )
    .update(SESSION_SUBJECT_BINDING_POLICY.hmacDomain, "utf8")
    .update("\u0000", "utf8")
    .update(payload, "utf8")
    .digest("hex")}` as const;

  return Object.freeze({
    state: "verified",
    provider: SESSION_SUBJECT_BINDING_POLICY.provider,
    subjectBindingVersion:
      SESSION_SUBJECT_BINDING_POLICY.subjectBindingVersion,
    subjectBinding,
    verificationSource:
      SESSION_SUBJECT_BINDING_POLICY.verificationSource,
  });
}

function isValidHmacKey(value: Uint8Array) {
  return (
    value instanceof Uint8Array &&
    value.byteLength === SESSION_SUBJECT_BINDING_POLICY.hmacKeyBytes
  );
}

function isCanonicalProviderSubject(value: string) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value
  ) {
    return false;
  }

  const bytes = new TextEncoder().encode(value);
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > SESSION_SUBJECT_BINDING_POLICY.maxSubjectBytes
  ) {
    return false;
  }

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return false;
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
  }

  return true;
}

function unavailable(): SessionSubjectBindingResult {
  return Object.freeze({ state: "unavailable" });
}
