import type { ReadOnlyHistoryBalance } from "@/db/queries/history-balance";
import { buildHomeDesignPreview } from "@/lib/home-design-preview";
import type { PortfolioHistoryDisplayRow } from "@/lib/history-balance";
import { buildHistoryPositionDetail, normalizeHistoryPositionSelection } from "@/lib/history-position-detail";
import { buildHistoryPositionComparison, normalizeHistoryPositionComparisonSelection } from "@/lib/history-position-comparison";
import type { HistoryDetailParams } from "./history-detail-state";
import { HistoryView } from "./history-view";

export function HistoryDesignPreview({ scope, detailParams = {} }: { scope?: string | string[]; detailParams?: HistoryDetailParams }) {
  const data = buildHomeDesignPreview(scope);
  const account = data.selectedScope.kind === "account" ? data.selectedScope.accountCode : "all";
  const portfolioRows: PortfolioHistoryDisplayRow[] = data.recentSnapshots.map((point): PortfolioHistoryDisplayRow => ({
    snapshotDate: point.date,
    account,
    source: "design_preview",
    rowKind: "stored",
    derivedFromAccounts: [],
    cashValue: null,
    investedAmount: null,
    totalCost: null,
    totalMarketValue: point.totalMarketValue,
    totalPnl: point.totalPnl,
    totalReturnPct: point.totalReturnPct,
  })).reverse();
  const positionDetail = buildHistoryPositionDetail({
    account,
    lane: "all",
    selection: normalizeHistoryPositionSelection({ account, lane: "all", positionDate: detailParams.positionDate, positionSource: detailParams.positionSource }),
    portfolioRows,
    positionRows: [],
  });
  const positionComparison = buildHistoryPositionComparison({
    account,
    lane: "all",
    selection: normalizeHistoryPositionComparisonSelection({ account, lane: "all", comparisonFrom: detailParams.comparisonFrom, comparisonTo: detailParams.comparisonTo }),
    portfolioRows,
    fromRows: [],
    toRows: [],
  });
  const dates = portfolioRows.map(row => row.snapshotDate).sort();
  const history: ReadOnlyHistoryBalance = {
    analysisScopes: data.analysisScopes,
    selectedScope: data.selectedScope,
    balanceAccount: null,
    lane: "all",
    readStatus: "ready",
    unavailableSources: [],
    balanceRows: [],
    portfolioRows,
    positionDetail,
    positionComparison,
    summary: {
      balanceRowCount: 0,
      portfolioRowCount: portfolioRows.length,
      derivedPortfolioRowCount: 0,
      partialPortfolioRowCount: 0,
      balanceDateRange: { minDate: null, maxDate: null },
      portfolioDateRange: { minDate: dates[0] ?? null, maxDate: dates.at(-1) ?? null },
      overlappingDateCount: 0,
    },
  };
  return <HistoryView events={null} eventsSupported={false} generatedAt={data.generatedAt} history={history} detailParams={{ ...detailParams, preview: "design" }} liveValuation={{
    state: "ready", date: "2026-08-22", capturedAt: data.generatedAt, valueKrw: data.totalValueKrw,
    holdingCount: data.holdings.length, excludedHoldingCount: 0, freshQuoteCount: data.holdings.length, recordedPriceCount: 0,
    oldestPriceAt: "2026-08-22T09:16:00+09:00", priceSources: ["design_preview"],
  }} />;
}
