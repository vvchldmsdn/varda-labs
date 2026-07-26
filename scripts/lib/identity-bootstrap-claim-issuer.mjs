import { createHash, randomBytes } from "node:crypto";

import { IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY } from "../../src/lib/identity-bootstrap-claim-authority-policy.ts";

export const IDENTITY_BOOTSTRAP_CLAIM_WRITE_CONFIRMATION =
  "ISSUE_BOOTSTRAP_CLAIM_ONCE";
export const IDENTITY_BOOTSTRAP_CLAIM_RAW_PREFIX =
  "varda-bootstrap-claim-v1.";
export const IDENTITY_BOOTSTRAP_CLAIM_ENTROPY_BYTES = 32;
export const IDENTITY_BOOTSTRAP_CLAIM_LIFETIME_SECONDS = 10 * 60;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLAIM_DIGEST_PATTERN =
  /^bootstrap-claim-sha256-v1:[0-9a-f]{64}$/;
const SHA256_FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/;

export class IdentityBootstrapClaimIssuerArgumentError extends Error {
  constructor(code) {
    super("Identity bootstrap claim issuer arguments are invalid");
    this.name = "IdentityBootstrapClaimIssuerArgumentError";
    this.code = code;
  }
}

export function parseIdentityBootstrapClaimIssuerArgs(argv) {
  let targetAppUserId = null;
  let write = false;
  let confirmation = null;
  let reviewedTargetFingerprint = null;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--target-app-user-id" && targetAppUserId === null) {
      targetAppUserId = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (argument === "--write" && !write) {
      write = true;
      continue;
    }
    if (argument === "--confirm" && confirmation === null) {
      confirmation = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (
      argument === "--reviewed-target-fingerprint" &&
      reviewedTargetFingerprint === null
    ) {
      reviewedTargetFingerprint = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    throw new IdentityBootstrapClaimIssuerArgumentError(
      "unsupported_or_duplicate_argument",
    );
  }

  if (!isCanonicalUuid(targetAppUserId)) {
    throw new IdentityBootstrapClaimIssuerArgumentError(
      "invalid_target_app_user_id",
    );
  }
  if (write && confirmation !== IDENTITY_BOOTSTRAP_CLAIM_WRITE_CONFIRMATION) {
    throw new IdentityBootstrapClaimIssuerArgumentError(
      "missing_write_confirmation",
    );
  }
  if (!write && confirmation !== null) {
    throw new IdentityBootstrapClaimIssuerArgumentError(
      "confirmation_without_write",
    );
  }
  if (write && !isCanonicalSha256Fingerprint(reviewedTargetFingerprint)) {
    throw new IdentityBootstrapClaimIssuerArgumentError(
      "missing_reviewed_target_fingerprint",
    );
  }
  if (!write && reviewedTargetFingerprint !== null) {
    throw new IdentityBootstrapClaimIssuerArgumentError(
      "reviewed_target_fingerprint_without_write",
    );
  }

  return Object.freeze({
    targetAppUserId: targetAppUserId.trim().toLowerCase(),
    write,
    reviewedTargetFingerprint,
  });
}

export function buildIdentityBootstrapClaimIssuerPlan({
  targetAppUserId,
  state,
  targetEvidence = null,
}) {
  const validTarget = isCanonicalUuid(targetAppUserId);
  const blockers = [];

  if (!validTarget) blockers.push("invalid_target_app_user_id");
  if (!state.schemaAvailable) blockers.push("pairing_schema_unavailable");
  if (!state.targetFound) {
    blockers.push("reviewed_target_not_found");
  } else if (
    state.targetStatus !== "provisioning" ||
    state.targetRole !== "user"
  ) {
    blockers.push("reviewed_target_state_mismatch");
  }
  if (state.targetProviderIdentityCount !== 0) {
    blockers.push("target_provider_identity_preexists");
  }
  if (state.openIntentCount !== 0) {
    blockers.push("unexpired_intent_exists");
  }

  const result = blockers.length === 0 ? "ready" : "blocked";

  return Object.freeze({
    operation: "preissued_bootstrap_claim_issuer_v1",
    mode: "dry_run",
    result,
    targetFingerprint:
      targetEvidence?.targetFingerprint ??
      (validTarget
        ? fingerprint(targetAppUserId.trim().toLowerCase())
        : null),
    databaseTarget:
      targetEvidence === null
        ? null
        : Object.freeze({
            policyId: targetEvidence.policyId,
            status: targetEvidence.status,
            reviewStatus: targetEvidence.reviewStatus,
            endpointFingerprint: targetEvidence.endpointFingerprint,
            databaseTargetFingerprint:
              targetEvidence.databaseTargetFingerprint,
          }),
    policy: Object.freeze({
      authorityPolicyId: IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.policyId,
      targetReviewPolicyId:
        IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.targetReviewPolicyId,
      provider: IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.provider,
      claimDigestVersion:
        IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.claimDigestVersion,
      lifetimeSeconds: IDENTITY_BOOTSTRAP_CLAIM_LIFETIME_SECONDS,
    }),
    currentState: Object.freeze({
      targetFound: state.targetFound,
      targetStatus: state.targetFound ? state.targetStatus : null,
      targetRole: state.targetFound ? state.targetRole : null,
      targetProviderIdentityCount: state.targetProviderIdentityCount,
      openIntentCount: state.openIntentCount,
    }),
    plannedWrites: Object.freeze({
      identityPairingIntents: result === "ready" ? 1 : 0,
      identityPairingIntentEvents: 0,
      authIdentities: 0,
      appUsers: 0,
      productTables: 0,
    }),
    blockers: Object.freeze(blockers),
    warnings:
      result === "ready"
        ? Object.freeze(["actual_write_requires_separate_approval"])
        : Object.freeze([]),
    committed: false,
    databaseSideEffects: false,
  });
}

export function createOneTimeIdentityBootstrapClaim(
  randomSource = randomBytes,
) {
  const entropy = randomSource(IDENTITY_BOOTSTRAP_CLAIM_ENTROPY_BYTES);
  if (
    !(entropy instanceof Uint8Array) ||
    entropy.byteLength !== IDENTITY_BOOTSTRAP_CLAIM_ENTROPY_BYTES
  ) {
    throw new Error("Identity bootstrap claim entropy source is invalid");
  }

  const rawClaim =
    IDENTITY_BOOTSTRAP_CLAIM_RAW_PREFIX +
    Buffer.from(entropy).toString("base64url");
  return Object.freeze({
    rawClaim,
    claimDigest: digestIdentityBootstrapClaim(rawClaim),
  });
}

export function digestIdentityBootstrapClaim(rawClaim) {
  if (
    typeof rawClaim !== "string" ||
    !new RegExp(
      `^${escapeRegExp(IDENTITY_BOOTSTRAP_CLAIM_RAW_PREFIX)}[A-Za-z0-9_-]{43}$`,
    ).test(rawClaim)
  ) {
    throw new Error("Identity bootstrap claim format is invalid");
  }

  return `bootstrap-claim-sha256-v1:${createHash("sha256")
    .update(rawClaim, "utf8")
    .digest("hex")}`;
}

export function buildIdentityBootstrapClaimIssueOutput({
  plan,
  lockedState,
  rawClaim,
}) {
  const insertedCount = Number(lockedState?.inserted_count ?? 0);
  if (
    plan.result !== "ready" ||
    insertedCount !== 1 ||
    typeof rawClaim !== "string"
  ) {
    return Object.freeze({
      ...plan,
      mode: "write",
      result: "blocked",
      plannedWrites: zeroWrites(),
      actualWrites: zeroWrites(),
      blockers: Object.freeze(["locked_state_not_issuable"]),
      warnings: Object.freeze([]),
      committed: false,
      databaseSideEffects: false,
    });
  }

  return Object.freeze({
    ...plan,
    mode: "write",
    result: "issued",
    plannedWrites: zeroWrites(),
    actualWrites: Object.freeze({
      identityPairingIntents: 1,
      identityPairingIntentEvents: 0,
      authIdentities: 0,
      appUsers: 0,
      productTables: 0,
    }),
    blockers: Object.freeze([]),
    warnings: Object.freeze([
      "one_time_claim_is_displayed_once",
      "do_not_log_or_store_the_raw_claim",
    ]),
    oneTimeDelivery: Object.freeze({
      rawClaim,
      channel: "local_stdout_once",
      displayCount: 1,
      expiresAt: normalizeTimestamp(lockedState.expires_at),
    }),
    committed: true,
    databaseSideEffects: true,
  });
}

export function blockedIdentityBootstrapClaimIssuerOutput(
  blocker,
  mode = "dry_run",
) {
  return Object.freeze({
    operation: "preissued_bootstrap_claim_issuer_v1",
    mode,
    result: "blocked",
    targetFingerprint: null,
    policy: null,
    currentState: null,
    plannedWrites: zeroWrites(),
    blockers: Object.freeze([blocker]),
    warnings: Object.freeze([]),
    committed: false,
    databaseSideEffects: false,
  });
}

export function isCanonicalUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

export function isCanonicalClaimDigest(value) {
  return typeof value === "string" && CLAIM_DIGEST_PATTERN.test(value);
}

export function isCanonicalSha256Fingerprint(value) {
  return (
    typeof value === "string" && SHA256_FINGERPRINT_PATTERN.test(value)
  );
}

function zeroWrites() {
  return Object.freeze({
    identityPairingIntents: 0,
    identityPairingIntentEvents: 0,
    authIdentities: 0,
    appUsers: 0,
    productTables: 0,
  });
}

function normalizeTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Issued claim expiry is invalid");
  }
  return date.toISOString();
}

function fingerprint(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
