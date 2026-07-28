import {
  NEON_DATABASE_TARGET_PINNING,
  parseNeonDatabaseUrl,
  sha256Fingerprint,
} from "./preview-database-target.ts";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

export const PRODUCTION_DATABASE_TARGET_GUARD_POLICY = Object.freeze({
  policyId: "production_database_target_operational_guard_v1",
  expectedNeonIntegrationProjectSha256:
    NEON_DATABASE_TARGET_PINNING.expectedNeonIntegrationProjectSha256,
  productionEndpointSha256:
    NEON_DATABASE_TARGET_PINNING.productionEndpointSha256,
});

export type ProductionDatabaseTargetGuardEnvironment = {
  [key: string]: string | undefined;
  DATABASE_URL?: string;
  DATABASE_URL_UNPOOLED?: string;
  NEON_PROJECT_ID?: string;
};

export type ProductionDatabaseTargetGuardPolicy = {
  policyId: typeof PRODUCTION_DATABASE_TARGET_GUARD_POLICY.policyId;
  expectedNeonIntegrationProjectSha256: string;
  productionEndpointSha256: string;
};

export type ProductionDatabaseTargetGuard = {
  policyId: typeof PRODUCTION_DATABASE_TARGET_GUARD_POLICY.policyId;
  status: "production_target_guard_passed";
  integrationProjectFingerprint: string;
  endpointFingerprint: string;
  targetFingerprint: string;
  endpointProjectBinding: "pinned_vercel_neon_integration_control";
};

export function guardProductionDatabaseTarget(
  env: ProductionDatabaseTargetGuardEnvironment,
  policy: ProductionDatabaseTargetGuardPolicy =
    PRODUCTION_DATABASE_TARGET_GUARD_POLICY,
): ProductionDatabaseTargetGuard {
  const databaseUrl = requiredValue(env.DATABASE_URL, "DATABASE_URL");
  const unpooledDatabaseUrl = requiredValue(
    env.DATABASE_URL_UNPOOLED,
    "DATABASE_URL_UNPOOLED",
  );
  const neonProjectId = requiredValue(
    env.NEON_PROJECT_ID,
    "NEON_PROJECT_ID",
  );

  assertSha256(
    policy.expectedNeonIntegrationProjectSha256,
    "expected integration project fingerprint",
  );
  assertSha256(
    policy.productionEndpointSha256,
    "production endpoint fingerprint",
  );

  const pooled = parseNeonDatabaseUrl(databaseUrl);
  const unpooled = parseNeonDatabaseUrl(unpooledDatabaseUrl);

  if (
    pooled.endpointId !== unpooled.endpointId ||
    pooled.username !== unpooled.username ||
    pooled.password !== unpooled.password ||
    pooled.databaseName !== unpooled.databaseName
  ) {
    throw new Error(
      "Production pooled and unpooled URLs do not identify one database target.",
    );
  }

  const integrationProjectFingerprint = sha256Fingerprint(neonProjectId);
  if (
    integrationProjectFingerprint !==
    policy.expectedNeonIntegrationProjectSha256
  ) {
    throw new Error(
      "Production NEON_PROJECT_ID does not match the pinned integration.",
    );
  }

  const endpointFingerprint = sha256Fingerprint(pooled.endpointId);
  if (endpointFingerprint !== policy.productionEndpointSha256) {
    throw new Error(
      "Database URLs do not resolve to the pinned Production endpoint.",
    );
  }

  return Object.freeze({
    policyId: policy.policyId,
    status: "production_target_guard_passed",
    integrationProjectFingerprint,
    endpointFingerprint,
    targetFingerprint: sha256Fingerprint(
      JSON.stringify({
        policyId: policy.policyId,
        integrationProjectFingerprint,
        endpointFingerprint,
        username: pooled.username,
        databaseName: pooled.databaseName,
      }),
    ),
    endpointProjectBinding: "pinned_vercel_neon_integration_control",
  });
}

function requiredValue(value: string | undefined, name: string) {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${name} is required for the Production database guard.`);
  }
  return normalized;
}

function assertSha256(value: string, label: string) {
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a canonical SHA-256 fingerprint.`);
  }
}
