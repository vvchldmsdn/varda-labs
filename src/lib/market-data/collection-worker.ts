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

/** Durable queue owns the work. A terminated after callback is recoverable. */
export function scheduleMarketCollection() {
  after(async () => {
    try { await drainMarketCollection(); } catch { /* Durable pending/expired claims survive a server interruption. */ }
  });
}

export async function drainMarketCollection() {
  let processed = 0, failed = 0, cacheHits = 0;
  if (!await hasReadyMarketCollection()) return { processed, failed, cacheHits, status: "idle" as const };
  if (!getKisProviderPolicy().configured) return { processed, failed, cacheHits, status: "provider_unavailable" as const };
  try {
    await withKisCollectionLease(() => withKisCollectionDeadline(async () => {
      await maintainMarketCollection();
      const deadline = Date.now() + MARKET_COLLECTION_POLICY.workerBudgetMs;
      const session = createKisProviderRequestSession();
      const provider = createKisMarketDataProvider(session);
      while (processed < MARKET_COLLECTION_POLICY.maximumWorkerJobs && Date.now() < deadline) {
        const job = await claimMarketCollection();
        if (!job) break;
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
          } else if (job.kind === "history" && job.startDate && job.endDate) {
            const result = await runKisHistoryCacheSync({ targets: [{ key: job.key, ticker: job.ticker,
              market: job.market, currency: job.currency, accounts: [], assetIds: [], assetNames: [] }],
              startDate: job.startDate, endDate: job.endDate, provider });
            ok = result.failedCount === 0 && result.fetchedRowCount > 0;
          } else if (job.kind === "fx") {
            const now = new Date();
            cacheHit = await fxCacheIsFresh();
            if (cacheHit) ok = true;
            else {
              const candidate = await fetchKisUsdKrwFxCandidate({ target: { ticker: job.ticker, exchange: null },
                fetchedAt: now, rateDate: resolveSnapshotCycle(now).snapshotDate, session });
              const result = await runUsdKrwFxCandidateJob({ candidate, dryRun: false, acceptExistingVardaRow: true });
              ok = result.ok;
            }
          }
        } catch (error) {
          ok = false;
          deferred = isProviderCollectionDeferred(error);
          const wait = typeof error === "object" && error !== null && "retryAfterSeconds" in error ? Number(error.retryAfterSeconds) : 0;
          if (Number.isFinite(wait) && wait > 0) retryAfterSeconds = Math.max(retryAfterSeconds, Math.min(3600, Math.ceil(wait)));
        }
        await finishMarketCollection(job, { ok, deferred, code: ok ? cacheHit ? "cache_fresh" : "collected" : deferred ? "provider_budget_wait" : "provider_unavailable", retryAfterSeconds: ok ? 0 : retryAfterSeconds });
        processed++; if (!ok) failed++; if (cacheHit) cacheHits++;
        // One failed provider operation yields fairly instead of probing every queued symbol.
        if (!ok) break;
      }
    }));
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
