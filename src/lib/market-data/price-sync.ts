import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  assets,
  livePriceQuotes,
  marketDataSyncRuns,
} from "@/db/schema";
import {
  applyAssetPriceSnapshotRows,
  emptyAssetPriceSnapshotWriteSummary,
  getAssetPriceSnapshotWritePolicy,
} from "@/lib/market-data/asset-price-snapshot-repository";
import {
  LIVE_PRICE_WRITE_CONTRACT,
  planLiveAssetPriceWrite,
} from "@/lib/market-data/live-price-write";
import { createStubMarketDataProvider } from "@/lib/market-data/providers/stub";
import { safeErrorMessage } from "@/lib/redaction";
import type {
  AssetPriceSnapshotWritePolicy,
  AssetPriceSnapshotWriteResult,
} from "@/lib/market-data/asset-price-snapshot-repository";
import type {
  LivePriceWritePolicy,
  LivePriceWriteResult,
} from "@/lib/market-data/live-price-write";
import type {
  ClosePrice,
  LiveQuote,
  MarketDataProvider,
  PriceLookupTarget,
  PriceSyncMode,
  ProviderResult,
} from "@/lib/market-data/providers/types";

const INVESTMENT_ASSET_TYPES = new Set(["etf", "stock", "pension", "commodity"]);
const DEFAULT_KIS_JOB_COOLDOWN_SECONDS = 90;

export const PRICE_SYNC_CONTRACT = {
  live: {
    updates: [...LIVE_PRICE_WRITE_CONTRACT.updates],
    inserts: [...LIVE_PRICE_WRITE_CONTRACT.inserts],
    snapshotWrites: LIVE_PRICE_WRITE_CONTRACT.snapshotWrites,
    notes: [
      "upserts user-neutral live quote cache only after guarded actual write",
      "live mode must not update user asset rows",
      "live mode must not write asset_price_snapshots",
    ],
  },
  close: {
    updates: [
      "asset_price_snapshots upsert by market/currency/ticker/date",
    ],
    inserts: ["asset_price_snapshots"],
    snapshotWrites: true,
    notes: [
      "close writes use exact market/currency/ticker/date identity",
      "raw close evidence must not be copied into adjusted_close_price",
      "future implementation may update ma_120 and days_above_ma after close history is fresh",
      "whether close mode updates assets.current_price remains an explicit option, not default skeleton behavior",
    ],
  },
} as const;

export type PriceSyncRunResult = {
  runId: string;
  status: "completed" | "failed";
  mode: PriceSyncMode;
  dryRun: boolean;
  provider: string;
  fixture: boolean;
  priceDate: string;
  requestedCount: number;
  assetCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  insertedCount: number;
  updatedCount: number;
  conflictCount: number;
  targetFilterSummary: PriceSyncTargetFilterSummary;
  targetFilterResults: PriceSyncTargetFilterResult[];
  plannedWrites: PlannedWrite[];
  writeSummary: MarketDataWriteResultSummary;
  writeResults: MarketDataWriteResult[];
  contract: (typeof PRICE_SYNC_CONTRACT)[PriceSyncMode];
  warnings: string[];
};

export type PriceSyncCooldownStatus = {
  active: boolean;
  provider: string;
  mode: PriceSyncMode;
  cooldownSeconds: number;
  retryAfterSeconds: number;
  lastRunId: string | null;
  lastRunStatus: string | null;
  lastRunStartedAt: string | null;
  lastRunFinishedAt: string | null;
};

export type PriceSyncTargetMarket = "korea" | "us";
export type PriceSyncTargetAccount = "brokerage" | "isa" | "irp";

export type PriceSyncTargetFilter = {
  tickers?: string[];
  market?: PriceSyncTargetMarket;
  account?: PriceSyncTargetAccount;
};

export type PriceSyncTargetFilterResult = {
  ticker: string;
  action: "included" | "skipped";
  reason?:
    | "ticker_not_in_asset_universe"
    | "ticker_not_syncable"
    | "ticker_filtered_out"
    | "ticker_limit_excluded";
};

export type PriceSyncTargetFilterSummary = {
  requestedTickers: string[] | null;
  requestedTickerCount: number;
  market: PriceSyncTargetMarket | null;
  account: PriceSyncTargetAccount | null;
  totalSyncableAssetCount: number;
  totalPriceTargetCount: number;
  filteredAssetCount: number;
  filteredPriceTargetCount: number;
  limitedPriceTargetCount: number;
};

type PlannedWrite = {
  table: string;
  operation: string;
  count: number;
  active: boolean;
};

type PriceSyncAssetRow = {
  id: string;
  name: string;
  ticker: string | null;
  assetType: string | null;
  market: string;
  currency: string;
  account: string;
};

type RunCounts = {
  successCount: number;
  failedCount: number;
  skippedCount: number;
};

type MarketDataWriteResult =
  | AssetPriceSnapshotWriteResult
  | LivePriceWriteResult;

type LivePriceWriteSummary = {
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  conflictCount: number;
  results: LivePriceWriteResult[];
};

type MarketDataWriteResultSummary = {
  actions: Record<string, number>;
  sources: Record<string, number>;
  reasons: Record<string, number>;
  existingSources: Record<string, number>;
  sample: MarketDataWriteResult[];
};

export function isPriceSyncMode(value: string | null): value is PriceSyncMode {
  return value === "live" || value === "close";
}

export async function getKisPriceSyncCooldownStatus(
  mode: PriceSyncMode,
  now = new Date(),
): Promise<PriceSyncCooldownStatus> {
  const cooldownSeconds = getKisJobCooldownSeconds();
  const [lastRun] = await db
    .select({
      id: marketDataSyncRuns.id,
      status: marketDataSyncRuns.status,
      startedAt: marketDataSyncRuns.startedAt,
      finishedAt: marketDataSyncRuns.finishedAt,
    })
    .from(marketDataSyncRuns)
    .where(
      and(
        eq(marketDataSyncRuns.jobType, "asset_price_sync"),
        eq(marketDataSyncRuns.source, "kis"),
        eq(marketDataSyncRuns.mode, mode),
      ),
    )
    .orderBy(desc(marketDataSyncRuns.startedAt))
    .limit(1);

  if (!lastRun || cooldownSeconds <= 0) {
    return {
      active: false,
      provider: "kis",
      mode,
      cooldownSeconds,
      retryAfterSeconds: 0,
      lastRunId: lastRun?.id ?? null,
      lastRunStatus: lastRun?.status ?? null,
      lastRunStartedAt: toIsoString(lastRun?.startedAt),
      lastRunFinishedAt: toIsoString(lastRun?.finishedAt),
    };
  }

  const lastActivityAt = lastRun.finishedAt ?? lastRun.startedAt;
  const elapsedMs = Math.max(0, now.getTime() - lastActivityAt.getTime());
  const retryAfterSeconds = Math.max(
    0,
    Math.ceil((cooldownSeconds * 1000 - elapsedMs) / 1000),
  );

  return {
    active: retryAfterSeconds > 0,
    provider: "kis",
    mode,
    cooldownSeconds,
    retryAfterSeconds,
    lastRunId: lastRun.id,
    lastRunStatus: lastRun.status,
    lastRunStartedAt: toIsoString(lastRun.startedAt),
    lastRunFinishedAt: toIsoString(lastRun.finishedAt),
  };
}

export async function runMarketPriceSync(options: {
  mode: PriceSyncMode;
  dryRun?: boolean;
  fixture?: boolean;
  priceDate?: string;
  provider?: MarketDataProvider;
  targetLimit?: number;
  targetFilter?: PriceSyncTargetFilter;
}): Promise<PriceSyncRunResult> {
  const provider = options.provider ?? createStubMarketDataProvider();
  const dryRun = options.dryRun ?? true;
  const fixture = options.fixture ?? false;
  const priceDate = options.priceDate ?? toDateKey(new Date());
  const startedAt = new Date();
  const closeWritePolicy = getAssetPriceSnapshotWritePolicy(
    provider.name,
    fixture,
  );
  const liveWritePolicy = getLivePriceWritePolicy(provider.name);
  const closeWriteEnabled = !dryRun && closeWritePolicy !== "none";
  const liveWriteEnabled = !dryRun && liveWritePolicy !== "none";
  const targetFilter = normalizeTargetFilter(options.targetFilter);
  const assetRows = await getAssetRowsForPriceSync();
  const syncableAssetRows = assetRows.filter(isSyncableAssetRow);
  const totalPriceTargets = buildPriceLookupTargets(syncableAssetRows);
  const filteredAssetRows = applyTargetFilter(syncableAssetRows, targetFilter);
  const filteredPriceTargets = orderPriceTargetsByFilter(
    buildPriceLookupTargets(filteredAssetRows),
    targetFilter,
  );
  const priceTargets =
    options.targetLimit === undefined
      ? filteredPriceTargets
      : filteredPriceTargets.slice(0, options.targetLimit);
  const targetFilterResults = buildTargetFilterResults({
    targetFilter,
    allAssetRows: assetRows,
    syncableAssetRows,
    filteredPriceTargets,
    priceTargets,
  });
  const targetFilterSummary = summarizeTargetFilter({
    targetFilter,
    totalSyncableAssetCount: syncableAssetRows.length,
    totalPriceTargetCount: totalPriceTargets.length,
    filteredAssetCount: filteredAssetRows.length,
    filteredPriceTargetCount: filteredPriceTargets.length,
    limitedPriceTargetCount: priceTargets.length,
  });

  if (
    !dryRun &&
    options.mode === "close" &&
    closeWriteEnabled &&
    priceTargets.length === 0
  ) {
    throw new PriceSyncRequestError(
      "no_write_targets",
      "KIS close writes require at least one selected write target",
      {
        targetFilterSummary,
        targetFilterResults,
      },
    );
  }

  if (
    !dryRun &&
    options.mode === "live" &&
    liveWriteEnabled &&
    priceTargets.length === 0
  ) {
    throw new PriceSyncRequestError(
      "no_write_targets",
      "KIS live writes require at least one selected write target",
      {
        targetFilterSummary,
        targetFilterResults,
      },
    );
  }

  const [run] = await db
    .insert(marketDataSyncRuns)
    .values({
      jobType: "asset_price_sync",
      mode: options.mode,
      status: "running",
      startedAt,
      source: provider.name,
      requestedCount: 0,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      metadataJson: {
        dryRun,
        fixture,
        priceDate,
        provider: provider.name,
        phase: "started",
        targetFilter: targetFilterSummary,
      },
    })
    .returning({ id: marketDataSyncRuns.id });

  try {
    const plannedWrites = buildPlannedWrites(
      options.mode,
      dryRun,
      closeWritePolicy,
      liveWritePolicy,
      priceTargets.length,
    );
    const providerResult = dryRun
      ? await buildDryRunProviderResult({
          mode: options.mode,
          provider,
          targets: priceTargets,
          requestedAt: startedAt,
          fixture,
          priceDate,
        })
      : await fetchProviderRows(
          provider,
          options.mode,
          priceTargets,
          startedAt,
          fixture,
          priceDate,
        );
    const counts = countProviderRows(providerResult.rows);
    const closeWriteSummary =
      options.mode === "close"
        ? await applyAssetPriceSnapshotRows({
            rows: providerResult.rows as ClosePrice[],
            targets: priceTargets,
            dryRun,
            writePolicy: closeWritePolicy,
            allowWrite: closeWriteEnabled,
          })
        : emptyAssetPriceSnapshotWriteSummary();
    const liveWriteSummary =
      options.mode === "live"
        ? await applyLivePriceRows({
            rows: providerResult.rows as LiveQuote[],
            targets: priceTargets,
            dryRun,
            provider: provider.name,
            writePolicy: liveWritePolicy,
            allowWrite: liveWriteEnabled,
          })
        : emptyLivePriceWriteSummary();
    const warnings = uniqueWarnings([
      ...providerResult.warnings,
      ...buildTargetFilterWarnings(targetFilterSummary, targetFilterResults),
      ...buildSkeletonWarnings({
        mode: options.mode,
        dryRun,
        fixture,
        closeWritePolicy,
        liveWritePolicy,
        closeWriteEnabled,
        liveWriteEnabled,
      }),
    ]);
    const writeResults: MarketDataWriteResult[] =
      options.mode === "live" ? liveWriteSummary.results : closeWriteSummary.results;
    const writeSummary = summarizeWriteResults(writeResults);
    const finishedAt = new Date();

    const result: PriceSyncRunResult = {
      runId: run.id,
      status: "completed",
      mode: options.mode,
      dryRun,
      provider: provider.name,
      fixture,
      priceDate,
      requestedCount: priceTargets.length,
      assetCount: syncableAssetRows.length,
      successCount: counts.successCount,
      failedCount:
        counts.failedCount +
        closeWriteSummary.failedCount +
        liveWriteSummary.failedCount,
      skippedCount:
        counts.skippedCount +
        closeWriteSummary.skippedCount +
        liveWriteSummary.skippedCount,
      insertedCount: closeWriteSummary.insertedCount + liveWriteSummary.insertedCount,
      updatedCount: closeWriteSummary.updatedCount + liveWriteSummary.updatedCount,
      conflictCount: closeWriteSummary.conflictCount + liveWriteSummary.conflictCount,
      targetFilterSummary,
      targetFilterResults,
      plannedWrites,
      writeSummary,
      writeResults,
      contract: PRICE_SYNC_CONTRACT[options.mode],
      warnings,
    };

    await db
      .update(marketDataSyncRuns)
      .set({
        status: result.status,
        finishedAt,
        requestedCount: result.requestedCount,
        successCount: result.successCount,
        failedCount: result.failedCount,
        skippedCount: result.skippedCount,
        metadataJson: {
          dryRun,
          fixture,
          priceDate,
          provider: provider.name,
          mode: options.mode,
          assetCount: syncableAssetRows.length,
          priceTargetCount: priceTargets.length,
          totalPriceTargetCount: totalPriceTargets.length,
          filteredPriceTargetCount: filteredPriceTargets.length,
          targetLimit: options.targetLimit ?? null,
          targetFilter: targetFilterSummary,
          targetFilterResults: summarizeTargetFilterResults(targetFilterResults),
          insertedCount: result.insertedCount,
          updatedCount: result.updatedCount,
          conflictCount: result.conflictCount,
          plannedWrites,
          writeSummary,
          contract: PRICE_SYNC_CONTRACT[options.mode],
          marketDataWritesEnabled:
            options.mode === "close" ? closeWriteEnabled : liveWriteEnabled,
          writePolicy:
            options.mode === "close" ? closeWritePolicy : liveWritePolicy,
          targetSummary: summarizeTargets(priceTargets),
          warnings,
        },
      })
      .where(eq(marketDataSyncRuns.id, run.id));

    return result;
  } catch (error) {
    const finishedAt = new Date();
    const safeError = safeErrorMessage(error, "Unknown price sync error");

    await db
      .update(marketDataSyncRuns)
      .set({
        status: "failed",
        finishedAt,
        error: safeError,
        metadataJson: {
          dryRun,
          fixture,
          priceDate,
          provider: provider.name,
          mode: options.mode,
          marketDataWritesEnabled:
            options.mode === "close" ? closeWriteEnabled : liveWriteEnabled,
          writePolicy:
            options.mode === "close" ? closeWritePolicy : liveWritePolicy,
          error: safeError,
          targetFilter: targetFilterSummary,
          targetFilterResults: summarizeTargetFilterResults(targetFilterResults),
          targetSummary: summarizeTargets(priceTargets),
        },
      })
      .where(eq(marketDataSyncRuns.id, run.id));

    throw new PriceSyncError(safeError, run.id);
  }
}

async function getAssetRowsForPriceSync(): Promise<PriceSyncAssetRow[]> {
  const rows = await db
    .select({
      id: assets.id,
      name: assets.name,
      ticker: assets.ticker,
      assetType: assets.assetType,
      market: assets.market,
      currency: assets.currency,
      account: assets.account,
    })
    .from(assets)
    .orderBy(assets.market, assets.ticker, assets.name);

  return rows;
}

function isSyncableAssetRow(row: PriceSyncAssetRow) {
  const ticker = normalizeTicker(row.ticker);
  const assetType = normalizeText(row.assetType) ?? "etf";
  return ticker !== null && INVESTMENT_ASSET_TYPES.has(assetType);
}

function buildPriceLookupTargets(rows: PriceSyncAssetRow[]): PriceLookupTarget[] {
  const targetsByKey = new Map<string, PriceLookupTarget>();

  for (const row of rows) {
    const ticker = normalizeTicker(row.ticker);
    if (!ticker) continue;

    const market = normalizeText(row.market) ?? "unknown";
    const currency = normalizeText(row.currency) ?? "unknown";
    const key = `${market}:${ticker}:${currency}`;
    const existing = targetsByKey.get(key);

    if (existing) {
      existing.assetIds.push(row.id);
      existing.assetNames.push(row.name);
      existing.accounts.push(normalizeText(row.account) ?? "unknown");
      continue;
    }

    targetsByKey.set(key, {
      key,
      ticker,
      market,
      currency,
      accounts: [normalizeText(row.account) ?? "unknown"],
      assetIds: [row.id],
      assetNames: [row.name],
    });
  }

  return Array.from(targetsByKey.values()).sort((left, right) =>
    left.key.localeCompare(right.key),
  );
}

function normalizeTargetFilter(
  filter: PriceSyncTargetFilter | undefined,
): PriceSyncTargetFilter {
  const tickers = filter?.tickers
    ?.map((ticker) => normalizeTicker(ticker))
    .filter((ticker): ticker is string => ticker !== null);

  return {
    tickers: tickers && tickers.length > 0 ? [...new Set(tickers)] : undefined,
    market: filter?.market,
    account: filter?.account,
  };
}

function applyTargetFilter(
  rows: PriceSyncAssetRow[],
  filter: PriceSyncTargetFilter,
) {
  const tickerSet = filter.tickers ? new Set(filter.tickers) : null;

  return rows.filter((row) => {
    const ticker = normalizeTicker(row.ticker);
    const market = normalizeText(row.market);
    const account = normalizeText(row.account);

    if (!ticker) return false;
    if (tickerSet && !tickerSet.has(ticker)) return false;
    if (filter.market && market !== filter.market) return false;
    if (filter.account && account !== filter.account) return false;

    return true;
  });
}

function buildTargetFilterResults(options: {
  targetFilter: PriceSyncTargetFilter;
  allAssetRows: PriceSyncAssetRow[];
  syncableAssetRows: PriceSyncAssetRow[];
  filteredPriceTargets: PriceLookupTarget[];
  priceTargets: PriceLookupTarget[];
}): PriceSyncTargetFilterResult[] {
  if (!options.targetFilter.tickers) return [];

  const allTickers = new Set(
    options.allAssetRows
      .map((row) => normalizeTicker(row.ticker))
      .filter((ticker): ticker is string => ticker !== null),
  );
  const syncableTickers = new Set(
    options.syncableAssetRows
      .map((row) => normalizeTicker(row.ticker))
      .filter((ticker): ticker is string => ticker !== null),
  );
  const filteredTargetTickers = new Set(
    options.filteredPriceTargets.map((target) => target.ticker),
  );
  const limitedTargetTickers = new Set(
    options.priceTargets.map((target) => target.ticker),
  );

  return options.targetFilter.tickers.map((ticker) => {
    if (!allTickers.has(ticker)) {
      return {
        ticker,
        action: "skipped" as const,
        reason: "ticker_not_in_asset_universe" as const,
      };
    }

    if (!syncableTickers.has(ticker)) {
      return {
        ticker,
        action: "skipped" as const,
        reason: "ticker_not_syncable" as const,
      };
    }

    if (!filteredTargetTickers.has(ticker)) {
      return {
        ticker,
        action: "skipped" as const,
        reason: "ticker_filtered_out" as const,
      };
    }

    if (!limitedTargetTickers.has(ticker)) {
      return {
        ticker,
        action: "skipped" as const,
        reason: "ticker_limit_excluded" as const,
      };
    }

    return { ticker, action: "included" as const };
  });
}

function summarizeTargetFilter(options: {
  targetFilter: PriceSyncTargetFilter;
  totalSyncableAssetCount: number;
  totalPriceTargetCount: number;
  filteredAssetCount: number;
  filteredPriceTargetCount: number;
  limitedPriceTargetCount: number;
}): PriceSyncTargetFilterSummary {
  return {
    requestedTickers: options.targetFilter.tickers ?? null,
    requestedTickerCount: options.targetFilter.tickers?.length ?? 0,
    market: options.targetFilter.market ?? null,
    account: options.targetFilter.account ?? null,
    totalSyncableAssetCount: options.totalSyncableAssetCount,
    totalPriceTargetCount: options.totalPriceTargetCount,
    filteredAssetCount: options.filteredAssetCount,
    filteredPriceTargetCount: options.filteredPriceTargetCount,
    limitedPriceTargetCount: options.limitedPriceTargetCount,
  };
}

function orderPriceTargetsByFilter(
  targets: PriceLookupTarget[],
  targetFilter: PriceSyncTargetFilter,
) {
  if (!targetFilter.tickers) return targets;

  const tickerOrder = new Map(
    targetFilter.tickers.map((ticker, index) => [ticker, index] as const),
  );

  return [...targets].sort((left, right) => {
    const leftIndex = tickerOrder.get(left.ticker) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = tickerOrder.get(right.ticker) ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return left.key.localeCompare(right.key);
  });
}

function buildPlannedWrites(
  mode: PriceSyncMode,
  dryRun: boolean,
  closeWritePolicy: AssetPriceSnapshotWritePolicy,
  liveWritePolicy: LivePriceWritePolicy,
  priceTargetCount: number,
): PlannedWrite[] {
  if (mode === "live") {
    return [
      {
        table: "live_price_quotes",
        operation: "upsert_live_quote_by_market_ticker_provider",
        count: priceTargetCount,
        active: !dryRun && liveWritePolicy !== "none",
      },
    ];
  }

  return [
    {
      table: "asset_price_snapshots",
      operation: "upsert_close_price_by_market_currency_ticker_date",
      count: priceTargetCount,
      active: !dryRun && closeWritePolicy !== "none",
    },
  ];
}

async function fetchProviderRows(
  provider: MarketDataProvider,
  mode: PriceSyncMode,
  targets: PriceLookupTarget[],
  requestedAt: Date,
  fixture: boolean,
  priceDate: string,
): Promise<ProviderResult<LiveQuote | ClosePrice>> {
  if (mode === "live") {
    return provider.fetchLiveQuotes(targets, {
      mode,
      dryRun: false,
      requestedAt,
      fixture: false,
      priceDate,
    });
  }

  return provider.fetchClosePrices(targets, {
    mode,
    dryRun: false,
    requestedAt,
    fixture,
    priceDate,
  });
}

async function buildDryRunProviderResult(options: {
  mode: PriceSyncMode,
  provider: MarketDataProvider,
  targets: PriceLookupTarget[],
  requestedAt: Date,
  fixture: boolean,
  priceDate: string,
}): Promise<ProviderResult<LiveQuote | ClosePrice>> {
  if (options.targets.length === 0) {
    return {
      provider: options.provider.name,
      fetchedAt: options.requestedAt,
      rows: [],
      warnings: ["target filters matched no syncable price targets"],
    };
  }

  if (options.mode === "close" && (options.fixture || options.provider.name === "kis")) {
    return options.provider.fetchClosePrices(options.targets, {
      mode: options.mode,
      dryRun: true,
      requestedAt: options.requestedAt,
      fixture: true,
      priceDate: options.priceDate,
    });
  }

  return {
    provider: options.provider.name,
    fetchedAt: options.requestedAt,
    rows: options.targets.map((target) =>
      options.mode === "live"
        ? {
            ticker: target.ticker,
            market: target.market,
            currency: target.currency,
            price: null,
            priceAsOf: null,
            fetchedAt: options.requestedAt,
            source: options.provider.name,
            quoteType: "live" as const,
            status: "skipped" as const,
            error: "dry_run",
          }
        : {
            ticker: target.ticker,
            market: target.market,
            currency: target.currency,
            priceDate: options.priceDate,
            closePrice: null,
            adjustedClosePrice: null,
            adjustedCloseBasis: null,
            adjustedCloseProvider: null,
            adjustedCloseSource: null,
            adjustedCloseFetchedAt: null,
            closePriceKrw: null,
            fxRate: null,
            providerSymbol: target.ticker,
            providerExchange: null,
            fetchedAt: options.requestedAt,
            source: options.provider.name,
            quoteType: "close" as const,
            status: "skipped" as const,
            isSample: true,
            error: "dry_run",
          },
    ),
    warnings: ["dry run: no provider fetch and no market data write"],
  };
}

async function applyLivePriceRows(options: {
  rows: LiveQuote[];
  targets: PriceLookupTarget[];
  dryRun: boolean;
  provider: string;
  writePolicy: LivePriceWritePolicy;
  allowWrite: boolean;
}): Promise<LivePriceWriteSummary> {
  const targetByKey = new Map(
    options.targets.map((target) => [target.key, target] as const),
  );
  const summary = emptyLivePriceWriteSummary();

  for (const row of options.rows) {
    const target = targetByKey.get(toTargetKey(row));
    const planned = planLiveAssetPriceWrite({
        row,
        target,
        provider: options.provider,
        dryRun: options.dryRun,
        allowWrite: options.allowWrite,
        writePolicy: options.writePolicy,
      });
    let result = planned.result;

    if (planned.write && result.action === "updated") {
      const existing = await findExistingLivePriceQuote(
        planned.write.market,
        planned.write.ticker,
        planned.write.provider,
      );
      const returned = await db
        .insert(livePriceQuotes)
        .values({
          ticker: planned.write.ticker,
          market: planned.write.market,
          currency: planned.write.currency,
          provider: planned.write.provider,
          source: planned.write.source,
          quoteType: planned.write.priceQuoteType,
          status: planned.write.priceStatus,
          error: planned.write.priceError,
          price: planned.write.price,
          priceAsOf: planned.write.priceAsOf,
          fetchedAt: planned.write.fetchedAt,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            livePriceQuotes.market,
            livePriceQuotes.ticker,
            livePriceQuotes.provider,
          ],
          set: {
            currency: sql`excluded.currency`,
            source: sql`excluded.source`,
            quoteType: sql`excluded.quote_type`,
            status: sql`excluded.status`,
            error: sql`excluded.error`,
            price: sql`excluded.price`,
            priceAsOf: sql`excluded.price_as_of`,
            fetchedAt: sql`excluded.fetched_at`,
            updatedAt: new Date(),
          },
        })
        .returning({ id: livePriceQuotes.id });

      result = {
        ...result,
        quoteCount: returned.length,
        action:
          returned.length === 0 ? "skipped" : existing ? "updated" : "inserted",
        reason: returned.length > 0 ? undefined : "quote_row_not_written",
      };
    }

    summary.results.push(result);

    if (result.action === "inserted") summary.insertedCount += result.quoteCount;
    if (result.action === "updated") summary.updatedCount += result.quoteCount;
    if (result.action === "failed") summary.failedCount += 1;
    if (result.action === "skipped") summary.skippedCount += 1;
  }

  return summary;
}

async function findExistingLivePriceQuote(
  market: string,
  ticker: string,
  provider: string,
) {
  const [existing] = await db
    .select({ id: livePriceQuotes.id })
    .from(livePriceQuotes)
    .where(
      and(
        eq(livePriceQuotes.market, market),
        eq(livePriceQuotes.ticker, ticker),
        eq(livePriceQuotes.provider, provider),
      ),
    )
    .limit(1);

  return existing ?? null;
}

function getLivePriceWritePolicy(providerName: string): LivePriceWritePolicy {
  if (providerName === "kis") return "kis";
  return "none";
}

function emptyLivePriceWriteSummary(): LivePriceWriteSummary {
  return {
    insertedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    conflictCount: 0,
    results: [],
  };
}

function summarizeWriteResults(results: MarketDataWriteResult[]) {
  const actions = new Map<string, number>();
  const sources = new Map<string, number>();
  const reasons = new Map<string, number>();
  const existingSources = new Map<string, number>();

  for (const result of results) {
    actions.set(result.action, (actions.get(result.action) ?? 0) + 1);
    const sourceKey = result.source ?? "null";
    sources.set(sourceKey, (sources.get(sourceKey) ?? 0) + 1);
    if (result.reason) {
      reasons.set(result.reason, (reasons.get(result.reason) ?? 0) + 1);
    }
    if ("existingSource" in result && result.existingSource !== undefined) {
      existingSources.set(
        result.existingSource ?? "null",
        (existingSources.get(result.existingSource ?? "null") ?? 0) + 1,
      );
    }
  }

  return {
    actions: Object.fromEntries(actions),
    sources: Object.fromEntries(sources),
    reasons: Object.fromEntries(reasons),
    existingSources: Object.fromEntries(existingSources),
    sample: results.slice(0, 10),
  };
}

function summarizeTargetFilterResults(results: PriceSyncTargetFilterResult[]) {
  const actions = new Map<string, number>();
  const reasons = new Map<string, number>();

  for (const result of results) {
    actions.set(result.action, (actions.get(result.action) ?? 0) + 1);
    if (result.reason) {
      reasons.set(result.reason, (reasons.get(result.reason) ?? 0) + 1);
    }
  }

  return {
    actions: Object.fromEntries(actions),
    reasons: Object.fromEntries(reasons),
    sample: results.slice(0, 25),
  };
}

function toTargetKey(
  row: Pick<LiveQuote | ClosePrice, "market" | "ticker" | "currency">,
) {
  const market = normalizeText(row.market) ?? "unknown";
  const ticker = normalizeTicker(row.ticker) ?? "";
  const currency = normalizeText(row.currency) ?? "unknown";
  return `${market}:${ticker}:${currency}`;
}

function countProviderRows(rows: Array<LiveQuote | ClosePrice>): RunCounts {
  return rows.reduce<RunCounts>(
    (counts, row) => {
      if (row.status === "ok") {
        counts.successCount += 1;
      } else if (row.status === "error") {
        counts.failedCount += 1;
      } else {
        counts.skippedCount += 1;
      }
      return counts;
    },
    { successCount: 0, failedCount: 0, skippedCount: 0 },
  );
}

function buildSkeletonWarnings(options: {
  mode: PriceSyncMode;
  dryRun: boolean;
  fixture: boolean;
  closeWritePolicy: AssetPriceSnapshotWritePolicy;
  liveWritePolicy: LivePriceWritePolicy;
  closeWriteEnabled: boolean;
  liveWriteEnabled: boolean;
}): string[] {
  const warnings: string[] = [];

  if (options.mode === "live" && options.dryRun) {
    warnings.push(
      "live price run is dry-run only; no live_price_quotes rows were written",
    );
  } else if (
    options.mode === "live" &&
    !options.dryRun &&
    options.liveWritePolicy === "kis" &&
    options.liveWriteEnabled
  ) {
    warnings.push(
      "kis live rows may upsert live_price_quotes only; user asset rows are not updated",
    );
  } else if (options.mode === "live" && !options.dryRun) {
    warnings.push(
      "dryRun=false was accepted, but this provider has no live asset write path enabled",
    );
  } else if (options.mode === "close" && options.dryRun) {
    warnings.push(
      "close price run is dry-run only; no asset_price_snapshots rows were written",
    );
  } else if (
    options.mode === "close" &&
    !options.dryRun &&
    options.fixture
  ) {
    warnings.push(
      "fixture close rows may write to asset_price_snapshots; source is stub_fixture and imported/non-stub rows are protected",
    );
  } else if (
    options.mode === "close" &&
    !options.dryRun &&
    options.closeWritePolicy === "kis" &&
    options.closeWriteEnabled
  ) {
    warnings.push(
      "kis close rows may write to asset_price_snapshots; assets.current_price is not updated",
    );
  } else if (!options.dryRun) {
    warnings.push(
      "dryRun=false was accepted, but this mode has no market data write path enabled yet",
    );
  }

  return warnings;
}

function buildTargetFilterWarnings(
  summary: PriceSyncTargetFilterSummary,
  results: PriceSyncTargetFilterResult[],
) {
  const warnings: string[] = [];

  if (summary.filteredPriceTargetCount === 0) {
    warnings.push("target filters matched no syncable price targets");
  }

  if (results.some((result) => result.action === "skipped")) {
    warnings.push("some requested tickers were not selected by target filters");
  }

  return warnings;
}

function uniqueWarnings(warnings: string[]) {
  return [...new Set(warnings)];
}

function summarizeTargets(targets: PriceLookupTarget[]) {
  const markets = new Map<string, number>();
  const currencies = new Map<string, number>();
  const accounts = new Map<string, number>();

  for (const target of targets) {
    markets.set(target.market, (markets.get(target.market) ?? 0) + 1);
    currencies.set(target.currency, (currencies.get(target.currency) ?? 0) + 1);
    for (const account of new Set(target.accounts)) {
      accounts.set(account, (accounts.get(account) ?? 0) + 1);
    }
  }

  return {
    markets: Object.fromEntries(markets),
    currencies: Object.fromEntries(currencies),
    accounts: Object.fromEntries(accounts),
    sample: targets.slice(0, 5).map((target) => ({
      ticker: target.ticker,
      market: target.market,
      currency: target.currency,
      accounts: [...new Set(target.accounts)],
      assetCount: target.assetIds.length,
    })),
  };
}

function normalizeText(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function normalizeTicker(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized ? normalized : null;
}

function toDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function getKisJobCooldownSeconds() {
  const configured = Number(process.env.KIS_JOB_COOLDOWN_SECONDS);
  if (Number.isFinite(configured) && configured >= 0) return Math.floor(configured);
  return DEFAULT_KIS_JOB_COOLDOWN_SECONDS;
}

function toIsoString(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

export class PriceSyncError extends Error {
  constructor(
    message: string,
    readonly runId: string,
  ) {
    super(message);
    this.name = "PriceSyncError";
  }
}

export class PriceSyncRequestError extends Error {
  readonly statusCode: number;

  constructor(
    readonly code: string,
    message: string,
    readonly details: unknown,
    statusCode = 400,
  ) {
    super(message);
    this.name = "PriceSyncRequestError";
    this.statusCode = statusCode;
  }
}
