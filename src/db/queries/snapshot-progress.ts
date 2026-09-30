import { holdingsPortfolioSql } from "@/lib/portfolio-presentation-policy";
import "server-only";
import { sqlClient } from "@/db/client";
import { getPortfolioAnalysisScopeTargets } from "@/db/queries/portfolio-analysis-scope-targets";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import type { TenantContext } from "@/lib/session-resolver-contract";
import { summarizeSnapshotProgress } from "@/lib/snapshots/progress";

/** Read status only; never starts a retry or exposes worker error details. */
export async function getOwnedLegacySnapshotProgress(input: {
  tenantContext: TenantContext; scope: PortfolioAnalysisScope; serviceDate: string;
}) {
  const targets = await getPortfolioAnalysisScopeTargets(input);
  const rows = await sqlClient.query(`select case when w.status='running' and (w.lease_until is null or w.lease_until<=clock_timestamp()) then 'failed' else w.status end as status from accounts a
    left join daily_snapshot_work w on w.account_id=a.id and w.canonical_owner_user_id=a.canonical_owner_user_id
      and w.snapshot_date=$2::date and w.stage='legacy' and w.revision=coalesce((select max(marker_sequence) from native_ledger_revisions r where r.account_id=a.id and r.canonical_owner_user_id=a.canonical_owner_user_id and r.affected_at<=($2::date::timestamp AT TIME ZONE 'Asia/Seoul')+interval '7 hours'),0)
    where a.canonical_owner_user_id=$1::uuid and a.is_active and ${holdingsPortfolioSql("a")} and a.account_type<>'cash'
      and ($3::boolean or a.id=any($4::uuid[]) or exists(select 1 from assets h where h.account_id=a.id
        and h.canonical_owner_user_id=$1::uuid and h.id=any($5::uuid[])))
      and exists(select 1 from assets h where h.account_id=a.id and h.canonical_owner_user_id=$1::uuid
        and h.archived_at is null and h.asset_type in ('etf','stock','pension','commodity')
        and (h.quantity>0 or h.fractional_krw_value>0))`,
    [input.tenantContext.ownerUserId, input.serviceDate, targets.includesAllOwnedAccounts,
      [...targets.wholeAccountIds], [...targets.directAssetIds]]);
  return summarizeSnapshotProgress(rows as {status: string | null}[]);
}