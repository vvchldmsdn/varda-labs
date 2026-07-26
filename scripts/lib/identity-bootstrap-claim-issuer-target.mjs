import { PREVIEW_DATABASE_TARGET_GUARD_POLICY } from "../../src/lib/deployment/preview-database-target.ts";
import {
  assertCanonicalSha256Fingerprint,
  assertOneNeonDatabaseTarget,
  parseNeonDatabaseUrl,
  sha256Fingerprint,
} from "../../src/lib/deployment/neon-database-target.ts";
import { isCanonicalUuid } from "./identity-bootstrap-claim-issuer.mjs";

export const IDENTITY_BOOTSTRAP_CLAIM_ISSUER_TARGET_POLICY = Object.freeze({
  policyId: "bootstrap_claim_issuer_target_guard_v1",
  productionEndpointSha256:
    PREVIEW_DATABASE_TARGET_GUARD_POLICY.productionEndpointSha256,
});

export class IdentityBootstrapClaimIssuerTargetError extends Error {
  constructor(code) {
    super("Identity bootstrap claim issuer target is not reviewed");
    this.name = "IdentityBootstrapClaimIssuerTargetError";
    this.code = code;
  }
}

export function guardIdentityBootstrapClaimIssuerTarget(
  {
    databaseUrl,
    databaseUrlUnpooled,
    targetAppUserId,
    reviewedTargetFingerprint = null,
  },
  policy = IDENTITY_BOOTSTRAP_CLAIM_ISSUER_TARGET_POLICY,
) {
  try {
    assertCanonicalSha256Fingerprint(
      policy.productionEndpointSha256,
      "production endpoint fingerprint",
    );
    if (!isCanonicalUuid(targetAppUserId)) {
      throw new IdentityBootstrapClaimIssuerTargetError(
        "invalid_target_app_user_id",
      );
    }

    const pooled = parseNeonDatabaseUrl(
      requiredValue(databaseUrl),
      "Identity bootstrap claim issuer database",
    );
    const unpooled = parseNeonDatabaseUrl(
      requiredValue(databaseUrlUnpooled),
      "Identity bootstrap claim issuer database",
    );
    assertOneNeonDatabaseTarget(pooled, unpooled, "Issuer");
    if (!pooled.pooled || unpooled.pooled) {
      throw new IdentityBootstrapClaimIssuerTargetError(
        "issuer_database_pooling_mismatch",
      );
    }

    const endpointFingerprint = sha256Fingerprint(pooled.endpointId);
    if (endpointFingerprint !== policy.productionEndpointSha256) {
      throw new IdentityBootstrapClaimIssuerTargetError(
        "issuer_database_not_pinned_production",
      );
    }

    const databaseTargetFingerprint = sha256Fingerprint(
      JSON.stringify({
        endpointFingerprint,
        username: pooled.username,
        databaseName: pooled.databaseName,
      }),
    );
    const appUserFingerprint = sha256Fingerprint(
      targetAppUserId.trim().toLowerCase(),
    );
    const targetFingerprint = sha256Fingerprint(
      JSON.stringify({
        policyId: policy.policyId,
        databaseTargetFingerprint,
        appUserFingerprint,
      }),
    );

    if (reviewedTargetFingerprint !== null) {
      assertCanonicalSha256Fingerprint(
        reviewedTargetFingerprint,
        "reviewed issuer target fingerprint",
      );
      if (reviewedTargetFingerprint !== targetFingerprint) {
        throw new IdentityBootstrapClaimIssuerTargetError(
          "reviewed_target_fingerprint_mismatch",
        );
      }
    }

    return Object.freeze({
      policyId: policy.policyId,
      status: "production_issuer_target_guard_passed",
      reviewStatus:
        reviewedTargetFingerprint === null
          ? "dry_run_review_required"
          : "reviewed_target_match",
      endpointFingerprint,
      databaseTargetFingerprint,
      targetFingerprint,
    });
  } catch (error) {
    if (error instanceof IdentityBootstrapClaimIssuerTargetError) {
      throw error;
    }
    throw new IdentityBootstrapClaimIssuerTargetError(
      "issuer_database_target_invalid",
    );
  }
}

function requiredValue(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new IdentityBootstrapClaimIssuerTargetError(
      "issuer_database_target_not_configured",
    );
  }
  return value.trim();
}
