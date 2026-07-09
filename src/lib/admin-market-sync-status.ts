import { closeCalendarReferenceDateForAsset } from "./snapshots/market-calendar.ts";

const INVESTMENT_ASSET_TYPES = new Set(["etf", "stock", "pension", "commodity"]);
const FRESH_PRICE_QUOTE_TYPES = new Set(["live", "delayed", "realtime"]);

export type AdminSyncAssetInput = {
  id: string;
  name: string;
  ticker: string | null;
  account: string;
  market: string;
  currency: string;
  assetType: string | null;
};

export type AdminSyncLiveQuoteInput = {
  ticker: string;
  market: string;
  currency: string;
  quoteType: string | null;
  status: string | null;
  fetchedAt: Date | string | null;
  priceAsOf: Date | string | null;
};

export type AdminSyncCloseRowInput = {
  ticker: string;
  priceDate: string;
  source: string | null;
  updatedAt: Date | string | null;
};

export type AdminSyncCycleInput = {
  snapshotDate: string;
  liveWindowStartAt: Date;
  liveWindowEndAt: Date;
};

export type AdminSyncTarget = {
  ticker: string;
  name: string;
  account: string;
  market: string;
  currency: string;
};

export type LivePriceStatusSummary = {
  targetCount: number;
  freshCount: number;
  staleOrMissingCount: number;
  latestPriceTimestamp: string | null;
  staleOrMissingTargets: AdminSyncTarget[];
};

export type CloseCoverageTarget = AdminSyncTarget & {
  expectedCloseDate: string;
  selectedCloseDate: string | null;
  source: string | null;
  status: "covered" | "missing" | "stale";
};

export type CloseCoverageStatusSummary = {
  targetCount: number;
  coveredCount: number;
  staleOrMissingCount: number;
  latestCloseDate: string | null;
  gaps: CloseCoverageTarget[];
};

export function summarizeLivePriceStatus(
  assets: AdminSyncAssetInput[],
  quotes: AdminSyncLiveQuoteInput[],
  cycle: AdminSyncCycleInput,
): LivePriceStatusSummary {
  const targets = syncableAssets(assets);
  const latestQuotes = latestLiveQuotesByAssetKey(quotes);
  const staleOrMissingTargets: AdminSyncTarget[] = [];
  let freshCount = 0;
  let latestPriceTimestamp: string | null = null;

  for (const asset of targets) {
    const quote = latestQuotes.get(assetLiveQuoteKey(asset)) ?? null;
    const priceTimestamp = quote
      ? latestTimestamp(quote.fetchedAt, quote.priceAsOf)
      : null;
    if (priceTimestamp) {
      latestPriceTimestamp = maxIso(latestPriceTimestamp, priceTimestamp);
    }

    if (quote && hasFreshPriceMetadata(quote, cycle, priceTimestamp)) {
      freshCount += 1;
    } else {
      staleOrMissingTargets.push(assetTarget(asset));
    }
  }

  return {
    targetCount: targets.length,
    freshCount,
    staleOrMissingCount: staleOrMissingTargets.length,
    latestPriceTimestamp,
    staleOrMissingTargets,
  };
}

export function summarizeCloseCoverageStatus(
  assets: AdminSyncAssetInput[],
  closeRows: AdminSyncCloseRowInput[],
  snapshotDate: string,
): CloseCoverageStatusSummary {
  const targets = syncableAssets(assets);
  const latestCloseRows = latestCloseRowsByTicker(closeRows);
  const gaps: CloseCoverageTarget[] = [];
  let coveredCount = 0;
  let latestCloseDate: string | null = null;

  for (const row of latestCloseRows.values()) {
    latestCloseDate = maxDateKey(latestCloseDate, row.priceDate);
  }

  for (const asset of targets) {
    const ticker = normalizeTicker(asset.ticker);
    if (!ticker) continue;

    const expectedCloseDate = closeCalendarReferenceDateForAsset(
      {
        market: asset.market,
        currency: asset.currency,
      },
      snapshotDate,
    );
    const closeRow = latestCloseRows.get(ticker) ?? null;
    const selectedCloseDate = closeRow?.priceDate ?? null;

    if (selectedCloseDate === expectedCloseDate) {
      coveredCount += 1;
      continue;
    }

    gaps.push({
      ...assetTarget(asset),
      expectedCloseDate,
      selectedCloseDate,
      source: closeRow?.source ?? null,
      status: selectedCloseDate === null ? "missing" : "stale",
    });
  }

  return {
    targetCount: targets.length,
    coveredCount,
    staleOrMissingCount: gaps.length,
    latestCloseDate,
    gaps,
  };
}

export function normalizeTicker(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase();
  return normalized || null;
}

function syncableAssets(assets: AdminSyncAssetInput[]) {
  return assets.filter((asset) => {
    const ticker = normalizeTicker(asset.ticker);
    return Boolean(ticker && INVESTMENT_ASSET_TYPES.has(asset.assetType ?? ""));
  });
}

function hasFreshPriceMetadata(
  quote: AdminSyncLiveQuoteInput,
  cycle: AdminSyncCycleInput,
  priceTimestamp: string | null,
) {
  const quoteType = quote.quoteType?.trim().toLowerCase() ?? "";
  if (!FRESH_PRICE_QUOTE_TYPES.has(quoteType)) return false;
  if (quote.status && quote.status !== "ok") return false;
  if (!priceTimestamp) return false;

  const timestamp = Date.parse(priceTimestamp);
  return (
    Number.isFinite(timestamp) &&
    timestamp >= cycle.liveWindowStartAt.getTime() &&
    timestamp < cycle.liveWindowEndAt.getTime()
  );
}

function latestLiveQuotesByAssetKey(rows: AdminSyncLiveQuoteInput[]) {
  const sortedRows = [...rows].sort((left, right) => {
    const timestampCompare =
      latestTimestamp(right.fetchedAt, right.priceAsOf)?.localeCompare(
        latestTimestamp(left.fetchedAt, left.priceAsOf) ?? "",
      ) ?? 0;
    if (timestampCompare !== 0) return timestampCompare;
    return left.ticker.localeCompare(right.ticker);
  });
  const byKey = new Map<string, AdminSyncLiveQuoteInput>();

  for (const row of sortedRows) {
    const key = liveQuoteKey(row.market, row.ticker, row.currency);
    if (!byKey.has(key)) byKey.set(key, row);
  }

  return byKey;
}

function latestTimestamp(
  left: Date | string | null,
  right: Date | string | null,
) {
  const leftIso = timestampIso(left);
  const rightIso = timestampIso(right);
  return maxIso(leftIso, rightIso);
}

function assetLiveQuoteKey(asset: Pick<AdminSyncAssetInput, "market" | "ticker" | "currency">) {
  return liveQuoteKey(asset.market, normalizeTicker(asset.ticker) ?? "", asset.currency);
}

function liveQuoteKey(market: string, ticker: string, currency: string) {
  return `${market}:${normalizeTicker(ticker) ?? ""}:${currency}`;
}

function latestCloseRowsByTicker(rows: AdminSyncCloseRowInput[]) {
  const sortedRows = [...rows].sort((left, right) => {
    const dateCompare = right.priceDate.localeCompare(left.priceDate);
    if (dateCompare !== 0) return dateCompare;
    return timestampIso(right.updatedAt)?.localeCompare(timestampIso(left.updatedAt) ?? "") ?? 0;
  });
  const byTicker = new Map<string, AdminSyncCloseRowInput>();

  for (const row of sortedRows) {
    const ticker = normalizeTicker(row.ticker);
    if (ticker && !byTicker.has(ticker)) byTicker.set(ticker, row);
  }

  return byTicker;
}

function assetTarget(asset: AdminSyncAssetInput): AdminSyncTarget {
  return {
    ticker: normalizeTicker(asset.ticker) ?? "-",
    name: asset.name,
    account: asset.account,
    market: asset.market,
    currency: asset.currency,
  };
}

function timestampIso(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function maxIso(left: string | null, right: string | null) {
  if (!left) return right;
  if (!right) return left;
  return right > left ? right : left;
}

function maxDateKey(left: string | null, right: string | null) {
  if (!left) return right;
  if (!right) return left;
  return right > left ? right : left;
}
