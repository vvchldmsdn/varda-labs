import "server-only";
import { getReadOnlyTenantPortfolioTargetPolicyModel } from "@/db/queries/portfolio-target-policy";
import type { TargetModel } from "./planning-contract";

type Args = Parameters<typeof getReadOnlyTenantPortfolioTargetPolicyModel>[0];
// Same revision/scope/order contract as tenant-target-policies (737b38f).
// This extra port only runs after session/scope admission and a v2 header.
export const TARGET_PLAN_READ_SQL = `
 select revision.id::text as revision_id, revision.approval_revision, revision.policy_version,
 revision.effective_service_date::text as effective_service_date, revision.universe_hash, revision.vector_hash,
 revision.approved_at::text as approved_at, plan.account_id::text as account_id, plan.plan_row_id::text as plan_row_id,
 plan.asset_name, plan.market, plan.currency, plan.ticker, plan.buyability, plan.target_weight_bps
 from public.portfolio_target_policy_revisions revision
 left join public.portfolio_target_plan_rows plan on plan.approval_revision_id=revision.id
 and plan.canonical_owner_user_id=revision.canonical_owner_user_id
 where revision.canonical_owner_user_id=$1::uuid and revision.scope_kind=$2::varchar
 and revision.scope_account_id is not distinct from $3::uuid
 and revision.scope_portfolio_group_id is not distinct from $4::uuid
 and revision.lifecycle_status='approved'
 order by revision.id,plan.account_id,plan.plan_row_id limit 66
`;
export async function getBetaTargetPolicyModel(args: Args): Promise<TargetModel> {
 const base = await getReadOnlyTenantPortfolioTargetPolicyModel(args);
 // Canonical reader already validates v2 plans, ownership and held/unheld identity.
 // Add presentation-only rows without issuing a second, divergent policy query.
 return {
  ...base,
  ...(base.approvedPolicy.policy?.policyVersion === "portfolio_target_policy_v2" ? { targetPlanRead: "v2_held_identity_v1" as const } : {}),
  plannedTargetRows: base.rows.filter(row => row.heldAssetId === null).map(row => ({
   plannedOnly: true as const, key: JSON.stringify(["plan", row.accountId, row.assetId]),
   account: row.accountCode, market: row.market, currency: row.currency, ticker: row.ticker, name: row.assetName,
   currentValueKrw: 0, currentWeightPct: 0, effectiveTargetPct: base.policyValidation.status === "available" ? row.targetWeightBps / 100 : null,
   driftPct: base.policyValidation.status === "available" ? -row.targetWeightBps / 100 : null,
  })),
 };
}
function text(value:unknown):string { if(typeof value!=="string"||!value.length)throw Error("Invalid target plan read field");return value; }
function integer(value:unknown):number { if(value===null||value==="")throw Error("Invalid target plan integer");const n=Number(value);if(!Number.isSafeInteger(n))throw Error("Invalid target plan integer");return n; }
export function projectTargetPlanRead(raw:readonly Record<string,unknown>[]): TargetModel["approvedPolicy"] {
 if(!raw.length)return {status:"missing",policy:null};
 if(new Set(raw.map(row=>text(row.revision_id))).size!==1||raw.length>64)return {status:"conflict",policy:null};
 const first=raw[0],date=text(first.effective_service_date),approvedAt=new Date(text(first.approved_at));
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(approvedAt.getTime()))throw Error("Invalid target plan date");
 return {status:"available",policy:{approvalRevision:integer(first.approval_revision),policyVersion:text(first.policy_version),
  effectiveServiceDate:date,universeHash:text(first.universe_hash),vectorHash:text(first.vector_hash),approvedAt,
  rows:raw.flatMap(row=>row.account_id===null?[]:[{accountId:text(row.account_id),assetId:text(row.plan_row_id),
   assetName:text(row.asset_name),market:text(row.market),currency:text(row.currency),ticker:row.ticker===null?null:text(row.ticker),
   buyability:text(row.buyability),targetWeightBps:integer(row.target_weight_bps)}])}};
}
