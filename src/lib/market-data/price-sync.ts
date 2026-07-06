import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { assetPriceSnapshots, assets, marketDataSyncRuns } from "@/db/schema";
import { createStubMarketDataProvider } from "@/lib/market-data/providers/stub";
import type {
  ClosePrice,
  LiveQuote,
  MarketDataProvider,
  PriceLookupTarget,
  PriceSyncMode,
  ProviderResult,
} from "@/lib/market-data/providers/types";

const INVESTMENT_ASSET_TYPES = new Set(["etf", "stock", "pension", "commodity"]);
const LIVE_MARKET_DATA_WRITES_ENABLED = false;
const DEFAULT_KIS_JOB_COOLDOWN_SECONDS = 90;
const DEFAULT_KIS_VALUE_CONFLICT_THRESHOLD_PCT = 3;

export const PRICE_SYNC_CONTRACT = {
  live: {
    updates: ["assets.current_price", "assets.price_* metadata"],
    inserts: [],
    snapshotWrites: false,
    notes: [
      "future implementation updates current asset prices and live price lineage",
      "future implementation must not write asset_price_snapshots in live mode",
    ],
  },
  close: {
    updates: ["asset_price_snapshots upsert by ticker/date"],
    inserts: ["asset_price_snapshots"],
    snapshotWrites: true,
    notes: [
      "future implementation uses asset_price_snapshots(ticker,date) unique key",
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
  writeResults: ClosePriceWriteResult[];
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

type ClosePriceWriteAction =
  | "planned_insert"
  | "planned_update"
  | "planned_skip"
  | "inserted"
  | "updated"
  | "skipped"
  | "failed"
  | "conflict";

type ClosePriceWritePolicy = "none" | "stub_fixture" | "kis";

type ClosePriceWriteResult = {
  ticker: string;
  priceDate: string;
  source: string | null;
  action: ClosePriceWriteAction;
  reason?: string;
  existingSource?: string | null;
};

type ClosePriceWriteSummary = {
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  conflictCount: number;
  results: ClosePriceWriteResult[];
};

type AssetPriceSnapshotRow = typeof assetPriceSnapshots.$inferSelect;

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
  const writePolicy = getClosePriceWritePolicy(provider.name, fixture);
  const closeWriteEnabled = !dryRun && writePolicy !== "none";
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
      writePolicy,
      syncableAssetRows.length,
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
        ? await applyClosePriceRows({
            rows: providerResult.rows as ClosePrice[],
            targets: priceTargets,
            dryRun,
            fixture,
            writePolicy,
            allowWrite: closeWriteEnabled,
          })
        : emptyClosePriceWriteSummary();
    const warnings = [
      ...providerResult.warnings,
      ...buildTargetFilterWarnings(targetFilterSummary, targetFilterResults),
      ...buildSkeletonWarnings({
        mode: options.mode,
        dryRun,
        fixture,
        writePolicy,
        closeWriteEnabled,
      }),
    ];
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
      failedCount: counts.failedCount + closeWriteSummary.failedCount,
      skippedCount: counts.skippedCount + closeWriteSummary.skippedCount,
      insertedCount: closeWriteSummary.insertedCount,
      updatedCount: closeWriteSummary.updatedCount,
      conflictCount: closeWriteSummary.conflictCount,
      targetFilterSummary,
      targetFilterResults,
      plannedWrites,
      writeResults: closeWriteSummary.results,
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
          writeResults: summarizeWriteResults(result.writeResults),
          contract: PRICE_SYNC_CONTRACT[options.mode],
          marketDataWritesEnabled:
            options.mode === "close" && closeWriteEnabled,
          writePolicy,
          targetSummary: summarizeTargets(priceTargets),
          warnings,
        },
      })
      .where(eq(marketDataSyncRuns.id, run.id));

    return result;
  } catch (error) {
    const finishedAt = new Date();
    const safeError = toSafeErrorMessage(error);

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
            options.mode === "close" && closeWriteEnabled,
          writePolicy,
          error: safeError,
          targetFilter: targetFilterSummary,
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
  writePolicy: ClosePriceWritePolicy,
  assetCount: number,
  priceTargetCount: number,
): PlannedWrite[] {
  if (mode === "live") {
    return [
      {
        table: "assets",
        operation: "update_current_price_and_price_metadata",
        count: assetCount,
        active: !dryRun && LIVE_MARKET_DATA_WRITES_ENABLED,
      },
    ];
  }

  return [
    {
      table: "asset_price_snapshots",
      operation: "upsert_close_price_by_ticker_date",
      count: priceTargetCount,
      active: !dryRun && writePolicy !== "none",
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
            closePriceKrw: null,
            fxRate: null,
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

async function applyClosePriceRows(options: {
  rows: ClosePrice[];
  targets: PriceLookupTarget[];
  dryRun: boolean;
  fixture: boolean;
  writePolicy: ClosePriceWritePolicy;
  allowWrite: boolean;
}): Promise<ClosePriceWriteSummary> {
  const targetByKey = new Map(
    options.targets.map((target) => [target.key, target] as const),
  );
  const summary = emptyClosePriceWriteSummary();

  for (const row of options.rows) {
    const target = targetByKey.get(toTargetKey(row));
    const result = await planOrApplyClosePriceRow({
      row,
      target,
      dryRun: options.dryRun,
      fixture: options.fixture,
      writePolicy: options.writePolicy,
      allowWrite: options.allowWrite,
    });

    summary.results.push(result);

    if (result.action === "inserted") summary.insertedCount += 1;
    if (result.action === "updated") summary.updatedCount += 1;
    if (result.action === "failed") summary.failedCount += 1;
    if (result.action === "conflict") {
      summary.conflictCount += 1;
      summary.skippedCount += 1;
    }
    if (
      result.action === "skipped" ||
      result.action === "planned_skip"
    ) {
      summary.skippedCount += 1;
    }
  }

  return summary;
}

async function planOrApplyClosePriceRow(options: {
  row: ClosePrice;
  target: PriceLookupTarget | undefined;
  dryRun: boolean;
  fixture: boolean;
  writePolicy: ClosePriceWritePolicy;
  allowWrite: boolean;
}): Promise<ClosePriceWriteResult> {
  const rowKey = {
    ticker: options.row.ticker,
    priceDate: options.row.priceDate,
    source: options.row.source,
  };
  const validationError = validateClosePriceRow(
    options.row,
    options.target,
    options.writePolicy,
  );

  if (validationError) {
    return {
      ...rowKey,
      action: options.row.status === "error" ? "failed" : "skipped",
      reason: validationError,
    };
  }

  const snapshot = toSnapshotInsert(options.row, options.target);
  const existing = await findExistingAssetPriceSnapshot(
    snapshot.ticker,
    snapshot.priceDate,
  );
  const protectedReason = getProtectedExistingReason(
    existing,
    snapshot,
    options.writePolicy,
  );

  if (protectedReason) {
    return {
      ...rowKey,
      action: protectedReason.startsWith("value_conflict")
        ? "conflict"
        : options.dryRun
          ? "planned_skip"
          : "skipped",
      reason: protectedReason,
      existingSource: existing?.source ?? null,
    };
  }

  if (existing && snapshotMatches(existing, snapshot)) {
    return {
      ...rowKey,
      action: options.dryRun ? "planned_skip" : "skipped",
      reason: "unchanged",
      existingSource: existing.source,
    };
  }

  if (options.dryRun) {
    return {
      ...rowKey,
      action: existing ? "planned_update" : "planned_insert",
      existingSource: existing?.source ?? null,
    };
  }

  if (!options.allowWrite || options.writePolicy === "none") {
    return {
      ...rowKey,
      action: "skipped",
      reason: "write_guard_not_satisfied",
      existingSource: existing?.source ?? null,
    };
  }

  const returned = await db
    .insert(assetPriceSnapshots)
    .values(snapshot)
    .onConflictDoUpdate({
      target: [assetPriceSnapshots.ticker, assetPriceSnapshots.priceDate],
      set: {
        assetId: sql`excluded.asset_id`,
        market: sql`excluded.market`,
        currency: sql`excluded.currency`,
        closePrice: sql`excluded.close_price`,
        adjustedClosePrice: sql`excluded.adjusted_close_price`,
        closePriceKrw: sql`excluded.close_price_krw`,
        fxRate: sql`excluded.fx_rate`,
        source: sql`excluded.source`,
        isSample: sql`excluded.is_sample`,
        updatedAt: new Date(),
      },
      setWhere: getClosePriceUpsertSetWhere(snapshot, options.writePolicy),
    })
    .returning({ id: assetPriceSnapshots.id });

  if (returned.length === 0) {
    return {
      ...rowKey,
      action: "skipped",
      reason: "write_guard_not_satisfied_after_conflict_check",
      existingSource: existing?.source ?? null,
    };
  }

  return {
    ...rowKey,
    action: existing ? "updated" : "inserted",
    existingSource: existing?.source ?? null,
  };
}

function validateClosePriceRow(
  row: ClosePrice,
  target: PriceLookupTarget | undefined,
  writePolicy: ClosePriceWritePolicy,
) {
  if (row.status !== "ok") return row.error ?? `provider_status_${row.status}`;
  if (!target) return "target_not_found";
  if (!isDateKey(row.priceDate)) return "invalid_price_date";
  if (!isDecimalString(row.closePrice)) return "invalid_close_price";
  if (!isDecimalString(row.adjustedClosePrice)) {
    return "invalid_adjusted_close_price";
  }
  if (row.closePriceKrw !== null && !isDecimalString(row.closePriceKrw)) {
    return "invalid_close_price_krw";
  }
  if (row.fxRate !== null && !isDecimalString(row.fxRate)) return "invalid_fx_rate";
  if (!isAllowedClosePriceSource(row.source, writePolicy)) {
    return "unsupported_write_source";
  }
  return null;
}

function toSnapshotInsert(
  row: ClosePrice,
  target: PriceLookupTarget | undefined,
) {
  const closePrice = row.closePrice ?? "0";

  return {
    legacyBase44Id: null,
    priceDate: row.priceDate,
    ticker: row.ticker,
    assetId: target?.assetIds[0] ?? null,
    market: row.market,
    currency: row.currency,
    closePrice,
    adjustedClosePrice: row.adjustedClosePrice ?? closePrice,
    closePriceKrw: row.closePriceKrw,
    fxRate: row.fxRate,
    source: row.source,
    isSample: row.isSample ?? true,
    base44CreatedAt: null,
    base44UpdatedAt: null,
  };
}

async function findExistingAssetPriceSnapshot(ticker: string, priceDate: string) {
  const [existing] = await db
    .select()
    .from(assetPriceSnapshots)
    .where(
      and(
        eq(assetPriceSnapshots.ticker, ticker),
        eq(assetPriceSnapshots.priceDate, priceDate),
      ),
    )
    .limit(1);

  return existing ?? null;
}

function getProtectedExistingReason(
  existing: AssetPriceSnapshotRow | null,
  incoming: ReturnType<typeof toSnapshotInsert>,
  writePolicy: ClosePriceWritePolicy,
) {
  if (!existing) return null;

  if (writePolicy === "stub_fixture") {
    if (incoming.source !== "stub_fixture") return "unsupported_write_source";
    if (existing.source !== "stub_fixture") return "protected_existing_source";
    return null;
  }

  if (writePolicy === "kis") {
    if (!isKisClosePriceSource(incoming.source)) return "unsupported_write_source";
    if (isKisClosePriceSource(existing.source)) return null;

    const conflictReason = getKisValueConflictReason(existing, incoming);
    if (conflictReason) return conflictReason;

    return null;
  }

  return "write_policy_disabled";
}

function getClosePriceUpsertSetWhere(
  snapshot: ReturnType<typeof toSnapshotInsert>,
  writePolicy: ClosePriceWritePolicy,
) {
  if (writePolicy === "stub_fixture") {
    return sql`${assetPriceSnapshots.source} = ${snapshot.source}`;
  }

  if (writePolicy === "kis") {
    const threshold = getKisValueConflictThresholdFraction();
    return sql`
      ${assetPriceSnapshots.source} like 'kis_%'
      or (
        abs(${assetPriceSnapshots.closePrice} - excluded.close_price)
        / greatest(abs(${assetPriceSnapshots.closePrice}), 1)
      ) <= ${threshold}
    `;
  }

  return sql`false`;
}

function getClosePriceWritePolicy(
  providerName: string,
  fixture: boolean,
): ClosePriceWritePolicy {
  if (providerName === "kis") return "kis";
  if (fixture) return "stub_fixture";
  return "none";
}

function isAllowedClosePriceSource(
  source: string | null,
  writePolicy: ClosePriceWritePolicy,
) {
  if (writePolicy === "stub_fixture") return source === "stub_fixture";
  if (writePolicy === "kis") return isKisClosePriceSource(source);
  return false;
}

function isKisClosePriceSource(source: string | null) {
  return (
    source === "kis_domestic_itemchartprice" ||
    /^kis_overseas_dailyprice:[A-Z]+$/.test(source ?? "")
  );
}

function getKisValueConflictReason(
  existing: AssetPriceSnapshotRow,
  incoming: ReturnType<typeof toSnapshotInsert>,
) {
  const existingClose = Number(existing.closePrice);
  const incomingClose = Number(incoming.closePrice);

  if (!Number.isFinite(existingClose) || !Number.isFinite(incomingClose)) {
    return "value_conflict_invalid_decimal";
  }

  const thresholdPct = getKisValueConflictThresholdPct();
  const relativeDiffPct =
    (Math.abs(existingClose - incomingClose) /
      Math.max(Math.abs(existingClose), 1)) *
    100;

  if (relativeDiffPct <= thresholdPct) return null;

  return `value_conflict:${relativeDiffPct.toFixed(4)}pct_gt_${thresholdPct}pct`;
}

function getKisValueConflictThresholdPct() {
  const configured = Number(process.env.KIS_VALUE_CONFLICT_THRESHOLD_PCT);
  if (Number.isFinite(configured) && configured >= 0) return configured;
  return DEFAULT_KIS_VALUE_CONFLICT_THRESHOLD_PCT;
}

function getKisValueConflictThresholdFraction() {
  return getKisValueConflictThresholdPct() / 100;
}

function snapshotMatches(
  existing: AssetPriceSnapshotRow,
  incoming: ReturnType<typeof toSnapshotInsert>,
) {
  return (
    existing.assetId === incoming.assetId &&
    existing.market === incoming.market &&
    existing.currency === incoming.currency &&
    sameDecimal(existing.closePrice, incoming.closePrice) &&
    sameDecimal(existing.adjustedClosePrice, incoming.adjustedClosePrice) &&
    sameNullableDecimal(existing.closePriceKrw, incoming.closePriceKrw) &&
    sameNullableDecimal(existing.fxRate, incoming.fxRate) &&
    existing.source === incoming.source &&
    existing.isSample === incoming.isSample
  );
}

function emptyClosePriceWriteSummary(): ClosePriceWriteSummary {
  return {
    insertedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    conflictCount: 0,
    results: [],
  };
}

function summarizeWriteResults(results: ClosePriceWriteResult[]) {
  const actions = new Map<string, number>();
  for (const result of results) {
    actions.set(result.action, (actions.get(result.action) ?? 0) + 1);
  }

  return {
    actions: Object.fromEntries(actions),
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

function isDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isDecimalString(value: string | null) {
  if (value === null) return false;
  return Number.isFinite(Number(value));
}

function sameDecimal(left: string, right: string) {
  return Number(left) === Number(right);
}

function sameNullableDecimal(left: string | null, right: string | null) {
  if (left === null || right === null) return left === right;
  return sameDecimal(left, right);
}

function toTargetKey(row: Pick<ClosePrice, "market" | "ticker" | "currency">) {
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
  writePolicy: ClosePriceWritePolicy;
  closeWriteEnabled: boolean;
}): string[] {
  const warnings = ["live asset price updates are not enabled yet"];

  if (options.mode === "close" && options.dryRun) {
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
    options.writePolicy === "kis" &&
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

function toSafeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown price sync error";

  return message
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/(secret|token|api[_-]?key)=([^&\s]+)/gi, "$1=[redacted]")
    .slice(0, 1000);
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
