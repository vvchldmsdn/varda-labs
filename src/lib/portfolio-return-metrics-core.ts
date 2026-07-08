import {
  convertToKrw,
  normalizeTicker,
  resolveKrwFxRate,
  sumBy,
  toNumber,
} from "./portfolio-math.ts";

type ParsedObject = Record<string, unknown>;

export type PortfolioReturnAccount = "brokerage" | "isa" | "irp";
export type PortfolioReturnSelectedAccount = PortfolioReturnAccount | "all";

export type PortfolioReturnAssetRow = {
  id: string;
  legacyBase44Id: string | null;
  account: string;
  ticker: string | null;
  name: string;
  currency: string;
  quantity: string | number | null;
  averageCost: string | number | null;
  currentPrice: string | number | null;
  fractionalAvgCost: string | number | null;
};

export type PortfolioReturnEventRow = {
  id?: string;
  eventDate: string;
  eventType: string;
  account: string | null;
  assetId: string | null;
  legacyAssetId: string;
  ticker: string | null;
  assetName: string;
  amountKrw: string | number | null;
  quantityDelta: string | number | null;
  price: string | number | null;
  fxRate: string | number | null;
  beforeValue: unknown;
  afterValue: unknown;
  memo: string | null;
  recordedAt: Date | string | null;
  createdAt: Date | string;
};

type AssetMaps = {
  byId: Map<string, PortfolioReturnAssetRow>;
  byLegacyId: Map<string, PortfolioReturnAssetRow>;
  byTickerAccount: Map<string, PortfolioReturnAssetRow>;
  byNameAccount: Map<string, PortfolioReturnAssetRow>;
};

export type AssetReturnMetrics = {
  assetKey: string;
  account: string;
  costBasisKrw: number;
  realizedCostBasisKrw: number;
  realizedPnlKrw: number;
  missingCost: boolean;
};

export type RealizedReturnRow = {
  eventId: string | null;
  eventDate: string;
  eventType: "sell";
  legacyAssetId: string;
  ticker: string | null;
  assetName: string;
  assetKey: string | null;
  account: string | null;
  realizedPnlKrw: number;
  realizedCostBasisKrw: number;
  missingCost: boolean;
};

export type ReturnMetricsSummary = {
  asOfDate: string | null;
  metricsByAssetKey: Map<string, AssetReturnMetrics>;
  realizedRows: RealizedReturnRow[];
  tradeEventCount: number;
  buyEventCount: number;
  sellEventCount: number;
  realizedSellEventCount: number;
  skippedBuyEventCount: number;
  unmatchedSellEventCount: number;
  missingCostSellEventCount: number;
  realizedPnlKrw: number;
  realizedCostBasisKrw: number;
};

export type AccountRealizedReturnSummary = {
  account: PortfolioReturnSelectedAccount;
  realizedPnlKrw: number;
  realizedCostBasisKrw: number;
  realizedSellEventCount: number;
  unmatchedSellEventCount: number;
  missingCostSellEventCount: number;
};

const ASSET_ACCOUNT_CODES = ["brokerage", "isa", "irp"] as const;

export function buildReturnMetricsSummary(
  events: PortfolioReturnEventRow[],
  assetRows: PortfolioReturnAssetRow[],
  usdKrwRate: number,
  options: { asOfDate?: string | null } = {},
): ReturnMetricsSummary {
  const asOfDate = options.asOfDate ?? null;
  const assetMaps = buildAssetMaps(assetRows);
  const metricsByAssetKey = new Map<string, AssetReturnMetrics>();
  const realizedRows: RealizedReturnRow[] = [];
  const runningLedger = new Map<string, { quantity: number; costKrw: number }>();
  let skippedBuyEventCount = 0;

  for (const asset of assetRows) {
    const key = assetMetricKey(asset);
    metricsByAssetKey.set(key, {
      assetKey: key,
      account: asset.account,
      costBasisKrw: fallbackCostBasisKrw(asset, usdKrwRate),
      realizedCostBasisKrw: 0,
      realizedPnlKrw: 0,
      missingCost: false,
    });
  }

  const tradeEvents = events
    .filter((event) => event.eventType === "buy" || event.eventType === "sell")
    .filter((event) => !asOfDate || event.eventDate <= asOfDate)
    .sort(compareEventsAscending);
  const buyEventCount = tradeEvents.filter((event) => event.eventType === "buy").length;
  const sellEventCount = tradeEvents.filter((event) => event.eventType === "sell").length;

  for (const event of tradeEvents) {
    const asset = resolveEventAsset(event, assetMaps);
    const assetKey = asset ? assetMetricKey(asset) : null;
    const ledgerKey = assetKey ?? event.legacyAssetId;
    const account = portfolioEventAccount(event) ?? asset?.account ?? null;
    const quantity = eventTradeQuantity(event);
    const amountKrw = historyTradeAmountKrw(event, asset, usdKrwRate);

    if (event.eventType === "buy") {
      if (!ledgerKey || amountKrw <= 0) {
        skippedBuyEventCount += 1;
        continue;
      }
      const row = runningLedger.get(ledgerKey) ?? { quantity: 0, costKrw: 0 };
      row.quantity += quantity;
      row.costKrw += amountKrw;
      runningLedger.set(ledgerKey, row);
      continue;
    }

    if (event.eventType !== "sell") continue;

    const explicitMetrics = readExplicitTradeMetrics(event);
    const ledgerRow = ledgerKey ? runningLedger.get(ledgerKey) : undefined;
    const disposedCostKrw =
      explicitMetrics.disposedCostKrw ??
      estimateDisposedCostFromLedger(ledgerRow, quantity) ??
      estimateDisposedCostFromEvent(event, asset, quantity, usdKrwRate);
    const fallbackRealizedPnlKrw =
      disposedCostKrw !== null && amountKrw > 0
        ? amountKrw - disposedCostKrw
        : parseRealizedPnl(event.memo);
    const realizedPnlKrw =
      explicitMetrics.realizedPnlKrw ?? fallbackRealizedPnlKrw;
    const realizedCostBasisKrw = disposedCostKrw ?? 0;
    const missingCost = disposedCostKrw === null;

    if (ledgerRow && disposedCostKrw !== null) {
      ledgerRow.quantity = Math.max(ledgerRow.quantity - quantity, 0);
      ledgerRow.costKrw = Math.max(ledgerRow.costKrw - disposedCostKrw, 0);
    }

    if (assetKey) {
      const metrics = metricsByAssetKey.get(assetKey);
      if (metrics) {
        metrics.realizedPnlKrw += realizedPnlKrw;
        metrics.realizedCostBasisKrw += realizedCostBasisKrw;
        metrics.missingCost = metrics.missingCost || missingCost;
      }
    }

    realizedRows.push({
      eventId: event.id ?? null,
      eventDate: event.eventDate,
      eventType: "sell",
      legacyAssetId: event.legacyAssetId,
      ticker: event.ticker,
      assetName: event.assetName,
      assetKey,
      account,
      realizedPnlKrw,
      realizedCostBasisKrw,
      missingCost,
    });
  }

  return {
    asOfDate,
    metricsByAssetKey,
    realizedRows,
    tradeEventCount: tradeEvents.length,
    buyEventCount,
    sellEventCount,
    realizedSellEventCount: realizedRows.length,
    skippedBuyEventCount,
    unmatchedSellEventCount: realizedRows.filter((row) => !row.assetKey).length,
    missingCostSellEventCount: realizedRows.filter((row) => row.missingCost).length,
    realizedPnlKrw: sumBy(realizedRows, (row) => row.realizedPnlKrw),
    realizedCostBasisKrw: sumBy(realizedRows, (row) => row.realizedCostBasisKrw),
  };
}

export function getAssetReturnMetrics(
  summary: ReturnMetricsSummary,
  asset: PortfolioReturnAssetRow,
  usdKrwRate: number,
) {
  const key = assetMetricKey(asset);
  return (
    summary.metricsByAssetKey.get(key) ?? {
      assetKey: key,
      account: asset.account,
      costBasisKrw: fallbackCostBasisKrw(asset, usdKrwRate),
      realizedCostBasisKrw: 0,
      realizedPnlKrw: 0,
      missingCost: false,
    }
  );
}

export function getSelectedRealizedRows(
  summary: ReturnMetricsSummary,
  selectedAccount: PortfolioReturnSelectedAccount,
  selectedAssetKeys: Set<string>,
) {
  if (selectedAccount === "all") return summary.realizedRows;

  return summary.realizedRows.filter((row) => {
    if (row.account) return row.account === selectedAccount;
    if (row.assetKey) return selectedAssetKeys.has(row.assetKey);
    return selectedAccount === "brokerage";
  });
}

export function summarizeRealizedReturnForAccount(
  summary: ReturnMetricsSummary,
  selectedAccount: PortfolioReturnSelectedAccount,
  selectedAssetKeys: Set<string>,
): AccountRealizedReturnSummary {
  const rows = getSelectedRealizedRows(summary, selectedAccount, selectedAssetKeys);
  return {
    account: selectedAccount,
    realizedPnlKrw: sumBy(rows, (row) => row.realizedPnlKrw),
    realizedCostBasisKrw: sumBy(rows, (row) => row.realizedCostBasisKrw),
    realizedSellEventCount: rows.length,
    unmatchedSellEventCount: rows.filter((row) => !row.assetKey).length,
    missingCostSellEventCount: rows.filter((row) => row.missingCost).length,
  };
}

export function assetMetricKey(asset: Pick<PortfolioReturnAssetRow, "legacyBase44Id" | "id">) {
  return asset.legacyBase44Id ?? asset.id;
}

export function portfolioEventAccount(event: PortfolioReturnEventRow) {
  if (event.account) return event.account;
  const before = parseJsonObject(event.beforeValue);
  const after = parseJsonObject(event.afterValue);
  const fromAfter = readStringField(after, ["account"]);
  if (fromAfter) return fromAfter;
  return readStringField(before, ["account"]);
}

function readExplicitTradeMetrics(event: PortfolioReturnEventRow) {
  const before = parseJsonObject(event.beforeValue);
  const after = parseJsonObject(event.afterValue);
  const metricObjects = [
    pickNestedObject(after, "trade_metrics"),
    pickNestedObject(after, "tradeMetrics"),
    pickNestedObject(after, "realized_metrics"),
    pickNestedObject(before, "trade_metrics"),
    pickNestedObject(before, "tradeMetrics"),
  ].filter((value): value is ParsedObject => Boolean(value));
  const metricObject = metricObjects[0] ?? null;

  if (!metricObject) {
    return {
      realizedPnlKrw: null,
      disposedCostKrw: null,
    };
  }

  return {
    realizedPnlKrw: readNumberField(metricObject, [
      "realized_pnl_krw",
      "realizedPnlKrw",
      "realized_pnl",
      "realizedPnl",
    ]),
    disposedCostKrw: readNumberField(metricObject, [
      "disposed_cost_krw",
      "disposedCostKrw",
      "cost_basis_krw",
      "costBasisKrw",
      "realized_cost_krw",
      "realizedCostKrw",
    ]),
  };
}

function historyTradeAmountKrw(
  event: PortfolioReturnEventRow,
  asset: PortfolioReturnAssetRow | null,
  usdKrwRate: number,
) {
  const amount = toNumber(event.amountKrw);
  if (amount !== null && amount !== 0) return Math.abs(amount);

  const quantity = eventTradeQuantity(event);
  const price = toNumber(event.price) ?? 0;
  const fxRate =
    toNumber(event.fxRate) ??
    resolveKrwFxRate(asset?.currency ?? "KRW", usdKrwRate).rate ??
    0;
  return Math.abs(quantity * price * fxRate);
}

function eventTradeQuantity(event: PortfolioReturnEventRow) {
  const quantityDelta = toNumber(event.quantityDelta);
  if (quantityDelta !== null && quantityDelta !== 0) return Math.abs(quantityDelta);

  const before = parseJsonObject(event.beforeValue);
  const after = parseJsonObject(event.afterValue);
  const beforeQuantity = readNumberField(before, ["quantity"]);
  const afterQuantity = readNumberField(after, ["quantity"]);
  if (beforeQuantity !== null && afterQuantity !== null) {
    return Math.abs(beforeQuantity - afterQuantity);
  }
  return 0;
}

function estimateDisposedCostFromLedger(
  ledgerRow: { quantity: number; costKrw: number } | undefined,
  quantity: number,
) {
  if (!ledgerRow || quantity <= 0 || ledgerRow.quantity <= 0 || ledgerRow.costKrw <= 0) {
    return null;
  }
  const ratio = Math.min(quantity / ledgerRow.quantity, 1);
  return ledgerRow.costKrw * ratio;
}

function estimateDisposedCostFromEvent(
  event: PortfolioReturnEventRow,
  asset: PortfolioReturnAssetRow | null,
  quantity: number,
  usdKrwRate: number,
) {
  if (quantity <= 0) return null;

  const before = parseJsonObject(event.beforeValue);
  const averageCost =
    readNumberField(before, ["average_cost", "averageCost", "avg_cost"]) ??
    toNumber(asset?.averageCost);
  if (averageCost === null || averageCost <= 0) return null;

  const fxRate =
    toNumber(event.fxRate) ??
    resolveKrwFxRate(asset?.currency ?? "KRW", usdKrwRate).rate ??
    0;
  return quantity * averageCost * fxRate;
}

function fallbackCostBasisKrw(asset: PortfolioReturnAssetRow, usdKrwRate: number) {
  const quantity = toNumber(asset.quantity) ?? 0;
  const averageCost =
    toNumber(asset.averageCost) ?? toNumber(asset.currentPrice) ?? 0;
  const localCostBasis = quantity * averageCost;
  return (
    (convertToKrw(localCostBasis, asset.currency, usdKrwRate) ?? 0) +
    (toNumber(asset.fractionalAvgCost) ?? 0)
  );
}

function buildAssetMaps(assetRows: PortfolioReturnAssetRow[]): AssetMaps {
  const maps: AssetMaps = {
    byId: new Map(),
    byLegacyId: new Map(),
    byTickerAccount: new Map(),
    byNameAccount: new Map(),
  };

  for (const asset of assetRows) {
    maps.byId.set(asset.id, asset);
    if (asset.legacyBase44Id) maps.byLegacyId.set(asset.legacyBase44Id, asset);
    const ticker = normalizeTicker(asset.ticker);
    if (ticker) maps.byTickerAccount.set(accountKey(asset.account, ticker), asset);
    maps.byNameAccount.set(accountKey(asset.account, asset.name), asset);
  }

  return maps;
}

function resolveEventAsset(event: PortfolioReturnEventRow, maps: AssetMaps) {
  if (event.assetId && maps.byId.has(event.assetId)) {
    return maps.byId.get(event.assetId) ?? null;
  }
  if (event.legacyAssetId && maps.byLegacyId.has(event.legacyAssetId)) {
    return maps.byLegacyId.get(event.legacyAssetId) ?? null;
  }

  const eventAccount = portfolioEventAccount(event);
  const accountsToTry = eventAccount ? [eventAccount] : ASSET_ACCOUNT_CODES;
  const ticker = normalizeTicker(event.ticker);
  for (const account of accountsToTry) {
    if (ticker) {
      const asset = maps.byTickerAccount.get(accountKey(account, ticker));
      if (asset) return asset;
    }
    if (event.assetName) {
      const asset = maps.byNameAccount.get(accountKey(account, event.assetName));
      if (asset) return asset;
    }
  }

  return null;
}

function accountKey(account: string, value: string) {
  return `${account}:${value}`;
}

function compareEventsAscending(a: PortfolioReturnEventRow, b: PortfolioReturnEventRow) {
  const dateCompare = a.eventDate.localeCompare(b.eventDate);
  if (dateCompare !== 0) return dateCompare;
  return timestampMs(a.recordedAt ?? a.createdAt) - timestampMs(b.recordedAt ?? b.createdAt);
}

function parseRealizedPnl(memo: string | null) {
  if (!memo) return 0;
  const match = memo.match(/realized_pnl_krw=([-+]?\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : 0;
}

function parseJsonObject(value: unknown): ParsedObject | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as ParsedObject;
  }
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ParsedObject;
    }
  } catch {
    return null;
  }
  return null;
}

function pickNestedObject(
  source: ParsedObject | null,
  key: string,
): ParsedObject | null {
  if (!source) return null;
  const value = source[key];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as ParsedObject;
  }
  return null;
}

function readNumberField(source: ParsedObject | null, keys: string[]) {
  if (!source) return null;
  for (const key of keys) {
    const value = toNumber(source[key]);
    if (value !== null) return value;
  }
  return null;
}

function readStringField(source: ParsedObject | null, keys: string[]) {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function timestampMs(value: Date | string | null) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : 0;
}
