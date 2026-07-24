import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { marketDataSyncRuns } from "@/db/schema";
import { applyAssetPriceSnapshotRows } from "@/lib/market-data/asset-price-snapshot-repository";
import { safeErrorMessage } from "@/lib/redaction";
import type {
  HistoricalPriceFailure,
  MarketDataProvider,
  PriceLookupTarget,
} from "@/lib/market-data/providers/types";

export const KIS_HISTORY_CACHE_SYNC_POLICY = Object.freeze({
  version: "kis_raw_history_cache_sync_v1",
  jobType: "asset_price_history_sync",
  mode: "history",
  provider: "kis",
  priceBasis: "raw_price_return",
  targetTable: "asset_price_snapshots",
  identity: "market_currency_ticker_date",
  partialEvidence: "write_valid_rows_and_report_failed_windows",
  adjustedCloseMutation: "forbidden",
  userOwnership: "shared_reference_no_owner_column",
} as const);

export type KisHistoryCacheSyncResult = {
  runId: string;
  status: "completed";
  provider: "kis";
  dryRun: false;
  startDate: string;
  endDate: string;
  targetCount: number;
  requestCount: number;
  fetchedRowCount: number;
  providerFailureCount: number;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  conflictCount: number;
  warnings: string[];
  failures: HistoricalPriceFailure[];
  policy: typeof KIS_HISTORY_CACHE_SYNC_POLICY;
};

export class KisHistoryCacheSyncError extends Error {
  constructor(
    message: string,
    readonly runId: string,
  ) {
    super(message);
    this.name = "KisHistoryCacheSyncError";
  }
}

export async function runKisHistoryCacheSync(options: {
  targets: PriceLookupTarget[];
  startDate: string;
  endDate: string;
  provider: MarketDataProvider;
}): Promise<KisHistoryCacheSyncResult> {
  if (
    options.provider.name !== KIS_HISTORY_CACHE_SYNC_POLICY.provider ||
    !options.provider.fetchHistoricalClosePrices
  ) {
    throw new Error("KIS historical cache sync requires the KIS provider");
  }

  const startedAt = new Date();
  const [run] = await db
    .insert(marketDataSyncRuns)
    .values({
      jobType: KIS_HISTORY_CACHE_SYNC_POLICY.jobType,
      mode: KIS_HISTORY_CACHE_SYNC_POLICY.mode,
      status: "running",
      startedAt,
      source: KIS_HISTORY_CACHE_SYNC_POLICY.provider,
      requestedCount: options.targets.length,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      metadataJson: {
        policy: KIS_HISTORY_CACHE_SYNC_POLICY.version,
        startDate: options.startDate,
        endDate: options.endDate,
        targets: options.targets.map((target) => ({
          market: target.market,
          currency: target.currency,
          ticker: target.ticker,
        })),
        phase: "started",
      },
    })
    .returning({ id: marketDataSyncRuns.id });

  try {
    const providerResult =
      await options.provider.fetchHistoricalClosePrices(options.targets, {
        dryRun: false,
        requestedAt: startedAt,
        startDate: options.startDate,
        endDate: options.endDate,
      });

    if (providerResult.priceBasis !== KIS_HISTORY_CACHE_SYNC_POLICY.priceBasis) {
      throw new Error("KIS history returned an unsupported price basis");
    }
    if (providerResult.rows.length === 0) {
      throw new Error("KIS history returned no cacheable rows");
    }

    const writeSummary = await applyAssetPriceSnapshotRows({
      rows: [...providerResult.rows],
      targets: options.targets,
      dryRun: false,
      writePolicy: "kis",
      allowWrite: true,
    });
    const failedCount =
      providerResult.failures.length + writeSummary.failedCount;
    const finishedAt = new Date();

    await db
      .update(marketDataSyncRuns)
      .set({
        status: "completed",
        finishedAt,
        requestedCount: providerResult.rows.length,
        successCount:
          writeSummary.insertedCount +
          writeSummary.updatedCount +
          writeSummary.skippedCount,
        failedCount,
        skippedCount: writeSummary.skippedCount,
        metadataJson: {
          policy: KIS_HISTORY_CACHE_SYNC_POLICY.version,
          startDate: options.startDate,
          endDate: options.endDate,
          targetCount: options.targets.length,
          requestCount: providerResult.requestCount,
          fetchedRowCount: providerResult.rows.length,
          providerFailureCount: providerResult.failures.length,
          priceBasis: providerResult.priceBasis,
          insertedCount: writeSummary.insertedCount,
          updatedCount: writeSummary.updatedCount,
          skippedCount: writeSummary.skippedCount,
          failedCount,
          conflictCount: writeSummary.conflictCount,
          failureCodes: countFailureCodes(providerResult.failures),
          writeReasons: countWriteReasons(writeSummary.results),
          phase: "completed",
        },
      })
      .where(eq(marketDataSyncRuns.id, run.id));

    return {
      runId: run.id,
      status: "completed",
      provider: "kis",
      dryRun: false,
      startDate: options.startDate,
      endDate: options.endDate,
      targetCount: options.targets.length,
      requestCount: providerResult.requestCount,
      fetchedRowCount: providerResult.rows.length,
      providerFailureCount: providerResult.failures.length,
      insertedCount: writeSummary.insertedCount,
      updatedCount: writeSummary.updatedCount,
      skippedCount: writeSummary.skippedCount,
      failedCount,
      conflictCount: writeSummary.conflictCount,
      warnings: [...providerResult.warnings],
      failures: [...providerResult.failures],
      policy: KIS_HISTORY_CACHE_SYNC_POLICY,
    };
  } catch (error) {
    const message = safeErrorMessage(
      error,
      "Unknown KIS history cache sync error",
    );
    await db
      .update(marketDataSyncRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        failedCount: 1,
        error: message,
        metadataJson: {
          policy: KIS_HISTORY_CACHE_SYNC_POLICY.version,
          startDate: options.startDate,
          endDate: options.endDate,
          targetCount: options.targets.length,
          phase: "failed",
        },
      })
      .where(eq(marketDataSyncRuns.id, run.id));
    throw new KisHistoryCacheSyncError(message, run.id);
  }
}

function countFailureCodes(failures: readonly HistoricalPriceFailure[]) {
  const counts = new Map<string, number>();
  for (const failure of failures) {
    counts.set(failure.code, (counts.get(failure.code) ?? 0) + 1);
  }
  return Object.fromEntries(counts);
}

function countWriteReasons(
  results: readonly {
    reason?: string;
  }[],
) {
  const counts = new Map<string, number>();
  for (const result of results) {
    if (!result.reason) continue;
    counts.set(result.reason, (counts.get(result.reason) ?? 0) + 1);
  }
  return Object.fromEntries(counts);
}
