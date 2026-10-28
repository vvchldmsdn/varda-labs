import "server-only";
import { runTenantReadTransaction } from "@/db/tenant-transaction-context";
import { getPortfolioAnalysisScopeTargets } from "@/db/queries/portfolio-analysis-scope-targets";
import type { getReadOnlyTenantPortfolioTargetPolicyModel } from "@/db/queries/portfolio-target-policy";
import type { TargetPlanSupport } from "./target-plan-model";

// Read-only counterpart of 737b38f's planned-only account/holding/quote admission.
// Bounded to the already admitted owner's exact approved revision. No providers.
export const TARGET_PLAN_SUPPORT_SQL = `
 select plan.plan_row_id::text as plan_row_id, plan.account_id::text as account_id,
 account.code as account_code, account.name as account_name, plan.asset_type,
 exists(select 1 from public.assets held where held.canonical_owner_user_id=$1::uuid
 and held.account_id=plan.account_id and held.archived_at is null
 and (held.quantity>0 or coalesce(held.fractional_krw_value,0)>0)
 and held.market=plan.market and held.currency=plan.currency
 and (held.ticker=plan.ticker or (plan.ticker is null and held.id=coalesce(plan.origin_asset_id,plan.plan_row_id)))) as has_holding,
 quote.price, quote.source as price_source, quote.price_as_of::text as price_as_of,
 quote.fetched_at::text as price_fetched_at
 from public.portfolio_target_plan_rows plan
 inner join public.accounts account on account.id=plan.account_id
 and account.canonical_owner_user_id=$1::uuid and account.is_active=true
 left join lateral (select q.price,q.source,q.price_as_of,q.fetched_at
 from public.live_price_quotes q where q.ticker=plan.ticker and q.market=plan.market
 and q.currency=plan.currency and q.provider='kis' and q.status='ok'
 and q.source like 'kis%' and q.price>0 and q.price_as_of<=q.fetched_at
 and q.fetched_at<=$3::timestamptz order by q.fetched_at desc,q.price_as_of desc limit 1) quote on true
 where plan.canonical_owner_user_id=$1::uuid and plan.approval_revision_id=$2::uuid
 order by plan.account_id,plan.plan_row_id limit 65
`;
export async function readTargetPlanSupport(args: Parameters<typeof getReadOnlyTenantPortfolioTargetPolicyModel>[0], revisionId: string): Promise<TargetPlanSupport> {
 const [scope, [raw]] = await Promise.all([getPortfolioAnalysisScopeTargets(args),
  runTenantReadTransaction(args.tenantContext.ownerUserId, tx => [tx.query(TARGET_PLAN_SUPPORT_SQL,[args.tenantContext.ownerUserId,revisionId,new Date().toISOString()])])]);
 const text=(v:unknown):string=>{if(typeof v!=="string"||!v.length)throw Error("Invalid target support");return v;};
 return {scope,rows:raw.map(r=>{
  if(typeof r.has_holding!=="boolean")throw Error("Invalid holding admission");
  const price=r.price===null?null:Number(r.price);
  if(price!==null&&(!Number.isFinite(price)||price<=0))throw Error("Invalid stored quote");
  return {planRowId:text(r.plan_row_id),accountId:text(r.account_id),accountCode:text(r.account_code),accountName:text(r.account_name),
   assetType:r.asset_type===null?null:text(r.asset_type),hasHolding:r.has_holding,currentPrice:price,
   priceSource:r.price_source===null?null:text(r.price_source),priceAsOf:r.price_as_of===null?null:text(r.price_as_of),
   priceFetchedAt:r.price_fetched_at===null?null:text(r.price_fetched_at)};
 })};
}
