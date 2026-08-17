import "server-only";

import { randomUUID } from "node:crypto";

import { sqlClient } from "@/db/client";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import {
  parsePortfolioGroupArchiveInput,
  parsePortfolioGroupSaveInput,
  type PortfolioGroupManagementActionState,
  type PortfolioGroupSaveInput,
} from "@/lib/portfolio-group-management";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";
import {
  assertActiveTenantWriteAllowed,
  prepareTenantWriteContext,
} from "@/lib/tenant-write-context";

type SaveResultRow = Readonly<{
  requested_account_count?: string | number;
  owned_account_count?: string | number;
  requested_asset_count?: string | number;
  owned_asset_count?: string | number;
  effective_requested_asset_count?: string | number;
  existing_group_count?: string | number;
  exact_group_count?: string | number;
  duplicate_name_count?: string | number;
  scheduled_membership_count?: string | number;
  saved_count?: string | number;
  active_account_count?: string | number;
  active_asset_count?: string | number;
}>;

export async function writeSessionPortfolioGroup(
  formData: FormData,
): Promise<PortfolioGroupManagementActionState> {
  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) {
    return state("unauthorized", "로그인과 사용자 연결을 확인해 주세요.");
  }

  const parsed = parsePortfolioGroupSaveInput(formData);
  if (!parsed.ok) return state("invalid", parsed.message);

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
    operation: parsed.input.mode === "create" ? "insert" : "update",
    existingOwnerUserId:
      parsed.input.mode === "update" ? ownerUserId : undefined,
    referencedOwnerUserIds: [ownerUserId],
  });

  try {
    const result = await savePortfolioGroup({
      input: parsed.input,
      ownerUserId,
    });
    if (number(result.saved_count) === 1) {
      return state(
        "success",
        parsed.input.mode === "create"
          ? "자산 그룹을 만들었습니다."
          : "자산 그룹 구성을 저장했습니다.",
      );
    }
    return saveConflictState(result, parsed.input);
  } catch (error) {
    if (isDatabaseConflict(error)) {
      return state(
        "conflict",
        "다른 변경이 먼저 반영되었습니다. 화면을 새로고침해 주세요.",
      );
    }
    return state(
      "error",
      "자산 그룹을 저장하지 못했습니다. 잠시 후 다시 확인해 주세요.",
    );
  }
}

export async function archiveSessionPortfolioGroup(
  formData: FormData,
): Promise<PortfolioGroupManagementActionState> {
  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) {
    return state("unauthorized", "로그인과 사용자 연결을 확인해 주세요.");
  }

  const parsed = parsePortfolioGroupArchiveInput(formData);
  if (!parsed.ok) return state("invalid", parsed.message);

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
    operation: "update",
    existingOwnerUserId: ownerUserId,
    referencedOwnerUserIds: [ownerUserId],
  });

  try {
    const now = new Date();
    const lockName = `varda.portfolio_group_management.v1:${ownerUserId}`;
    const results = await sqlClient.transaction((transaction) => [
      transaction.query("set local lock_timeout = '2s'"),
      transaction.query("set local statement_timeout = '8s'"),
      transaction.query(ATOMIC_ARCHIVE_QUERY, [
        lockName,
        ownerUserId,
        parsed.input.groupId,
        parsed.input.expectedUpdatedAt,
        resolveSnapshotCycle(now).snapshotDate,
        now.toISOString(),
      ]),
    ]);
    const result = results[2]?.[0] as
      | { archived_count?: string | number }
      | undefined;
    return number(result?.archived_count) === 1
      ? state(
          "success",
          "자산 그룹을 보관했습니다. 과거 분석 기록은 유지됩니다.",
        )
      : state(
          "conflict",
          "자산 그룹이 변경되었거나 이미 보관되었습니다. 화면을 새로고침해 주세요.",
        );
  } catch (error) {
    if (isDatabaseConflict(error)) {
      return state(
        "conflict",
        "다른 변경이 먼저 반영되었습니다. 화면을 새로고침해 주세요.",
      );
    }
    return state(
      "error",
      "자산 그룹을 보관하지 못했습니다. 잠시 후 다시 확인해 주세요.",
    );
  }
}

async function savePortfolioGroup({
  input,
  ownerUserId,
}: {
  input: PortfolioGroupSaveInput;
  ownerUserId: string;
}) {
  const now = new Date();
  const groupId = input.groupId ?? randomUUID();
  const lockName = `varda.portfolio_group_management.v1:${ownerUserId}`;
  const results = await sqlClient.transaction((transaction) => [
    transaction.query("set local lock_timeout = '2s'"),
    transaction.query("set local statement_timeout = '8s'"),
    transaction.query(ATOMIC_SAVE_QUERY, [
      lockName,
      ownerUserId,
      groupId,
      input.mode,
      input.expectedUpdatedAt,
      input.name,
      input.description,
      resolveSnapshotCycle(now).snapshotDate,
      now.toISOString(),
      JSON.stringify(input.accountIds),
      JSON.stringify(input.assetIds),
    ]),
  ]);
  return (results[2]?.[0] ?? {}) as SaveResultRow;
}

function saveConflictState(
  result: SaveResultRow,
  input: PortfolioGroupSaveInput,
): PortfolioGroupManagementActionState {
  if (number(result.duplicate_name_count) > 0) {
    return state("conflict", "같은 이름의 활성 자산 그룹이 이미 있습니다.");
  }
  if (
    number(result.requested_account_count) !== number(result.owned_account_count) ||
    number(result.requested_asset_count) !== number(result.owned_asset_count)
  ) {
    return state(
      "conflict",
      "선택한 계좌 또는 종목의 소유권이 변경되었습니다. 화면을 새로고침해 주세요.",
    );
  }
  if (number(result.scheduled_membership_count) > 0) {
    return state(
      "conflict",
      "미래 날짜의 그룹 구성 기록이 있어 자동 변경하지 않았습니다.",
    );
  }
  if (
    input.mode === "update" &&
    (number(result.existing_group_count) !== 1 ||
      number(result.exact_group_count) !== 1)
  ) {
    return state(
      "conflict",
      "자산 그룹이 변경되었거나 보관되었습니다. 화면을 새로고침해 주세요.",
    );
  }
  return state("conflict", "자산 그룹 변경 조건을 다시 확인해 주세요.");
}

function isDatabaseConflict(error: unknown) {
  const code = databaseErrorCode(error);
  return ["23503", "23505", "55P03", "57014"].includes(code ?? "");
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
  status: PortfolioGroupManagementActionState["status"],
  message: string,
): PortfolioGroupManagementActionState {
  return Object.freeze({ status, message });
}

const ATOMIC_SAVE_QUERY = `
with lock_acquired as materialized (
  select pg_advisory_xact_lock(hashtextextended($1, 0))
), requested_accounts as materialized (
  select distinct value::uuid as id
  from jsonb_array_elements_text($10::jsonb)
), requested_assets as materialized (
  select distinct value::uuid as id
  from jsonb_array_elements_text($11::jsonb)
), owned_accounts as materialized (
  select a.id
  from accounts a
  join requested_accounts requested on requested.id = a.id
  where a.canonical_owner_user_id = $2::uuid
    and a.is_active = true
), owned_assets as materialized (
  select asset.id, asset.account_id
  from assets asset
  join requested_assets requested on requested.id = asset.id
  join accounts account on account.id = asset.account_id
  where asset.canonical_owner_user_id = $2::uuid
    and account.canonical_owner_user_id = $2::uuid
    and account.is_active = true
    and asset.account = account.code
    and asset.archived_at is null
), effective_requested_assets as materialized (
  select owned.id
  from owned_assets owned
  where not exists (
    select 1
    from requested_accounts requested
    where requested.id = owned.account_id
  )
), existing_group as materialized (
  select group_row.id, group_row.updated_at
  from portfolio_groups group_row
  cross join lock_acquired
  where group_row.id = $3::uuid
    and group_row.canonical_owner_user_id = $2::uuid
    and group_row.archived_at is null
  for update of group_row
), facts as materialized (
  select
    (select count(*) from requested_accounts) as requested_account_count,
    (select count(*) from owned_accounts) as owned_account_count,
    (select count(*) from requested_assets) as requested_asset_count,
    (select count(*) from owned_assets) as owned_asset_count,
    (select count(*) from effective_requested_assets) as effective_requested_asset_count,
    (select count(*) from existing_group) as existing_group_count,
    (
      select count(*)
      from existing_group existing
      where existing.updated_at = $5::timestamptz
    ) as exact_group_count,
    (
      select count(*)
      from portfolio_groups duplicate
      where duplicate.canonical_owner_user_id = $2::uuid
        and duplicate.archived_at is null
        and lower(duplicate.name) = lower($6::varchar)
        and duplicate.id <> $3::uuid
    ) as duplicate_name_count,
    (
      select count(*)
      from (
        select membership.id
        from portfolio_group_account_memberships membership
        where membership.canonical_owner_user_id = $2::uuid
          and membership.portfolio_group_id = $3::uuid
          and (
            membership.valid_from > $8::date
            or membership.valid_to > $8::date
          )
        union all
        select membership.id
        from portfolio_group_asset_memberships membership
        where membership.canonical_owner_user_id = $2::uuid
          and membership.portfolio_group_id = $3::uuid
          and (
            membership.valid_from > $8::date
            or membership.valid_to > $8::date
          )
      ) scheduled
    ) as scheduled_membership_count
  from lock_acquired
), allowed as materialized (
  select facts.*
  from facts
  where facts.requested_account_count = facts.owned_account_count
    and facts.requested_asset_count = facts.owned_asset_count
    and facts.duplicate_name_count = 0
    and facts.scheduled_membership_count = 0
    and (
      ($4::varchar = 'create' and facts.existing_group_count = 0)
      or
      ($4::varchar = 'update' and facts.exact_group_count = 1)
    )
), next_sort_order as materialized (
  select coalesce(max(group_row.sort_order), -1) + 1 as value
  from portfolio_groups group_row
  cross join allowed
  where group_row.canonical_owner_user_id = $2::uuid
    and group_row.archived_at is null
), created_group as (
  insert into portfolio_groups (
    id, canonical_owner_user_id, name, description, sort_order,
    archived_at, created_at, updated_at
  )
  select
    $3::uuid, $2::uuid, $6::varchar, $7::text, next_sort_order.value,
    null, $9::timestamptz, $9::timestamptz
  from allowed
  cross join next_sort_order
  where $4::varchar = 'create'
  returning id
), updated_group as (
  update portfolio_groups group_row
  set name = $6::varchar,
      description = $7::text,
      updated_at = $9::timestamptz
  from allowed
  where $4::varchar = 'update'
    and group_row.id = $3::uuid
    and group_row.canonical_owner_user_id = $2::uuid
    and group_row.archived_at is null
    and group_row.updated_at = $5::timestamptz
  returning group_row.id
), saved_group as materialized (
  select id from created_group
  union all
  select id from updated_group
), deleted_account_memberships as (
  delete from portfolio_group_account_memberships membership
  using saved_group
  where membership.portfolio_group_id = saved_group.id
    and membership.canonical_owner_user_id = $2::uuid
    and membership.valid_from >= $8::date
    and not exists (
      select 1 from requested_accounts requested
      where requested.id = membership.account_id
    )
  returning membership.id
), closed_account_memberships as (
  update portfolio_group_account_memberships membership
  set valid_to = $8::date
  from saved_group
  where membership.portfolio_group_id = saved_group.id
    and membership.canonical_owner_user_id = $2::uuid
    and membership.valid_from < $8::date
    and (membership.valid_to is null or membership.valid_to > $8::date)
    and not exists (
      select 1 from requested_accounts requested
      where requested.id = membership.account_id
    )
  returning membership.id
), account_change_barrier as materialized (
  select
    (select count(*) from deleted_account_memberships) +
    (select count(*) from closed_account_memberships) as value
), inserted_account_memberships as (
  insert into portfolio_group_account_memberships (
    id, canonical_owner_user_id, portfolio_group_id, account_id,
    valid_from, valid_to, created_at
  )
  select
    gen_random_uuid(), $2::uuid, saved_group.id, requested.id,
    $8::date, null, $9::timestamptz
  from saved_group
  cross join requested_accounts requested
  cross join account_change_barrier
  where not exists (
    select 1
    from portfolio_group_account_memberships membership
    where membership.portfolio_group_id = saved_group.id
      and membership.account_id = requested.id
      and membership.valid_to is null
  )
  on conflict (portfolio_group_id, account_id) where valid_to is null do nothing
  returning id
), deleted_asset_memberships as (
  delete from portfolio_group_asset_memberships membership
  using saved_group
  where membership.portfolio_group_id = saved_group.id
    and membership.canonical_owner_user_id = $2::uuid
    and membership.valid_from >= $8::date
    and not exists (
      select 1 from effective_requested_assets requested
      where requested.id = membership.asset_id
    )
  returning membership.id
), closed_asset_memberships as (
  update portfolio_group_asset_memberships membership
  set valid_to = $8::date
  from saved_group
  where membership.portfolio_group_id = saved_group.id
    and membership.canonical_owner_user_id = $2::uuid
    and membership.valid_from < $8::date
    and (membership.valid_to is null or membership.valid_to > $8::date)
    and not exists (
      select 1 from effective_requested_assets requested
      where requested.id = membership.asset_id
    )
  returning membership.id
), asset_change_barrier as materialized (
  select
    (select count(*) from deleted_asset_memberships) +
    (select count(*) from closed_asset_memberships) as value
), inserted_asset_memberships as (
  insert into portfolio_group_asset_memberships (
    id, canonical_owner_user_id, portfolio_group_id, asset_id,
    valid_from, valid_to, created_at
  )
  select
    gen_random_uuid(), $2::uuid, saved_group.id, requested.id,
    $8::date, null, $9::timestamptz
  from saved_group
  cross join effective_requested_assets requested
  cross join asset_change_barrier
  where not exists (
    select 1
    from portfolio_group_asset_memberships membership
    where membership.portfolio_group_id = saved_group.id
      and membership.asset_id = requested.id
      and membership.valid_to is null
  )
  on conflict (portfolio_group_id, asset_id) where valid_to is null do nothing
  returning id
), mutation_barrier as materialized (
  select
    (select count(*) from inserted_account_memberships) +
    (select count(*) from inserted_asset_memberships) as value
)
select
  facts.*,
  (select count(*) from saved_group) as saved_count,
  (
    select count(*)
    from portfolio_group_account_memberships membership
    cross join mutation_barrier
    where membership.canonical_owner_user_id = $2::uuid
      and membership.portfolio_group_id = $3::uuid
      and membership.valid_to is null
  ) as active_account_count,
  (
    select count(*)
    from portfolio_group_asset_memberships membership
    cross join mutation_barrier
    where membership.canonical_owner_user_id = $2::uuid
      and membership.portfolio_group_id = $3::uuid
      and membership.valid_to is null
  ) as active_asset_count
from facts
`;

const ATOMIC_ARCHIVE_QUERY = `
with lock_acquired as materialized (
  select pg_advisory_xact_lock(hashtextextended($1, 0))
), archived_group as materialized (
  update portfolio_groups group_row
  set archived_at = $6::timestamptz,
      updated_at = $6::timestamptz
  from lock_acquired
  where group_row.id = $3::uuid
    and group_row.canonical_owner_user_id = $2::uuid
    and group_row.archived_at is null
    and group_row.updated_at = $4::timestamptz
  returning group_row.id
), deleted_account_memberships as (
  delete from portfolio_group_account_memberships membership
  using archived_group
  where membership.portfolio_group_id = archived_group.id
    and membership.canonical_owner_user_id = $2::uuid
    and membership.valid_from >= $5::date
  returning membership.id
), closed_account_memberships as (
  update portfolio_group_account_memberships membership
  set valid_to = $5::date
  from archived_group
  where membership.portfolio_group_id = archived_group.id
    and membership.canonical_owner_user_id = $2::uuid
    and membership.valid_from < $5::date
    and (membership.valid_to is null or membership.valid_to > $5::date)
  returning membership.id
), deleted_asset_memberships as (
  delete from portfolio_group_asset_memberships membership
  using archived_group
  where membership.portfolio_group_id = archived_group.id
    and membership.canonical_owner_user_id = $2::uuid
    and membership.valid_from >= $5::date
  returning membership.id
), closed_asset_memberships as (
  update portfolio_group_asset_memberships membership
  set valid_to = $5::date
  from archived_group
  where membership.portfolio_group_id = archived_group.id
    and membership.canonical_owner_user_id = $2::uuid
    and membership.valid_from < $5::date
    and (membership.valid_to is null or membership.valid_to > $5::date)
  returning membership.id
), mutation_barrier as materialized (
  select
    (select count(*) from deleted_account_memberships) +
    (select count(*) from closed_account_memberships) +
    (select count(*) from deleted_asset_memberships) +
    (select count(*) from closed_asset_memberships) as value
)
select
  (select count(*) from archived_group) as archived_count,
  mutation_barrier.value as membership_mutation_count
from mutation_barrier
`;
