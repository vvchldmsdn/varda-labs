import { createHash } from "node:crypto";

import {
  fingerprintAppUserId,
  isSha256Fingerprint,
} from "./legacy-account-ownership-evidence.mjs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CLAIM_DIGEST_PATTERN =
  /^bootstrap-claim-sha256-v1:[0-9a-f]{64}$/;

export const IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_POLICY = Object.freeze({
  operation: "identity_bootstrap_lifecycle_preflight_v1",
  provider: "neon_auth",
  authorityPolicyId: "preissued_bootstrap_claim_authority_v1",
  claimDigestVersion: "bootstrap_claim_sha256_v1",
  targetReviewPolicyId:
    "single_provisioning_user_explicit_review_v1",
  maxIntentLifetimeMs: 10 * 60 * 1_000,
  transactionIsolation: "repeatable_read",
  accessMode: "read_only",
  statementTimeoutMs: 8_000,
  retryCount: 0,
});

export const IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_SQL = `
  with evaluation_clock as materialized (
    select clock_timestamp() as observed_at
  ),
  matching_intents as materialized (
    select
      id,
      authority_policy_id,
      target_app_user_id,
      provider,
      claim_digest_version,
      claim_digest,
      target_review_policy_id,
      issued_at,
      expires_at
    from identity_pairing_intents
    where claim_digest_version = $1
      and claim_digest = $2
  ),
  matching_intent as materialized (
    select *
    from matching_intents
    order by id
    limit 1
  )
  select
    evaluation_clock.observed_at as "observedAt",
    target.id::text as "targetAppUserId",
    target.status as "targetStatus",
    target.role as "targetRole",
    (
      select count(*)::int
      from auth_identities identity_row
      where identity_row.app_user_id = $3::uuid
        and identity_row.provider = $4
    ) as "providerIdentityCount",
    (select count(*)::int from matching_intents) as "matchingIntentCount",
    matching_intent.id::text as "identityPairingIntentId",
    matching_intent.authority_policy_id as "authorityPolicyId",
    matching_intent.target_app_user_id::text as "intentTargetAppUserId",
    matching_intent.provider as "intentProvider",
    matching_intent.claim_digest_version as "intentClaimDigestVersion",
    matching_intent.claim_digest as "intentClaimDigest",
    matching_intent.target_review_policy_id as "targetReviewPolicyId",
    matching_intent.issued_at as "issuedAt",
    matching_intent.expires_at as "expiresAt",
    (
      select count(*)::int
      from identity_pairing_intent_events terminal_event
      where terminal_event.identity_pairing_intent_id =
        matching_intent.id
    ) as "terminalEventCount",
    (
      select min(terminal_event.event_type)
      from identity_pairing_intent_events terminal_event
      where terminal_event.identity_pairing_intent_id =
        matching_intent.id
    ) as "terminalEventType",
    (
      select count(*)::int
      from identity_pairing_intents open_intent
      left join identity_pairing_intent_events terminal_event
        on terminal_event.identity_pairing_intent_id = open_intent.id
      where open_intent.target_app_user_id = $3::uuid
        and open_intent.provider = $4
        and terminal_event.id is null
        and open_intent.expires_at > evaluation_clock.observed_at
    ) as "openIntentCount"
  from evaluation_clock
  left join app_users target on target.id = $3::uuid
  left join matching_intent on true
`;

export class IdentityBootstrapLifecyclePreflightError extends Error {
  constructor(code) {
    super("Identity bootstrap lifecycle preflight failed");
    this.name = "IdentityBootstrapLifecyclePreflightError";
    this.code = code;
  }
}

export function parseIdentityBootstrapLifecyclePreflightArgs(argv) {
  if (!Array.isArray(argv)) {
    throw new IdentityBootstrapLifecyclePreflightError(
      "arguments_invalid",
    );
  }

  const allowed = new Set([
    "--target-app-user-id",
    "--target-app-user-sha256",
    "--claim-digest-version",
    "--claim-digest",
    "--identity-pairing-intent-sha256",
    "--reviewed-database-target-fingerprint",
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!allowed.has(key) || values.has(key)) {
      throw new IdentityBootstrapLifecyclePreflightError(
        "unsupported_or_duplicate_argument",
      );
    }
    const value = argv[index + 1];
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.startsWith("--")
    ) {
      throw new IdentityBootstrapLifecyclePreflightError(
        "arguments_invalid",
      );
    }
    values.set(key, value);
    index += 1;
  }
  if (values.size !== allowed.size) {
    throw new IdentityBootstrapLifecyclePreflightError(
      "required_evidence_missing",
    );
  }

  const targetAppUserId = values.get("--target-app-user-id");
  const targetAppUserSha256 = values.get(
    "--target-app-user-sha256",
  );
  const claimDigestVersion = values.get("--claim-digest-version");
  const claimDigest = values.get("--claim-digest");
  const identityPairingIntentSha256 = values.get(
    "--identity-pairing-intent-sha256",
  );
  const reviewedDatabaseTargetFingerprint = values.get(
    "--reviewed-database-target-fingerprint",
  );

  if (
    !isCanonicalUuid(targetAppUserId) ||
    !isSha256Fingerprint(targetAppUserSha256) ||
    fingerprintAppUserId(targetAppUserId) !== targetAppUserSha256
  ) {
    throw new IdentityBootstrapLifecyclePreflightError(
      "reviewed_target_invalid",
    );
  }
  if (
    claimDigestVersion !==
      IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_POLICY.claimDigestVersion ||
    !CLAIM_DIGEST_PATTERN.test(claimDigest)
  ) {
    throw new IdentityBootstrapLifecyclePreflightError(
      "claim_binding_invalid",
    );
  }
  if (!isSha256Fingerprint(identityPairingIntentSha256)) {
    throw new IdentityBootstrapLifecyclePreflightError(
      "intent_binding_invalid",
    );
  }
  if (!isSha256Fingerprint(reviewedDatabaseTargetFingerprint)) {
    throw new IdentityBootstrapLifecyclePreflightError(
      "reviewed_database_target_fingerprint_invalid",
    );
  }

  return Object.freeze({
    targetAppUserId,
    targetAppUserSha256,
    claimDigestVersion,
    claimDigest,
    identityPairingIntentSha256,
    reviewedDatabaseTargetFingerprint,
  });
}

export function buildIdentityBootstrapLifecyclePreflight({
  row,
  options,
  databaseTargetFingerprint,
}) {
  const normalizedOptions = normalizeOptions(options);
  if (
    !isSha256Fingerprint(databaseTargetFingerprint) ||
    databaseTargetFingerprint !==
      normalizedOptions.reviewedDatabaseTargetFingerprint
  ) {
    throw new IdentityBootstrapLifecyclePreflightError(
      "reviewed_database_target_fingerprint_mismatch",
    );
  }

  const snapshot = normalizeSnapshot(row);
  const blockers = [];

  if (snapshot.targetAppUserId === null) {
    blockers.push("target_app_user_not_found");
  } else if (
    snapshot.targetAppUserId !== normalizedOptions.targetAppUserId ||
    fingerprintAppUserId(snapshot.targetAppUserId) !==
      normalizedOptions.targetAppUserSha256
  ) {
    blockers.push("target_app_user_binding_drift");
  }
  if (
    snapshot.targetAppUserId !== null &&
    (snapshot.targetStatus !== "provisioning" ||
      snapshot.targetRole !== "user")
  ) {
    blockers.push("target_app_user_state_mismatch");
  }
  if (snapshot.providerIdentityCount !== 0) {
    blockers.push("target_provider_identity_present");
  }

  if (snapshot.matchingIntentCount === 0) {
    blockers.push("matching_intent_not_found");
  } else if (snapshot.matchingIntentCount !== 1) {
    blockers.push("matching_intent_ambiguous");
  } else if (!intentBindingMatches(snapshot, normalizedOptions)) {
    blockers.push("matching_intent_binding_drift");
  }

  if (snapshot.terminalEventCount > 0) {
    blockers.push(
      snapshot.terminalEventCount === 1 &&
        snapshot.terminalEventType === "consumed"
        ? "matching_intent_consumed"
        : snapshot.terminalEventCount === 1 &&
            snapshot.terminalEventType === "revoked"
          ? "matching_intent_revoked"
          : "matching_intent_terminal_state_invalid",
    );
  }
  if (
    snapshot.matchingIntentCount === 1 &&
    snapshot.expiresAt > snapshot.observedAt
  ) {
    blockers.push("matching_intent_unexpired");
  }
  if (snapshot.openIntentCount !== 0) {
    blockers.push("unexpired_unterminated_intent_present");
  }

  return Object.freeze({
    operation:
      IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_POLICY.operation,
    mode: "production_select_only",
    result:
      blockers.length === 0 ? "ready_for_new_issue" : "blocked",
    readOnly: true,
    databaseSideEffects: false,
    databaseTargetFingerprint,
    evidence: Object.freeze({
      targetAppUserSha256: normalizedOptions.targetAppUserSha256,
      identityPairingIntentSha256:
        normalizedOptions.identityPairingIntentSha256,
      claimDigestVersion: normalizedOptions.claimDigestVersion,
    }),
    state: Object.freeze({
      target:
        snapshot.targetAppUserId === null
          ? "missing"
          : snapshot.targetStatus === "provisioning" &&
              snapshot.targetRole === "user"
            ? "provisioning_user"
            : "unexpected",
      providerIdentity:
        snapshot.providerIdentityCount === 0 ? "absent" : "present",
      matchingIntent:
        snapshot.matchingIntentCount === 0
          ? "missing"
          : snapshot.matchingIntentCount !== 1
            ? "ambiguous"
            : snapshot.terminalEventCount > 0
              ? "terminal"
              : snapshot.expiresAt <= snapshot.observedAt
                ? "expired_unterminated"
                : "unexpired_unterminated",
      openIntent:
        snapshot.openIntentCount === 0 ? "absent" : "present",
    }),
    blockers: Object.freeze(blockers),
    transaction: Object.freeze({
      isolation:
        IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_POLICY.transactionIsolation,
      accessMode:
        IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_POLICY.accessMode,
      statementTimeoutMs:
        IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_POLICY.statementTimeoutMs,
      retryCount:
        IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_POLICY.retryCount,
    }),
    plannedWrites: zeroWrites(),
  });
}

export function fingerprintIdentityPairingIntentId(value) {
  if (!isCanonicalUuid(value)) {
    throw new IdentityBootstrapLifecyclePreflightError(
      "intent_identifier_invalid",
    );
  }
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function normalizeOptions(options) {
  if (options === null || typeof options !== "object") {
    throw new IdentityBootstrapLifecyclePreflightError(
      "preflight_options_invalid",
    );
  }
  return parseIdentityBootstrapLifecyclePreflightArgs([
    "--target-app-user-id",
    readOwnString(options, "targetAppUserId") ?? "",
    "--target-app-user-sha256",
    readOwnString(options, "targetAppUserSha256") ?? "",
    "--claim-digest-version",
    readOwnString(options, "claimDigestVersion") ?? "",
    "--claim-digest",
    readOwnString(options, "claimDigest") ?? "",
    "--identity-pairing-intent-sha256",
    readOwnString(options, "identityPairingIntentSha256") ?? "",
    "--reviewed-database-target-fingerprint",
    readOwnString(options, "reviewedDatabaseTargetFingerprint") ?? "",
  ]);
}

function normalizeSnapshot(row) {
  if (row === null || typeof row !== "object") {
    throw new IdentityBootstrapLifecyclePreflightError(
      "database_snapshot_invalid",
    );
  }

  const observedAt = normalizeTimestamp(readOwnValue(row, "observedAt"));
  const targetAppUserId = normalizeOptionalUuid(
    readOwnValue(row, "targetAppUserId"),
  );
  const matchingIntentCount = normalizeCount(
    readOwnValue(row, "matchingIntentCount"),
  );
  const identityPairingIntentId = normalizeOptionalUuid(
    readOwnValue(row, "identityPairingIntentId"),
  );
  const expiresAt =
    matchingIntentCount === 0
      ? null
      : normalizeTimestamp(readOwnValue(row, "expiresAt"));
  const issuedAt =
    matchingIntentCount === 0
      ? null
      : normalizeTimestamp(readOwnValue(row, "issuedAt"));
  const terminalEventCount = normalizeCount(
    readOwnValue(row, "terminalEventCount"),
  );
  const terminalEventType = normalizeOptionalString(
    readOwnValue(row, "terminalEventType"),
  );
  if (
    (terminalEventCount === 0 && terminalEventType !== null) ||
    (terminalEventCount === 1 &&
      !["consumed", "revoked"].includes(terminalEventType))
  ) {
    throw new IdentityBootstrapLifecyclePreflightError(
      "database_snapshot_invalid",
    );
  }

  return Object.freeze({
    observedAt,
    targetAppUserId,
    targetStatus: normalizeOptionalString(
      readOwnValue(row, "targetStatus"),
    ),
    targetRole: normalizeOptionalString(readOwnValue(row, "targetRole")),
    providerIdentityCount: normalizeCount(
      readOwnValue(row, "providerIdentityCount"),
    ),
    matchingIntentCount,
    identityPairingIntentId,
    authorityPolicyId: normalizeOptionalString(
      readOwnValue(row, "authorityPolicyId"),
    ),
    intentTargetAppUserId: normalizeOptionalUuid(
      readOwnValue(row, "intentTargetAppUserId"),
    ),
    intentProvider: normalizeOptionalString(
      readOwnValue(row, "intentProvider"),
    ),
    intentClaimDigestVersion: normalizeOptionalString(
      readOwnValue(row, "intentClaimDigestVersion"),
    ),
    intentClaimDigest: normalizeOptionalString(
      readOwnValue(row, "intentClaimDigest"),
    ),
    targetReviewPolicyId: normalizeOptionalString(
      readOwnValue(row, "targetReviewPolicyId"),
    ),
    issuedAt,
    expiresAt,
    terminalEventCount,
    terminalEventType,
    openIntentCount: normalizeCount(
      readOwnValue(row, "openIntentCount"),
    ),
  });
}

function intentBindingMatches(snapshot, options) {
  return (
    snapshot.identityPairingIntentId !== null &&
    fingerprintIdentityPairingIntentId(
      snapshot.identityPairingIntentId,
    ) === options.identityPairingIntentSha256 &&
    snapshot.authorityPolicyId ===
      IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_POLICY.authorityPolicyId &&
    snapshot.intentTargetAppUserId === options.targetAppUserId &&
    snapshot.intentProvider ===
      IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_POLICY.provider &&
    snapshot.intentClaimDigestVersion === options.claimDigestVersion &&
    snapshot.intentClaimDigest === options.claimDigest &&
    snapshot.targetReviewPolicyId ===
      IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_POLICY.targetReviewPolicyId &&
    snapshot.issuedAt < snapshot.expiresAt &&
    snapshot.expiresAt - snapshot.issuedAt <=
      IDENTITY_BOOTSTRAP_LIFECYCLE_PREFLIGHT_POLICY.maxIntentLifetimeMs
  );
}

function normalizeTimestamp(value) {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new IdentityBootstrapLifecyclePreflightError(
      "database_snapshot_invalid",
    );
  }
  return timestamp.getTime();
}

function normalizeCount(value) {
  const number = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new IdentityBootstrapLifecyclePreflightError(
      "database_snapshot_invalid",
    );
  }
  return number;
}

function normalizeOptionalUuid(value) {
  if (value === null || value === undefined) return null;
  if (!isCanonicalUuid(value)) {
    throw new IdentityBootstrapLifecyclePreflightError(
      "database_snapshot_invalid",
    );
  }
  return value;
}

function normalizeOptionalString(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new IdentityBootstrapLifecyclePreflightError(
      "database_snapshot_invalid",
    );
  }
  return value;
}

function isCanonicalUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function readOwnString(value, key) {
  const result = readOwnValue(value, key);
  return typeof result === "string" ? result : null;
}

function readOwnValue(value, key) {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return undefined;
  }
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
  return descriptor && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function zeroWrites() {
  return Object.freeze({
    identityPairingIntents: 0,
    identityPairingIntentEvents: 0,
    authIdentities: 0,
    appUsers: 0,
    accounts: 0,
    productTables: 0,
  });
}
