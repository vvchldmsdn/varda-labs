import 'server-only';
import { sqlClient } from '@/db/client';
import { resolveCurrentTenantContext } from '@/lib/auth/current-tenant-context';
import { getReadOnlyTenantHoldingAnalysisPreparationTarget, getReadOnlyTenantHoldingAnalysisDataReadiness } from '@/db/queries/holding-analysis-data-readiness';
import { normalizeCollectionJobs } from '@/lib/market-data/collection-policy';
import { resolveSnapshotCycle } from '@/lib/snapshots/market-calendar';
import { holdingHistoryRequest, collectionProgress } from '@/lib/holding-analysis-collection';
import { parseHoldingAnalysisDataPreparationInput } from '@/lib/holding-analysis-data-readiness';

/** Shared job details are exposed only after admitting this user's active holding. */
export async function readSessionHoldingAnalysisProgress(holdingId: string) {
  const form = new FormData(); form.set('holdingId', holdingId);
  if (!parseHoldingAnalysisDataPreparationInput(form).ok) return null;
  const session = await resolveCurrentTenantContext();
  if (!session.ok) return null;
  try {
    const target = await getReadOnlyTenantHoldingAnalysisPreparationTarget({ tenantContext: session.tenantContext, holdingId });
    if (!target?.ticker) return null;
    const serviceDate = resolveSnapshotCycle(new Date()).snapshotDate;
    const keys = normalizeCollectionJobs([holdingHistoryRequest({ ticker: target.ticker, market: target.market, currency: target.currency }, serviceDate)]).map(job => job.key);
    const [jobs, read] = await Promise.all([
      sqlClient.query('select status, last_code from market_collection_jobs where key = any($1::text[])', [keys]),
      getReadOnlyTenantHoldingAnalysisDataReadiness({ tenantContext: session.tenantContext, serviceDate, holdings: [target] }),
    ]);
    if (read.state !== 'ready' || read.entries.length !== 1) return null;
    return { collection: collectionProgress(jobs.map(job => ['paired_history_conflict', 'paired_history_protected_v2'].includes(String(job.last_code)) ? 'blocked' : String(job.status)), keys.length), readiness: read.entries[0] };
  } catch { return null; }
}
