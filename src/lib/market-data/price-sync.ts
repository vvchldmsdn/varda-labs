import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { assets, marketDataSyncRuns } from "@/db/schema";
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
const SKELETON_MARKET_DATA_WRITES_ENABLED = false;

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
  requestedCount: number;
  assetCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  plannedWrites: PlannedWrite[];
  contract: (typeof PRICE_SYNC_CONTRACT)[PriceSyncMode];
  warnings: string[];
};

type PlannedWrite = {
  table: string;
  operation: string;
  count: number;
  active: boolean;
};

type SyncableAssetRow = {
  id: string;
  name: string;
  ticker: string | null;
  assetType: string | null;
  market: string;
  currency: string;
};

type RunCounts = {
  successCount: number;
  failedCount: number;
  skippedCount: number;
};

export function isPriceSyncMode(value: string | null): value is PriceSyncMode {
  return value === "live" || value === "close";
}

export async function runMarketPriceSync(options: {
  mode: PriceSyncMode;
  dryRun?: boolean;
  provider?: MarketDataProvider;
}): Promise<PriceSyncRunResult> {
  const provider = options.provider ?? createStubMarketDataProvider();
  const dryRun = options.dryRun ?? true;
  const startedAt = new Date();

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
        provider: provider.name,
        phase: "started",
      },
    })
    .returning({ id: marketDataSyncRuns.id });

  try {
    const assetRows = await getSyncableAssetRows();
    const priceTargets = buildPriceLookupTargets(assetRows);
    const plannedWrites = buildPlannedWrites(
      options.mode,
      dryRun,
      assetRows.length,
      priceTargets.length,
    );
    const providerResult = dryRun
      ? buildDryRunProviderResult(options.mode, provider.name, priceTargets, startedAt)
      : await fetchProviderRows(provider, options.mode, priceTargets, startedAt);
    const counts = countProviderRows(providerResult.rows);
    const warnings = [
      ...providerResult.warnings,
      ...buildSkeletonWarnings(dryRun),
    ];
    const finishedAt = new Date();

    const result: PriceSyncRunResult = {
      runId: run.id,
      status: "completed",
      mode: options.mode,
      dryRun,
      provider: provider.name,
      requestedCount: priceTargets.length,
      assetCount: assetRows.length,
      successCount: counts.successCount,
      failedCount: counts.failedCount,
      skippedCount: counts.skippedCount,
      plannedWrites,
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
          provider: provider.name,
          mode: options.mode,
          assetCount: assetRows.length,
          priceTargetCount: priceTargets.length,
          plannedWrites,
          contract: PRICE_SYNC_CONTRACT[options.mode],
          marketDataWritesEnabled: SKELETON_MARKET_DATA_WRITES_ENABLED,
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
          provider: provider.name,
          mode: options.mode,
          marketDataWritesEnabled: SKELETON_MARKET_DATA_WRITES_ENABLED,
          error: safeError,
        },
      })
      .where(eq(marketDataSyncRuns.id, run.id));

    throw new PriceSyncError(safeError, run.id);
  }
}

async function getSyncableAssetRows(): Promise<SyncableAssetRow[]> {
  const rows = await db
    .select({
      id: assets.id,
      name: assets.name,
      ticker: assets.ticker,
      assetType: assets.assetType,
      market: assets.market,
      currency: assets.currency,
    })
    .from(assets)
    .orderBy(assets.market, assets.ticker, assets.name);

  return rows.filter((asset) => {
    const ticker = normalizeTicker(asset.ticker);
    const assetType = normalizeText(asset.assetType) ?? "etf";
    return ticker !== null && INVESTMENT_ASSET_TYPES.has(assetType);
  });
}

function buildPriceLookupTargets(rows: SyncableAssetRow[]): PriceLookupTarget[] {
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
      continue;
    }

    targetsByKey.set(key, {
      key,
      ticker,
      market,
      currency,
      assetIds: [row.id],
      assetNames: [row.name],
    });
  }

  return Array.from(targetsByKey.values()).sort((left, right) =>
    left.key.localeCompare(right.key),
  );
}

function buildPlannedWrites(
  mode: PriceSyncMode,
  dryRun: boolean,
  assetCount: number,
  priceTargetCount: number,
): PlannedWrite[] {
  const active = !dryRun && SKELETON_MARKET_DATA_WRITES_ENABLED;

  if (mode === "live") {
    return [
      {
        table: "assets",
        operation: "update_current_price_and_price_metadata",
        count: assetCount,
        active,
      },
    ];
  }

  return [
    {
      table: "asset_price_snapshots",
      operation: "upsert_close_price_by_ticker_date",
      count: priceTargetCount,
      active,
    },
  ];
}

async function fetchProviderRows(
  provider: MarketDataProvider,
  mode: PriceSyncMode,
  targets: PriceLookupTarget[],
  requestedAt: Date,
): Promise<ProviderResult<LiveQuote | ClosePrice>> {
  if (mode === "live") {
    return provider.fetchLiveQuotes(targets, {
      mode,
      dryRun: false,
      requestedAt,
    });
  }

  return provider.fetchClosePrices(targets, {
    mode,
    dryRun: false,
    requestedAt,
  });
}

function buildDryRunProviderResult(
  mode: PriceSyncMode,
  providerName: string,
  targets: PriceLookupTarget[],
  requestedAt: Date,
): ProviderResult<LiveQuote | ClosePrice> {
  return {
    provider: providerName,
    fetchedAt: requestedAt,
    rows: targets.map((target) =>
      mode === "live"
        ? {
            ticker: target.ticker,
            market: target.market,
            currency: target.currency,
            price: null,
            priceAsOf: null,
            fetchedAt: requestedAt,
            source: providerName,
            quoteType: "live" as const,
            status: "skipped" as const,
            error: "dry_run",
          }
        : {
            ticker: target.ticker,
            market: target.market,
            currency: target.currency,
            priceDate: requestedAt.toISOString().slice(0, 10),
            closePrice: null,
            adjustedClosePrice: null,
            closePriceKrw: null,
            fxRate: null,
            fetchedAt: requestedAt,
            source: providerName,
            quoteType: "close" as const,
            status: "skipped" as const,
            error: "dry_run",
          },
    ),
    warnings: ["dry run: no provider fetch and no market data write"],
  };
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

function buildSkeletonWarnings(dryRun: boolean): string[] {
  const warnings = [
    "skeleton mode: external providers, asset updates, and snapshot upserts are not enabled yet",
  ];

  if (!dryRun) {
    warnings.push(
      "dryRun=false was accepted, but market data writes remain disabled in this skeleton",
    );
  }

  return warnings;
}

function summarizeTargets(targets: PriceLookupTarget[]) {
  const markets = new Map<string, number>();
  const currencies = new Map<string, number>();

  for (const target of targets) {
    markets.set(target.market, (markets.get(target.market) ?? 0) + 1);
    currencies.set(target.currency, (currencies.get(target.currency) ?? 0) + 1);
  }

  return {
    markets: Object.fromEntries(markets),
    currencies: Object.fromEntries(currencies),
    sample: targets.slice(0, 5).map((target) => ({
      ticker: target.ticker,
      market: target.market,
      currency: target.currency,
      assetCount: target.assetIds.length,
    })),
  };
}

function normalizeText(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function normalizeTicker(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
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
