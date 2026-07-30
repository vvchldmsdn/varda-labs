import { createHash } from "node:crypto";

import {
  PREVIEW_DATABASE_TARGET_GUARD_POLICY,
  guardPreviewDatabaseTarget,
  type PreviewDatabaseTargetGuardEnvironment,
  type PreviewDatabaseTargetGuardPolicy,
} from "./preview-database-target.ts";
import {
  PRODUCTION_DATABASE_TARGET_GUARD_POLICY,
  guardProductionDatabaseTarget,
  type ProductionDatabaseTargetGuardPolicy,
} from "./production-database-target.ts";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const NEON_BRANCH_ID_PATTERN = /^br-[a-z0-9-]+$/;
const NEON_ENDPOINT_ID_PATTERN = /^ep-[a-z0-9-]+$/;
const REHEARSAL_BRANCH_NAME_PATTERN =
  /^preview\/codex\/legacy-account-owner-assignment-rehearsal(?:-[a-z0-9-]+)?$/;
const MISSING = Symbol("missing");
const INVALID = Symbol("invalid");

export const LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_CONFIRMATION =
  "--confirm-isolated-legacy-account-owner-assignment-rehearsal";

export const LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_TARGET_POLICY =
  Object.freeze({
    policyId: "legacy_account_owner_assignment_rehearsal_target_v1",
    previewDatabasePolicy: PREVIEW_DATABASE_TARGET_GUARD_POLICY,
    productionDatabasePolicy: PRODUCTION_DATABASE_TARGET_GUARD_POLICY,
    productionSourceTargetSha256:
      "sha256:ec111c76efbab437f6e948ec32faa2f4890c593dd523eafb47bdebceaeab3755",
  } as const);

export type LegacyAccountOwnerAssignmentRehearsalEnvironment = {
  [key: string]: string | undefined;
  LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_BRANCH_ID?: string;
  LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_BRANCH_NAME?: string;
  LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_DATABASE_URL?: string;
  LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_DATABASE_URL_UNPOOLED?: string;
  LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_SOURCE_TARGET_FINGERPRINT?: string;
  NEON_PROJECT_ID?: string;
};

export type LegacyAccountOwnerAssignmentRehearsalOptions = {
  branchId: string;
  branchName: string;
  endpointId: string;
};

export function guardLegacyAccountOwnerAssignmentProductionSource({
  baseEnv,
  productionDatabasePolicy =
    LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_TARGET_POLICY
      .productionDatabasePolicy,
  expectedProductionSourceTargetFingerprint =
    LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_TARGET_POLICY
      .productionSourceTargetSha256,
}: {
  baseEnv: Record<string, unknown>;
  productionDatabasePolicy?: ProductionDatabaseTargetGuardPolicy;
  expectedProductionSourceTargetFingerprint?: string;
}) {
  const source = readProductionSource({
    baseEnv,
    productionDatabasePolicy,
    expectedProductionSourceTargetFingerprint,
  });
  return Object.freeze({
    projectId: source.projectId,
    sourceTargetFingerprint: source.targetFingerprint,
  });
}

export function guardLegacyAccountOwnerAssignmentRehearsalTarget(
  env: LegacyAccountOwnerAssignmentRehearsalEnvironment,
  previewDatabasePolicy: PreviewDatabaseTargetGuardPolicy =
    LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_TARGET_POLICY.previewDatabasePolicy,
) {
  const branchId = requiredValue(
    env.LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_BRANCH_ID,
    "LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_BRANCH_ID",
  );
  const branchName = requiredValue(
    env.LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_BRANCH_NAME,
    "LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_BRANCH_NAME",
  );
  const sourceTargetFingerprint = requiredValue(
    env
      .LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_SOURCE_TARGET_FINGERPRINT,
    "LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_SOURCE_TARGET_FINGERPRINT",
  );
  if (!NEON_BRANCH_ID_PATTERN.test(branchId)) {
    throw new Error("The owner-assignment rehearsal branch id is invalid.");
  }
  if (!REHEARSAL_BRANCH_NAME_PATTERN.test(branchName)) {
    throw new Error("The owner-assignment rehearsal branch name is invalid.");
  }
  if (!SHA256_PATTERN.test(sourceTargetFingerprint)) {
    throw new Error(
      "The owner-assignment rehearsal source target fingerprint is invalid.",
    );
  }

  const previewEnvironment: PreviewDatabaseTargetGuardEnvironment = {
    VERCEL_ENV: "preview",
    DATABASE_URL: requiredValue(
      env.LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_DATABASE_URL,
      "LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_DATABASE_URL",
    ),
    DATABASE_URL_UNPOOLED: requiredValue(
      env.LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_DATABASE_URL_UNPOOLED,
      "LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_DATABASE_URL_UNPOOLED",
    ),
    NEON_PROJECT_ID: requiredValue(
      env.NEON_PROJECT_ID,
      "NEON_PROJECT_ID",
    ),
  };
  const databaseTarget = guardPreviewDatabaseTarget(
    previewEnvironment,
    previewDatabasePolicy,
  );
  const branchIdFingerprint = sha256Fingerprint(branchId);
  const branchNameFingerprint = sha256Fingerprint(branchName);

  return Object.freeze({
    policyId:
      LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_TARGET_POLICY.policyId,
    status: "disposable_rehearsal_target_guard_passed" as const,
    branchEndpointAttestation: "not_established" as const,
    controlPlaneVerificationRequired: true as const,
    branchIdFingerprint,
    branchNameFingerprint,
    sourceTargetFingerprint,
    integrationProjectFingerprint:
      databaseTarget.integrationProjectFingerprint,
    endpointFingerprint: databaseTarget.endpointFingerprint,
    targetFingerprint: sha256Fingerprint(
      JSON.stringify({
        policyId:
          LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_TARGET_POLICY.policyId,
        branchIdFingerprint,
        branchNameFingerprint,
        sourceTargetFingerprint,
        databaseTargetFingerprint: databaseTarget.targetFingerprint,
      }),
    ),
  });
}

export function readLegacyAccountOwnerAssignmentRehearsalOptions(
  args: string[],
): LegacyAccountOwnerAssignmentRehearsalOptions {
  if (!Array.isArray(args)) {
    throw new Error("Owner-assignment rehearsal arguments are invalid.");
  }

  const values = new Map<string, string>();
  let confirmed = false;
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (
      key ===
      LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_CONFIRMATION
    ) {
      if (confirmed) {
        throw new Error(
          "Owner-assignment rehearsal confirmation is duplicated.",
        );
      }
      confirmed = true;
      continue;
    }
    if (
      !["--branch-id", "--branch-name", "--endpoint-id"].includes(key) ||
      values.has(key)
    ) {
      throw new Error("Owner-assignment rehearsal argument is invalid.");
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(
        "Owner-assignment rehearsal argument value is invalid.",
      );
    }
    values.set(key, value);
    index += 1;
  }

  if (!confirmed) {
    throw new Error(
      "Owner-assignment rehearsal confirmation is required.",
    );
  }
  const branchId = values.get("--branch-id");
  const branchName = values.get("--branch-name");
  const endpointId = values.get("--endpoint-id");
  if (
    !branchId ||
    !NEON_BRANCH_ID_PATTERN.test(branchId) ||
    !branchName ||
    !REHEARSAL_BRANCH_NAME_PATTERN.test(branchName) ||
    !endpointId ||
    !NEON_ENDPOINT_ID_PATTERN.test(endpointId)
  ) {
    throw new Error("Owner-assignment rehearsal target is invalid.");
  }

  return Object.freeze({ branchId, branchName, endpointId });
}

export function prepareLegacyAccountOwnerAssignmentRehearsalEnvironment({
  baseEnv,
  options,
  productionDatabasePolicy =
    LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_TARGET_POLICY
      .productionDatabasePolicy,
  expectedProductionSourceTargetFingerprint =
    LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_TARGET_POLICY
      .productionSourceTargetSha256,
}: {
  baseEnv: Record<string, unknown>;
  options: LegacyAccountOwnerAssignmentRehearsalOptions;
  productionDatabasePolicy?: ProductionDatabaseTargetGuardPolicy;
  expectedProductionSourceTargetFingerprint?: string;
}): LegacyAccountOwnerAssignmentRehearsalEnvironment {
  const source = readProductionSource({
    baseEnv,
    productionDatabasePolicy,
    expectedProductionSourceTargetFingerprint,
  });
  return Object.freeze({
    LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_BRANCH_ID:
      options.branchId,
    LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_BRANCH_NAME:
      options.branchName,
    LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_DATABASE_URL:
      rewriteNeonEndpoint(source.pooled, options.endpointId),
    LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_DATABASE_URL_UNPOOLED:
      rewriteNeonEndpoint(source.unpooled, options.endpointId),
    LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_SOURCE_TARGET_FINGERPRINT:
      source.targetFingerprint,
    NEON_PROJECT_ID: source.projectId,
  });
}

function readProductionSource({
  baseEnv,
  productionDatabasePolicy,
  expectedProductionSourceTargetFingerprint,
}: {
  baseEnv: Record<string, unknown>;
  productionDatabasePolicy: ProductionDatabaseTargetGuardPolicy;
  expectedProductionSourceTargetFingerprint: string;
}) {
  const pooled = ownPrimitiveString(baseEnv, "DATABASE_URL");
  const unpooled = ownPrimitiveString(
    baseEnv,
    "DATABASE_URL_UNPOOLED",
  );
  const projectId = ownPrimitiveString(baseEnv, "NEON_PROJECT_ID");
  if (pooled === null || unpooled === null || projectId === null) {
    throw new Error(
      "Owner-assignment rehearsal source configuration is incomplete.",
    );
  }
  if (!SHA256_PATTERN.test(expectedProductionSourceTargetFingerprint)) {
    throw new Error(
      "Owner-assignment rehearsal source target policy is invalid.",
    );
  }

  const productionTarget = guardProductionDatabaseTarget(
    {
      DATABASE_URL: pooled,
      DATABASE_URL_UNPOOLED: unpooled,
      NEON_PROJECT_ID: projectId,
    },
    productionDatabasePolicy,
  );
  if (
    productionTarget.targetFingerprint !==
    expectedProductionSourceTargetFingerprint
  ) {
    throw new Error(
      "Owner-assignment rehearsal source role or database identity drifted.",
    );
  }

  return {
    pooled,
    unpooled,
    projectId,
    targetFingerprint: productionTarget.targetFingerprint,
  };
}

function rewriteNeonEndpoint(rawUrl: string, endpointId: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(
      "Owner-assignment rehearsal database URL is invalid.",
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !parsed.hostname.endsWith(".neon.tech") ||
    !NEON_ENDPOINT_ID_PATTERN.test(endpointId)
  ) {
    throw new Error(
      "Owner-assignment rehearsal database endpoint is invalid.",
    );
  }

  const labels = parsed.hostname.split(".");
  if (labels.length < 2) {
    throw new Error(
      "Owner-assignment rehearsal database endpoint is invalid.",
    );
  }
  const pooled = labels[0].endsWith("-pooler");
  parsed.hostname = `${endpointId}${pooled ? "-pooler" : ""}.${labels
    .slice(1)
    .join(".")}`;
  return parsed.toString();
}

function requiredValue(value: string | undefined, name: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function ownPrimitiveString(
  value: Record<string, unknown>,
  key: string,
) {
  const item = ownDataValue(value, key);
  return typeof item === "string" && item.length > 0 ? item : null;
}

function ownDataValue(value: Record<string, unknown>, key: string) {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return INVALID;
  }
  if (!descriptor) return MISSING;
  if (!("value" in descriptor)) return INVALID;
  return descriptor.value;
}

function sha256Fingerprint(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
