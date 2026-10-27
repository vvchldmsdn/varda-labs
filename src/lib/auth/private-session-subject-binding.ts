import "server-only";

import { getAuthTransportRuntime } from "@/lib/auth/auth-transport-runtime";
import { readCurrentSessionSubject } from "@/lib/auth/current-session-subject";
import {
  decodeSessionSubjectBindingHmacKey,
  readSessionSubjectBinding,
  type SessionSubjectBindingResult,
  type VerifiedSessionSubjectPort,
} from "@/lib/auth/session-subject-binding";
import { createVerifiedSessionConsumeCapability } from "../../../scripts/lib/verified-session-consume-capability.mjs";

const IDENTITY_PAIRING_EVIDENCE_HMAC_KEY_ENV =
  "IDENTITY_PAIRING_EVIDENCE_HMAC_KEY";

export async function readPrivateSessionSubjectBinding(): Promise<SessionSubjectBindingResult> {
  const sessionPort = createPrivateSessionSubjectPort();
  if (sessionPort.state !== "ready") {
    return Object.freeze({ state: sessionPort.state });
  }
  const hmacKey = loadEvidenceHmacKey();
  if (!hmacKey) return unavailable();

  try {
    return await readSessionSubjectBinding({
      sessionPort: sessionPort.port,
      hmacKey,
    });
  } finally {
    hmacKey.fill(0);
  }
}

export async function createPrivateSessionConsumeCapability() {
  const sessionPort = createPrivateSessionSubjectPort();
  if (sessionPort.state !== "ready") {
    return Object.freeze({ state: sessionPort.state });
  }
  const hmacKey = loadEvidenceHmacKey();
  if (!hmacKey) return unavailable();

  try {
    return await createVerifiedSessionConsumeCapability({
      sessionPort: sessionPort.port,
      hmacKey,
    });
  } finally {
    hmacKey.fill(0);
  }
}

function createPrivateSessionSubjectPort():
  | Readonly<{ state: "disabled" | "unavailable" }>
  | Readonly<{ state: "ready"; port: VerifiedSessionSubjectPort }> {
  let runtime: ReturnType<typeof getAuthTransportRuntime>;
  try {
    runtime = getAuthTransportRuntime();
  } catch {
    return Object.freeze({ state: "unavailable" });
  }
  if (runtime.state === "disabled") {
    return Object.freeze({ state: "disabled" });
  }
  if (runtime.state !== "ready") {
    return Object.freeze({ state: "unavailable" });
  }

  return Object.freeze({
    state: "ready",
    port: Object.freeze({
      async read() {
        try {
          const result = await readCurrentSessionSubject();
          if (result.state === "unavailable" || result.state === "invalid") {
            return Object.freeze({ state: "unavailable" });
          }

          if (result.state !== "authenticated" || result.provider !== "neon_auth") {
            return Object.freeze({ state: "missing" });
          }

          return Object.freeze({
            state: "verified",
            provider: "neon_auth",
            subject: result.providerSubject,
            verificationSource: "server_verified_session",
          });
        } catch {
          return Object.freeze({ state: "unavailable" });
        }
      },
    }),
  });
}

function loadEvidenceHmacKey() {
  return decodeSessionSubjectBindingHmacKey(
    process.env[IDENTITY_PAIRING_EVIDENCE_HMAC_KEY_ENV],
  );
}

function unavailable(): SessionSubjectBindingResult {
  return Object.freeze({ state: "unavailable" });
}
