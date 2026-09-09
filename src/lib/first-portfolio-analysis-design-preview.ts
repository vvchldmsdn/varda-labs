import { buildFirstPortfolioAnalysis } from "./first-portfolio-analysis.ts";
import { buildHoldingAnalysisDataReadiness } from "./holding-analysis-data-readiness.ts";
import { buildPortfolioStructure } from "./portfolio-structure.ts";

export function buildFirstPortfolioAnalysisDesignPreview(empty = false) {
  const assets = empty ? [] : [
    { id: "11111111-1111-4111-8111-111111111111", name: "Vanguard S&P 500 ETF", ticker: "VOO", market: "us", currency: "USD", quantity: 12, currentPrice: 520 },
    { id: "22222222-2222-4222-8222-222222222222", name: "Samsung Electronics", ticker: "005930", market: "korea", currency: "KRW", quantity: 40, currentPrice: 72000 },
    { id: "33333333-3333-4333-8333-333333333333", name: "iShares 7-10 Year Treasury Bond ETF", ticker: "IEF", market: "us", currency: "USD", quantity: 24, currentPrice: 95 },
  ].map((asset) => ({ ...asset, account: "my-portfolio", assetType: "etf", priceSource: "manual", priceFetchedAt: "2026-09-09T03:00:00Z" }));
  return {
    summary: buildFirstPortfolioAnalysis(buildPortfolioStructure({ assets, usdKrwRate: 1350, assetSelection: "preselected", selectedAccount: "all" })),
    readiness: {
      state: "ready" as const,
      entries: assets.map((asset) => ({
        holdingId: asset.id, accountCode: asset.account, name: asset.name, ticker: asset.ticker,
        readiness: buildHoldingAnalysisDataReadiness({ holding: { holdingId: asset.id, accountCode: asset.account, ...asset }, serviceDate: "2026-09-09", priceRows: [], fxRows: [] }),
      })),
    },
  };
}
