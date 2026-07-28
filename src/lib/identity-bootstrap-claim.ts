import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

export const IDENTITY_BOOTSTRAP_CLAIM_POLICY = Object.freeze({
  authorityPolicyId: "preissued_bootstrap_claim_authority_v1",
  provider: "neon_auth",
  claimPrefix: "varda-bootstrap-claim-v1.",
  claimEntropyBytes: 32,
  claimDigestVersion: "bootstrap_claim_sha256_v1",
  claimDigestPrefix: "bootstrap-claim-sha256-v1:",
  targetReviewPolicyId: "single_provisioning_user_explicit_review_v1",
  maxIntentLifetimeMs: 10 * 60 * 1_000,
} as const);

const CANONICAL_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isCanonicalIdentityBootstrapClaim(
  rawClaim: unknown,
): rawClaim is string {
  if (
    typeof rawClaim !== "string" ||
    !rawClaim.startsWith(IDENTITY_BOOTSTRAP_CLAIM_POLICY.claimPrefix)
  ) {
    return false;
  }

  const encodedEntropy = rawClaim.slice(
    IDENTITY_BOOTSTRAP_CLAIM_POLICY.claimPrefix.length,
  );
  if (!CANONICAL_BASE64URL_PATTERN.test(encodedEntropy)) return false;

  const entropy = Buffer.from(encodedEntropy, "base64url");
  const canonical =
    entropy.byteLength ===
      IDENTITY_BOOTSTRAP_CLAIM_POLICY.claimEntropyBytes &&
    entropy.toString("base64url") === encodedEntropy;
  entropy.fill(0);
  return canonical;
}

export function digestIdentityBootstrapClaim(rawClaim: unknown) {
  if (!isCanonicalIdentityBootstrapClaim(rawClaim)) {
    throw new Error("Identity bootstrap claim format is invalid");
  }

  return `${IDENTITY_BOOTSTRAP_CLAIM_POLICY.claimDigestPrefix}${createHash(
    "sha256",
  )
    .update(rawClaim, "utf8")
    .digest("hex")}` as const;
}
