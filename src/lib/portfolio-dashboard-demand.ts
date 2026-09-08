import { selectTodayHoldingCandidates, type TodayHoldingDetailQuery } from "./today-holding-detail.ts";

export type PortfolioDashboardDemand =
  | Readonly<{ surface: "home" }>
  | Readonly<{ surface: "today"; holdingDetail: TodayHoldingDetailQuery }>;

const INVESTMENT_ASSET_TYPES = new Set(["etf", "stock", "pension", "commodity"]);

export function isDashboardInvestmentAsset(asset: { assetType: string | null }) {
  return INVESTMENT_ASSET_TYPES.has(asset.assetType ?? "etf");
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
