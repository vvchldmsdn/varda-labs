import {
  createSessionSubjectBinding,
  SESSION_SUBJECT_BINDING_POLICY,
  snapshotSessionSubjectEvidence,
} from "../../src/lib/auth/session-subject-binding.ts";
import {
  digestIdentityBootstrapClaim,
  IDENTITY_BOOTSTRAP_CLAIM_POLICY,
} from "../../src/lib/identity-bootstrap-claim.ts";
import {
  createIdentityLinkPlanBinding,
  IDENTITY_LINK_PLAN_BINDING_POLICY,
} from "../../src/lib/identity-link-plan-binding.ts";
import {
  planInitialIdentityLink,
  prepareVerifiedProviderSubjectPort,
} from "../../src/lib/initial-identity-link-planner.ts";

export const IDENTITY_PAIRING_CONSUME_WRITER_POLICY = Object.freeze({
  operation: "identity_pairing_atomic_consume_v1",
  transactionIsolation: "read_committed",
  lockTimeoutMs: 2_000,
  statementTimeoutMs: 8_000,
  retryCount: 0,
});

export class IdentityPairingConsumeError extends Error {
  constructor(code) {
    super("Identity pairing claim consumption failed");
    this.name = "IdentityPairingConsumeError";
    this.code = code;
  }
}

export async function consumeIdentityPairingClaim({
  pool,
  rawClaim,
  verifiedSessionSubjectPort,
  hmacKey,
}) {
  if (!pool || typeof pool.connect !== "function") {
    throw new IdentityPairingConsumeError("database_port_invalid");
  }
  if (
    !verifiedSessionSubjectPort ||
    typeof verifiedSessionSubjectPort.read !== "function"
  ) {
    throw new IdentityPairingConsumeError(
      "verified_subject_port_invalid",
    );
  }
  if (
    !(hmacKey instanceof Uint8Array) ||
    hmacKey.byteLength !== SESSION_SUBJECT_BINDING_POLICY.hmacKeyBytes
  ) {
    throw new IdentityPairingConsumeError("binding_key_invalid");
  }

  let claimDigest;
  try {
    claimDigest = digestIdentityBootstrapClaim(rawClaim);
  } catch {
    throw new IdentityPairingConsumeError("claim_format_invalid");
  }

  const subject = await readVerifiedSessionSubject({
    verifiedSessionSubjectPort,
    hmacKey,
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
    validateIntent(intent, claimDigest);

    const target = await lockTarget(client, intent.target_app_user_id);
    const identityRows = await lockRelevantIdentities(client, {
      provider: subject.provider,
      subject: subject.rawSubject,
      targetAppUserId: target.id,
    });
    const lifecycle = await readLockedLifecycle(client, intent.id);

    validateLifecycle(intent, lifecycle);
    validateTarget(target);

    const plan = planInitialIdentityLink({
      providerSubject: prepareVerifiedProviderSubjectPort({
        provider: subject.provider,
        subject: subject.rawSubject,
        verified: true,
      }),
      reviewedTarget: {
        state: "reviewed",
        appUserId: target.id,
        appUserStatus: target.status,
        appUserRole: target.role,
        candidateCount: 1,
        reviewSource: "explicit_review",
      },
      existingLinks: identityRows.map((row) => ({
        provider: row.provider,
        subject: row.provider_subject,
        appUserId: row.app_user_id,
        status: row.status,
      })),
    });
    if (plan.outcome !== "planned_link") {
      throw new IdentityPairingConsumeError(
        `identity_link_${plan.reason ?? plan.outcome}`,
      );
    }

    let planBinding;
    try {
      planBinding = createIdentityLinkPlanBinding({
        hmacKey,
        provider: subject.provider,
        subjectBindingVersion: subject.subjectBindingVersion,
        subjectBinding: subject.subjectBinding,
        targetAppUserId: target.id,
        targetStatus: target.status,
        targetRole: target.role,
        existingLinks: identityRows.map((row) => ({
          id: row.id,
          appUserId: row.app_user_id,
          provider: row.provider,
          subject: row.provider_subject,
          status: row.status,
        })),
      });
    } catch {
      throw new IdentityPairingConsumeError(
        "plan_binding_generation_failed",
      );
    }

    const identityResult = await client.query(
      `
        insert into auth_identities (
          app_user_id,
          provider,
          provider_subject,
          status
        ) values ($1::uuid, $2, $3, 'active')
        returning id
      `,
      [target.id, subject.provider, subject.rawSubject],
    );
    if (identityResult.rowCount !== 1 || !identityResult.rows[0]?.id) {
      throw new IdentityPairingConsumeError("identity_insert_failed");
    }

    const activationResult = await client.query(
      `
        update app_users
        set status = 'active',
            updated_at = clock_timestamp()
        where id = $1::uuid
          and status = 'provisioning'
          and role = 'user'
        returning id
      `,
      [target.id],
    );
    if (activationResult.rowCount !== 1) {
      throw new IdentityPairingConsumeError(
        "target_activation_failed",
      );
    }

    const eventResult = await client.query(
      `
        insert into identity_pairing_intent_events (
          identity_pairing_intent_id,
          event_type,
          auth_identity_id,
          subject_binding_version,
          subject_binding,
          identity_link_planner_policy_id,
          identity_link_plan_binding_version,
          identity_link_plan_binding
        ) values (
          $1::uuid,
          'consumed',
          $2::uuid,
          $3,
          $4,
          $5,
          $6,
          $7
        )
        returning id
      `,
      [
        intent.id,
        identityResult.rows[0].id,
        subject.subjectBindingVersion,
        subject.subjectBinding,
        planBinding.plannerPolicyId,
        planBinding.planBindingVersion,
        planBinding.planBinding,
      ],
    );
    if (eventResult.rowCount !== 1 || !eventResult.rows[0]?.id) {
      throw new IdentityPairingConsumeError(
        "terminal_event_insert_failed",
      );
    }

    await client.query("commit");
    transactionOpen = false;

    return Object.freeze({
      operation: IDENTITY_PAIRING_CONSUME_WRITER_POLICY.operation,
      result: "consumed",
      policy: Object.freeze({
        authorityPolicyId:
          IDENTITY_BOOTSTRAP_CLAIM_POLICY.authorityPolicyId,
        provider: IDENTITY_BOOTSTRAP_CLAIM_POLICY.provider,
        plannerPolicyId:
          IDENTITY_LINK_PLAN_BINDING_POLICY.plannerPolicyId,
        subjectBindingVersion:
          SESSION_SUBJECT_BINDING_POLICY.subjectBindingVersion,
        planBindingVersion:
          IDENTITY_LINK_PLAN_BINDING_POLICY.planBindingVersion,
        transactionIsolation:
          IDENTITY_PAIRING_CONSUME_WRITER_POLICY.transactionIsolation,
        lockTimeoutMs:
          IDENTITY_PAIRING_CONSUME_WRITER_POLICY.lockTimeoutMs,
        statementTimeoutMs:
          IDENTITY_PAIRING_CONSUME_WRITER_POLICY.statementTimeoutMs,
        retryCount: IDENTITY_PAIRING_CONSUME_WRITER_POLICY.retryCount,
      }),
      actualWrites: Object.freeze({
        authIdentities: 1,
        appUsers: 1,
        identityPairingIntentEvents: 1,
        productTables: 0,
      }),
      committed: true,
    });
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("rollback");
      } catch {
        // Preserve the original fail-closed reason.
      }
    }
    if (error instanceof IdentityPairingConsumeError) throw error;
    throw mapDatabaseError(error);
  } finally {
    try {
      client.release();
    } catch {
      // The transaction outcome is authoritative.
    }
  }
}

async function readVerifiedSessionSubject({
  verifiedSessionSubjectPort,
  hmacKey,
}) {
  let evidence;
  try {
    evidence = await verifiedSessionSubjectPort.read();
  } catch {
    throw new IdentityPairingConsumeError(
      "verified_subject_unavailable",
    );
  }

  const evidenceSnapshot = snapshotSessionSubjectEvidence(evidence);
  const binding = createSessionSubjectBinding({
    evidence: evidenceSnapshot,
    hmacKey,
  });
  if (binding.state !== "verified") {
    throw new IdentityPairingConsumeError(
      binding.state === "disabled"
        ? "verified_subject_disabled"
        : binding.state === "missing"
          ? "verified_subject_required"
          : "verified_subject_unavailable",
    );
  }

  return Object.freeze({
    provider: binding.provider,
    rawSubject: evidenceSnapshot.subject,
    subjectBindingVersion: binding.subjectBindingVersion,
    subjectBinding: binding.subjectBinding,
  });
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
        target_review_policy_id,
        issued_at,
        expires_at
      from identity_pairing_intents
      where claim_digest = $1
      for update
    `,
    [claimDigest],
  );
  if (result.rowCount !== 1) {
    throw new IdentityPairingConsumeError("claim_intent_not_found");
  }
  return result.rows[0];
}

function validateIntent(intent, claimDigest) {
  if (
    intent.authority_policy_id !==
      IDENTITY_BOOTSTRAP_CLAIM_POLICY.authorityPolicyId ||
    intent.provider !== IDENTITY_BOOTSTRAP_CLAIM_POLICY.provider ||
    intent.claim_digest_version !==
      IDENTITY_BOOTSTRAP_CLAIM_POLICY.claimDigestVersion ||
    intent.claim_digest !== claimDigest ||
    intent.target_review_policy_id !==
      IDENTITY_BOOTSTRAP_CLAIM_POLICY.targetReviewPolicyId
  ) {
    throw new IdentityPairingConsumeError("claim_intent_invalid");
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
    throw new IdentityPairingConsumeError(
      "reviewed_target_not_found",
    );
  }
  return result.rows[0];
}

function validateTarget(target) {
  if (target.status !== "provisioning" || target.role !== "user") {
    throw new IdentityPairingConsumeError(
      "reviewed_target_state_mismatch",
    );
  }
}

async function lockRelevantIdentities(
  client,
  { provider, subject, targetAppUserId },
) {
  const result = await client.query(
    `
      select id, app_user_id, provider, provider_subject, status
      from auth_identities
      where (provider = $1 and provider_subject = $2)
         or (app_user_id = $3::uuid and provider = $1)
      order by id
      for update
    `,
    [provider, subject, targetAppUserId],
  );
  return result.rows;
}

async function readLockedLifecycle(client, intentId) {
  const result = await client.query(
    `
      select
        clock_timestamp() as evaluated_at,
        exists (
          select 1
          from identity_pairing_intent_events
          where identity_pairing_intent_id = $1::uuid
        ) as terminal_event_present
    `,
    [intentId],
  );
  if (result.rowCount !== 1) {
    throw new IdentityPairingConsumeError(
      "claim_lifecycle_unavailable",
    );
  }
  return result.rows[0];
}

function validateLifecycle(intent, lifecycle) {
  if (lifecycle.terminal_event_present === true) {
    throw new IdentityPairingConsumeError(
      "claim_intent_already_terminal",
    );
  }
  if (lifecycle.terminal_event_present !== false) {
    throw new IdentityPairingConsumeError(
      "claim_lifecycle_unavailable",
    );
  }

  const evaluatedAt = toEpoch(lifecycle.evaluated_at);
  const issuedAt = toEpoch(intent.issued_at);
  const expiresAt = toEpoch(intent.expires_at);
  if (
    evaluatedAt === null ||
    issuedAt === null ||
    expiresAt === null ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt >
      IDENTITY_BOOTSTRAP_CLAIM_POLICY.maxIntentLifetimeMs
  ) {
    throw new IdentityPairingConsumeError("claim_intent_invalid");
  }
  if (evaluatedAt < issuedAt) {
    throw new IdentityPairingConsumeError(
      "claim_intent_not_yet_valid",
    );
  }
  if (evaluatedAt >= expiresAt) {
    throw new IdentityPairingConsumeError("claim_intent_expired");
  }
}

function toEpoch(value) {
  const timestamp =
    value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function mapDatabaseError(error) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  if (code === "23505" || code === "40P01") {
    return new IdentityPairingConsumeError(
      "concurrent_state_conflict",
    );
  }
  if (code === "55P03" || code === "57014") {
    return new IdentityPairingConsumeError("database_timeout");
  }
  if (code === "23514") {
    return new IdentityPairingConsumeError(
      "database_constraint_violation",
    );
  }
  return new IdentityPairingConsumeError(
    "database_transaction_failed",
  );
}
