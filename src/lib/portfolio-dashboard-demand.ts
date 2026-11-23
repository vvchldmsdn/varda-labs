import { selectTodayHoldingCandidates, type TodayHoldingDetailQuery } from "./today-holding-detail.ts";
import type { assets, livePriceQuotes } from "../db/schema";
import { normalizeTicker } from "./portfolio-math.ts";

export type PortfolioDashboardDemand =
  | Readonly<{ surface: "home" }>
  | Readonly<{ surface: "today"; holdingDetail: TodayHoldingDetailQuery }>;

const INVESTMENT_ASSET_TYPES = new Set(["etf", "stock", "pension", "commodity"]);

export function isDashboardInvestmentAsset(asset: { assetType: string | null }) {
  return INVESTMENT_ASSET_TYPES.has(asset.assetType ?? "etf");
}

type Asset = typeof assets.$inferSelect;
type Quote = typeof livePriceQuotes.$inferSelect;
function quoteKey(row: Pick<Asset, "market" | "ticker" | "currency">) {
  return `${row.market}:${normalizeTicker(row.ticker) ?? ""}:${row.currency}`;
}

/** The source query supplies latest-first market observations. Home and its
 * live performance tip choose the same quote (including the stored fallback). */
export function markDashboardInvestmentAssets(assets: readonly Asset[], rows: readonly Quote[]) {
  const quotes = new Map<string, Quote>();
  for (const row of rows) {
    const key = quoteKey(row);
    if (!quotes.has(key)) quotes.set(key, row);
  }
  return assets.map(asset => {
    const quote = quotes.get(quoteKey(asset));
    if (!quote || quote.status !== "ok") return asset;
    return { ...asset, currentPrice: quote.price, priceSource: quote.source, priceFetchedAt: quote.fetchedAt,
      priceAsOf: quote.priceAsOf, priceQuoteType: quote.quoteType, priceStatus: quote.status, priceError: quote.error };
  });
}

/** Resolve only against the already-authorized scope; ambiguous URLs read no history. */
export function selectDashboardHistoryAssetIds(
  assets: readonly {
    id: string;
    assetType: string | null;
    ticker: string | null;
    market: string;
    account: string;
  }[],
  demand: PortfolioDashboardDemand,
) {
  const investmentAssets = assets.filter(isDashboardInvestmentAsset);
  if (demand.surface === "home") return investmentAssets.map((asset) => asset.id);
  const candidates = selectTodayHoldingCandidates(investmentAssets, demand.holdingDetail);
  return candidates.length === 1 ? [candidates[0].id] : [];
}
