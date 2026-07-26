import "server-only";

import { getAuthTransportRuntime } from "@/lib/auth/auth-transport-runtime";
import {
  decodeSessionSubjectBindingHmacKey,
  readSessionSubjectBinding,
  type SessionSubjectBindingResult,
  type VerifiedSessionSubjectPort,
} from "@/lib/auth/session-subject-binding";

const IDENTITY_PAIRING_EVIDENCE_HMAC_KEY_ENV =
  "IDENTITY_PAIRING_EVIDENCE_HMAC_KEY";

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
  return decodeSessionSubjectBindingHmacKey(
    process.env[IDENTITY_PAIRING_EVIDENCE_HMAC_KEY_ENV],
  );
}

function unavailable(): SessionSubjectBindingResult {
  return Object.freeze({ state: "unavailable" });
}
