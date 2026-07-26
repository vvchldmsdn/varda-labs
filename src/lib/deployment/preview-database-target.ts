import {
  assertCanonicalSha256Fingerprint,
  assertOneNeonDatabaseTarget,
  parseNeonDatabaseUrl,
  sha256Fingerprint,
} from "./neon-database-target.ts";

export { sha256Fingerprint };

export const PREVIEW_DATABASE_TARGET_GUARD_POLICY = Object.freeze({
  policyId: "preview_database_target_operational_guard_v2",
  expectedNeonIntegrationProjectSha256:
    "sha256:715beb5ee1546f662b876ab7af2ca37da852332bcbc3d93863e95be4d9952a87",
  productionEndpointSha256:
    "sha256:e47003b830425b835f435c9149931906a1e3df40307b7462a222755a923981a2",
  latestReviewedMigration: Object.freeze({
    tag: "0020_rainy_northstar",
    createdAt: 1784893393803,
    sha256:
      "fd8b0fe786f19f2b77849873a4c643c05254c7a00604b1a7ab3f3bc2210eb7d7",
  }),
  allowedPendingMigrations: Object.freeze([
    Object.freeze({
      tag: "0020_rainy_northstar",
      createdAt: 1784893393803,
      sha256:
        "fd8b0fe786f19f2b77849873a4c643c05254c7a00604b1a7ab3f3bc2210eb7d7",
    }),
  ]),
});

export type PreviewDatabaseTargetGuardEnvironment = {
  [key: string]: string | undefined;
  VERCEL_ENV?: string;
  DATABASE_URL?: string;
  DATABASE_URL_UNPOOLED?: string;
  NEON_PROJECT_ID?: string;
};

export type PreviewDatabaseTargetGuard = {
  policyId: typeof PREVIEW_DATABASE_TARGET_GUARD_POLICY.policyId;
  status: "operational_guard_passed";
  integrationProjectFingerprint: string;
  endpointFingerprint: string;
  targetFingerprint: string;
  endpointProjectBinding: "external_vercel_neon_integration_control";
};

type PreviewDatabaseTargetGuardPolicy = {
  policyId: typeof PREVIEW_DATABASE_TARGET_GUARD_POLICY.policyId;
  expectedNeonIntegrationProjectSha256: string;
  productionEndpointSha256: string;
};

export function guardPreviewDatabaseTarget(
  env: PreviewDatabaseTargetGuardEnvironment,
  policy: PreviewDatabaseTargetGuardPolicy =
    PREVIEW_DATABASE_TARGET_GUARD_POLICY,
): PreviewDatabaseTargetGuard {
  if (env.VERCEL_ENV !== "preview") {
    throw new Error(
      "Preview database operational guard requires VERCEL_ENV=preview.",
    );
  }

  const databaseUrl = requiredValue(env.DATABASE_URL, "DATABASE_URL");
  const unpooledDatabaseUrl = requiredValue(
    env.DATABASE_URL_UNPOOLED,
    "DATABASE_URL_UNPOOLED",
  );
  const neonProjectId = requiredValue(
    env.NEON_PROJECT_ID,
    "NEON_PROJECT_ID",
  );
  assertCanonicalSha256Fingerprint(
    policy.expectedNeonIntegrationProjectSha256,
    "expected integration project fingerprint",
  );
  assertCanonicalSha256Fingerprint(
    policy.productionEndpointSha256,
    "production endpoint fingerprint",
  );

  const pooled = parseNeonDatabaseUrl(databaseUrl, "Preview database");
  const unpooled = parseNeonDatabaseUrl(
    unpooledDatabaseUrl,
    "Preview database",
  );
  assertOneNeonDatabaseTarget(pooled, unpooled, "Preview");

  const integrationProjectFingerprint = sha256Fingerprint(neonProjectId);
  if (
    integrationProjectFingerprint !==
    policy.expectedNeonIntegrationProjectSha256
  ) {
    throw new Error(
      "Preview NEON_PROJECT_ID does not match the pinned Vercel-Neon integration configuration.",
    );
  }

  const endpointFingerprint = sha256Fingerprint(pooled.endpointId);
  if (endpointFingerprint === policy.productionEndpointSha256) {
    throw new Error(
      "Preview database resolves to the pinned Production Neon endpoint.",
    );
  }

  return {
    policyId: policy.policyId,
    status: "operational_guard_passed",
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
    endpointProjectBinding: "external_vercel_neon_integration_control",
  };
}

function requiredValue(value: string | undefined, name: string) {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${name} is required for the Preview database guard.`);
  }
  return normalized;
}
