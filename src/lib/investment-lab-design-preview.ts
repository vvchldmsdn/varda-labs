import { buildHomeDesignPreview } from "./home-design-preview.ts";
import { buildPortfolioStructureDesignPreview } from "./portfolio-structure-design-preview.ts";
import { buildInvestmentLabCounterfactualReadModel } from "./investment-lab-counterfactual-read-model.ts";
import { buildInvestmentLabEtfXray } from "./investment-lab-etf-xray.ts";
import { resolveInvestmentLabFixedMixSelection } from "./investment-lab-fixed-mix-selection.ts";
import { calculateInvestmentLabPathRisk } from "./investment-lab-path-risk.ts";
import { resolveInvestmentLabPeriodSelection } from "./investment-lab-period-selection.ts";
import {
  INVESTMENT_LAB_SCENARIO_CHART_POLICY,
  type InvestmentLabScenarioChart,
} from "./investment-lab-scenario-chart.ts";
import type { InvestmentLabScenarioMatrixId } from "./investment-lab-scenario-matrix.ts";
import {
  INVESTMENT_LAB_CURRENT_SNAPSHOT_RULE_VERSION,
  INVESTMENT_LAB_CURRENT_SNAPSHOT_SOURCE,
} from "./investment-lab-source-segment-authority.ts";

type PreviewQuery = {
  scope?: string | readonly string[];
  start?: string | readonly string[];
  end?: string | readonly string[];
  kodexWeight?: string | readonly string[];
};

// Synthetic inputs for the explicit development-only preview; never stored or queried.
export function buildInvestmentLabDesignPreview(query: PreviewQuery) {
  const dashboard = buildHomeDesignPreview(query.scope);
  const structure = buildPortfolioStructureDesignPreview(query.scope).structure;
  const initialKrw =
    dashboard.holdings.reduce((sum, row) => sum + row.valueKrw, 0) * 0.86;
  const allDates = Array.from({ length: 150 }, (_, index) =>
    new Date(Date.UTC(2026, 3, 1 + index)).toISOString().slice(0, 10),
  );
  const period = resolveInvestmentLabPeriodSelection({
    availableServiceDates: allDates,
    defaultServiceDates: allDates,
    request:
      query.start === undefined && query.end === undefined
        ? undefined
        : { startServiceDate: query.start, endServiceDate: query.end },
  });
  const dates = allDates.filter(
    (date) =>
      date >= (period.selectedStartServiceDate ?? allDates[0]) &&
      date <= (period.selectedEndServiceDate ?? allDates.at(-1)!),
  );
  const selection = resolveInvestmentLabFixedMixSelection(query.kodexWeight);
  const profiles: ReadonlyArray<
    readonly [InvestmentLabScenarioMatrixId, number, number]
  > = [
    ["actual", 0.102, 0.035],
    ["kodex200", 0.255, 0.05],
    ["voo", 0.165, 0.025],
    ["fixed_mix", 0.21, 0.032],
    ["anchor_basket", 0.185, 0.03],
    ["anchor_value_weight", 0.122, 0.025],
    ["anchor_current_weight_monthly", 0.151, 0.035],
    ["anchor_equal_weight_monthly", 0.202, 0.022],
    ["zero_return", 0, 0],
  ];
  const lines = profiles.map(([id, growth, amplitude]) => ({
    id,
    label: id,
    color: id === "actual" ? "#303b35" : "#438f79",
    points: dates.map((serviceDate, index) => {
      const t = index / Math.max(1, dates.length - 1);
      const wave =
        Math.sin(t * Math.PI * 6) * amplitude +
        Math.sin(t * Math.PI * 14) * amplitude * 0.2;
      return {
        serviceDate,
        valueKrw: Math.round(initialKrw * (1 + growth * t + wave)),
        hasPendingExecution: false,
      };
    }),
  }));
  const chart: InvestmentLabScenarioChart = {
    status: "partial",
    policy: INVESTMENT_LAB_SCENARIO_CHART_POLICY,
    period: {
      startServiceDate: dates[0],
      endServiceDate: dates.at(-1)!,
      comparisonDateCount: dates.length,
    },
    lines,
    unavailableScenarioIds: [
      "approved_target_weight_monthly",
      "preperiod_min_volatility",
    ],
  };
  const actualEnd = lines[0].points.at(-1)!.valueKrw;
  const summaries = lines.map((line) => {
    const points = line.points;
    const endValueKrw = points.at(-1)!.valueKrw;
    const risk = calculateInvestmentLabPathRisk(
      points
        .slice(1)
        .map((point, index) => ({
          periodReturn: point.valueKrw / points[index].valueKrw - 1,
          calendarDays: 1,
        })),
    );
    return {
      id: line.id,
      endValueKrw,
      endDifferenceKrw: endValueKrw - actualEnd,
      returnEstimate: endValueKrw / points[0].valueKrw - 1,
      maximumDrawdown: risk.maximumDrawdown,
      annualizedVolatility: risk.annualizedVolatility,
    };
  });
  const source = (index: number, scale: number) =>
    lines[index].points.map((point) => ({
      priceDate: point.serviceDate,
      closePrice: (point.valueKrw / initialKrw) * scale,
      adjustedClosePrice: null,
      source: "kis",
      priceBasis: "kis_raw_close" as const,
    }));
  const model = buildInvestmentLabCounterfactualReadModel(
    {
      eventRows: [],
      snapshotRows: lines[0].points.map((point) => ({
        snapshotDate: point.serviceDate,
        account: "brokerage",
        cashValue: 0,
        totalMarketValue: point.valueKrw,
        usdKrw: 1380,
        source: INVESTMENT_LAB_CURRENT_SNAPSHOT_SOURCE,
        ruleVersion: INVESTMENT_LAB_CURRENT_SNAPSHOT_RULE_VERSION,
      })),
      closeRows: source(1, 90_000),
      vooCloseRows: source(2, 550),
      fxRows: dates.map((date) => ({
        rateDate: date,
        usdKrw: 1380,
        status: "ok",
        source: "design_preview",
      })),
    },
    { account: "brokerage", fixedMixSelection: selection },
  );
  const etfs = structure.holdingRows.filter(
    (holding) => holding.ticker && holding.assetType === "etf",
  );
  const etfXray = buildInvestmentLabEtfXray({
    portfolioHoldings: structure.holdingRows.filter(
      (holding) => holding.name !== "Fount",
    ),
    masters: etfs.map((holding) => ({
      referenceId: `preview-${holding.ticker}`,
      ticker: holding.ticker!,
      name: holding.name,
      market: holding.market,
      currency: holding.currency,
    })),
    holdingEvidence: etfs.flatMap((holding) =>
      [
        ["NVDA", "NVIDIA", 12, "technology"],
        ["AAPL", "Apple", 8, "technology"],
        ["MSFT", "Microsoft", 7, "technology"],
        ["AMGN", "Amgen", 4, "healthcare"],
      ].map(([symbol, name, weight, sector], index) => ({
        id: `preview-${holding.ticker}-${symbol}`,
        legacyBase44Id: null,
        etfMasterId: `preview-${holding.ticker}`,
        legacyEtfId: null,
        etfTicker: holding.ticker!,
        etfName: holding.name,
        asOfDate: "2026-08-28",
        holdingSymbol: String(symbol),
        holdingName: String(name),
        holdingMarket: "us",
        holdingCountry: "US",
        currency: "USD",
        sector: String(sector),
        industry: null,
        securityType: "stock",
        source: "design_preview",
        rank: index + 1,
        weightPct: Number(weight),
        shares: null,
        marketValue: null,
      })),
    ),
  });
  return { dashboard, chart, summaries, period, selection, model, etfXray };
}
