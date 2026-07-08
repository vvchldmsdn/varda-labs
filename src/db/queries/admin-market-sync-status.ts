import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import {
  assetPriceSnapshots,
  assets,
  dailyPortfolioSnapshots,
  dailyPositionSnapshots,
  fxRates,
  marketDataSyncRuns,
} from "@/db/schema";
import {
  normalizeTicker,
  summarizeCloseCoverageStatus,
  summarizeLivePriceStatus,
  type AdminSyncAssetInput,
  type AdminSyncCloseRowInput,
  type CloseCoverageStatusSummary,
  type LivePriceStatusSummary,
} from "@/lib/admin-market-sync-status";
import {
  buildCycleForSnapshotDate,
  resolveSnapshotCycle,
} from "@/lib/snapshots/market-calendar";

const DEFAULT_KIS_JOB_COOLDOWN_SECONDS = 90;

export type AdminMarketSyncStatus = {
  generatedAt: string;
  cycle: {
    snapshotDate: string;
    liveWindowStartAt: string;
    liveWindowEndAt: string;
  };
  livePrice: LivePriceStatusSummary;
  closeCoverage: CloseCoverageStatusSummary;
  fx: {
    latestRateDate: string | null;
    usdKrw: string | null;
    source: string | null;
    fetchedAt: string | null;
    freshness: "missing" | "current_cycle" | "stale";
  };
  snapshots: {
    currentSnapshotDate: string;
    currentPositionRows: number;
    currentPortfolioRows: number;
    latestPositionSnapshotDate: string | null;
    latestPortfolioSnapshotDate: string | null;
    currentPositionRowsByAccount: Record<string, number>;
    currentPortfolioRowsByAccount: Record<string, number>;
  };
  cooldowns: {
    live: KisCooldownStatus;
    close: KisCooldownStatus;
  };
  recentRuns: AdminMarketSyncRun[];
};

export type KisCooldownStatus = {
  mode: "live" | "close";
  active: boolean;
  cooldownSeconds: number;
  retryAfterSeconds: number;
  lastRunId: string | null;
  lastRunStatus: string | null;
  lastRunStartedAt: string | null;
  lastRunFinishedAt: string | null;
};

export type AdminMarketSyncRun = {
  id: string;
  jobType: string;
  mode: string | null;
  status: string;
  source: string | null;
  startedAt: string;
  finishedAt: string | null;
  requestedCount: number | null;
  successCount: number | null;
  failedCount: number | null;
  skippedCount: number | null;
};

export async function getAdminMarketSyncStatus(
  now = new Date(),
): Promise<AdminMarketSyncStatus> {
  const { snapshotDate } = resolveSnapshotCycle(now);
  const cycle = buildCycleForSnapshotDate(snapshotDate, now);
  const liveWindowStartAt = cycle.cycleEndAt;
  const liveWindowEndAt = new Date(
    liveWindowStartAt.getTime() + 24 * 60 * 60 * 1000,
  );

  const [
    assetRows,
    latestFxRows,
    positionRows,
    portfolioRows,
    recentRunRows,
    liveCooldown,
    closeCooldown,
  ] = await Promise.all([
    getAssetRows(),
    getLatestFxRows(),
    getRecentPositionSnapshotRows(),
    getRecentPortfolioSnapshotRows(),
    getRecentMarketDataSyncRuns(),
    getKisCooldownStatus("live", now),
    getKisCooldownStatus("close", now),
  ]);

  const tickers = uniqueTickers(assetRows);
  const closeRows = tickers.length > 0 ? await getCloseRows(tickers) : [];
  const livePrice = summarizeLivePriceStatus(assetRows, {
    snapshotDate,
    liveWindowStartAt,
    liveWindowEndAt,
  });
  const closeCoverage = summarizeCloseCoverageStatus(
    assetRows,
    closeRows,
    snapshotDate,
  );
  const latestFx = latestFxRows[0] ?? null;

  return {
    generatedAt: now.toISOString(),
    cycle: {
      snapshotDate,
      liveWindowStartAt: liveWindowStartAt.toISOString(),
      liveWindowEndAt: liveWindowEndAt.toISOString(),
    },
    livePrice,
    closeCoverage,
    fx: {
      latestRateDate: latestFx?.rateDate ?? null,
      usdKrw: latestFx?.usdKrw ?? null,
      source: latestFx?.source ?? null,
      fetchedAt: timestampIso(latestFx?.fetchedAt),
      freshness: fxFreshness(snapshotDate, latestFx?.rateDate ?? null),
    },
    snapshots: buildSnapshotStatus(snapshotDate, positionRows, portfolioRows),
    cooldowns: {
      live: liveCooldown,
      close: closeCooldown,
    },
    recentRuns: recentRunRows,
  };
}

async function getAssetRows(): Promise<AdminSyncAssetInput[]> {
  const rows = await db
    .select({
      id: assets.id,
      name: assets.name,
      ticker: assets.ticker,
      account: assets.account,
      market: assets.market,
      currency: assets.currency,
      assetType: assets.assetType,
      priceQuoteType: assets.priceQuoteType,
      priceStatus: assets.priceStatus,
      priceFetchedAt: assets.priceFetchedAt,
      priceAsOf: assets.priceAsOf,
    })
    .from(assets);

  return rows;
}

async function getLatestFxRows() {
  return db
    .select({
      rateDate: fxRates.rateDate,
      usdKrw: fxRates.usdKrw,
      source: fxRates.source,
      fetchedAt: fxRates.fetchedAt,
    })
    .from(fxRates)
    .orderBy(desc(fxRates.rateDate))
    .limit(1);
}

async function getCloseRows(
  tickers: string[],
): Promise<AdminSyncCloseRowInput[]> {
  return db
    .select({
      ticker: assetPriceSnapshots.ticker,
      priceDate: assetPriceSnapshots.priceDate,
      source: assetPriceSnapshots.source,
      updatedAt: assetPriceSnapshots.updatedAt,
    })
    .from(assetPriceSnapshots)
    .where(inArray(assetPriceSnapshots.ticker, tickers))
    .orderBy(desc(assetPriceSnapshots.priceDate));
}

async function getRecentPositionSnapshotRows() {
  return db
    .select({
      snapshotDate: dailyPositionSnapshots.snapshotDate,
      account: dailyPositionSnapshots.account,
    })
    .from(dailyPositionSnapshots)
    .orderBy(desc(dailyPositionSnapshots.snapshotDate))
    .limit(1200);
}

async function getRecentPortfolioSnapshotRows() {
  return db
    .select({
      snapshotDate: dailyPortfolioSnapshots.snapshotDate,
      account: dailyPortfolioSnapshots.account,
    })
    .from(dailyPortfolioSnapshots)
    .orderBy(desc(dailyPortfolioSnapshots.snapshotDate))
    .limit(120);
}

async function getRecentMarketDataSyncRuns(): Promise<AdminMarketSyncRun[]> {
  const rows = await db
    .select({
      id: marketDataSyncRuns.id,
      jobType: marketDataSyncRuns.jobType,
      mode: marketDataSyncRuns.mode,
      status: marketDataSyncRuns.status,
      source: marketDataSyncRuns.source,
      startedAt: marketDataSyncRuns.startedAt,
      finishedAt: marketDataSyncRuns.finishedAt,
      requestedCount: marketDataSyncRuns.requestedCount,
      successCount: marketDataSyncRuns.successCount,
      failedCount: marketDataSyncRuns.failedCount,
      skippedCount: marketDataSyncRuns.skippedCount,
    })
    .from(marketDataSyncRuns)
    .orderBy(desc(marketDataSyncRuns.startedAt))
    .limit(8);

  return rows.map((row) => ({
    ...row,
    startedAt: row.startedAt.toISOString(),
    finishedAt: timestampIso(row.finishedAt),
  }));
}

async function getKisCooldownStatus(
  mode: "live" | "close",
  now: Date,
): Promise<KisCooldownStatus> {
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
      mode,
      active: false,
      cooldownSeconds,
      retryAfterSeconds: 0,
      lastRunId: lastRun?.id ?? null,
      lastRunStatus: lastRun?.status ?? null,
      lastRunStartedAt: timestampIso(lastRun?.startedAt),
      lastRunFinishedAt: timestampIso(lastRun?.finishedAt),
    };
  }

  const lastActivityAt = lastRun.finishedAt ?? lastRun.startedAt;
  const elapsedMs = Math.max(0, now.getTime() - lastActivityAt.getTime());
  const retryAfterSeconds = Math.max(
    0,
    Math.ceil((cooldownSeconds * 1000 - elapsedMs) / 1000),
  );

  return {
    mode,
    active: retryAfterSeconds > 0,
    cooldownSeconds,
    retryAfterSeconds,
    lastRunId: lastRun.id,
    lastRunStatus: lastRun.status,
    lastRunStartedAt: lastRun.startedAt.toISOString(),
    lastRunFinishedAt: timestampIso(lastRun.finishedAt),
  };
}

function buildSnapshotStatus(
  snapshotDate: string,
  positionRows: { snapshotDate: string; account: string }[],
  portfolioRows: { snapshotDate: string; account: string }[],
) {
  const currentPositionRows = positionRows.filter(
    (row) => row.snapshotDate === snapshotDate,
  );
  const currentPortfolioRows = portfolioRows.filter(
    (row) => row.snapshotDate === snapshotDate,
  );

  return {
    currentSnapshotDate: snapshotDate,
    currentPositionRows: currentPositionRows.length,
    currentPortfolioRows: currentPortfolioRows.length,
    latestPositionSnapshotDate: maxDate(positionRows.map((row) => row.snapshotDate)),
    latestPortfolioSnapshotDate: maxDate(
      portfolioRows.map((row) => row.snapshotDate),
    ),
    currentPositionRowsByAccount: countByAccount(currentPositionRows),
    currentPortfolioRowsByAccount: countByAccount(currentPortfolioRows),
  };
}

function uniqueTickers(rows: AdminSyncAssetInput[]) {
  return [
    ...new Set(
      rows
        .map((row) => normalizeTicker(row.ticker))
        .filter((ticker): ticker is string => Boolean(ticker)),
    ),
  ];
}

function countByAccount(rows: { account: string }[]) {
  return rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.account] = (counts[row.account] ?? 0) + 1;
    return counts;
  }, {});
}

function maxDate(values: string[]) {
  return values.reduce<string | null>(
    (latest, value) => (latest === null || value > latest ? value : latest),
    null,
  );
}

function fxFreshness(snapshotDate: string, rateDate: string | null) {
  if (!rateDate) return "missing";
  return rateDate === snapshotDate ? "current_cycle" : "stale";
}

function getKisJobCooldownSeconds() {
  const configured = Number(process.env.KIS_JOB_COOLDOWN_SECONDS);
  if (Number.isFinite(configured) && configured >= 0) {
    return Math.floor(configured);
  }
  return DEFAULT_KIS_JOB_COOLDOWN_SECONDS;
}

function timestampIso(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
