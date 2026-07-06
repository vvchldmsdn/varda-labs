import "server-only";

import { and, eq, sql } from "drizzle-orm";

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
  plannedWrites: PlannedWrite[];
  writeResults: ClosePriceWriteResult[];
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

type ClosePriceWriteAction =
  | "planned_insert"
  | "planned_update"
  | "planned_skip"
  | "inserted"
  | "updated"
  | "skipped"
  | "failed";

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
  results: ClosePriceWriteResult[];
};

type AssetPriceSnapshotRow = typeof assetPriceSnapshots.$inferSelect;

export function isPriceSyncMode(value: string | null): value is PriceSyncMode {
  return value === "live" || value === "close";
}

export async function runMarketPriceSync(options: {
  mode: PriceSyncMode;
  dryRun?: boolean;
  fixture?: boolean;
  priceDate?: string;
  provider?: MarketDataProvider;
  targetLimit?: number;
}): Promise<PriceSyncRunResult> {
  const provider = options.provider ?? createStubMarketDataProvider();
  const dryRun = options.dryRun ?? true;
  const fixture = options.fixture ?? false;
  const priceDate = options.priceDate ?? toDateKey(new Date());
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
        fixture,
        priceDate,
        provider: provider.name,
        phase: "started",
      },
    })
    .returning({ id: marketDataSyncRuns.id });

  try {
    const assetRows = await getSyncableAssetRows();
    const allPriceTargets = buildPriceLookupTargets(assetRows);
    const priceTargets =
      options.targetLimit === undefined
        ? allPriceTargets
        : allPriceTargets.slice(0, options.targetLimit);
    const plannedWrites = buildPlannedWrites(
      options.mode,
      dryRun,
      fixture,
      assetRows.length,
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
            allowWrite: !dryRun && fixture,
          })
        : emptyClosePriceWriteSummary();
    const warnings = [
      ...providerResult.warnings,
      ...buildSkeletonWarnings(options.mode, dryRun, fixture),
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
      assetCount: assetRows.length,
      successCount: counts.successCount,
      failedCount: counts.failedCount + closeWriteSummary.failedCount,
      skippedCount: counts.skippedCount + closeWriteSummary.skippedCount,
      insertedCount: closeWriteSummary.insertedCount,
      updatedCount: closeWriteSummary.updatedCount,
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
          assetCount: assetRows.length,
          priceTargetCount: priceTargets.length,
          totalPriceTargetCount: allPriceTargets.length,
          targetLimit: options.targetLimit ?? null,
          insertedCount: result.insertedCount,
          updatedCount: result.updatedCount,
          plannedWrites,
          writeResults: summarizeWriteResults(result.writeResults),
          contract: PRICE_SYNC_CONTRACT[options.mode],
          marketDataWritesEnabled:
            options.mode === "close" && !dryRun && fixture,
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
          marketDataWritesEnabled: options.mode === "close" && !dryRun && fixture,
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
  fixture: boolean,
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
      active: !dryRun && fixture,
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
      allowWrite: options.allowWrite,
    });

    summary.results.push(result);

    if (result.action === "inserted") summary.insertedCount += 1;
    if (result.action === "updated") summary.updatedCount += 1;
    if (result.action === "failed") summary.failedCount += 1;
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
  allowWrite: boolean;
}): Promise<ClosePriceWriteResult> {
  const rowKey = {
    ticker: options.row.ticker,
    priceDate: options.row.priceDate,
    source: options.row.source,
  };
  const validationError = validateClosePriceRow(options.row, options.target);

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
  const protectedReason = getProtectedExistingReason(existing, snapshot.source);

  if (protectedReason) {
    return {
      ...rowKey,
      action: options.dryRun ? "planned_skip" : "skipped",
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

  if (!options.allowWrite || !options.fixture) {
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
      setWhere: sql`${assetPriceSnapshots.source} = ${snapshot.source}`,
    })
    .returning({ id: assetPriceSnapshots.id });

  if (returned.length === 0) {
    return {
      ...rowKey,
      action: "skipped",
      reason: "protected_existing_source",
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
  if (row.source !== "stub_fixture") return "unsupported_write_source";
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
  incomingSource: string | null,
) {
  if (!existing) return null;
  if (incomingSource !== "stub_fixture") return "unsupported_write_source";
  if (existing.source !== "stub_fixture") return "protected_existing_source";
  return null;
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

function buildSkeletonWarnings(
  mode: PriceSyncMode,
  dryRun: boolean,
  fixture: boolean,
): string[] {
  const warnings = [
    "external market data providers and live asset updates are not enabled yet",
  ];

  if (mode === "close" && !dryRun && fixture) {
    warnings.push(
      "fixture close rows may write to asset_price_snapshots; source is stub_fixture and imported/non-stub rows are protected",
    );
  } else if (!dryRun) {
    warnings.push(
      "dryRun=false was accepted, but this mode has no market data write path enabled yet",
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

function toDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
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
