import { createHash } from "node:crypto";

import {
  PREVIEW_DATABASE_TARGET_GUARD_POLICY,
  guardPreviewDatabaseTarget,
  type PreviewDatabaseTargetGuardEnvironment,
  type PreviewDatabaseTargetGuardPolicy,
} from "./preview-database-target.ts";

const NEON_BRANCH_ID_PATTERN = /^br-[a-z0-9-]+$/;
const REHEARSAL_BRANCH_NAME_PATTERN =
  /^preview\/codex\/identity-pairing-consume-rehearsal(?:-[a-z0-9-]+)?$/;

export const IDENTITY_PAIRING_REHEARSAL_TARGET_POLICY = Object.freeze({
  policyId: "identity_pairing_disposable_rehearsal_target_v1",
  previewDatabasePolicy: PREVIEW_DATABASE_TARGET_GUARD_POLICY,
} as const);

export type IdentityPairingRehearsalTargetEnvironment = {
  [key: string]: string | undefined;
  IDENTITY_PAIRING_REHEARSAL_BRANCH_ID?: string;
  IDENTITY_PAIRING_REHEARSAL_BRANCH_NAME?: string;
  IDENTITY_PAIRING_REHEARSAL_DATABASE_URL?: string;
  IDENTITY_PAIRING_REHEARSAL_DATABASE_URL_UNPOOLED?: string;
  NEON_PROJECT_ID?: string;
};

export function guardIdentityPairingRehearsalTarget(
  env: IdentityPairingRehearsalTargetEnvironment,
  previewDatabasePolicy: PreviewDatabaseTargetGuardPolicy =
    IDENTITY_PAIRING_REHEARSAL_TARGET_POLICY.previewDatabasePolicy,
) {
  const branchId = requiredValue(
    env.IDENTITY_PAIRING_REHEARSAL_BRANCH_ID,
    "IDENTITY_PAIRING_REHEARSAL_BRANCH_ID",
  );
  const branchName = requiredValue(
    env.IDENTITY_PAIRING_REHEARSAL_BRANCH_NAME,
    "IDENTITY_PAIRING_REHEARSAL_BRANCH_NAME",
  );
  if (!NEON_BRANCH_ID_PATTERN.test(branchId)) {
    throw new Error("The rehearsal branch id is invalid.");
  }
  if (!REHEARSAL_BRANCH_NAME_PATTERN.test(branchName)) {
    throw new Error("The rehearsal branch name is invalid.");
  }

  const previewEnvironment: PreviewDatabaseTargetGuardEnvironment = {
    VERCEL_ENV: "preview",
    DATABASE_URL: requiredValue(
      env.IDENTITY_PAIRING_REHEARSAL_DATABASE_URL,
      "IDENTITY_PAIRING_REHEARSAL_DATABASE_URL",
    ),
    DATABASE_URL_UNPOOLED: requiredValue(
      env.IDENTITY_PAIRING_REHEARSAL_DATABASE_URL_UNPOOLED,
      "IDENTITY_PAIRING_REHEARSAL_DATABASE_URL_UNPOOLED",
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
    policyId: IDENTITY_PAIRING_REHEARSAL_TARGET_POLICY.policyId,
    status: "disposable_rehearsal_target_guard_passed" as const,
    branchEndpointAttestation: "not_established" as const,
    controlPlaneVerificationRequired: true as const,
    branchIdFingerprint,
    branchNameFingerprint,
    integrationProjectFingerprint:
      databaseTarget.integrationProjectFingerprint,
    endpointFingerprint: databaseTarget.endpointFingerprint,
    targetFingerprint: sha256Fingerprint(
      JSON.stringify({
        policyId: IDENTITY_PAIRING_REHEARSAL_TARGET_POLICY.policyId,
        branchIdFingerprint,
        branchNameFingerprint,
        databaseTargetFingerprint: databaseTarget.targetFingerprint,
      }),
    ),
  });
}

function requiredValue(value: string | undefined, name: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function sha256Fingerprint(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
