import "server-only";

import { randomUUID } from "node:crypto";

import { sqlClient } from "@/db/client";
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from "@/db/queries/portfolio-analysis-scopes";
import { getReadOnlyTenantPortfolioTargetPolicyModel } from "@/db/queries/portfolio-target-policy";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import {
  PORTFOLIO_TARGET_POLICY,
  buildPortfolioTargetPolicyRecord,
  parseTargetWeightPercent,
  portfolioTargetScopeColumns,
  serializePortfolioTargetPolicyRows,
} from "@/lib/portfolio-target-policy";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";
import {
  assertActiveTenantWriteAllowed,
  prepareTenantWriteContext,
} from "@/lib/tenant-write-context";

export type PortfolioTargetPolicyActionState = Readonly<{
  status: "idle" | "success" | "invalid" | "unauthorized" | "conflict" | "error";
  message: string | null;
}>;

export async function writeSessionPortfolioTargetPolicy(
  formData: FormData,
): Promise<PortfolioTargetPolicyActionState> {
  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) {
    return state("unauthorized", "로그인과 사용자 연결을 확인해 주세요.");
  }

  const scopeValue = formData.get("scope");
  if (typeof scopeValue !== "string" || scopeValue.trim().length === 0) {
    return state("invalid", "저장할 자산 범위를 확인해 주세요.");
  }
  const scopeContext = await getReadOnlyTenantPortfolioAnalysisScopeContext({
    scope: scopeValue,
    tenantContext: resolution.tenantContext,
  });
  if (
    scopeContext.state !== "ready" ||
    scopeContext.resolution.state !== "resolved"
  ) {
    return state("conflict", "자산 범위가 변경되었습니다. 화면을 새로고침해 주세요.");
  }

  const serviceDate = resolveSnapshotCycle(new Date()).snapshotDate;
  const scope = scopeContext.resolution.scope;
  const model = await getReadOnlyTenantPortfolioTargetPolicyModel({
    scope,
    serviceDate,
    tenantContext: resolution.tenantContext,
  });
  if (model.status !== "ready") {
    return state("conflict", "현재 보유종목 구성을 목표비중으로 저장할 수 없습니다.");
  }

  const submittedRowCount = Number(formData.get("rowCount"));
  if (
    !Number.isSafeInteger(submittedRowCount) ||
    submittedRowCount !== model.universe.rows.length
  ) {
    return state("conflict", "보유종목 구성이 변경되었습니다. 화면을 새로고침해 주세요.");
  }
  const submittedUniverseHash = formData.get("universeHash");
  if (
    typeof submittedUniverseHash !== "string" ||
    model.currentUniverseHash === null ||
    submittedUniverseHash !== model.currentUniverseHash
  ) {
    return state("conflict", "보유종목 구성이 변경되었습니다. 화면을 새로고침해 주세요.");
  }
  const decisions = model.universe.rows.map((row, index) => ({
    assetId: row.assetId,
    targetWeightBps: parseTargetWeightPercent(
      formData.get(`targetWeight:${index}`),
    ),
  }));
  if (decisions.some((decision) => decision.targetWeightBps === null)) {
    return state("invalid", "목표비중은 소수점 둘째 자리까지 입력해 주세요.");
  }
  const record = buildPortfolioTargetPolicyRecord({
    decisions: decisions.map((decision) => ({
      assetId: decision.assetId,
      targetWeightBps: decision.targetWeightBps!,
    })),
    effectiveServiceDate: serviceDate,
    scope,
    universe: model.universe.rows,
  });
  if (record.status !== "ready") {
    return state("invalid", blockerMessage(record.blockers));
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
    operation: "insert",
    referencedOwnerUserIds: [ownerUserId],
  });

  try {
    const writeResult = await recordPortfolioTargetPolicy({
      ownerUserId,
      record,
      scope,
    });
    if (!writeResult) {
      return state("error", "목표비중 저장 결과를 확인하지 못했습니다.");
    }
    return state("success", "이 범위의 목표비중을 저장했습니다.");
  } catch (error) {
    if (databaseErrorCode(error) === "23505") {
      return state(
        "conflict",
        "다른 저장이 먼저 완료되었습니다. 화면을 새로고침해 확인해 주세요.",
      );
    }
    return state("error", "목표비중을 저장하지 못했습니다. 잠시 후 다시 확인해 주세요.");
  }
}

async function recordPortfolioTargetPolicy({
  ownerUserId,
  record,
  scope,
}: {
  ownerUserId: string;
  record: Extract<ReturnType<typeof buildPortfolioTargetPolicyRecord>, { status: "ready" }>;
  scope: Parameters<typeof portfolioTargetScopeColumns>[0];
}) {
  const revisionId = randomUUID();
  const approvedAt = new Date().toISOString();
  const scopeColumns = portfolioTargetScopeColumns(scope);
  const lockName = [
    "varda.portfolio_target_policy.v1",
    ownerUserId,
    scope.key,
  ].join(":");
  const rowsJson = serializePortfolioTargetPolicyRows(record.rows);

  const results = await sqlClient.transaction((transaction) => [
    transaction.query("set local lock_timeout = '2s'"),
    transaction.query("set local statement_timeout = '8s'"),
    transaction.query(ATOMIC_REPLACE_QUERY, [
      lockName,
      ownerUserId,
      scopeColumns.scopeKind,
      scopeColumns.scopeAccountId,
      scopeColumns.scopePortfolioGroupId,
      revisionId,
      PORTFOLIO_TARGET_POLICY.version,
      record.effectiveServiceDate,
      record.universeHash,
      record.vectorHash,
      PORTFOLIO_TARGET_POLICY.authoritySource,
      approvedAt,
      rowsJson,
    ]),
  ]);
  const result = results[2]?.[0] as
    | {
        revision_count?: string | number;
        row_count?: string | number;
        event_count?: string | number;
      }
    | undefined;
  return (
    Number(result?.revision_count) === 1 &&
    Number(result?.row_count) === record.rows.length &&
    Number(result?.event_count) >= 1 &&
    Number(result?.event_count) <= 2
  );
}

const ATOMIC_REPLACE_QUERY = `
with lock_acquired as materialized (
  select pg_advisory_xact_lock(hashtextextended($1, 0))
), current_revision as materialized (
  select r.id
  from portfolio_target_policy_revisions r
  cross join lock_acquired
  where r.canonical_owner_user_id = $2::uuid
    and r.scope_kind = $3::varchar
    and r.scope_account_id is not distinct from $4::uuid
    and r.scope_portfolio_group_id is not distinct from $5::uuid
    and r.lifecycle_status = 'approved'
  for update of r
), next_revision as materialized (
  select coalesce(max(r.approval_revision), 0) + 1 as value
  from portfolio_target_policy_revisions r
  cross join lock_acquired
  where r.canonical_owner_user_id = $2::uuid
    and r.scope_kind = $3::varchar
    and r.scope_account_id is not distinct from $4::uuid
    and r.scope_portfolio_group_id is not distinct from $5::uuid
), superseded as (
  update portfolio_target_policy_revisions r
  set lifecycle_status = 'superseded', terminal_at = $12::timestamptz
  from current_revision current
  where r.id = current.id
  returning r.id
), inserted_revision as (
  insert into portfolio_target_policy_revisions (
    id, canonical_owner_user_id, scope_kind, scope_account_id,
    scope_portfolio_group_id, policy_version, approval_revision,
    effective_service_date, universe_hash, vector_hash, authority_source,
    lifecycle_status, approved_at, terminal_at
  )
  select
    $6::uuid, $2::uuid, $3::varchar, $4::uuid, $5::uuid, $7::varchar,
    next_revision.value, $8::date,
    $9::varchar, $10::varchar, $11::varchar, 'approved',
    $12::timestamptz, null
  from next_revision
  cross join (select count(*) from superseded) superseded_count
  returning id
), inserted_rows as (
  insert into portfolio_target_policy_rows (
    approval_revision_id, canonical_owner_user_id, account_id, asset_id,
    asset_name, market, currency, ticker, buyability, target_weight_bps
  )
  select
    inserted_revision.id, $2::uuid, row.account_id, row.asset_id,
    row.asset_name, row.market, row.currency, row.ticker,
    row.buyability, row.target_weight_bps
  from inserted_revision
  cross join jsonb_to_recordset($13::jsonb) as row(
    account_id uuid,
    asset_id uuid,
    asset_name varchar,
    market varchar,
    currency varchar,
    ticker varchar,
    buyability varchar,
    target_weight_bps integer
  )
  returning asset_id
), supersession_events as (
  insert into portfolio_target_policy_lifecycle_events (
    id, canonical_owner_user_id, approval_revision_id, event_sequence,
    audit_version, transition_kind, previous_status, resulting_status,
    transitioned_at, replacement_revision_id
  )
  select
    gen_random_uuid(), $2::uuid, superseded.id, 2,
    'portfolio_target_policy_audit_v1', 'supersession', 'approved',
    'superseded', $12::timestamptz, $6::uuid
  from superseded
  cross join inserted_revision
  returning id
), approval_event as (
  insert into portfolio_target_policy_lifecycle_events (
    id, canonical_owner_user_id, approval_revision_id, event_sequence,
    audit_version, transition_kind, previous_status, resulting_status,
    transitioned_at, replacement_revision_id
  )
  select
    gen_random_uuid(), $2::uuid, inserted_revision.id, 1,
    'portfolio_target_policy_audit_v1', 'explicit_approval', null,
    'approved', $12::timestamptz, null
  from inserted_revision
  returning id
)
select
  (select count(*) from inserted_revision) as revision_count,
  (select count(*) from inserted_rows) as row_count,
  (select count(*) from supersession_events) +
    (select count(*) from approval_event) as event_count
`;

function blockerMessage(blockers: readonly string[]) {
  if (blockers.includes("target_weight_total_invalid")) {
    return "목표비중 합계는 정확히 100%여야 합니다.";
  }
  if (blockers.includes("positive_target_not_buyable")) {
    return "현재 매수 대상으로 지원하지 않는 자산은 목표비중을 0%로 두어야 합니다.";
  }
  if (blockers.includes("decision_set_mismatch")) {
    return "보유종목 구성이 변경되었습니다. 화면을 새로고침해 주세요.";
  }
  return "입력한 목표비중을 확인해 주세요.";
}

function databaseErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : null;
}

function state(
  status: PortfolioTargetPolicyActionState["status"],
  message: string,
): PortfolioTargetPolicyActionState {
  return Object.freeze({ status, message });
}
