import { createAuthTransportBaseUrlFingerprint } from "../src/lib/auth/auth-transport-policy.ts";

const rawBaseUrl = process.env.NEON_AUTH_BASE_URL?.trim();
const fingerprint = createAuthTransportBaseUrlFingerprint(rawBaseUrl);
if (!fingerprint) {
  throw new Error("Auth target is invalid");
}

process.stdout.write(`${fingerprint}\n`);
