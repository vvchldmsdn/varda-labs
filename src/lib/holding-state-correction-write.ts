import "server-only";

import { sqlClient } from "@/db/client";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import {
  HOLDING_STATE_CORRECTION_POLICY,
  parseHoldingStateCorrectionInput,
  type HoldingStateCorrectionActionState,
} from "@/lib/holding-state-correction";
import {
  assertActiveTenantWriteAllowed,
  prepareTenantWriteContext,
} from "@/lib/tenant-write-context";

type CorrectionResult = Readonly<{
  existing_asset_count?: string | number;
  exact_asset_count?: string | number;
  unchanged_count?: string | number;
  corrected_count?: string | number;
  evidence_count?: string | number;
}>;

export async function writeSessionHoldingStateCorrection(
  formData: FormData,
): Promise<HoldingStateCorrectionActionState> {
  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) {
    return state("unauthorized", "로그인과 사용자 연결을 확인해 주세요.");
  }

  const parsed = parseHoldingStateCorrectionInput(formData);
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
    const result = await runAtomicCorrection({
      ownerUserId,
      ...parsed.input,
    });
    if (
      number(result.corrected_count) === 1 &&
      number(result.evidence_count) === 1
    ) {
      return state(
        "success",
        "현재 보유 수량과 평균 매입가를 정정하고 변경 이력을 남겼습니다.",
      );
    }
    if (number(result.existing_asset_count) !== 1) {
      return state(
        "conflict",
        "보유종목 또는 계좌 상태가 변경되었습니다. 화면을 새로고침해 주세요.",
      );
    }
    if (number(result.exact_asset_count) !== 1) {
      return state(
        "conflict",
        "다른 변경이 먼저 반영되었습니다. 화면을 새로고침해 주세요.",
      );
    }
    if (number(result.unchanged_count) === 1) {
      return state("invalid", "변경된 수량이나 평균 매입가가 없습니다.");
    }
    return state("conflict", "정정 조건을 다시 확인해 주세요.");
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
      "보유 상태를 정정하지 못했습니다. 잠시 후 다시 확인해 주세요.",
    );
  }
}

async function runAtomicCorrection({
  ownerUserId,
  assetId,
  expectedUpdatedAt,
  quantity,
  averageCost,
  reason,
}: {
  ownerUserId: string;
  assetId: string;
  expectedUpdatedAt: string;
  quantity: string;
  averageCost: string;
  reason: string | null;
}) {
  const results = await sqlClient.transaction((transaction) => [
    transaction.query("set local lock_timeout = '2s'"),
    transaction.query("set local statement_timeout = '8s'"),
    transaction.query(ATOMIC_CORRECTION_QUERY, [
      `varda.holding_state_correction.v1:${ownerUserId}:${assetId}`,
      ownerUserId,
      assetId,
      expectedUpdatedAt,
      quantity,
      averageCost,
      reason,
      HOLDING_STATE_CORRECTION_POLICY.version,
    ]),
  ]);
  return (results[2]?.[0] ?? {}) as CorrectionResult;
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
  status: HoldingStateCorrectionActionState["status"],
  message: string,
): HoldingStateCorrectionActionState {
  return Object.freeze({ status, message });
}

const ATOMIC_CORRECTION_QUERY = `
with lock_acquired as materialized (
  select pg_advisory_xact_lock(hashtextextended($1, 0))
), existing_asset as materialized (
  select
    asset.id,
    asset.account_id,
    asset.quantity,
    asset.average_cost,
    asset.updated_at
  from assets asset
  join accounts account_row
    on account_row.id = asset.account_id
   and account_row.canonical_owner_user_id = $2::uuid
   and account_row.is_active = true
  cross join lock_acquired
  where asset.id = $3::uuid
    and asset.canonical_owner_user_id = $2::uuid
    and asset.account = account_row.code
  for update of asset
), facts as materialized (
  select
    count(*) as existing_asset_count,
    count(*) filter (where updated_at = $4::timestamptz) as exact_asset_count,
    count(*) filter (
      where updated_at = $4::timestamptz
        and quantity = $5::numeric
        and average_cost is not distinct from $6::numeric
    ) as unchanged_count
  from existing_asset
), corrected as (
  update assets asset
  set
    quantity = $5::numeric,
    average_cost = $6::numeric,
    updated_at = greatest(
      transaction_timestamp(),
      existing.updated_at + interval '1 millisecond'
    )
  from existing_asset existing
  cross join facts
  where asset.id = existing.id
    and facts.existing_asset_count = 1
    and facts.exact_asset_count = 1
    and facts.unchanged_count = 0
  returning
    asset.id,
    asset.account_id,
    asset.quantity,
    asset.average_cost,
    asset.updated_at
), evidence as (
  insert into holding_state_corrections (
    canonical_owner_user_id,
    asset_id,
    account_id,
    previous_quantity,
    corrected_quantity,
    previous_average_cost,
    corrected_average_cost,
    previous_asset_updated_at,
    corrected_asset_updated_at,
    reason,
    policy_version,
    corrected_at
  )
  select
    $2::uuid,
    existing.id,
    existing.account_id,
    existing.quantity,
    corrected.quantity,
    existing.average_cost,
    corrected.average_cost,
    existing.updated_at,
    corrected.updated_at,
    $7::text,
    $8::varchar,
    corrected.updated_at
  from existing_asset existing
  join corrected on corrected.id = existing.id
  returning id
)
select
  facts.*,
  (select count(*) from corrected) as corrected_count,
  (select count(*) from evidence) as evidence_count
from facts
`;
