import {
  convertToKrw,
  normalizeTicker,
  sumComplete,
  toNumber,
} from "./portfolio-math.ts";

type ParsedObject = Record<string, unknown>;

export type PortfolioReturnAccount = string;
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
  fractionalKrwValue?: string | number | null;
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
  byTicker: Map<string, PortfolioReturnAssetRow[]>;
  byName: Map<string, PortfolioReturnAssetRow[]>;
};

export type AssetReturnMetrics = {
  assetKey: string;
  account: string;
  costBasisKrw: number | null;
  realizedCostBasisKrw: number | null;
  realizedPnlKrw: number | null;
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
  realizedPnlKrw: number | null;
  realizedCostBasisKrw: number | null;
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
  realizedPnlKrw: number | null;
  realizedCostBasisKrw: number | null;
};

export type AccountRealizedReturnSummary = {
  account: PortfolioReturnSelectedAccount;
  realizedPnlKrw: number | null;
  realizedCostBasisKrw: number | null;
  realizedSellEventCount: number;
  unmatchedSellEventCount: number;
  missingCostSellEventCount: number;
};

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
  const incompleteLedgers = new Set<string>();
  let skippedBuyEventCount = 0;

  for (const asset of assetRows) {
    const key = assetMetricKey(asset);
    const costBasisKrw = fallbackCostBasisKrw(asset, usdKrwRate);
    metricsByAssetKey.set(key, {
      assetKey: key,
      account: asset.account,
      costBasisKrw,
      realizedCostBasisKrw: 0,
      realizedPnlKrw: 0,
      missingCost: costBasisKrw === null,
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
    const amountKrw = historyTradeAmountKrw(event, asset);

    if (event.eventType === "buy") {
      if (!ledgerKey || amountKrw === null || amountKrw <= 0 || quantity <= 0) {
        skippedBuyEventCount += 1;
        if (ledgerKey) incompleteLedgers.add(ledgerKey);
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
    const ledgerRow = ledgerKey && !incompleteLedgers.has(ledgerKey) ? runningLedger.get(ledgerKey) : undefined;
    const disposedCostKrw =
      explicitMetrics.disposedCostKrw ??
      estimateDisposedCostFromLedger(ledgerRow, quantity) ??
      estimateDisposedCostFromEvent(event, asset, quantity);
    const fallbackRealizedPnlKrw =
      disposedCostKrw !== null && amountKrw !== null && amountKrw > 0
        ? amountKrw - disposedCostKrw
        : parseRealizedPnl(event.memo);
    const realizedPnlKrw =
      explicitMetrics.realizedPnlKrw ?? fallbackRealizedPnlKrw;
    const realizedCostBasisKrw = disposedCostKrw;
    const missingCost = disposedCostKrw === null;

    if (ledgerKey && (quantity <= 0 || !ledgerRow || quantity > ledgerRow.quantity)) {
      incompleteLedgers.add(ledgerKey);
    } else if (ledgerRow && disposedCostKrw !== null) {
      ledgerRow.quantity = Math.max(ledgerRow.quantity - quantity, 0);
      ledgerRow.costKrw = Math.max(ledgerRow.costKrw - disposedCostKrw, 0);
    }

    if (assetKey) {
      const metrics = metricsByAssetKey.get(assetKey);
      if (metrics) {
        metrics.realizedPnlKrw = sumComplete([metrics.realizedPnlKrw, realizedPnlKrw], value => value);
        metrics.realizedCostBasisKrw = sumComplete([metrics.realizedCostBasisKrw, realizedCostBasisKrw], value => value);
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
    realizedPnlKrw: sumComplete(realizedRows, (row) => row.realizedPnlKrw),
    realizedCostBasisKrw: sumComplete(realizedRows, (row) => row.realizedCostBasisKrw),
  };
}

export function getAssetReturnMetrics(
  summary: ReturnMetricsSummary,
  asset: PortfolioReturnAssetRow,
  usdKrwRate: number,
) {
  const key = assetMetricKey(asset);
  const costBasisKrw = fallbackCostBasisKrw(asset, usdKrwRate);
  return (
    summary.metricsByAssetKey.get(key) ?? {
      assetKey: key,
      account: asset.account,
      costBasisKrw,
      realizedCostBasisKrw: 0,
      realizedPnlKrw: 0,
      missingCost: costBasisKrw === null,
    }
  );
}

export function getSelectedRealizedRows(
  summary: Pick<ReturnMetricsSummary, "realizedRows">,
  selectedAccount: PortfolioReturnSelectedAccount,
  selectedAssetKeys: Set<string>,
) {
  if (selectedAccount === "all") return summary.realizedRows;

  return summary.realizedRows.filter((row) => {
    if (row.account) return row.account === selectedAccount;
    if (row.assetKey) return selectedAssetKeys.has(row.assetKey);
    return false;
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
    realizedPnlKrw: sumComplete(rows, (row) => row.realizedPnlKrw),
    realizedCostBasisKrw: sumComplete(rows, (row) => row.realizedCostBasisKrw),
    realizedSellEventCount: rows.length,
    unmatchedSellEventCount: rows.filter((row) => !row.assetKey).length,
    missingCostSellEventCount: rows.filter((row) => row.missingCost).length,
  };
}

export function assetMetricKey(asset: Pick<PortfolioReturnAssetRow, "legacyBase44Id" | "id">) {
  return asset.legacyBase44Id ?? asset.id;
}

export function portfolioEventAccount(event: PortfolioReturnEventRow) {
  return portfolioEventAccountFromMetadata(event);
}

export function portfolioEventAccountFromMetadata(
  event: Pick<
    PortfolioReturnEventRow,
    "account" | "beforeValue" | "afterValue"
  >,
) {
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
) {
  const amount = toNumber(event.amountKrw);
  if (amount !== null && amount !== 0) return Math.abs(amount);

  const quantity = eventTradeQuantity(event);
  const price = toNumber(event.price);
  const fxRate = historicalEventFxRate(event, asset);
  if (quantity <= 0 || price === null || price <= 0 || fxRate === null) return null;
  const amountKrw = quantity * price * fxRate;
  return Number.isFinite(amountKrw) ? amountKrw : null;
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
  if (!ledgerRow || quantity <= 0 || quantity > ledgerRow.quantity || ledgerRow.quantity <= 0 || ledgerRow.costKrw <= 0) {
    return null;
  }
  const ratio = quantity / ledgerRow.quantity;
  return ledgerRow.costKrw * ratio;
}

function estimateDisposedCostFromEvent(
  event: PortfolioReturnEventRow,
  asset: PortfolioReturnAssetRow | null,
  quantity: number,
) {
  if (quantity <= 0) return null;

  const before = parseJsonObject(event.beforeValue);
  // A current holding correction cannot supply the cost of an earlier sale.
  const averageCost = readNumberField(before, ["average_cost", "averageCost", "avg_cost"]);
  if (averageCost === null || averageCost <= 0) return null;

  const fxRate = historicalEventFxRate(event, asset);
  if (fxRate === null) return null;
  const costKrw = quantity * averageCost * fxRate;
  return Number.isFinite(costKrw) ? costKrw : null;
}

function historicalEventFxRate(event: PortfolioReturnEventRow, asset: PortfolioReturnAssetRow | null) {
  const recorded = toNumber(event.fxRate);
  if (recorded !== null) return recorded > 0 ? recorded : null;
  const currency = readStringField(parseJsonObject(event.beforeValue), ["currency"]) ??
    readStringField(parseJsonObject(event.afterValue), ["currency"]) ?? asset?.currency;
  // KRW needs no conversion. Missing foreign-currency FX stays unknown.
  return currency?.toUpperCase() === "KRW" ? 1 : null;
}

function fallbackCostBasisKrw(asset: PortfolioReturnAssetRow, usdKrwRate: number) {
  const quantity = toNumber(asset.quantity);
  const averageCost = toNumber(asset.averageCost);
  const fractionalCost = toNumber(asset.fractionalAvgCost);
  if (quantity === null || quantity < 0 || (quantity > 0 && (averageCost === null || averageCost < 0))) return null;
  if ((toNumber(asset.fractionalKrwValue) ?? 0) > 0 && fractionalCost === null) return null;
  if (fractionalCost !== null && fractionalCost < 0) return null;
  const baseCost = quantity === 0 ? 0 : convertToKrw(quantity * (averageCost ?? 0), asset.currency, usdKrwRate);
  if (baseCost === null) return null;
  const total = baseCost + (fractionalCost ?? 0);
  return Number.isFinite(total) ? total : null;
}

function buildAssetMaps(assetRows: PortfolioReturnAssetRow[]): AssetMaps {
  const maps: AssetMaps = {
    byId: new Map(),
    byLegacyId: new Map(),
    byTickerAccount: new Map(),
    byNameAccount: new Map(),
    byTicker: new Map(),
    byName: new Map(),
  };

  for (const asset of assetRows) {
    maps.byId.set(asset.id, asset);
    if (asset.legacyBase44Id) maps.byLegacyId.set(asset.legacyBase44Id, asset);
    const ticker = normalizeTicker(asset.ticker);
    if (ticker) {
      maps.byTickerAccount.set(accountKey(asset.account, ticker), asset);
      appendAssetMatch(maps.byTicker, ticker, asset);
    }
    maps.byNameAccount.set(accountKey(asset.account, asset.name), asset);
    appendAssetMatch(maps.byName, asset.name, asset);
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
  const ticker = normalizeTicker(event.ticker);
  if (eventAccount) {
    if (ticker) {
      const asset = maps.byTickerAccount.get(accountKey(eventAccount, ticker));
      if (asset) return asset;
    }
    if (event.assetName) {
      const asset = maps.byNameAccount.get(
        accountKey(eventAccount, event.assetName),
      );
      if (asset) return asset;
    }
    return null;
  }

  return resolveAccountlessAssetMatch({
    tickerMatches: ticker ? maps.byTicker.get(ticker) : undefined,
    nameMatches: event.assetName
      ? maps.byName.get(event.assetName)
      : undefined,
  });
}

function appendAssetMatch(
  map: Map<string, PortfolioReturnAssetRow[]>,
  key: string,
  asset: PortfolioReturnAssetRow,
) {
  const matches = map.get(key);
  if (matches) {
    matches.push(asset);
    return;
  }
  map.set(key, [asset]);
}

function resolveAccountlessAssetMatch({
  tickerMatches = [],
  nameMatches = [],
}: {
  tickerMatches?: readonly PortfolioReturnAssetRow[];
  nameMatches?: readonly PortfolioReturnAssetRow[];
}) {
  if (tickerMatches.length > 0 && nameMatches.length > 0) {
    const nameMatchIds = new Set(nameMatches.map((asset) => asset.id));
    return uniqueAssetMatch(
      tickerMatches.filter((asset) => nameMatchIds.has(asset.id)),
    );
  }
  return uniqueAssetMatch(
    tickerMatches.length > 0 ? tickerMatches : nameMatches,
  );
}

function uniqueAssetMatch(matches: readonly PortfolioReturnAssetRow[]) {
  return matches.length === 1 ? matches[0] : null;
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
  if (!memo) return null;
  const match = memo.match(/realized_pnl_krw=([-+]?\d+(?:\.\d+)?)/i);
  return match ? toNumber(match[1]) : null;
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
