import { createHash, randomBytes } from "node:crypto";

import {
  digestIdentityBootstrapClaim,
  IDENTITY_BOOTSTRAP_CLAIM_POLICY,
} from "../../src/lib/identity-bootstrap-claim.ts";
import {
  fingerprintAppUserId,
  isSha256Fingerprint,
} from "./legacy-account-ownership-evidence.mjs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PRIVATE_CLAIM_CONTINUATIONS = new WeakMap();

export const IDENTITY_BOOTSTRAP_CLAIM_ISSUER_POLICY = Object.freeze({
  operation: "preissued_bootstrap_claim_issuer_v1",
  transactionIsolation: "read_committed",
  lockTimeoutMs: 2_000,
  statementTimeoutMs: 8_000,
  retryCount: 0,
});

export class IdentityBootstrapClaimIssuerError extends Error {
  constructor(code) {
    super("Identity bootstrap claim issuance failed");
    this.name = "IdentityBootstrapClaimIssuerError";
    this.code = code;
  }
}

export async function issueIdentityBootstrapClaim({
  pool,
  targetAppUserId,
  targetAppUserSha256,
  randomSource = randomBytes,
}) {
  validateInput({ pool, targetAppUserId, targetAppUserSha256 });

  const oneTimeClaim = createOneTimeIdentityBootstrapClaim(randomSource);
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    oneTimeClaim.destroy();
    throw mapDatabaseError(error);
  }

  let transactionOpen = false;
  try {
    await client.query("begin isolation level read committed");
    transactionOpen = true;
    await client.query("set local lock_timeout = '2s'");
    await client.query("set local statement_timeout = '8s'");

    const target = await lockTarget(client, targetAppUserId);
    validateTarget(target, targetAppUserSha256);

    const issueResult = await insertIntentIfEligible(client, {
      targetAppUserId,
      claimDigest: oneTimeClaim.claimDigest,
    });
    if (issueResult.rowCount !== 1 || !issueResult.rows[0]?.id) {
      throw new IdentityBootstrapClaimIssuerError(
        issueResult.rows[0]?.blocker ?? "claim_intent_not_issuable",
      );
    }
    const identityPairingIntentSha256 = fingerprintUuid(
      issueResult.rows[0].id,
    );

    await client.query("commit");
    transactionOpen = false;

    const continuation = createPrivateBootstrapContinuation({
      rawClaim: oneTimeClaim.take(),
    });
    oneTimeClaim.destroy();

    const result = Object.freeze({
      operation: IDENTITY_BOOTSTRAP_CLAIM_ISSUER_POLICY.operation,
      result: "issued",
      policy: Object.freeze({
        authorityPolicyId:
          IDENTITY_BOOTSTRAP_CLAIM_POLICY.authorityPolicyId,
        provider: IDENTITY_BOOTSTRAP_CLAIM_POLICY.provider,
        claimDigestVersion:
          IDENTITY_BOOTSTRAP_CLAIM_POLICY.claimDigestVersion,
        targetReviewPolicyId:
          IDENTITY_BOOTSTRAP_CLAIM_POLICY.targetReviewPolicyId,
        maxIntentLifetimeMs:
          IDENTITY_BOOTSTRAP_CLAIM_POLICY.maxIntentLifetimeMs,
        transactionIsolation:
          IDENTITY_BOOTSTRAP_CLAIM_ISSUER_POLICY.transactionIsolation,
        lockTimeoutMs:
          IDENTITY_BOOTSTRAP_CLAIM_ISSUER_POLICY.lockTimeoutMs,
        statementTimeoutMs:
          IDENTITY_BOOTSTRAP_CLAIM_ISSUER_POLICY.statementTimeoutMs,
        retryCount: IDENTITY_BOOTSTRAP_CLAIM_ISSUER_POLICY.retryCount,
      }),
      evidence: Object.freeze({
        targetAppUserSha256,
        expiresAt: normalizeTimestamp(issueResult.rows[0].expires_at),
      }),
      executionBinding: Object.freeze({
        targetAppUserSha256,
        provider: IDENTITY_BOOTSTRAP_CLAIM_POLICY.provider,
        claimDigestVersion:
          IDENTITY_BOOTSTRAP_CLAIM_POLICY.claimDigestVersion,
        claimDigest: oneTimeClaim.claimDigest,
        identityPairingIntentSha256,
      }),
      actualWrites: Object.freeze({
        identityPairingIntents: 1,
        identityPairingIntentEvents: 0,
        authIdentities: 0,
        appUsers: 0,
        productTables: 0,
      }),
      committed: true,
    });
    PRIVATE_CLAIM_CONTINUATIONS.set(result, continuation);
    return result;
  } catch (error) {
    oneTimeClaim.destroy();
    if (transactionOpen) {
      try {
        await client.query("rollback");
      } catch {
        // Keep the original fail-closed reason.
      }
    }
    if (error instanceof IdentityBootstrapClaimIssuerError) throw error;
    throw mapDatabaseError(error);
  } finally {
    try {
      client.release();
    } catch {
      // The transaction outcome is authoritative.
    }
  }
}

export function createOneTimeIdentityBootstrapClaim(
  randomSource = randomBytes,
) {
  let entropy;
  try {
    entropy = randomSource(
      IDENTITY_BOOTSTRAP_CLAIM_POLICY.claimEntropyBytes,
    );
  } catch {
    throw new IdentityBootstrapClaimIssuerError(
      "claim_entropy_unavailable",
    );
  }
  if (
    !(entropy instanceof Uint8Array) ||
    entropy.byteLength !==
      IDENTITY_BOOTSTRAP_CLAIM_POLICY.claimEntropyBytes
  ) {
    throw new IdentityBootstrapClaimIssuerError(
      "claim_entropy_invalid",
    );
  }

  const entropyBuffer = Buffer.from(entropy);
  let rawClaim =
    IDENTITY_BOOTSTRAP_CLAIM_POLICY.claimPrefix +
    entropyBuffer.toString("base64url");
  entropyBuffer.fill(0);
  entropy.fill(0);

  const claimDigest = digestIdentityBootstrapClaim(rawClaim);
  return Object.freeze({
    claimDigest,
    take() {
      if (rawClaim === null) {
        throw new IdentityBootstrapClaimIssuerError(
          "claim_material_already_taken",
        );
      }
      const current = rawClaim;
      rawClaim = null;
      return current;
    },
    destroy() {
      rawClaim = null;
    },
    isAvailable() {
      return rawClaim !== null;
    },
    toJSON() {
      return Object.freeze({
        state: rawClaim === null ? "taken" : "ready",
      });
    },
  });
}

export function takeIssuedIdentityBootstrapClaim(result) {
  if (
    result === null ||
    typeof result !== "object" ||
    !PRIVATE_CLAIM_CONTINUATIONS.has(result)
  ) {
    throw new IdentityBootstrapClaimIssuerError(
      "claim_continuation_unavailable",
    );
  }
  const continuation = PRIVATE_CLAIM_CONTINUATIONS.get(result);
  PRIVATE_CLAIM_CONTINUATIONS.delete(result);
  return continuation.take();
}

function validateInput({
  pool,
  targetAppUserId,
  targetAppUserSha256,
}) {
  if (!pool || typeof pool.connect !== "function") {
    throw new IdentityBootstrapClaimIssuerError("database_port_invalid");
  }
  if (
    typeof targetAppUserId !== "string" ||
    !UUID_PATTERN.test(targetAppUserId) ||
    targetAppUserId !== targetAppUserId.toLowerCase()
  ) {
    throw new IdentityBootstrapClaimIssuerError(
      "target_app_user_id_invalid",
    );
  }
  if (!isSha256Fingerprint(targetAppUserSha256)) {
    throw new IdentityBootstrapClaimIssuerError(
      "target_app_user_fingerprint_invalid",
    );
  }
  if (fingerprintAppUserId(targetAppUserId) !== targetAppUserSha256) {
    throw new IdentityBootstrapClaimIssuerError(
      "target_app_user_fingerprint_mismatch",
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
    throw new IdentityBootstrapClaimIssuerError(
      "reviewed_target_not_found",
    );
  }
  return result.rows[0];
}

function validateTarget(target, targetAppUserSha256) {
  if (
    fingerprintAppUserId(target.id) !== targetAppUserSha256 ||
    target.status !== "provisioning" ||
    target.role !== "user"
  ) {
    throw new IdentityBootstrapClaimIssuerError(
      "reviewed_target_state_mismatch",
    );
  }
}

async function insertIntentIfEligible(
  client,
  { targetAppUserId, claimDigest },
) {
  return client.query(
    `
      with issue_clock as materialized (
        select clock_timestamp() as issued_at
      ),
      eligibility as materialized (
        select
          not exists (
            select 1
            from auth_identities identity_row
            where identity_row.app_user_id = $1::uuid
              and identity_row.provider = $2
          ) as provider_identity_absent,
          not exists (
            select 1
            from identity_pairing_intents intent
            left join identity_pairing_intent_events terminal_event
              on terminal_event.identity_pairing_intent_id = intent.id
            cross join issue_clock
            where intent.target_app_user_id = $1::uuid
              and intent.provider = $2
              and terminal_event.id is null
              and intent.expires_at > issue_clock.issued_at
          ) as open_intent_absent
      ),
      inserted as (
        insert into identity_pairing_intents (
          authority_policy_id,
          target_app_user_id,
          provider,
          claim_digest_version,
          claim_digest,
          target_review_policy_id,
          issued_at,
          expires_at
        )
        select
          $3,
          $1::uuid,
          $2,
          $4,
          $5,
          $6,
          issue_clock.issued_at,
          issue_clock.issued_at + interval '10 minutes'
        from issue_clock
        cross join eligibility
        where eligibility.provider_identity_absent
          and eligibility.open_intent_absent
        returning id, expires_at
      )
      select id, expires_at, null::text as blocker
      from inserted
      union all
      select
        null::uuid as id,
        null::timestamptz as expires_at,
        case
          when not eligibility.provider_identity_absent
            then 'target_provider_identity_preexists'
          when not eligibility.open_intent_absent
            then 'unexpired_intent_exists'
          else 'claim_intent_not_issuable'
        end as blocker
      from eligibility
      where not exists (select 1 from inserted)
    `,
    [
      targetAppUserId,
      IDENTITY_BOOTSTRAP_CLAIM_POLICY.provider,
      IDENTITY_BOOTSTRAP_CLAIM_POLICY.authorityPolicyId,
      IDENTITY_BOOTSTRAP_CLAIM_POLICY.claimDigestVersion,
      claimDigest,
      IDENTITY_BOOTSTRAP_CLAIM_POLICY.targetReviewPolicyId,
    ],
  );
}

function createPrivateBootstrapContinuation({ rawClaim }) {
  let secret = Object.freeze({ rawClaim });
  return Object.freeze({
    take() {
      if (secret === null) {
        throw new IdentityBootstrapClaimIssuerError(
          "claim_continuation_already_taken",
        );
      }
      const current = secret;
      secret = null;
      return current;
    },
    isAvailable() {
      return secret !== null;
    },
    toJSON() {
      return Object.freeze({ state: secret === null ? "taken" : "ready" });
    },
  });
}

function fingerprintUuid(value) {
  if (
    typeof value !== "string" ||
    !UUID_PATTERN.test(value) ||
    value !== value.toLowerCase()
  ) {
    throw new IdentityBootstrapClaimIssuerError(
      "claim_intent_id_invalid",
    );
  }
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function normalizeTimestamp(value) {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new IdentityBootstrapClaimIssuerError(
      "claim_expiry_invalid",
    );
  }
  return timestamp.toISOString();
}

function mapDatabaseError(error) {
  const code = readOwnString(error, "code") ?? "";
  if (code === "23505" || code === "40P01") {
    return new IdentityBootstrapClaimIssuerError(
      "concurrent_state_conflict",
    );
  }
  if (code === "55P03" || code === "57014") {
    return new IdentityBootstrapClaimIssuerError("database_timeout");
  }
  if (code === "23514" || code === "23503") {
    return new IdentityBootstrapClaimIssuerError(
      "database_constraint_violation",
    );
  }
  return new IdentityBootstrapClaimIssuerError(
    "database_transaction_failed",
  );
}

function readOwnString(value, key) {
  if (value === null || typeof value !== "object") return null;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return null;
  }
  return descriptor &&
    "value" in descriptor &&
    typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}
