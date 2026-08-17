import "server-only";

import { randomUUID } from "node:crypto";

import { sqlClient } from "@/db/client";
import {
  ACCOUNT_MANAGEMENT_POLICY,
  generatedAccountCode,
  parseAccountArchiveInput,
  parseAccountCreateInput,
  parseAccountRestoreInput,
  parseAccountUpdateInput,
  type AccountManagementActionState,
} from "@/lib/account-management";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";
import {
  assertActiveTenantWriteAllowed,
  prepareTenantWriteContext,
} from "@/lib/tenant-write-context";

type WriteResult = Readonly<{
  active_count?: string | number;
  archived_count?: string | number;
  duplicate_name_count?: string | number;
  exact_account_count?: string | number;
  existing_account_count?: string | number;
  active_holding_count?: string | number;
  open_group_reference_count?: string | number;
  inconsistent_asset_count?: string | number;
  restored_count?: string | number;
  saved_count?: string | number;
}>;

export async function createSessionAccount(
  formData: FormData,
): Promise<AccountManagementActionState> {
  const authorized = await authorize("insert");
  if (!authorized.ok) return authorized.state;
  const parsed = parseAccountCreateInput(formData);
  if (!parsed.ok) return state("invalid", parsed.message);

  const accountId = randomUUID();
  const now = new Date().toISOString();
  try {
    const result = await runAtomicQuery(ATOMIC_CREATE_QUERY, [
      lockName(authorized.ownerUserId),
      authorized.ownerUserId,
      accountId,
      generatedAccountCode(accountId),
      parsed.input.name,
      ACCOUNT_MANAGEMENT_POLICY.generatedAccountType,
      ACCOUNT_MANAGEMENT_POLICY.generatedReportingCurrency,
      now,
      ACCOUNT_MANAGEMENT_POLICY.maximumActiveAccounts,
    ]);
    if (number(result.saved_count) === 1) {
      return state("success", "Account created.");
    }
    if (number(result.duplicate_name_count) > 0) {
      return state("conflict", "An active account already uses this name.");
    }
    if (
      number(result.active_count) >=
      ACCOUNT_MANAGEMENT_POLICY.maximumActiveAccounts
    ) {
      return state("conflict", "The active account limit has been reached.");
    }
    return state("conflict", "The account could not be created.");
  } catch (error) {
    return databaseFailure(error, "The account could not be created.");
  }
}

export async function updateSessionAccount(
  formData: FormData,
): Promise<AccountManagementActionState> {
  const authorized = await authorize("update");
  if (!authorized.ok) return authorized.state;
  const parsed = parseAccountUpdateInput(formData);
  if (!parsed.ok) return state("invalid", parsed.message);

  try {
    const result = await runAtomicQuery(ATOMIC_UPDATE_QUERY, [
      lockName(authorized.ownerUserId),
      authorized.ownerUserId,
      parsed.input.accountId,
      parsed.input.expectedUpdatedAt,
      parsed.input.name,
      new Date().toISOString(),
    ]);
    if (number(result.saved_count) === 1) {
      return state("success", "Account name updated.");
    }
    if (number(result.duplicate_name_count) > 0) {
      return state("conflict", "An active account already uses this name.");
    }
    return staleAccountState(result);
  } catch (error) {
    return databaseFailure(error, "The account could not be updated.");
  }
}

export async function archiveSessionAccount(
  formData: FormData,
): Promise<AccountManagementActionState> {
  const authorized = await authorize("update");
  if (!authorized.ok) return authorized.state;
  const parsed = parseAccountArchiveInput(formData);
  if (!parsed.ok) return state("invalid", parsed.message);

  const now = new Date();
  try {
    const result = await runAtomicQuery(ATOMIC_ARCHIVE_QUERY, [
      lockName(authorized.ownerUserId),
      authorized.ownerUserId,
      parsed.input.accountId,
      parsed.input.expectedUpdatedAt,
      resolveSnapshotCycle(now).snapshotDate,
      now.toISOString(),
    ]);
    if (number(result.archived_count) === 1) {
      return state("success", "Account archived. Historical rows were preserved.");
    }
    if (number(result.inconsistent_asset_count) > 0) {
      return state(
        "conflict",
        "Account ownership integrity must be repaired before archiving.",
      );
    }
    if (number(result.active_holding_count) > 0) {
      return state(
        "conflict",
        "Move or close active holdings before archiving this account.",
      );
    }
    if (number(result.open_group_reference_count) > 0) {
      return state(
        "conflict",
        "Remove this account and its holdings from asset groups before archiving.",
      );
    }
    return staleAccountState(result);
  } catch (error) {
    return databaseFailure(error, "The account could not be archived.");
  }
}

export async function restoreSessionAccount(
  formData: FormData,
): Promise<AccountManagementActionState> {
  const authorized = await authorize("update");
  if (!authorized.ok) return authorized.state;
  const parsed = parseAccountRestoreInput(formData);
  if (!parsed.ok) return state("invalid", parsed.message);

  try {
    const result = await runAtomicQuery(ATOMIC_RESTORE_QUERY, [
      lockName(authorized.ownerUserId),
      authorized.ownerUserId,
      parsed.input.accountId,
      parsed.input.expectedUpdatedAt,
      new Date().toISOString(),
      ACCOUNT_MANAGEMENT_POLICY.maximumActiveAccounts,
    ]);
    if (number(result.restored_count) === 1) {
      return state("success", "Account restored.");
    }
    if (number(result.duplicate_name_count) > 0) {
      return state(
        "conflict",
        "Rename the active account with the same name before restoring this one.",
      );
    }
    if (
      number(result.active_count) >=
      ACCOUNT_MANAGEMENT_POLICY.maximumActiveAccounts
    ) {
      return state("conflict", "The active account limit has been reached.");
    }
    return staleAccountState(result);
  } catch (error) {
    return databaseFailure(error, "The account could not be restored.");
  }
}

async function authorize(operation: "insert" | "update") {
  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) {
    return Object.freeze({
      ok: false as const,
      state: state("unauthorized", "Sign in with an active portfolio user."),
    });
  }
  const ownerUserId = resolution.tenantContext.ownerUserId;
  const writeContext = prepareTenantWriteContext({
    mode: "active",
    source: "session",
    targetClassification: "user_owned",
    canonicalOwnerUserId: ownerUserId,
    canonicalOwnerStatus: "active",
    canonicalOwnerVerified: true,
  });
  assertActiveTenantWriteAllowed({
    context: writeContext,
    operation,
    existingOwnerUserId: operation === "update" ? ownerUserId : undefined,
    referencedOwnerUserIds: [ownerUserId],
  });
  return Object.freeze({ ok: true as const, ownerUserId });
}

async function runAtomicQuery(query: string, parameters: unknown[]) {
  const results = await sqlClient.transaction((transaction) => [
    transaction.query("set local lock_timeout = '2s'"),
    transaction.query("set local statement_timeout = '8s'"),
    transaction.query(query, parameters),
  ]);
  return (results[2]?.[0] ?? {}) as WriteResult;
}

function lockName(ownerUserId: string) {
  return `varda.account_management.v1:${ownerUserId}`;
}

function staleAccountState(result: WriteResult) {
  return number(result.existing_account_count) !== 1 ||
    number(result.exact_account_count) !== 1
    ? state("conflict", "The account changed. Refresh the page and try again.")
    : state("conflict", "The account change was blocked.");
}

function databaseFailure(error: unknown, message: string) {
  const code = databaseErrorCode(error);
  return ["23503", "23505", "55P03", "57014"].includes(code ?? "")
    ? state("conflict", "Another account change completed first. Refresh the page.")
    : state("error", message);
}

function databaseErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : null;
}

function number(value: string | number | undefined) {
  return Number(value ?? 0);
}

function state(
  status: AccountManagementActionState["status"],
  message: string,
): AccountManagementActionState {
  return Object.freeze({ status, message });
}

const ATOMIC_CREATE_QUERY = `
with lock_acquired as materialized (
  select pg_advisory_xact_lock(hashtextextended($1, 0))
), facts as materialized (
  select
    count(account_row.id) filter (where account_row.is_active) as active_count,
    count(account_row.id) filter (
      where account_row.is_active
        and lower(btrim(account_row.name)) = lower($5::varchar)
    ) as duplicate_name_count,
    coalesce(max(account_row.sort_order), -1) + 1 as next_sort_order
  from lock_acquired
  left join accounts account_row
    on account_row.canonical_owner_user_id = $2::uuid
), inserted as (
  insert into accounts (
    id, owner_user_id, canonical_owner_user_id, code, name, account_type,
    currency, is_active, sort_order, created_at, updated_at
  )
  select
    $3::uuid, null, $2::uuid, $4::varchar, $5::varchar, $6::varchar,
    $7::varchar, true, facts.next_sort_order, $8::timestamptz, $8::timestamptz
  from facts
  where facts.active_count < $9::integer
    and facts.duplicate_name_count = 0
  returning id
)
select
  facts.active_count,
  facts.duplicate_name_count,
  (select count(*) from inserted) as saved_count
from facts
`;

const ATOMIC_UPDATE_QUERY = `
with lock_acquired as materialized (
  select pg_advisory_xact_lock(hashtextextended($1, 0))
), existing_account as materialized (
  select account_row.id, account_row.updated_at
  from accounts account_row
  cross join lock_acquired
  where account_row.id = $3::uuid
    and account_row.canonical_owner_user_id = $2::uuid
    and account_row.is_active = true
  for update of account_row
), facts as materialized (
  select
    (select count(*) from existing_account) as existing_account_count,
    (
      select count(*)
      from existing_account
      where updated_at = $4::timestamptz
    ) as exact_account_count,
    (
      select count(*)
      from accounts duplicate
      where duplicate.canonical_owner_user_id = $2::uuid
        and duplicate.is_active = true
        and duplicate.id <> $3::uuid
        and lower(btrim(duplicate.name)) = lower($5::varchar)
    ) as duplicate_name_count
), updated as (
  update accounts account_row
  set name = $5::varchar, updated_at = $6::timestamptz
  from facts
  where account_row.id = $3::uuid
    and account_row.canonical_owner_user_id = $2::uuid
    and facts.existing_account_count = 1
    and facts.exact_account_count = 1
    and facts.duplicate_name_count = 0
  returning account_row.id
)
select facts.*, (select count(*) from updated) as saved_count
from facts
`;

const ATOMIC_ARCHIVE_QUERY = `
with lock_acquired as materialized (
  select pg_advisory_xact_lock(hashtextextended($1, 0))
), existing_account as materialized (
  select account_row.id, account_row.code, account_row.updated_at
  from accounts account_row
  cross join lock_acquired
  where account_row.id = $3::uuid
    and account_row.canonical_owner_user_id = $2::uuid
    and account_row.is_active = true
  for update of account_row
), facts as materialized (
  select
    (select count(*) from existing_account) as existing_account_count,
    (
      select count(*)
      from existing_account
      where updated_at = $4::timestamptz
    ) as exact_account_count,
    (
      select count(*)
      from assets asset
      where asset.account_id = $3::uuid
        and asset.archived_at is null
    ) as active_holding_count,
    (
      select count(*)
      from assets asset
      cross join existing_account existing
      where asset.account_id = existing.id
        and (
          asset.canonical_owner_user_id is distinct from $2::uuid
          or btrim(asset.account) <> existing.code
        )
    ) as inconsistent_asset_count,
    (
      select count(*)
      from (
        select membership.portfolio_group_id
        from portfolio_group_account_memberships membership
        where membership.account_id = $3::uuid
          and (membership.valid_to is null or membership.valid_to > $5::date)
        union
        select membership.portfolio_group_id
        from portfolio_group_asset_memberships membership
        join assets asset on asset.id = membership.asset_id
        where asset.account_id = $3::uuid
          and (membership.valid_to is null or membership.valid_to > $5::date)
      ) group_references
    ) as open_group_reference_count
), archived as (
  update accounts account_row
  set is_active = false, updated_at = $6::timestamptz
  from facts
  where account_row.id = $3::uuid
    and account_row.canonical_owner_user_id = $2::uuid
    and facts.existing_account_count = 1
    and facts.exact_account_count = 1
    and facts.active_holding_count = 0
    and facts.inconsistent_asset_count = 0
    and facts.open_group_reference_count = 0
  returning account_row.id
)
select facts.*, (select count(*) from archived) as archived_count
from facts
`;

const ATOMIC_RESTORE_QUERY = `
with lock_acquired as materialized (
  select pg_advisory_xact_lock(hashtextextended($1, 0))
), existing_account as materialized (
  select account_row.id, account_row.name, account_row.updated_at
  from accounts account_row
  cross join lock_acquired
  where account_row.id = $3::uuid
    and account_row.canonical_owner_user_id = $2::uuid
    and account_row.is_active = false
  for update of account_row
), facts as materialized (
  select
    (select count(*) from existing_account) as existing_account_count,
    (
      select count(*)
      from existing_account
      where updated_at = $4::timestamptz
    ) as exact_account_count,
    (
      select count(*)
      from accounts active_account
      where active_account.canonical_owner_user_id = $2::uuid
        and active_account.is_active = true
    ) as active_count,
    (
      select count(*)
      from accounts duplicate
      cross join existing_account existing
      where duplicate.canonical_owner_user_id = $2::uuid
        and duplicate.is_active = true
        and lower(btrim(duplicate.name)) = lower(btrim(existing.name))
    ) as duplicate_name_count
), restored as (
  update accounts account_row
  set is_active = true, updated_at = $5::timestamptz
  from facts
  where account_row.id = $3::uuid
    and account_row.canonical_owner_user_id = $2::uuid
    and facts.existing_account_count = 1
    and facts.exact_account_count = 1
    and facts.active_count < $6::integer
    and facts.duplicate_name_count = 0
  returning account_row.id
)
select facts.*, (select count(*) from restored) as restored_count
from facts
`;
