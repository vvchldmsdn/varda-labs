import {
  INITIAL_APP_USER_ROLE,
  INITIAL_APP_USER_STATUS,
  ProvisioningArgumentError,
  isCanonicalUuid,
} from "./initial-app-user-provisioning.mjs";

export const PROVISIONING_ADVISORY_LOCK_NAME =
  "varda.initial_app_user_provisioning.v1";
export const PROVISIONING_ADVISORY_LOCK_SQL =
  "select pg_advisory_xact_lock(hashtextextended($1, 0))";

export function buildLockedProvisioningQuery(
  initialOwnerId,
  canonicalOwnerTables,
) {
  if (!isCanonicalUuid(initialOwnerId)) {
    throw new ProvisioningArgumentError("invalid_initial_owner_id");
  }
  if (
    canonicalOwnerTables.length === 0 ||
    canonicalOwnerTables.some((table) => !/^[a-z_]+$/.test(table))
  ) {
    throw new Error("Canonical owner table allowlist is invalid");
  }

  const canonicalCountSql = canonicalOwnerTables
    .map(
      (table) =>
        `select count(*) filter (where canonical_owner_user_id is not null)::bigint as rows from "${table}"`,
    )
    .join(" union all ");

  return Object.freeze({
    text: `
      with state as materialized (
        select
          (select count(*)::int from app_users) as app_user_count_before,
          coalesce(
            (select bool_or(id = $1::uuid) from app_users),
            false
          ) as candidate_exists,
          coalesce(
            (
              select bool_or(
                id = $1::uuid
                and status = '${INITIAL_APP_USER_STATUS}'
                and role = '${INITIAL_APP_USER_ROLE}'
              )
              from app_users
            ),
            false
          ) as candidate_exact,
          (select count(*)::int from auth_identities) as auth_identity_count,
          (
            select coalesce(sum(rows), 0)::int
            from (${canonicalCountSql}) canonical_counts
          ) as canonical_owner_non_null_rows
      ),
      inserted as (
        insert into app_users (id, status, role)
        select
          $1::uuid,
          '${INITIAL_APP_USER_STATUS}',
          '${INITIAL_APP_USER_ROLE}'
        from state
        where app_user_count_before = 0
          and auth_identity_count = 0
          and canonical_owner_non_null_rows = 0
        returning true as inserted
      )
      select
        state.*,
        (select count(*)::int from inserted) as inserted_count
      from state
    `,
    params: Object.freeze([initialOwnerId.trim().toLowerCase()]),
  });
}

export function buildActualProvisioningOutput(plan, lockedState) {
  const appUserCountBefore = Number(lockedState.app_user_count_before);
  const authIdentityCount = Number(lockedState.auth_identity_count);
  const canonicalOwnerNonNullRows = Number(
    lockedState.canonical_owner_non_null_rows,
  );
  const insertedCount = Number(lockedState.inserted_count);
  const candidateExact = lockedState.candidate_exact === true;
  const blockers = [];

  if (authIdentityCount !== 0) blockers.push("auth_identity_preexists");
  if (canonicalOwnerNonNullRows !== 0) {
    blockers.push("canonical_owner_preexists");
  }
  if (appUserCountBefore > 1) blockers.push("multiple_app_users_exist");
  if (appUserCountBefore === 1 && !candidateExact) {
    blockers.push("existing_app_user_conflict");
  }
  if (insertedCount > 1) blockers.push("unexpected_insert_count");

  let result = "blocked";
  if (blockers.length === 0 && insertedCount === 1 && appUserCountBefore === 0) {
    result = "provisioned";
  } else if (
    blockers.length === 0 &&
    insertedCount === 0 &&
    appUserCountBefore === 1 &&
    candidateExact
  ) {
    result = "already_provisioned";
  } else if (blockers.length === 0) {
    blockers.push("locked_state_not_insertable");
  }

  return Object.freeze({
    ...plan,
    mode: "write",
    result,
    appUserCount: Object.freeze({
      current: appUserCountBefore,
      expected: result === "provisioned" ? 1 : appUserCountBefore,
    }),
    plannedWrites: Object.freeze({
      appUsers: 0,
      authIdentities: 0,
      financialTables: 0,
      canonicalOwners: 0,
    }),
    actualWrites: Object.freeze({
      appUsers: result === "provisioned" ? 1 : 0,
      authIdentities: 0,
      financialTables: 0,
      canonicalOwners: 0,
    }),
    blockers: Object.freeze(blockers),
    warnings: Object.freeze([]),
    committed: result === "provisioned",
    databaseSideEffects: result === "provisioned",
  });
}
