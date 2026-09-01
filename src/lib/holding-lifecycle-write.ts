import "server-only";

import { sqlClient } from "@/db/client";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import {
  HOLDING_LIFECYCLE_POLICY,
  parseHoldingArchiveInput,
  parseHoldingRestoreInput,
  type HoldingLifecycleActionState,
  type HoldingLifecycleInput,
} from "@/lib/holding-lifecycle";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";
import {
  assertActiveTenantWriteAllowed,
  prepareTenantWriteContext,
} from "@/lib/tenant-write-context";

type LifecycleResult = Readonly<{
  existing_asset_count?: string | number;
  exact_asset_count?: string | number;
  changed_count?: string | number;
  evidence_count?: string | number;
  membership_mutation_count?: string | number;
}>;

export async function archiveSessionHolding(
  formData: FormData,
): Promise<HoldingLifecycleActionState> {
  const parsed = parseHoldingArchiveInput(formData);
  if (!parsed.ok) return state("invalid", parsed.message);
  return writeLifecycle("archive", parsed.input);
}

export async function restoreSessionHolding(
  formData: FormData,
): Promise<HoldingLifecycleActionState> {
  const parsed = parseHoldingRestoreInput(formData);
  if (!parsed.ok) return state("invalid", parsed.message);
  return writeLifecycle("restore", parsed.input);
}

async function writeLifecycle(
  operation: "archive" | "restore",
  input: HoldingLifecycleInput,
): Promise<HoldingLifecycleActionState> {
  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) {
    return state("unauthorized", "로그인과 사용자 연결을 확인해 주세요.");
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
    operation: "update",
    existingOwnerUserId: ownerUserId,
    referencedOwnerUserIds: [ownerUserId],
  });

  const now = new Date();
  try {
    const result = await runAtomicLifecycle({
      operation,
      ownerUserId,
      input,
      serviceDate: resolveSnapshotCycle(now).snapshotDate,
      occurredAt: now.toISOString(),
    });
    if (
      number(result.changed_count) === 1 &&
      number(result.evidence_count) === 1
    ) {
      return operation === "archive"
        ? state(
            "success",
            "보유종목을 종료했습니다. 수량·매입원가·과거 기록은 보존됩니다.",
          )
        : state(
            "success",
            "보유종목을 복원했습니다. 분석 범위 연결은 필요할 때 다시 지정해 주세요.",
          );
    }
    if (
      number(result.existing_asset_count) !== 1 ||
      number(result.exact_asset_count) !== 1
    ) {
      return state(
        "conflict",
        "보유종목 또는 계좌 상태가 변경되었습니다. 화면을 새로고침해 주세요.",
      );
    }
    return state("conflict", "보유종목 상태 변경 조건을 다시 확인해 주세요.");
  } catch (error) {
    const code = databaseErrorCode(error);
    if (["23503", "23505", "23514", "55P03", "57014"].includes(code ?? "")) {
      return state(
        "conflict",
        "다른 변경이 먼저 반영되었습니다. 화면을 새로고침해 주세요.",
      );
    }
    return state(
      "error",
      "보유종목 상태를 변경하지 못했습니다. 잠시 후 다시 확인해 주세요.",
    );
  }
}

async function runAtomicLifecycle({
  operation,
  ownerUserId,
  input,
  serviceDate,
  occurredAt,
}: {
  operation: "archive" | "restore";
  ownerUserId: string;
  input: HoldingLifecycleInput;
  serviceDate: string;
  occurredAt: string;
}) {
  const results = await sqlClient.transaction((transaction) => [
    transaction.query("set local lock_timeout = '2s'"),
    transaction.query("set local statement_timeout = '8s'"),
    transaction.query(
      operation === "archive" ? ATOMIC_ARCHIVE_QUERY : ATOMIC_RESTORE_QUERY,
      [
        `varda.holding_lifecycle.v1:${ownerUserId}:${input.assetId}`,
        ownerUserId,
        input.assetId,
        input.expectedUpdatedAt,
        serviceDate,
        occurredAt,
        input.reason,
        HOLDING_LIFECYCLE_POLICY.version,
      ],
    ),
  ]);
  return (results[2]?.[0] ?? {}) as LifecycleResult;
}

function number(value: string | number | undefined) {
  return Number(value ?? 0);
}

function databaseErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : null;
}

function state(
  status: HoldingLifecycleActionState["status"],
  message: string,
): HoldingLifecycleActionState {
  return Object.freeze({ status, message });
}

const ATOMIC_ARCHIVE_QUERY = `
with lock_acquired as materialized (
  select pg_advisory_xact_lock(hashtextextended($1, 0))
), existing_asset as materialized (
  select asset.id, asset.account_id, asset.archived_at, asset.updated_at
  from assets asset
  join accounts account_row
    on account_row.id = asset.account_id
   and account_row.canonical_owner_user_id = $2::uuid
   and account_row.is_active = true
  cross join lock_acquired
  where asset.id = $3::uuid
    and asset.canonical_owner_user_id = $2::uuid
    and asset.account = account_row.code
    and asset.archived_at is null
  for update of asset
), facts as materialized (
  select
    count(*) as existing_asset_count,
    count(*) filter (where updated_at = $4::timestamptz) as exact_asset_count
  from existing_asset
), changed as materialized (
  update assets asset
  set
    archived_at = greatest(
      $6::timestamptz,
      existing.updated_at + interval '1 millisecond'
    ),
    updated_at = greatest(
      $6::timestamptz,
      existing.updated_at + interval '1 millisecond'
    )
  from existing_asset existing
  cross join facts
  where asset.id = existing.id
    and facts.existing_asset_count = 1
    and facts.exact_asset_count = 1
  returning asset.id, asset.account_id, asset.archived_at, asset.updated_at
), deleted_memberships as (
  delete from portfolio_group_asset_memberships membership
  using changed
  where membership.asset_id = changed.id
    and membership.canonical_owner_user_id = $2::uuid
    and membership.valid_from >= $5::date
  returning membership.id
), closed_memberships as (
  update portfolio_group_asset_memberships membership
  set valid_to = $5::date
  from changed
  where membership.asset_id = changed.id
    and membership.canonical_owner_user_id = $2::uuid
    and membership.valid_from < $5::date
    and (membership.valid_to is null or membership.valid_to > $5::date)
  returning membership.id
), evidence as (
  insert into holding_lifecycle_events (
    canonical_owner_user_id, asset_id, account_id, event_type,
    previous_archived_at, resulting_archived_at,
    previous_asset_updated_at, resulting_asset_updated_at,
    reason, policy_version, occurred_at
  )
  select
    $2::uuid, existing.id, existing.account_id, 'archived',
    existing.archived_at, changed.archived_at,
    existing.updated_at, changed.updated_at,
    $7::text, $8::varchar, changed.updated_at
  from existing_asset existing
  join changed on changed.id = existing.id
  returning id
), mutation_barrier as materialized (
  select
    (select count(*) from deleted_memberships) +
    (select count(*) from closed_memberships) as membership_mutation_count
)
select
  facts.*,
  (select count(*) from changed) as changed_count,
  (select count(*) from evidence) as evidence_count,
  mutation_barrier.membership_mutation_count
from facts
cross join mutation_barrier
`;

const ATOMIC_RESTORE_QUERY = `
with lock_acquired as materialized (
  select pg_advisory_xact_lock(hashtextextended($1, 0))
), existing_asset as materialized (
  select asset.id, asset.account_id, asset.archived_at, asset.updated_at
  from assets asset
  join accounts account_row
    on account_row.id = asset.account_id
   and account_row.canonical_owner_user_id = $2::uuid
   and account_row.is_active = true
  cross join lock_acquired
  where asset.id = $3::uuid
    and asset.canonical_owner_user_id = $2::uuid
    and asset.account = account_row.code
    and asset.archived_at is not null
  for update of asset
), facts as materialized (
  select
    count(*) as existing_asset_count,
    count(*) filter (where updated_at = $4::timestamptz) as exact_asset_count
  from existing_asset
), changed as materialized (
  update assets asset
  set
    archived_at = null,
    updated_at = greatest(
      $6::timestamptz,
      existing.updated_at + interval '1 millisecond'
    )
  from existing_asset existing
  cross join facts
  where asset.id = existing.id
    and facts.existing_asset_count = 1
    and facts.exact_asset_count = 1
  returning asset.id, asset.account_id, asset.archived_at, asset.updated_at
), evidence as (
  insert into holding_lifecycle_events (
    canonical_owner_user_id, asset_id, account_id, event_type,
    previous_archived_at, resulting_archived_at,
    previous_asset_updated_at, resulting_asset_updated_at,
    reason, policy_version, occurred_at
  )
  select
    $2::uuid, existing.id, existing.account_id, 'restored',
    existing.archived_at, changed.archived_at,
    existing.updated_at, changed.updated_at,
    $7::text, $8::varchar, changed.updated_at
  from existing_asset existing
  join changed on changed.id = existing.id
  returning id
)
select
  facts.*,
  (select count(*) from changed) as changed_count,
  (select count(*) from evidence) as evidence_count,
  0 as membership_mutation_count
from facts
`;
