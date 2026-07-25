import { createHash } from "node:crypto";

import { PREVIEW_DATABASE_TARGET_GUARD_POLICY } from "./preview-database-target.ts";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const NEON_ENDPOINT_PATTERN = /^ep-[a-z0-9-]+$/;
const NEON_BRANCH_PATTERN = /^br-[a-z0-9-]+$/;

export const IDENTITY_PAIRING_REHEARSAL_TARGET_POLICY = Object.freeze({
  policyId: "identity_pairing_isolated_branch_rehearsal_target_v1",
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
  status: "isolated_rehearsal_target_guard_passed";
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
  );
  const rehearsalUnpooled = parseNeonDatabaseUrl(
    requiredValue(
      env.IDENTITY_PAIRING_REHEARSAL_DATABASE_URL_UNPOOLED,
      "IDENTITY_PAIRING_REHEARSAL_DATABASE_URL_UNPOOLED",
    ),
  );
  assertOneTarget(rehearsalPooled, rehearsalUnpooled, "rehearsal");
  if (!rehearsalPooled.pooled || rehearsalUnpooled.pooled) {
    throw new Error(
      "The rehearsal target requires one pooled URL and one unpooled URL.",
    );
  }

  const productionPooled = parseNeonDatabaseUrl(
    requiredValue(env.DATABASE_URL, "DATABASE_URL"),
  );
  const productionUnpooled = parseNeonDatabaseUrl(
    requiredValue(env.DATABASE_URL_UNPOOLED, "DATABASE_URL_UNPOOLED"),
  );
  assertOneTarget(productionPooled, productionUnpooled, "Production");

  assertSha256(
    policy.expectedNeonIntegrationProjectSha256,
    "expected integration project fingerprint",
  );
  assertSha256(
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
    status: "isolated_rehearsal_target_guard_passed",
    branchFingerprint,
    endpointFingerprint,
    integrationProjectFingerprint,
    targetFingerprint: sha256Fingerprint(
      JSON.stringify({
        policyId: policy.policyId,
        branchFingerprint,
        endpointFingerprint,
        integrationProjectFingerprint,
        username: rehearsalPooled.username,
        databaseName: rehearsalPooled.databaseName,
      }),
    ),
  };
}

export function sha256Fingerprint(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

type ParsedNeonDatabaseUrl = {
  endpointId: string;
  pooled: boolean;
  username: string;
  password: string;
  databaseName: string;
};

function parseNeonDatabaseUrl(rawUrl: string): ParsedNeonDatabaseUrl {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("A database URL is not a valid URL.");
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("A rehearsal database URL must use PostgreSQL.");
  }
  if (!parsed.hostname.endsWith(".neon.tech")) {
    throw new Error("A rehearsal database URL is not a Neon endpoint.");
  }

  const hostLabel = parsed.hostname.split(".")[0];
  const pooled = hostLabel.endsWith("-pooler");
  const endpointId = hostLabel.replace(/-pooler$/, "");
  if (!NEON_ENDPOINT_PATTERN.test(endpointId)) {
    throw new Error("A rehearsal database URL has an invalid endpoint.");
  }

  const databaseName = decodeURIComponent(
    parsed.pathname.replace(/^\/+/, ""),
  );
  if (!parsed.username || !parsed.password || !databaseName) {
    throw new Error("A rehearsal database URL is missing connection identity.");
  }

  return {
    endpointId,
    pooled,
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    databaseName,
  };
}

function assertOneTarget(
  pooled: ParsedNeonDatabaseUrl,
  unpooled: ParsedNeonDatabaseUrl,
  label: string,
) {
  if (
    pooled.endpointId !== unpooled.endpointId ||
    pooled.username !== unpooled.username ||
    pooled.password !== unpooled.password ||
    pooled.databaseName !== unpooled.databaseName
  ) {
    throw new Error(
      `${label} pooled and unpooled URLs do not identify one database target.`,
    );
  }
}

function requiredValue(value: string | undefined, name: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function assertSha256(value: string, label: string) {
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a canonical SHA-256 fingerprint.`);
  }
}
