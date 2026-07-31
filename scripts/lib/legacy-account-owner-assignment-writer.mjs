import {
  compareAscii,
  fingerprintAppUserId,
  isSha256Fingerprint,
} from "./legacy-account-ownership-evidence.mjs";
import {
  evaluateLegacyAccountOwnerAssignment,
  LEGACY_ACCOUNT_OWNER_ASSIGNMENT_EXPECTED_ACCOUNT_COUNT,
} from "./legacy-account-owner-assignment-state.mjs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLAIM_DIGEST_PATTERN =
  /^bootstrap-claim-sha256-v1:[0-9a-f]{64}$/;
const CLAIM_DIGEST_VERSION = "bootstrap_claim_sha256_v1";

export const LEGACY_ACCOUNT_OWNER_ASSIGNMENT_POLICY = Object.freeze({
  operation: "post_consume_legacy_account_owner_assignment_v1",
  expectedAccountCount:
    LEGACY_ACCOUNT_OWNER_ASSIGNMENT_EXPECTED_ACCOUNT_COUNT,
  authorityPolicyId: "preissued_bootstrap_claim_authority_v1",
  provider: "neon_auth",
  targetReviewPolicyId: "single_provisioning_user_explicit_review_v1",
  consumedEventType: "consumed",
  subjectBindingVersion: "provider_subject_hmac_sha256_v1",
  plannerPolicyId: "initial_identity_link_planner_v1",
  planBindingVersion: "identity_link_plan_hmac_sha256_v1",
  transactionIsolation: "read_committed",
  lockTimeoutMs: 2_000,
  statementTimeoutMs: 8_000,
  retryCount: 0,
});

export class LegacyAccountOwnerAssignmentError extends Error {
  constructor(code) {
    super("Legacy account owner assignment failed");
    this.name = "LegacyAccountOwnerAssignmentError";
    this.code = code;
  }
}

export function planLegacyAccountOwnerAssignment(input) {
  return executeLegacyAccountOwnerAssignment({
    ...input,
    mode: "dry_run",
  });
}

export async function assignLegacyAccountsToConsumedIdentity({
  pool,
  claimDigest,
  targetAppUserSha256,
  legacyOwnerSha256,
  candidateSetDigest,
  eligibleSetDigest,
}) {
  return executeLegacyAccountOwnerAssignment({
    pool,
    mode: "write",
    claimDigest,
    targetAppUserSha256,
    legacyOwnerSha256,
    candidateSetDigest,
    eligibleSetDigest,
  });
}

async function executeLegacyAccountOwnerAssignment({
  pool,
  mode,
  claimDigest,
  targetAppUserSha256,
  legacyOwnerSha256,
  candidateSetDigest,
  eligibleSetDigest,
}) {
  validateInput({
    pool,
    mode,
    claimDigest,
    targetAppUserSha256,
    legacyOwnerSha256,
    candidateSetDigest,
    eligibleSetDigest,
  });

  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    throw mapDatabaseError(error);
  }

  let transactionOpen = false;
  try {
    await client.query("begin isolation level read committed");
    transactionOpen = true;
    await client.query("set local lock_timeout = '2s'");
    await client.query("set local statement_timeout = '8s'");

    const intent = await lockIntent(client, claimDigest);
    validateIntent(intent, {
      claimDigest,
      targetAppUserSha256,
    });

    const target = await lockTarget(client, intent.target_app_user_id);
    validateTarget(target, targetAppUserSha256);

    const event = await lockConsumedEvent(client, intent.id);
    validateConsumedEvent(event, intent.id);

    const identity = await lockConsumedIdentity(
      client,
      event.auth_identity_id,
    );
    validateConsumedIdentity(identity, {
      authIdentityId: event.auth_identity_id,
      targetAppUserId: target.id,
      provider: intent.provider,
    });

    const accountRows = await lockAccounts(client);
    const snapshot = evaluateLegacyAccountOwnerAssignment({
      accountRows,
      targetAppUserSha256,
      legacyOwnerSha256,
      candidateSetDigest,
      eligibleSetDigest,
    });
    if (snapshot.blocker !== null) {
      throw new LegacyAccountOwnerAssignmentError(snapshot.blocker);
    }

    const plannedAccountWrites =
      snapshot.state === "assignment_pending"
        ? LEGACY_ACCOUNT_OWNER_ASSIGNMENT_POLICY.expectedAccountCount
        : 0;
    if (mode === "dry_run") {
      await client.query("rollback");
      transactionOpen = false;
      return buildResult({
        mode,
        result:
          snapshot.state === "already_applied"
            ? "already_applied"
            : "planned",
        plannedAccountWrites,
        actualAccountWrites: 0,
        candidateSetDigest,
        eligibleSetDigest,
        committed: false,
      });
    }

    if (snapshot.state === "already_applied") {
      await client.query("commit");
      transactionOpen = false;
      return buildResult({
        mode,
        result: "already_applied",
        plannedAccountWrites,
        actualAccountWrites: 0,
        candidateSetDigest,
        eligibleSetDigest,
        committed: true,
      });
    }

    const updateResult = await client.query(
      `
        update accounts
        set canonical_owner_user_id = $2::uuid,
            updated_at = clock_timestamp()
        where id = any($1::uuid[])
          and canonical_owner_user_id is null
          and owner_user_id = $3
        returning id
      `,
      [
        snapshot.eligibleAccountIds,
        target.id,
        snapshot.exactLegacyOwnerValue,
      ],
    );
    validateUpdatedIds(updateResult, snapshot.eligibleAccountIds);

    const assignedRows = await readAssignedAccounts(
      client,
      snapshot.eligibleAccountIds,
    );
    validateAssignedRows(assignedRows, {
      accountIds: snapshot.eligibleAccountIds,
      targetAppUserId: target.id,
      exactLegacyOwnerValue: snapshot.exactLegacyOwnerValue,
    });

    await client.query("commit");
    transactionOpen = false;

    return buildResult({
      mode,
      result: "assigned",
      plannedAccountWrites,
      actualAccountWrites:
        LEGACY_ACCOUNT_OWNER_ASSIGNMENT_POLICY.expectedAccountCount,
      candidateSetDigest,
      eligibleSetDigest,
      committed: true,
    });
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("rollback");
      } catch {
        // Preserve the fail-closed reason from the attempted assignment.
      }
    }
    if (error instanceof LegacyAccountOwnerAssignmentError) throw error;
    throw mapDatabaseError(error);
  } finally {
    try {
      client.release();
    } catch {
      // The transaction outcome is authoritative.
    }
  }
}

function validateInput({
  pool,
  mode,
  claimDigest,
  targetAppUserSha256,
  legacyOwnerSha256,
  candidateSetDigest,
  eligibleSetDigest,
}) {
  if (!pool || typeof pool.connect !== "function") {
    throw new LegacyAccountOwnerAssignmentError("database_port_invalid");
  }
  if (!["dry_run", "write"].includes(mode)) {
    throw new LegacyAccountOwnerAssignmentError("assignment_mode_invalid");
  }
  if (
    typeof claimDigest !== "string" ||
    !CLAIM_DIGEST_PATTERN.test(claimDigest)
  ) {
    throw new LegacyAccountOwnerAssignmentError(
      "claim_digest_invalid",
    );
  }
  for (const [value, code] of [
    [targetAppUserSha256, "target_app_user_fingerprint_invalid"],
    [legacyOwnerSha256, "legacy_owner_fingerprint_invalid"],
    [candidateSetDigest, "candidate_set_digest_invalid"],
    [eligibleSetDigest, "eligible_set_digest_invalid"],
  ]) {
    if (!isSha256Fingerprint(value)) {
      throw new LegacyAccountOwnerAssignmentError(code);
    }
  }
}

async function lockIntent(client, claimDigest) {
  const result = await client.query(
    `
      select
        id,
        authority_policy_id,
        target_app_user_id,
        provider,
        claim_digest_version,
        claim_digest,
        target_review_policy_id
      from identity_pairing_intents
      where claim_digest = $1
      for update
    `,
    [claimDigest],
  );
  if (result.rowCount !== 1) {
    throw new LegacyAccountOwnerAssignmentError(
      "consumed_intent_not_found",
    );
  }
  return result.rows[0];
}

function validateIntent(
  intent,
  { claimDigest, targetAppUserSha256 },
) {
  if (
    typeof intent.id !== "string" ||
    !UUID_PATTERN.test(intent.id) ||
    intent.id !== intent.id.toLowerCase() ||
    intent.authority_policy_id !==
      LEGACY_ACCOUNT_OWNER_ASSIGNMENT_POLICY.authorityPolicyId ||
    intent.provider !==
      LEGACY_ACCOUNT_OWNER_ASSIGNMENT_POLICY.provider ||
    intent.claim_digest_version !== CLAIM_DIGEST_VERSION ||
    intent.claim_digest !== claimDigest ||
    intent.target_review_policy_id !==
      LEGACY_ACCOUNT_OWNER_ASSIGNMENT_POLICY.targetReviewPolicyId ||
    fingerprintAppUserId(intent.target_app_user_id) !==
      targetAppUserSha256
  ) {
    throw new LegacyAccountOwnerAssignmentError(
      "consumed_intent_invalid",
    );
  }
}

async function lockTarget(client, targetAppUserId) {
  const result = await client.query(
    `
      select id, status, role
      from app_users
      where id = $1::uuid
      for update
    `,
    [targetAppUserId],
  );
  if (result.rowCount !== 1) {
    throw new LegacyAccountOwnerAssignmentError(
      "consumed_target_not_found",
    );
  }
  return result.rows[0];
}

function validateTarget(target, targetAppUserSha256) {
  if (
    fingerprintAppUserId(target.id) !== targetAppUserSha256 ||
    target.status !== "active" ||
    target.role !== "user"
  ) {
    throw new LegacyAccountOwnerAssignmentError(
      "consumed_target_state_mismatch",
    );
  }
}

async function lockConsumedEvent(client, intentId) {
  const result = await client.query(
    `
      select
        id,
        identity_pairing_intent_id,
        event_type,
        auth_identity_id,
        subject_binding_version,
        identity_link_planner_policy_id,
        identity_link_plan_binding_version
      from identity_pairing_intent_events
      where identity_pairing_intent_id = $1::uuid
      order by id
      for update
    `,
    [intentId],
  );
  if (result.rowCount !== 1) {
    throw new LegacyAccountOwnerAssignmentError(
      "consumed_event_not_found",
    );
  }
  return result.rows[0];
}

function validateConsumedEvent(event, intentId) {
  if (
    event.identity_pairing_intent_id !== intentId ||
    event.event_type !==
      LEGACY_ACCOUNT_OWNER_ASSIGNMENT_POLICY.consumedEventType ||
    typeof event.auth_identity_id !== "string" ||
    !UUID_PATTERN.test(event.auth_identity_id) ||
    event.subject_binding_version !==
      LEGACY_ACCOUNT_OWNER_ASSIGNMENT_POLICY.subjectBindingVersion ||
    event.identity_link_planner_policy_id !==
      LEGACY_ACCOUNT_OWNER_ASSIGNMENT_POLICY.plannerPolicyId ||
    event.identity_link_plan_binding_version !==
      LEGACY_ACCOUNT_OWNER_ASSIGNMENT_POLICY.planBindingVersion
  ) {
    throw new LegacyAccountOwnerAssignmentError(
      "consumed_event_invalid",
    );
  }
}

async function lockConsumedIdentity(client, authIdentityId) {
  const result = await client.query(
    `
      select id, app_user_id, provider, status
      from auth_identities
      where id = $1::uuid
      for update
    `,
    [authIdentityId],
  );
  if (result.rowCount !== 1) {
    throw new LegacyAccountOwnerAssignmentError(
      "consumed_identity_not_found",
    );
  }
  return result.rows[0];
}

function validateConsumedIdentity(
  identity,
  { authIdentityId, targetAppUserId, provider },
) {
  if (
    identity.id !== authIdentityId ||
    identity.app_user_id !== targetAppUserId ||
    identity.provider !== provider ||
    identity.status !== "active"
  ) {
    throw new LegacyAccountOwnerAssignmentError(
      "consumed_identity_invalid",
    );
  }
}

async function lockAccounts(client) {
  const result = await client.query(
    `
      select
        id,
        owner_user_id as legacy_owner_user_id,
        canonical_owner_user_id
      from accounts
      order by id
      for update
    `,
  );
  return result.rows;
}

function validateUpdatedIds(updateResult, expectedIds) {
  const actualIds = updateResult.rows
    .map(({ id }) => id)
    .sort(compareAscii);
  if (
    updateResult.rowCount !==
      LEGACY_ACCOUNT_OWNER_ASSIGNMENT_POLICY.expectedAccountCount ||
    actualIds.length !== expectedIds.length ||
    actualIds.some((id, index) => id !== expectedIds[index])
  ) {
    throw new LegacyAccountOwnerAssignmentError(
      "account_update_count_mismatch",
    );
  }
}

async function readAssignedAccounts(client, accountIds) {
  const result = await client.query(
    `
      select
        id,
        owner_user_id as legacy_owner_user_id,
        canonical_owner_user_id
      from accounts
      where id = any($1::uuid[])
      order by id
    `,
    [accountIds],
  );
  return result.rows;
}

function validateAssignedRows(
  rows,
  { accountIds, targetAppUserId, exactLegacyOwnerValue },
) {
  if (rows.length !== accountIds.length) {
    throw new LegacyAccountOwnerAssignmentError(
      "account_assignment_verification_failed",
    );
  }
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (
      row.id !== accountIds[index] ||
      row.legacy_owner_user_id !== exactLegacyOwnerValue ||
      row.canonical_owner_user_id !== targetAppUserId
    ) {
      throw new LegacyAccountOwnerAssignmentError(
        "account_assignment_verification_failed",
      );
    }
  }
}

function buildResult({
  mode,
  result,
  plannedAccountWrites,
  actualAccountWrites,
  candidateSetDigest,
  eligibleSetDigest,
  committed,
}) {
  return Object.freeze({
    operation: LEGACY_ACCOUNT_OWNER_ASSIGNMENT_POLICY.operation,
    mode,
    result,
    policy: Object.freeze({
      expectedAccountCount:
        LEGACY_ACCOUNT_OWNER_ASSIGNMENT_POLICY.expectedAccountCount,
      transactionIsolation:
        LEGACY_ACCOUNT_OWNER_ASSIGNMENT_POLICY.transactionIsolation,
      lockTimeoutMs:
        LEGACY_ACCOUNT_OWNER_ASSIGNMENT_POLICY.lockTimeoutMs,
      statementTimeoutMs:
        LEGACY_ACCOUNT_OWNER_ASSIGNMENT_POLICY.statementTimeoutMs,
      retryCount: LEGACY_ACCOUNT_OWNER_ASSIGNMENT_POLICY.retryCount,
    }),
    evidence: Object.freeze({
      candidateSetDigest,
      eligibleSetDigest,
    }),
    plannedWrites: Object.freeze({
      accounts: plannedAccountWrites,
      identityTables: 0,
      otherProductTables: 0,
    }),
    actualWrites: Object.freeze({
      accounts: actualAccountWrites,
      identityTables: 0,
      otherProductTables: 0,
    }),
    committed,
  });
}

function mapDatabaseError(error) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  if (code === "23505" || code === "40P01") {
    return new LegacyAccountOwnerAssignmentError(
      "concurrent_state_conflict",
    );
  }
  if (code === "55P03" || code === "57014") {
    return new LegacyAccountOwnerAssignmentError("database_timeout");
  }
  if (code === "23514" || code === "23503") {
    return new LegacyAccountOwnerAssignmentError(
      "database_constraint_violation",
    );
  }
  return new LegacyAccountOwnerAssignmentError(
    "database_transaction_failed",
  );
}
