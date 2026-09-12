import "server-only";
import { getTenantSqlClient } from "@/db/tenant-client";
import { ADDITIONAL_CONTRIBUTION_POLICY } from "@/lib/additional-contribution-allocator";
import { isPlanId, validatePlan, type PlanInput } from "@/lib/investment-plan";
import type { TenantContext } from "@/lib/session-resolver-contract";

export type SavedInvestmentPlan = { id: string; input: PlanInput; createdAt: string };
export type SaveInvestmentPlanResult = { status: "created" | "existing" | "conflict" | "limit" | "inactive"; id: string };

export async function listInvestmentPlans(tenant: TenantContext): Promise<SavedInvestmentPlan[]> {
  const sql = getTenantSqlClient();
  const [, rows] = await sql.transaction(tx => [
    tx.query("select set_config('app.current_user_id', $1, true)", [tenant.ownerUserId]),
    tx.query("select id, input_json, created_at from investment_plans where owner_user_id = $1::uuid order by created_at desc, id limit 50", [tenant.ownerUserId]),
  ], { isolationLevel: "ReadCommitted", readOnly: true });
  return rows.map(row => {
    const parsed = validatePlan(row.input_json);
    if (!parsed.ok) throw new Error("investment_plan_invalid_record");
    return { id: String(row.id), input: parsed.input, createdAt: new Date(row.created_at).toISOString() };
  });
}

export async function saveInvestmentPlan(tenant: TenantContext, id: string, input: PlanInput): Promise<SaveInvestmentPlanResult> {
  const parsed = validatePlan(input);
  if (!isPlanId(id) || !parsed.ok) throw new Error("investment_plan_invalid_input");
  const sql = getTenantSqlClient();
  // Separate lock statement: ReadCommitted refreshes the following statement's snapshot
  // after another request commits, so both the cap and idempotency survive concurrent clicks.
  const [, , , rows] = await sql.transaction(tx => [
    tx.query("select set_config('app.current_user_id', $1, true)", [tenant.ownerUserId]),
    tx.query("select set_config('lock_timeout', '3000', true), set_config('statement_timeout', '5000', true)"),
    tx.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`investment_plans:${tenant.ownerUserId}`]),
    tx.query(SAVE_PLAN_SQL, [tenant.ownerUserId, id, JSON.stringify(parsed.input), ADDITIONAL_CONTRIBUTION_POLICY.version]),
  ], { isolationLevel: "ReadCommitted" });
  const status = rows[0]?.status;
  if (!["created", "existing", "conflict", "limit", "inactive"].includes(status)) throw new Error("investment_plan_write_unavailable");
  return { id, status } as SaveInvestmentPlanResult;
}

export async function deleteInvestmentPlan(tenant: TenantContext, id: string): Promise<boolean> {
  if (!isPlanId(id)) return false;
  const sql = getTenantSqlClient();
  const [, , , rows] = await sql.transaction(tx => [
    tx.query("select set_config('app.current_user_id', $1, true)", [tenant.ownerUserId]),
    tx.query("select set_config('lock_timeout', '3000', true), set_config('statement_timeout', '5000', true)"),
    tx.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`investment_plans:${tenant.ownerUserId}`]),
    tx.query("delete from investment_plans where owner_user_id = $1::uuid and id = $2::uuid returning id", [tenant.ownerUserId, id]),
  ], { isolationLevel: "ReadCommitted" });
  return rows.length === 1;
}

const SAVE_PLAN_SQL = `
with existing as materialized (
  select input_json, engine_version from investment_plans where owner_user_id = $1::uuid and id = $2::uuid
), inserted as (
  insert into investment_plans(owner_user_id, id, input_json, engine_version)
  select $1::uuid, $2::uuid, $3::jsonb, $4::varchar
  where investment_plan_tenant_active() and not exists(select 1 from existing)
    and (select count(*) from investment_plans where owner_user_id = $1::uuid) < 50
  returning id
)
select case
  when not investment_plan_tenant_active() then 'inactive'
  when exists(select 1 from inserted) then 'created'
  when exists(select 1 from existing where input_json = $3::jsonb and engine_version = $4::varchar) then 'existing'
  when exists(select 1 from existing) then 'conflict'
  else 'limit' end as status`;
