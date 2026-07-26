import "server-only";

import { Buffer } from "node:buffer";

import { getAuthTransportRuntime } from "@/lib/auth/auth-transport-runtime";
import {
  readSessionSubjectBinding,
  type SessionSubjectBindingResult,
  type VerifiedSessionSubjectPort,
} from "@/lib/auth/session-subject-binding";

const IDENTITY_PAIRING_EVIDENCE_HMAC_KEY_ENV =
  "IDENTITY_PAIRING_EVIDENCE_HMAC_KEY";
const IDENTITY_PAIRING_EVIDENCE_HMAC_KEY_PATTERN =
  /^[A-Za-z0-9_-]{43}$/;
const IDENTITY_PAIRING_EVIDENCE_HMAC_KEY_BYTES = 32;

export async function readPrivateSessionSubjectBinding(): Promise<SessionSubjectBindingResult> {
  let runtime: ReturnType<typeof getAuthTransportRuntime>;
  try {
    runtime = getAuthTransportRuntime();
  } catch {
    return unavailable();
  }

  if (runtime.state === "disabled") {
    return Object.freeze({ state: "disabled" });
  }
  if (runtime.state !== "ready") return unavailable();

  const auth = runtime.auth;
  const hmacKey = loadEvidenceHmacKey();
  if (!hmacKey) return unavailable();

  const sessionPort: VerifiedSessionSubjectPort = Object.freeze({
    async read() {
      try {
        const result = await auth.getSession();
        if (result.error) return Object.freeze({ state: "unavailable" });

        const subject = result.data?.user.id;
        if (typeof subject !== "string") {
          return Object.freeze({ state: "missing" });
        }

        return Object.freeze({
          state: "verified",
          provider: "neon_auth",
          subject,
          verificationSource: "server_verified_session",
        });
      } catch {
        return Object.freeze({ state: "unavailable" });
      }
    },
  });

  try {
    return await readSessionSubjectBinding({ sessionPort, hmacKey });
  } finally {
    hmacKey.fill(0);
  }
}

function loadEvidenceHmacKey() {
  const encoded =
    process.env[IDENTITY_PAIRING_EVIDENCE_HMAC_KEY_ENV]?.trim();
  if (
    !encoded ||
    !IDENTITY_PAIRING_EVIDENCE_HMAC_KEY_PATTERN.test(encoded)
  ) {
    return null;
  }

  const decoded = Buffer.from(encoded, "base64url");
  if (decoded.byteLength !== IDENTITY_PAIRING_EVIDENCE_HMAC_KEY_BYTES) {
    decoded.fill(0);
    return null;
  }

  const key = Uint8Array.from(decoded);
  decoded.fill(0);
  return key;
}

function unavailable(): SessionSubjectBindingResult {
  return Object.freeze({ state: "unavailable" });
}
