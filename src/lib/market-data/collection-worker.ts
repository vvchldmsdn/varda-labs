import "server-only";
import { after } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { fxRates, livePriceQuotes } from "@/db/schema";
import { claimMarketCollection, finishMarketCollection, getMarketCollectionSummary, hasReadyMarketCollection, maintainMarketCollection, type ClaimedCollectionJob } from "@/lib/market-data/collection-queue";
import { MARKET_COLLECTION_POLICY, collectionRetrySeconds, isProviderCollectionDeferred } from "@/lib/market-data/collection-policy";
import { KisRefreshLeaseBusyError, withKisCollectionLease } from "@/lib/market-data/kis-refresh-lease";
import { runMarketPriceSync } from "@/lib/market-data/price-sync";
import { runKisHistoryCacheSync } from "@/lib/market-data/kis-history-cache-sync";
import { createKisMarketDataProvider, createKisProviderRequestSession, fetchKisUsdKrwFxCandidate, getKisProviderPolicy } from "@/lib/market-data/providers/kis";
import { runUsdKrwFxCandidateJob } from "@/lib/market-data/fx-refresh-job";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";
import { withKisCollectionDeadline } from "@/lib/market-data/provider-budget";
import { revalidateLatestClose } from "@/lib/market-data/latest-close-revalidation";
import { resumeConfiguredTwelveDataService } from "@/lib/market-data/twelve-data-service";
import { syncMissingRawCloses } from './close-gap-sync';
import type { CollectionPartition } from './collection-queue';

/** Durable queue owns the work. A terminated after callback is recoverable. */
export function scheduleMarketCollection(before?:()=>Promise<unknown>) {
  after(async () => {
    if(before)await before().catch(()=>undefined);
    // Each partition resumes even if the other is idle, disabled, cooling down, or fails.
    await Promise.allSettled([drainMarketCollection(), resumeConfiguredTwelveDataService()]);
  });
}

export async function drainMarketCollection(options: {partition?:CollectionPartition;budgetMs?:number;maximumJobs?:number}={}) {
  const partition=options.partition??{provider:'kis' as const};
  const budgetMs=Math.max(0,Math.min(120000,options.budgetMs??MARKET_COLLECTION_POLICY.workerBudgetMs));
  let processed = 0, failed = 0, cacheHits = 0;
  await maintainMarketCollection(partition);
  if (!await hasReadyMarketCollection(partition)) return { processed, failed, cacheHits, status: "idle" as const };
  if (!getKisProviderPolicy().configured) return { processed, failed, cacheHits, status: "provider_unavailable" as const };
  try {
    await withKisCollectionLease(() => withKisCollectionDeadline(async () => {
      const deadline = Date.now() + budgetMs;
      const session = createKisProviderRequestSession();
      const provider = createKisMarketDataProvider(session);
      while (processed < Math.min(40,options.maximumJobs??MARKET_COLLECTION_POLICY.maximumWorkerJobs) && Date.now() < deadline) {
        // Give interactive quotes/FX the first turns, then offer history a turn.
        // The queue falls back immediately when a preferred lane has no ready work.
        // Provider failures/deadlines still stop this wake; this is not a quota guarantee.
        const preferredLane = partition.provider === "kis" && !partition.historyOnly && !partition.rawCloses
          ? processed % (MARKET_COLLECTION_POLICY.quoteClaimsBeforeHistory + 1) === MARKET_COLLECTION_POLICY.quoteClaimsBeforeHistory ? "history" : "quotes"
          : "all";
        const job = await claimMarketCollection(partition, preferredLane);
        if (!job) break;
        let terminal = false, failureCode = "provider_unavailable";
        let ok = false, cacheHit = false, deferred = false, retryAfterSeconds = collectionRetrySeconds(job.attempts);
        try {
          if (job.kind === "live") {
            cacheHit = await liveCacheIsFresh(job);
            if (cacheHit) ok = true;
            else {
              const result = await runMarketPriceSync({ mode: "live", dryRun: false, provider, targetLimit: 1,
                explicitTargets: [{ ticker: job.ticker, market: job.market, currency: job.currency }] });
              ok = result.successCount === 1 && result.failedCount === 0;
            }
            if (ok) await revalidateLatestClose({ target: job, provider });
          } else if(job.kind==='history'&&job.key.startsWith('kis:history:raw_close_v1:')){
            const result=await syncMissingRawCloses(job,provider);
            ok=result.complete;failureCode='raw_close_still_missing';
            if(!ok&&result.pendingFinalizationCount){deferred=true;failureCode='history_finalization_pending';retryAfterSeconds=900;}
          } else if (job.kind === "history" && job.startDate && job.endDate) {
            if (!job.key.startsWith("kis:history:paired_v1:")) throw new Error("history_policy_changed");
            const result = await runKisHistoryCacheSync({ targets: [{ key: job.key, ticker: job.ticker,
              market: job.market, currency: job.currency, accounts: [], assetIds: [], assetNames: [] }],
              startDate: job.startDate, endDate: job.endDate, provider,
              pairedClaim: job.key.startsWith("kis:history:paired_v1:") ? job : undefined });
            ok = result.failedCount === 0 && result.fetchedRowCount > 0;
            if (result.conflictCount > result.retryableRevisionCount) {
              terminal = true; failureCode = "paired_history_protected_v2";
            } else if(result.retryableRevisionCount>0 || result.pendingFinalizationCount>0) {
              ok=false;deferred=true;failureCode="history_finalization_pending";retryAfterSeconds=900;
            }
          } else if (job.kind === "fx") {
            const now = new Date();
            cacheHit = await fxCacheIsFresh();
            if (cacheHit) ok = true;
            else {
              const candidate = await fetchKisUsdKrwFxCandidate({ target: { ticker: job.ticker, exchange: null },
                fetchedAt: now, rateDate: resolveSnapshotCycle(now).snapshotDate, session });
              // A successful recheck refreshes cache freshness even if the rate
              // is unchanged; the writer preserves provider-time semantics and CAS.
              const result = await runUsdKrwFxCandidateJob({ candidate, dryRun: false, acceptExistingVardaRow: true, refreshUnchangedReceipt: true });
              ok = result.ok;
            }
          }
        } catch (error) {
          ok = false;
          deferred = isProviderCollectionDeferred(error);
          if(typeof error==="object"&&error!==null&&"code" in error&&error.code==="provider_history_pending")failureCode="history_finalization_pending";
          const wait = typeof error === "object" && error !== null && "retryAfterSeconds" in error ? Number(error.retryAfterSeconds) : 0;
          if (Number.isFinite(wait) && wait > 0) retryAfterSeconds = Math.max(retryAfterSeconds, Math.min(3600, Math.ceil(wait)));
        }
        await finishMarketCollection(job, { ok, deferred, terminal, code: ok ? cacheHit ? "cache_fresh" : "collected" : deferred && failureCode!=="history_finalization_pending" ? "provider_budget_wait" : failureCode, retryAfterSeconds: ok ? 0 : retryAfterSeconds });
        processed++; if (!ok) failed++; if (cacheHit) cacheHits++;
        // One failed provider operation yields instead of probing every queued symbol.
        if (!ok && failureCode!=="history_finalization_pending") break;
      }
    },budgetMs));
  } catch (error) {
    if (!(error instanceof KisRefreshLeaseBusyError)) throw error;
    return { processed, failed, cacheHits, status: "busy" as const };
  }
  return { processed, failed, cacheHits, status: "completed" as const, queue: await getMarketCollectionSummary() };
}

async function liveCacheIsFresh(job: ClaimedCollectionJob) {
  const now = Date.now();
  const rows = await db.select({ id: livePriceQuotes.id }).from(livePriceQuotes).where(and(
    eq(livePriceQuotes.provider, "kis"), eq(livePriceQuotes.market, job.market), eq(livePriceQuotes.currency, job.currency),
    eq(livePriceQuotes.ticker, job.ticker), eq(livePriceQuotes.status, "ok"), sql`${livePriceQuotes.price} > 0`,
    gte(livePriceQuotes.fetchedAt, new Date(now - 300_000)), sql`${livePriceQuotes.fetchedAt} <= ${new Date(now + 60_000)}`,
  )).limit(1);
  return rows.length === 1;
}

async function fxCacheIsFresh() {
  const now = Date.now();
  const rows = await db.select({ id: fxRates.id }).from(fxRates).where(and(
    eq(fxRates.isSample, false), eq(fxRates.status, "ok"), sql`${fxRates.usdKrw} > 0`,
    gte(fxRates.fetchedAt, new Date(now - 300_000)), sql`${fxRates.fetchedAt} <= ${new Date(now + 60_000)}`,
  )).limit(1);
  return rows.length === 1;
}
