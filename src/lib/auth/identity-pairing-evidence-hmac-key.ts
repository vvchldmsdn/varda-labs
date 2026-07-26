import "server-only";

import { Buffer } from "node:buffer";

export const IDENTITY_PAIRING_EVIDENCE_HMAC_KEY_ENV =
  "IDENTITY_PAIRING_EVIDENCE_HMAC_KEY";
const IDENTITY_PAIRING_EVIDENCE_HMAC_KEY_BYTES = 32;

export class IdentityPairingEvidenceHmacKeyConfigurationError extends Error {
  constructor() {
    super("Identity pairing evidence HMAC key is unavailable");
    this.name = "IdentityPairingEvidenceHmacKeyConfigurationError";
  }
}

export function loadIdentityPairingEvidenceHmacKey() {
  const encodedKey =
    process.env[IDENTITY_PAIRING_EVIDENCE_HMAC_KEY_ENV]?.trim();
  if (
    !encodedKey ||
    !/^[A-Za-z0-9_-]{43}$/.test(encodedKey)
  ) {
    throw new IdentityPairingEvidenceHmacKeyConfigurationError();
  }

  const key = Buffer.from(encodedKey, "base64url");
  if (key.byteLength !== IDENTITY_PAIRING_EVIDENCE_HMAC_KEY_BYTES) {
    throw new IdentityPairingEvidenceHmacKeyConfigurationError();
  }
  return new Uint8Array(key);
}
