import {
  IDENTITY_BOOTSTRAP_CLAIM_LIFETIME_SECONDS,
  isCanonicalClaimDigest,
  isCanonicalUuid,
} from "./identity-bootstrap-claim-issuer.mjs";
import { IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY } from "../../src/lib/identity-bootstrap-claim-authority-policy.ts";

export function buildIdentityBootstrapClaimIssueQueries({
  targetAppUserId,
  claimDigest,
}) {
  if (!isCanonicalUuid(targetAppUserId)) {
    throw new Error("Identity bootstrap claim target is invalid");
  }
  if (!isCanonicalClaimDigest(claimDigest)) {
    throw new Error("Identity bootstrap claim digest is invalid");
  }

  return Object.freeze({
    targetLock: Object.freeze({
      text: `
        select id
        from app_users
        where id = $1::uuid
        for update
      `,
      params: Object.freeze([targetAppUserId.trim().toLowerCase()]),
    }),
    issue: Object.freeze({
      text: `
      with target as materialized (
        select id, status, role
        from app_users
        where id = $1::uuid
      ),
      issue_clock as materialized (
        select clock_timestamp() as issued_at
      ),
      locked_state as materialized (
        select
          exists(select 1 from target) as target_found,
          coalesce(
            (select status = 'provisioning' and role = 'user' from target),
            false
          ) as target_exact,
          (
            select count(*)::int
            from auth_identities identity_row
            where identity_row.app_user_id = $1::uuid
              and identity_row.provider = 'neon_auth'
          ) as target_provider_identity_count,
          (
            select count(*)::int
            from identity_pairing_intents intent
            left join identity_pairing_intent_events terminal_event
              on terminal_event.identity_pairing_intent_id = intent.id
            cross join issue_clock
            where intent.target_app_user_id = $1::uuid
              and intent.provider = 'neon_auth'
              and terminal_event.id is null
              and intent.expires_at > issue_clock.issued_at
          ) as open_intent_count
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
          '${IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.policyId}',
          $1::uuid,
          '${IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.provider}',
          '${IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.claimDigestVersion}',
          $2,
          '${IDENTITY_BOOTSTRAP_CLAIM_AUTHORITY_POLICY.targetReviewPolicyId}',
          issue_clock.issued_at,
          issue_clock.issued_at
            + interval '${IDENTITY_BOOTSTRAP_CLAIM_LIFETIME_SECONDS} seconds'
        from locked_state
        cross join issue_clock
        where locked_state.target_found
          and locked_state.target_exact
          and locked_state.target_provider_identity_count = 0
          and locked_state.open_intent_count = 0
        returning issued_at, expires_at
      )
      select
        locked_state.*,
        (select count(*)::int from inserted) as inserted_count,
        (select issued_at from inserted) as issued_at,
        (select expires_at from inserted) as expires_at
      from locked_state
    `,
      params: Object.freeze([
        targetAppUserId.trim().toLowerCase(),
        claimDigest,
      ]),
    }),
  });
}
