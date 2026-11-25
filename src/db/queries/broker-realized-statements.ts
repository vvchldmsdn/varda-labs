import "server-only";
import { runTenantReadTransaction } from "@/db/tenant-transaction-context";
import { projectBrokerRealizedStatement } from "@/lib/broker-realized-statement";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import type { TenantContext } from "@/lib/session-resolver-contract";

export const BROKER_REALIZED_STATEMENTS_SQL = `
  select a.name as account_label, r.start_date::text, r.end_date::text, r.months
  from public.accounts a
  cross join lateral (
    select r.start_date, r.end_date, r.months from public.account_realized_profit_reviews r
    where r.account_id = a.id and r.canonical_owner_user_id = a.canonical_owner_user_id
    order by r.created_at desc, r.evidence_hash desc limit 1
  ) r
  where a.canonical_owner_user_id = $1::uuid and a.is_active and ($2::uuid is null or a.id = $2::uuid)
  order by a.sort_order, a.name, a.id`;

export async function readBrokerRealizedStatements(tenant: TenantContext, scope: PortfolioAnalysisScope) {
  if (scope.kind === "portfolio_group") return [];
  const [rows] = await runTenantReadTransaction(tenant.ownerUserId, tx => [
    tx.query(BROKER_REALIZED_STATEMENTS_SQL, [tenant.ownerUserId, scope.kind === "account" ? scope.accountId : null]),
  ]);
  return rows.map(projectBrokerRealizedStatement).filter(statement => statement !== null);
}
