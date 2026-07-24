import { createHash } from "node:crypto";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const NEON_ENDPOINT_PATTERN = /^ep-[a-z0-9-]+$/;

export const PREVIEW_DATABASE_TARGET_GUARD_POLICY = Object.freeze({
  policyId: "preview_database_target_operational_guard_v2",
  expectedNeonIntegrationProjectSha256:
    "sha256:715beb5ee1546f662b876ab7af2ca37da852332bcbc3d93863e95be4d9952a87",
  productionEndpointSha256:
    "sha256:e47003b830425b835f435c9149931906a1e3df40307b7462a222755a923981a2",
  latestReviewedMigration: Object.freeze({
    tag: "0019_lush_maddog",
    createdAt: 1784761030555,
    sha256:
      "db1f61aa9f5f6e7123c3ff9081de90ac5a580d456669e13c8d2602b552746033",
  }),
  allowedPendingMigrations: Object.freeze([
    Object.freeze({
      tag: "0019_lush_maddog",
      createdAt: 1784761030555,
      sha256:
        "db1f61aa9f5f6e7123c3ff9081de90ac5a580d456669e13c8d2602b552746033",
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
      "Preview pooled and unpooled database URLs do not identify one database target.",
    );
  }

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

export function sha256Fingerprint(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parseNeonDatabaseUrl(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Preview database URL is not a valid URL.");
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("Preview database URL must use a PostgreSQL protocol.");
  }
  if (!parsed.hostname.endsWith(".neon.tech")) {
    throw new Error("Preview database URL is not a Neon endpoint.");
  }

  const endpointId = parsed.hostname
    .split(".")[0]
    .replace(/-pooler$/, "");
  if (!NEON_ENDPOINT_PATTERN.test(endpointId)) {
    throw new Error("Preview database URL has an invalid Neon endpoint.");
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!parsed.username || !parsed.password || !databaseName) {
    throw new Error("Preview database URL is missing connection identity.");
  }

  return {
    endpointId,
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    databaseName,
  };
}

function requiredValue(value: string | undefined, name: string) {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${name} is required for the Preview database guard.`);
  }
  return normalized;
}

function assertSha256(value: string, label: string) {
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a canonical SHA-256 fingerprint.`);
  }
}
