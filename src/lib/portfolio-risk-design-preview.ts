import { PORTFOLIO_RISK_BENCHMARKS } from "./portfolio-risk-path-analytics.ts";
import { composePortfolioRiskReadModel } from "./portfolio-risk-read-model.ts";
import type { PortfolioStructureHoldingRow } from "./portfolio-structure.ts";

export function buildPortfolioRiskDesignPreview(
  holdingRows: readonly PortfolioStructureHoldingRow[],
) {
  const sourceDates = dateRange("2026-04-18", "2026-08-20");
  const endFxRate = previewFxRate(sourceDates.length - 1);
  const assetRows = holdingRows
    .filter((row) => Boolean(row.ticker))
    .map((row) => ({
      account: row.account,
      ticker: row.ticker,
      name: row.name,
      market: row.market,
      currency: row.currency,
      assetType: row.assetType,
      quantity:
        row.currency === "USD"
          ? row.currentValueKrw / (row.currentPrice * endFxRate)
          : row.currentValueKrw / row.currentPrice,
    }));
  const identities = new Map<string, RiskPreviewIdentity>();
  for (const row of holdingRows) {
    if (!row.ticker || row.currentPrice <= 0) continue;
    const key = `${row.market}|${row.currency}|${row.ticker}`;
    if (identities.has(key)) continue;
    identities.set(key, {
      ticker: row.ticker,
      market: row.market,
      currency: row.currency,
      anchorPrice: row.currentPrice,
    });
  }
  for (const benchmark of PORTFOLIO_RISK_BENCHMARKS) {
    const key = `${benchmark.market}|${benchmark.currency}|${benchmark.ticker}`;
    if (identities.has(key)) continue;
    identities.set(key, {
      ticker: benchmark.ticker,
      market: benchmark.market,
      currency: benchmark.currency,
      anchorPrice: previewFallbackPrice(benchmark.ticker, benchmark.currency),
    });
  }

  const priceRows = sourceDates.flatMap((priceDate, dateIndex) =>
    [...identities.values()].map((identity, instrumentIndex) => {
      const seed = identity.ticker
        .split("")
        .reduce((sum, character) => sum + character.charCodeAt(0), 0);
      const closePrice =
        identity.anchorPrice *
        (previewPriceLevel(dateIndex, instrumentIndex, seed) /
          previewPriceLevel(sourceDates.length - 1, instrumentIndex, seed));
      return {
        ticker: identity.ticker,
        market: identity.market,
        currency: identity.currency,
        priceDate,
        closePrice,
        adjustedClosePrice: closePrice,
        source: "design_preview",
        isSample: false,
      };
    }),
  );
  const fxRows = sourceDates.map((rateDate, index) => ({
    rateDate,
    usdKrw: previewFxRate(index),
    source: "design_preview",
    status: "ok",
    isSample: false,
  }));

  return composePortfolioRiskReadModel({
    assetSelection: "preselected",
    selection: { account: "all", window: 90 },
    queryRange: {
      serviceCycleDate: "2026-08-21",
      priceSourceDateFrom: sourceDates[0],
      fxSourceDateFrom: sourceDates[0],
      sourceDateTo: sourceDates.at(-1) ?? "2026-08-20",
    },
    assetRows,
    priceRows,
    fxRows,
  });
}

type RiskPreviewIdentity = {
  ticker: string;
  market: string;
  currency: string;
  anchorPrice: number;
};

function previewPriceLevel(
  dateIndex: number,
  instrumentIndex: number,
  seed: number,
) {
  const cycle =
    Math.sin(dateIndex * (0.12 + (instrumentIndex % 5) * 0.013) + seed) *
    0.045;
  const marketPulse = Math.cos(dateIndex * 0.071 + instrumentIndex) * 0.018;
  const trend = dateIndex * (0.00045 + (instrumentIndex % 4) * 0.00008);
  return 1 + trend + cycle + marketPulse;
}

function previewFallbackPrice(ticker: string, currency: string) {
  const seed = ticker
    .split("")
    .reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return currency === "USD" ? 110 + (seed % 220) : 8_000 + (seed % 90_000);
}

function previewFxRate(index: number) {
  return (
    1_465 +
    index * 0.21 +
    Math.sin(index * 0.105) * 18 +
    Math.cos(index * 0.039) * 7
  );
}

function dateRange(startDate: string, endDate: string) {
  const values: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= end) {
    values.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return values;
}
