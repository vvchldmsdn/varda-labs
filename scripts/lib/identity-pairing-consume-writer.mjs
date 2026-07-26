import { createHash } from "node:crypto";

import {
  planInitialIdentityLink,
  prepareVerifiedProviderSubjectPort,
} from "../../src/lib/initial-identity-link-planner.ts";
import { IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY } from "../../src/lib/identity-bootstrap-claim-authority-policy.ts";
import { digestIdentityBootstrapClaim } from "./identity-bootstrap-claim-issuer.mjs";
import {
  createIdentityPairingBindings,
  IDENTITY_PAIRING_HMAC_KEY_ENV,
} from "./identity-pairing-consume-crypto.mjs";

const LOCK_TIMEOUT = "5s";
const STATEMENT_TIMEOUT = "30s";

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
  verifiedSubjectPort,
  hmacKey,
}) {
  if (!pool || typeof pool.connect !== "function") {
    throw new IdentityPairingConsumeError("database_port_invalid");
  }
  if (!verifiedSubjectPort || typeof verifiedSubjectPort.use !== "function") {
    throw new IdentityPairingConsumeError("verified_subject_port_invalid");
  }

  let callbackCount = 0;
  const portResult = await verifiedSubjectPort.use(async (subjectEvidence) => {
    callbackCount += 1;
    if (callbackCount !== 1) {
      throw new IdentityPairingConsumeError("verified_subject_port_invalid");
    }
    return consumeWithVerifiedSubject({
      pool,
      rawClaim,
      subjectEvidence,
      hmacKey,
    });
  });

  if (
    callbackCount !== 1 ||
    !portResult ||
    portResult.state !== "verified"
  ) {
    throw new IdentityPairingConsumeError("verified_subject_required");
  }
  return portResult.value;
}

async function consumeWithVerifiedSubject({
  pool,
  rawClaim,
  subjectEvidence,
  hmacKey,
}) {
  const subject = readVerifiedSubject(subjectEvidence);
  let claimDigest;
  try {
    claimDigest = digestIdentityBootstrapClaim(rawClaim);
  } catch {
    throw new IdentityPairingConsumeError("claim_format_invalid");
  }

  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query("begin isolation level read committed");
    transactionOpen = true;
    await client.query(`set local lock_timeout = '${LOCK_TIMEOUT}'`);
    await client.query(
      `set local statement_timeout = '${STATEMENT_TIMEOUT}'`,
    );

    const intent = await lockIntent(client, claimDigest);
    validateIntent(intent, claimDigest);

    const target = await lockTarget(client, intent.target_app_user_id);
    const identityRows = await lockRelevantIdentities(client, {
      provider: subject.provider,
      subject: subject.subject,
      targetAppUserId: target.id,
    });
    const lifecycle = await readLockedLifecycle(client, intent.id);
    validateLifecycle(intent, lifecycle);
    validateTarget(target);

    const plannerInput = {
      providerSubject: prepareVerifiedProviderSubjectPort({
        provider: subject.provider,
        subject: subject.subject,
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
    };
    const plan = planInitialIdentityLink(plannerInput);
    if (plan.outcome !== "planned_link") {
      throw new IdentityPairingConsumeError(
        `identity_link_${plan.reason ?? plan.outcome}`,
      );
    }

    let bindings;
    try {
      bindings = createIdentityPairingBindings({
        hmacKey,
        provider: subject.provider,
        subject: subject.subject,
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
      throw new IdentityPairingConsumeError("binding_generation_failed");
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
      [target.id, subject.provider, subject.subject],
    );
    if (identityResult.rowCount !== 1 || !identityResult.rows[0]?.id) {
      throw new IdentityPairingConsumeError("identity_insert_failed");
    }
    const authIdentityId = identityResult.rows[0].id;

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
      throw new IdentityPairingConsumeError("target_activation_failed");
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
        authIdentityId,
        bindings.subjectBindingVersion,
        bindings.subjectBinding,
        bindings.plannerPolicyId,
        bindings.planBindingVersion,
        bindings.planBinding,
      ],
    );
    if (eventResult.rowCount !== 1) {
      throw new IdentityPairingConsumeError("terminal_event_insert_failed");
    }

    await client.query("commit");
    transactionOpen = false;

    return Object.freeze({
      operation: "identity_pairing_atomic_consume_v1",
      result: "consumed",
      targetFingerprint: fingerprint(target.id),
      intentFingerprint: fingerprint(intent.id),
      policy: Object.freeze({
        authorityPolicyId:
          IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.policyId,
        provider: IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.provider,
        plannerPolicyId: bindings.plannerPolicyId,
        subjectBindingVersion: bindings.subjectBindingVersion,
        planBindingVersion: bindings.planBindingVersion,
        hmacKeyEnvironment: IDENTITY_PAIRING_HMAC_KEY_ENV,
        transactionIsolation: "read_committed",
        retryCount: 0,
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
    client.release();
  }
}

function readVerifiedSubject(subjectEvidence) {
  if (
    !subjectEvidence ||
    subjectEvidence.provider !==
      IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.provider ||
    subjectEvidence.verificationSource !== "server_verified_session" ||
    typeof subjectEvidence.subject !== "string" ||
    subjectEvidence.subject.length === 0 ||
    subjectEvidence.subject.length > 255 ||
    subjectEvidence.subject.trim() !== subjectEvidence.subject
  ) {
    throw new IdentityPairingConsumeError("verified_subject_required");
  }
  return subjectEvidence;
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
      IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.policyId ||
    intent.provider !== IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.provider ||
    intent.claim_digest_version !==
      IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.claimDigestVersion ||
    intent.claim_digest !== claimDigest ||
    intent.target_review_policy_id !==
      IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.targetReviewPolicyId
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
    throw new IdentityPairingConsumeError("reviewed_target_not_found");
  }
  return result.rows[0];
}

function validateTarget(target) {
  if (target.status !== "provisioning" || target.role !== "user") {
    throw new IdentityPairingConsumeError("reviewed_target_state_mismatch");
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
    throw new IdentityPairingConsumeError("claim_lifecycle_unavailable");
  }
  return result.rows[0];
}

function validateLifecycle(intent, lifecycle) {
  if (lifecycle.terminal_event_present === true) {
    throw new IdentityPairingConsumeError("claim_intent_already_terminal");
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
      IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.maxIntentLifetimeMs
  ) {
    throw new IdentityPairingConsumeError("claim_intent_invalid");
  }
  if (evaluatedAt < issuedAt) {
    throw new IdentityPairingConsumeError("claim_intent_not_yet_valid");
  }
  if (evaluatedAt >= expiresAt) {
    throw new IdentityPairingConsumeError("claim_intent_expired");
  }
}

function toEpoch(value) {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function mapDatabaseError(error) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  if (code === "23505") {
    return new IdentityPairingConsumeError("concurrent_state_conflict");
  }
  if (code === "55P03" || code === "57014") {
    return new IdentityPairingConsumeError("database_timeout");
  }
  return new IdentityPairingConsumeError("database_transaction_failed");
}

function fingerprint(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
