import "server-only";
import { getTenantSqlClient } from "@/db/tenant-client";
import { readNativeContributionContext } from "@/db/queries/native-contribution-context";
import { buildNativeContributionPlan, isNativeContributionPlanId, validNativeContributionRequest, type NativeContributionRequest, type SavedNativeContributionPlan } from "@/lib/native-contribution-plan";
import type { TenantContext } from "@/lib/session-resolver-contract";

export async function listNativeContributionPlans(tenant: TenantContext, scopeKey?: string, id?: string): Promise<SavedNativeContributionPlan[]> {
  const [, rows] = await getTenantSqlClient().transaction(tx => [
    tx.query("select set_config('app.current_user_id',$1,true)", [tenant.ownerUserId]),
    tx.query(`select id,created_at as "createdAt",document_json as document from native_contribution_plans where owner_user_id=$1::uuid and ($2::text is null or scope_key=$2) and ($3::uuid is null or id=$3::uuid) order by created_at desc,id limit 20`, [tenant.ownerUserId, scopeKey ?? null, id ?? null]),
  ], { readOnly: true });
  return rows.map(row => ({ ...row, createdAt: new Date(row.createdAt).toISOString() })) as SavedNativeContributionPlan[];
}

export async function saveNativeContributionPlan(tenant: TenantContext, request: NativeContributionRequest) {
  if (!validNativeContributionRequest(request)) return { status: "blocked" as const, reason: "invalid_request" };
  const old = (await listNativeContributionPlans(tenant, undefined, request.id))[0];
  if (old) return { status: equalRequest(old.document.request, request) ? "existing" as const : "conflict" as const, plan: old };
  const context = await readNativeContributionContext(tenant, request.scopeKey, request.reportingCurrency);
  const planned = buildNativeContributionPlan(context, request);
  if (planned.status !== "ready") return planned;
  const document = JSON.stringify(planned.document);
  if (Buffer.byteLength(document) > 500_000) return { status: "blocked" as const, reason: "evidence_window_exceeded" };
  const [, , , rows] = await getTenantSqlClient().transaction(tx => [
    tx.query("select set_config('app.current_user_id',$1,true)", [tenant.ownerUserId]),
    tx.query("select set_config('lock_timeout','3000',true),set_config('statement_timeout','5000',true)"),
    tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`varda.portfolio_mutation.v1:${tenant.ownerUserId}`]),
    tx.query(SAVE_SQL, [tenant.ownerUserId, request.id, request.scopeKey, request.reportingCurrency, JSON.stringify(request), document, JSON.stringify(planned.document.basis.nativeSequences),context.status==='ready'&&context.evidenceVersion?JSON.stringify(context.policy):null]),
  ], { isolationLevel: "ReadCommitted" });
  const status = rows[0]?.status;
  if (!["created", "existing", "conflict", "limit", "inactive"].includes(status)) throw new Error("native_plan_save_unavailable");
  const plan = status === "created" || status === "existing" ? (await listNativeContributionPlans(tenant, undefined, request.id))[0] : undefined;
  return { status: status as "created" | "existing" | "conflict" | "limit" | "inactive", basisChanged:!!request.previewEvidenceVersion && context.status==='ready' && request.previewEvidenceVersion!==context.evidenceVersion, ...(plan ? { plan } : {}) };
}
function equalRequest(a: NativeContributionRequest, b: NativeContributionRequest) {
  return a.id === b.id && a.scopeKey === b.scopeKey && a.reportingCurrency === b.reportingCurrency && a.useAvailableCash === b.useAvailableCash && a.newMoney.amount === b.newMoney.amount && a.newMoney.currency === b.newMoney.currency && a.previewEvidenceVersion===b.previewEvidenceVersion;
}
export async function deleteNativeContributionPlan(tenant: TenantContext, id: string) {
  if (!isNativeContributionPlanId(id)) throw new Error("native_plan_invalid_id");
  const [, , , rows] = await getTenantSqlClient().transaction(tx => [
    tx.query("select set_config('app.current_user_id',$1,true)", [tenant.ownerUserId]),
    tx.query("select set_config('lock_timeout','3000',true),set_config('statement_timeout','5000',true)"),
    tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`varda.portfolio_mutation.v1:${tenant.ownerUserId}`]),
    tx.query("delete from native_contribution_plans where owner_user_id=$1::uuid and id=$2::uuid returning id", [tenant.ownerUserId, id]),
  ], { isolationLevel: "ReadCommitted" });
  return rows.length === 1;
}
const SAVE_SQL = `with existing as materialized (
 select request_json from native_contribution_plans where owner_user_id=$1::uuid and id=$2::uuid
), unchanged as materialized (
 select not exists(select 1 from jsonb_each_text($7::jsonb) expected where not exists (
   select 1 from accounts a where a.id=expected.key::uuid and a.canonical_owner_user_id=$1::uuid and a.is_active and a.native_state->>'sequence'=expected.value))
   and ($8::jsonb is null or (select count(*)=1 from portfolio_target_policy_revisions p where p.lifecycle_status='approved'
     and p.scope_kind=case when $3='all' then 'all' when $3 like 'account:%' then 'account' else 'portfolio_group' end
     and p.scope_account_id is not distinct from case when $3 like 'account:%' then split_part($3,':',2)::uuid else null end
     and p.scope_portfolio_group_id is not distinct from case when $3 like 'portfolio:%' then split_part($3,':',2)::uuid else null end
     and p.approval_revision=($8::jsonb->>'revision')::integer and p.universe_hash=$8::jsonb->>'universeHash' and p.vector_hash=$8::jsonb->>'vectorHash'
     and p.policy_version=$8::jsonb->>'version')) as ok
), inserted as (
 insert into native_contribution_plans(owner_user_id,id,scope_key,reporting_currency,request_json,document_json)
 select $1::uuid,$2::uuid,$3,$4,$5::jsonb,$6::jsonb where investment_plan_tenant_active() and (select ok from unchanged) and not exists(select 1 from existing)
 and (select count(*) from native_contribution_plans where owner_user_id=$1::uuid)<20 returning id
) select case when not investment_plan_tenant_active() then 'inactive'
 when exists(select 1 from inserted) then 'created'
 when exists(select 1 from existing where request_json=$5::jsonb) then 'existing'
 when exists(select 1 from existing) or not (select ok from unchanged) then 'conflict'
 else 'limit' end as status`;
