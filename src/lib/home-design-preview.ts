import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import type {
  DashboardData,
  DashboardHolding,
  RecentPortfolioPoint,
} from "@/lib/portfolio-dashboard";
import type {
  PortfolioDashboardHeatmapRow,
  PortfolioDashboardHoldingHistory,
} from "@/lib/portfolio-dashboard-history";
import { buildDashboardFxTrend } from "@/lib/fx-trend";

const BROKERAGE_ID = "11111111-1111-4111-8111-111111111111";
const ISA_ID = "22222222-2222-4222-8222-222222222222";
const IRP_ID = "33333333-3333-4333-8333-333333333333";
const GROWTH_ID = "44444444-4444-4444-8444-444444444444";
const INCOME_ID = "55555555-5555-4555-8555-555555555555";

const SCOPES = Object.freeze([
  { kind: "all", key: "all", label: "전체" },
  {
    kind: "account",
    key: `account:${BROKERAGE_ID}`,
    label: "증권",
    accountId: BROKERAGE_ID,
    accountCode: "brokerage",
  },
  {
    kind: "account",
    key: `account:${ISA_ID}`,
    label: "ISA",
    accountId: ISA_ID,
    accountCode: "isa",
  },
  {
    kind: "account",
    key: `account:${IRP_ID}`,
    label: "IRP",
    accountId: IRP_ID,
    accountCode: "irp",
  },
  {
    kind: "portfolio_group",
    key: `portfolio:${GROWTH_ID}`,
    label: "성장 자산",
    portfolioGroupId: GROWTH_ID,
  },
  {
    kind: "portfolio_group",
    key: `portfolio:${INCOME_ID}`,
    label: "인컴 자산",
    portfolioGroupId: INCOME_ID,
  },
] satisfies readonly PortfolioAnalysisScope[]);

const HOLDING_SEEDS = [
  ["kodex-200", "KODEX 200", "069500", "brokerage", "korea", "KRW", 5_612_300, 117_700, 47, 14.2, -34_200, -0.61, "성장 자산"],
  ["voo", "Vanguard S&P 500 ETF", "VOO", "brokerage", "us", "USD", 4_706_500, 687.03, 4, 11.9, 41_800, 0.9, "성장 자산"],
  ["ace-dividend", "ACE 고배당", "0139P0", "brokerage", "korea", "KRW", 4_103_200, 13_305, 311, 10.4, -18_900, -0.46, "인컴 자산"],
  ["schd", "Schwab US Dividend Equity ETF", "SCHD", "brokerage", "us", "USD", 3_091_800, 32.32, 62, 7.8, 22_600, 0.74, "인컴 자산"],
  ["qqq", "Invesco QQQ Trust", "QQQ", "brokerage", "us", "USD", 2_281_400, 717.61, 2, 5.8, 37_100, 1.65, "성장 자산"],
  ["ai-semi", "KODEX AI반도체TOP10+", "395160", "brokerage", "korea", "KRW", 1_847_200, 45_470, 40, 4.7, -9_800, -0.53, "성장 자산"],
  ["ai-power", "RISE AI전력인프라", "0101N0", "isa", "korea", "KRW", 2_092_700, 20_720, 101, 5.3, 54_300, 2.66, "성장 자산"],
  ["nasdaq-isa", "TIGER 미국나스닥100", "133690", "isa", "korea", "KRW", 1_883_500, 147_190, 13, 4.8, 13_400, 0.72, "성장 자산"],
  ["topix", "KODEX 일본TOPIX100", "101280", "irp", "korea", "KRW", 1_716_900, 15_450, 111, 4.3, -12_100, -0.7, "성장 자산"],
  ["nuclear", "SOL 한국원자력SMR", "0092B0", "irp", "korea", "KRW", 1_550_800, 18_460, 84, 3.9, 28_700, 1.88, "성장 자산"],
] as const;

export function buildHomeDesignPreview(scopeInput: string | readonly string[] | undefined): DashboardData {
  const requestedScope = Array.isArray(scopeInput) ? scopeInput[0] : scopeInput;
  const selectedScope = SCOPES.find((scope) => scope.key === requestedScope) ?? SCOPES[0];
  const selectedSeeds = HOLDING_SEEDS.filter((seed) => belongsToScope(seed, selectedScope));
  const selectedTotal = selectedSeeds.reduce((sum, seed) => sum + seed[6], 0);
  const holdings = selectedSeeds.map((seed) => buildHolding(seed, selectedTotal));
  const todayChangeKrw = holdings.reduce((sum, holding) => sum + (holding.dailyChangeKrw ?? 0), 0);
  const costBasisKrw = holdings.reduce((sum, holding) => sum + holding.costBasisKrw, 0);
  const totalPnlKrw = selectedTotal - costBasisKrw;
  const latestDate = "2026-08-21";
  const recentSnapshots = buildPortfolioHistory(selectedTotal, 122, latestDate);
  const holdingHistory = buildHoldingHistory(holdings, latestDate);
  const todayFxChangeKrw = holdings
    .filter((holding) => holding.currency === "USD")
    .reduce((sum, holding) => sum - Math.round(holding.valueKrw * 0.0018), 0);

  return {
    selectedScope,
    analysisScopes: SCOPES,
    generatedAt: "2026-08-22T09:18:00+09:00",
    usdKrwRate: 1_493.62,
    fxTrend: buildPreviewFxTrend(latestDate),
    latestSnapshotDate: latestDate,
    latestSnapshotReferenceDate: latestDate,
    totalValueKrw: selectedTotal,
    costBasisKrw,
    realizedCostBasisKrw: 0,
    unrealizedPnlKrw: totalPnlKrw,
    realizedPnlKrw: 960_969,
    totalPnlKrw: totalPnlKrw + 960_969,
    holdingReturnPct: percentage(totalPnlKrw, costBasisKrw),
    totalReturnPct: percentage(totalPnlKrw + 960_969, costBasisKrw),
    todayChangeKrw,
    todayReturnPct: percentage(todayChangeKrw, selectedTotal - todayChangeKrw),
    todayFxChangeKrw,
    tradeFlowKrw: 0,
    trimDriftThreshold: 12,
    useTrendFilter: true,
    accountSummaries: buildAccountSummaries(holdings),
    holdings,
    nonInvestmentAssets: [],
    nonInvestmentTotalKrw: 0,
    recentSnapshots,
    holdingHistory,
    eventActivity: [
      {
        id: "preview-buy",
        eventDate: "2026-06-18",
        eventType: "buy",
        account: "brokerage",
        accountLabel: "증권",
        ticker: "VOO",
        assetName: "Vanguard S&P 500 ETF",
        source: "preview",
        ruleVersion: null,
        mappingStatus: "mapped",
        amountKrw: 1_250_000,
        quantityDelta: 1,
        realizedPnlKrw: null,
        realizedCostBasisKrw: null,
        missingCost: false,
      },
      {
        id: "preview-dividend",
        eventDate: "2026-07-28",
        eventType: "dividend",
        account: "brokerage",
        accountLabel: "증권",
        ticker: "SCHD",
        assetName: "Schwab US Dividend Equity ETF",
        source: "preview",
        ruleVersion: null,
        mappingStatus: "mapped",
        amountKrw: 84_500,
        quantityDelta: 0,
        realizedPnlKrw: null,
        realizedCostBasisKrw: null,
        missingCost: false,
      },
    ],
    topMovers: [...holdings].sort((left, right) => Math.abs(right.dailyChangeKrw ?? 0) - Math.abs(left.dailyChangeKrw ?? 0)).slice(0, 5),
    todayMovement: {
      ready: true,
      source: "daily_position_snapshot",
      reason: null,
      previousTotalKrw: selectedTotal - todayChangeKrw,
      changeKrw: todayChangeKrw,
      returnPct: percentage(todayChangeKrw, selectedTotal - todayChangeKrw),
      tradeFlowKrw: 0,
      fxChangeKrw: todayFxChangeKrw,
      contributionRows: [],
      exclusions: [],
      coverage: {
        currentCoveragePct: 100,
        snapshotCoveragePct: 100,
        countCoveragePct: 100,
        previousCloseCoveragePct: 100,
      },
    },
    dataHealth: {
      importedAssetCount: holdings.length,
      investmentAssetCount: holdings.length,
      nonInvestmentAssetCount: 0,
      assetCount: holdings.length,
      eventLedgerCount: 51,
      selectedEventLedgerCount: 8,
      selectedRealizedSellEventCount: 2,
      selectedUnmatchedSellEventCount: 0,
      latestSnapshotPositions: holdings.length,
      unmatchedSnapshotRows: 0,
      unmatchedSnapshotRowsAllTime: 52,
      movementReady: true,
      movementSource: "daily_position_snapshot",
      movementReason: null,
      movementCurrentCoveragePct: 100,
      movementSnapshotCoveragePct: 100,
      movementCountCoveragePct: 100,
      previousCloseCoveragePct: 100,
      movementEligibleAssetCount: holdings.length,
      movementExcludedAssetCount: 0,
      headlineBasis: "current_assets_plus_event_ledger",
      trendBasis: "daily_portfolio_snapshots",
      latestPortfolioSnapshotDate: latestDate,
      portfolioSnapshotValueDeltaKrw: todayChangeKrw,
      portfolioSnapshotPnlDeltaKrw: todayChangeKrw,
      portfolioSnapshotReturnPctDelta: percentage(todayChangeKrw, selectedTotal - todayChangeKrw),
      unsupportedCurrencyCount: 0,
      unsupportedCurrencies: [],
      latestFxRateDate: latestDate,
      latestFxSource: "frankfurter",
      latestFxFetchedAt: "2026-08-22T07:02:00+09:00",
      latestFxAgeDays: 0,
      fxFreshnessState: "fresh",
    },
  };
}

type HoldingSeed = (typeof HOLDING_SEEDS)[number];

function belongsToScope(seed: HoldingSeed, scope: PortfolioAnalysisScope) {
  if (scope.kind === "all") return true;
  if (scope.kind === "account") return seed[3] === scope.accountCode;
  if (scope.portfolioGroupId === GROWTH_ID) return seed[12] === "성장 자산";
  return seed[12] === "인컴 자산";
}

function buildHolding(seed: HoldingSeed, selectedTotal: number): DashboardHolding {
  const [id, name, ticker, account, market, currency, valueKrw, currentPrice, quantity, targetWeight, dailyChangeKrw, dailyReturnPct, groupName] = seed;
  const costBasisKrw = Math.round(valueKrw / (1 + (targetWeight - 5) / 100));
  const totalPnlKrw = valueKrw - costBasisKrw;
  const currentWeight = (valueKrw / selectedTotal) * 100;

  return {
    id,
    legacyBase44Id: null,
    name,
    ticker,
    assetType: "etf",
    movementEligible: true,
    account,
    market,
    currency,
    quantity,
    currentPrice,
    priceSource: market === "us" ? "kis_overseas_price" : "kis_domestic_inquire_price",
    priceFetchedAt: "2026-08-22T09:16:00+09:00",
    priceAsOf: "2026-08-22T09:16:00+09:00",
    priceQuoteType: "live",
    priceStatus: "ok",
    valueKrw,
    costBasisKrw,
    realizedCostBasisKrw: 0,
    unrealizedPnlKrw: totalPnlKrw,
    realizedPnlKrw: 0,
    totalPnlKrw,
    holdingReturnPct: percentage(totalPnlKrw, costBasisKrw),
    totalReturnPct: percentage(totalPnlKrw, costBasisKrw),
    currentWeight,
    targetWeight,
    effectiveTargetWeight: targetWeight,
    driftPct: currentWeight - targetWeight,
    needsTrim: currentWeight - targetWeight >= 12,
    dailyChangeKrw,
    dailyReturnPct,
    dailySource: "daily_position_snapshot",
    previousCloseValueKrw: valueKrw - dailyChangeKrw,
    fxDailyChangeKrw: currency === "USD" ? -Math.round(valueKrw * 0.0018) : 0,
    groupName,
  };
}

function buildAccountSummaries(holdings: readonly DashboardHolding[]) {
  return [
    ["brokerage", "증권"],
    ["isa", "ISA"],
    ["irp", "IRP"],
  ].flatMap(([code, label]) => {
    const rows = holdings.filter((holding) => holding.account === code);
    if (rows.length === 0) return [];
    const totalValueKrw = rows.reduce((sum, row) => sum + row.valueKrw, 0);
    const costBasisKrw = rows.reduce((sum, row) => sum + row.costBasisKrw, 0);
    const totalPnlKrw = totalValueKrw - costBasisKrw;
    return [{
      code,
      label,
      totalValueKrw,
      costBasisKrw,
      unrealizedPnlKrw: totalPnlKrw,
      realizedPnlKrw: 0,
      totalPnlKrw,
      holdingReturnPct: percentage(totalPnlKrw, costBasisKrw),
      totalReturnPct: percentage(totalPnlKrw, costBasisKrw),
      holdingCount: rows.length,
    }];
  });
}

function buildPortfolioHistory(totalValueKrw: number, count: number, endDate: string): RecentPortfolioPoint[] {
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const costBasisKrw = totalValueKrw * 0.89;
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(end - (count - index - 1) * 86_400_000).toISOString().slice(0, 10);
    const progress = index / Math.max(count - 1, 1);
    const wave = Math.sin(index / 4.8) * 0.016 + Math.sin(index / 12.7) * 0.024;
    const value = totalValueKrw * (0.86 + progress * 0.14 + wave);
    const pnl = value - costBasisKrw;
    return {
      date,
      totalMarketValue: Math.round(value),
      totalPnl: Math.round(pnl),
      totalReturnPct: percentage(pnl, costBasisKrw),
    };
  });
}

function buildHoldingHistory(holdings: readonly DashboardHolding[], endDate: string): PortfolioDashboardHoldingHistory {
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const dates = Array.from({ length: 31 }, (_, index) =>
    new Date(end - (30 - index) * 86_400_000).toISOString().slice(0, 10),
  );
  let observedCellCount = 0;
  const rows: PortfolioDashboardHeatmapRow[] = holdings.map((holding, rowIndex) => ({
    holdingId: holding.id,
    name: holding.name,
    ticker: holding.ticker,
    account: holding.account,
    currentWeight: holding.currentWeight,
    cells: dates.map((date, cellIndex) => {
      const missing = (rowIndex * 5 + cellIndex) % 23 === 0;
      if (missing) {
        return {
          date,
          changePct: null,
          changeKrw: null,
          priceChangeKrw: null,
          fxChangeKrw: null,
          basis: "missing" as const,
        };
      }
      observedCellCount += 1;
      const changePct = Number((Math.sin((rowIndex + 1) * 0.91 + cellIndex * 0.67) * 2.45).toFixed(2));
      const changeKrw = Math.round(holding.valueKrw * changePct / 100);
      const fxChangeKrw = holding.currency === "USD"
        ? Math.round(holding.valueKrw * Math.sin(cellIndex * 0.38) * 0.0015)
        : 0;
      return {
        date,
        changePct,
        changeKrw,
        priceChangeKrw: changeKrw - fxChangeKrw,
        fxChangeKrw,
        basis: "unit_value" as const,
      };
    }),
  }));
  const expectedCellCount = rows.length * dates.length;
  return {
    dates,
    rows,
    observedCellCount,
    expectedCellCount,
    coveragePct: expectedCellCount > 0 ? (observedCellCount / expectedCellCount) * 100 : null,
  };
}

function percentage(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

function buildPreviewFxTrend(endDate: string) {
  const observationCount = 180;
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const rawRows = Array.from({ length: observationCount }, (_, index) => {
    const progress = index / (observationCount - 1);
    return {
      rateDate: new Date(end - (observationCount - index - 1) * 86_400_000)
        .toISOString()
        .slice(0, 10),
      usdKrw:
        1_452 + progress * 39 + Math.sin(index / 8.3) * 9 + Math.sin(index / 21) * 5,
    };
  });
  const latestDelta = 1_493.62 - rawRows.at(-1)!.usdKrw;
  return buildDashboardFxTrend(
    rawRows.map((row) => ({ ...row, usdKrw: row.usdKrw + latestDelta })),
  );
}
