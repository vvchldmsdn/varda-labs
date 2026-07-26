import { PREVIEW_DATABASE_TARGET_GUARD_POLICY } from "./preview-database-target.ts";
import {
  assertCanonicalSha256Fingerprint,
  assertOneNeonDatabaseTarget,
  parseNeonDatabaseUrl,
  sha256Fingerprint,
} from "./neon-database-target.ts";

const NEON_BRANCH_PATTERN = /^br-[a-z0-9-]+$/;

export { sha256Fingerprint };

export const IDENTITY_PAIRING_REHEARSAL_TARGET_POLICY = Object.freeze({
  policyId: "identity_pairing_non_production_rehearsal_endpoint_v2",
  expectedNeonIntegrationProjectSha256:
    PREVIEW_DATABASE_TARGET_GUARD_POLICY
      .expectedNeonIntegrationProjectSha256,
  productionEndpointSha256:
    PREVIEW_DATABASE_TARGET_GUARD_POLICY.productionEndpointSha256,
});

export type IdentityPairingRehearsalTargetEnvironment = {
  DATABASE_URL?: string;
  DATABASE_URL_UNPOOLED?: string;
  IDENTITY_PAIRING_REHEARSAL_BRANCH_ID?: string;
  IDENTITY_PAIRING_REHEARSAL_DATABASE_URL?: string;
  IDENTITY_PAIRING_REHEARSAL_DATABASE_URL_UNPOOLED?: string;
  NEON_PROJECT_ID?: string;
};

type IdentityPairingRehearsalTargetPolicy = {
  policyId: typeof IDENTITY_PAIRING_REHEARSAL_TARGET_POLICY.policyId;
  expectedNeonIntegrationProjectSha256: string;
  productionEndpointSha256: string;
};

export type IdentityPairingRehearsalTargetGuard = {
  policyId: typeof IDENTITY_PAIRING_REHEARSAL_TARGET_POLICY.policyId;
  status: "non_production_rehearsal_endpoint_guard_passed";
  branchEndpointAttestation: "not_established";
  controlPlaneVerificationRequired: true;
  branchFingerprint: string;
  endpointFingerprint: string;
  integrationProjectFingerprint: string;
  targetFingerprint: string;
};

export function guardIdentityPairingRehearsalTarget(
  env: IdentityPairingRehearsalTargetEnvironment,
  policy: IdentityPairingRehearsalTargetPolicy =
    IDENTITY_PAIRING_REHEARSAL_TARGET_POLICY,
): IdentityPairingRehearsalTargetGuard {
  const branchId = requiredValue(
    env.IDENTITY_PAIRING_REHEARSAL_BRANCH_ID,
    "IDENTITY_PAIRING_REHEARSAL_BRANCH_ID",
  );
  if (!NEON_BRANCH_PATTERN.test(branchId)) {
    throw new Error("The rehearsal branch must use a Neon branch id.");
  }

  const rehearsalPooled = parseNeonDatabaseUrl(
    requiredValue(
      env.IDENTITY_PAIRING_REHEARSAL_DATABASE_URL,
      "IDENTITY_PAIRING_REHEARSAL_DATABASE_URL",
    ),
    "A rehearsal database",
  );
  const rehearsalUnpooled = parseNeonDatabaseUrl(
    requiredValue(
      env.IDENTITY_PAIRING_REHEARSAL_DATABASE_URL_UNPOOLED,
      "IDENTITY_PAIRING_REHEARSAL_DATABASE_URL_UNPOOLED",
    ),
    "A rehearsal database",
  );
  assertOneNeonDatabaseTarget(
    rehearsalPooled,
    rehearsalUnpooled,
    "rehearsal",
  );
  if (!rehearsalPooled.pooled || rehearsalUnpooled.pooled) {
    throw new Error(
      "The rehearsal target requires one pooled URL and one unpooled URL.",
    );
  }

  const productionPooled = parseNeonDatabaseUrl(
    requiredValue(env.DATABASE_URL, "DATABASE_URL"),
    "A Production database",
  );
  const productionUnpooled = parseNeonDatabaseUrl(
    requiredValue(env.DATABASE_URL_UNPOOLED, "DATABASE_URL_UNPOOLED"),
    "A Production database",
  );
  assertOneNeonDatabaseTarget(
    productionPooled,
    productionUnpooled,
    "Production",
  );

  assertCanonicalSha256Fingerprint(
    policy.expectedNeonIntegrationProjectSha256,
    "expected integration project fingerprint",
  );
  assertCanonicalSha256Fingerprint(
    policy.productionEndpointSha256,
    "production endpoint fingerprint",
  );

  const integrationProjectFingerprint = sha256Fingerprint(
    requiredValue(env.NEON_PROJECT_ID, "NEON_PROJECT_ID"),
  );
  if (
    integrationProjectFingerprint !==
    policy.expectedNeonIntegrationProjectSha256
  ) {
    throw new Error(
      "The rehearsal NEON_PROJECT_ID does not match the pinned integration.",
    );
  }

  const endpointFingerprint = sha256Fingerprint(
    rehearsalPooled.endpointId,
  );
  if (
    rehearsalPooled.endpointId === productionPooled.endpointId ||
    endpointFingerprint === policy.productionEndpointSha256
  ) {
    throw new Error(
      "The rehearsal database resolves to the Production Neon endpoint.",
    );
  }

  const branchFingerprint = sha256Fingerprint(branchId);
  return {
    policyId: policy.policyId,
    status: "non_production_rehearsal_endpoint_guard_passed",
    branchEndpointAttestation: "not_established",
    controlPlaneVerificationRequired: true,
    branchFingerprint,
    endpointFingerprint,
    integrationProjectFingerprint,
    targetFingerprint: sha256Fingerprint(
      JSON.stringify({
        policyId: policy.policyId,
        branchEndpointAttestation: "not_established",
        branchFingerprint,
        endpointFingerprint,
        integrationProjectFingerprint,
        username: rehearsalPooled.username,
        databaseName: rehearsalPooled.databaseName,
      }),
    ),
  };
}

function requiredValue(value: string | undefined, name: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}
