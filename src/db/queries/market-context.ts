import "server-only";

import { asc, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import {
  benchmarkSnapshots,
  globalMarketFactors,
  marketRegimeDaily,
} from "@/db/schema";
import {
  groupGlobalMarketFactorsByFamily,
  selectLatestBenchmarksByTicker,
  selectLatestGlobalMarketFactorsByKey,
  selectLatestMarketRegimesByAccount,
  summarizeMarketRegimeDuplicateGroups,
  type MarketRegimeDuplicateGroup,
} from "@/lib/market-context";

export const DEFAULT_MARKET_BENCHMARK_TICKERS = ["069500", "VOO"] as const;

type DecimalValue = string | null;

export type ReadOnlyMarketBenchmark = {
  ticker: string;
  name: string;
  date: string;
  source: string | null;
  currency: string;
  closePrice: string;
  normalizedIndexValue: string;
  fxRate: DecimalValue;
};

export type ReadOnlyMarketRegime = {
  account: string;
  date: string;
  label: string;
  description: string | null;
  driverKeys: string[];
  duplicateRowCount: number;
  selectedFromDuplicateGroup: boolean;
  macroStressScore: DecimalValue;
  regimeScore: DecimalValue;
  newsSentimentScore: DecimalValue;
  avgCorrelation: DecimalValue;
  enb: DecimalValue;
  portfolioVolatility: DecimalValue;
  yieldCurve: DecimalValue;
  rateLevel: DecimalValue;
  stressBadgeCount: number | null;
};

export type ReadOnlyMarketFactor = {
  key: string;
  family: string;
  name: string;
  date: string;
  frequency: string;
  source: string;
  sourceSeriesId: string;
  countryCode: string;
  region: string;
  relatedCurrency: string;
  tenor: string;
  description: string | null;
  isPreliminary: boolean;
  value: string;
  prevValue: string;
  changePct: DecimalValue;
  change1mPct: DecimalValue;
  change3mPct: DecimalValue;
  change6mPct: DecimalValue;
  changeSpeed20d: DecimalValue;
  percentile1y: string;
  volatility20dPct: string;
  volatility60dPct: string;
  carrySpreadValue: DecimalValue;
  periodEndDate: string;
  releaseDate: string;
  observedAt: Date;
};

export type ReadOnlyMarketFactorFamily =
  {
    family: string;
    factors: ReadOnlyMarketFactor[];
  };

export type ReadOnlyMarketContext = {
  requestedBenchmarkTickers: string[];
  benchmarks: ReadOnlyMarketBenchmark[];
  regimes: ReadOnlyMarketRegime[];
  regimeDuplicateGroupCount: number;
  regimeDuplicateGroups: MarketRegimeDuplicateGroup[];
  factorFamilies: ReadOnlyMarketFactorFamily[];
};

export async function getReadOnlyMarketContext({
  benchmarkTickers = DEFAULT_MARKET_BENCHMARK_TICKERS,
}: {
  benchmarkTickers?: readonly string[];
} = {}): Promise<ReadOnlyMarketContext> {
  const requestedBenchmarkTickers = benchmarkTickers.map((ticker) =>
    ticker.trim().toUpperCase(),
  );
  const [benchmarkRows, regimeRows, factorRows] = await Promise.all([
    loadBenchmarkRows(requestedBenchmarkTickers),
    loadMarketRegimeRows(),
    loadGlobalMarketFactorRows(),
  ]);

  const latestBenchmarks = selectLatestBenchmarksByTicker(
    benchmarkRows,
    requestedBenchmarkTickers,
  );
  const regimeDuplicateGroups = summarizeMarketRegimeDuplicateGroups(regimeRows);
  const regimeDuplicateGroupsByKey = new Map(
    regimeDuplicateGroups.map((group) => [
      `${group.date}|${group.account}`,
      group,
    ]),
  );
  const latestRegimes = selectLatestMarketRegimesByAccount(regimeRows);
  const latestFactors = selectLatestGlobalMarketFactorsByKey(factorRows);
  const factorFamilies = groupGlobalMarketFactorsByFamily(latestFactors);

  return {
    requestedBenchmarkTickers,
    benchmarks: latestBenchmarks.map((row) => ({
      ticker: row.benchmarkTicker,
      name: row.benchmarkName,
      date: row.benchmarkDate,
      source: row.source,
      currency: row.currency,
      closePrice: row.closePrice,
      normalizedIndexValue: row.normalizedIndexValue,
      fxRate: row.fxRate,
    })),
    regimes: latestRegimes.map((row) => {
      const duplicateGroup = regimeDuplicateGroupsByKey.get(
        `${row.regimeDate}|${row.account}`,
      );

      return {
        account: row.account,
        date: row.regimeDate,
        label: row.label,
        description: row.description,
        driverKeys: jsonObjectKeys(row.driversJson),
        duplicateRowCount: duplicateGroup?.rowCount ?? 1,
        selectedFromDuplicateGroup:
          duplicateGroup?.selectedLegacyBase44Id === row.legacyBase44Id,
        macroStressScore: row.macroStressScore,
        regimeScore: row.regimeScore,
        newsSentimentScore: row.newsSentimentScore,
        avgCorrelation: row.avgCorrelation,
        enb: row.enb,
        portfolioVolatility: row.portfolioVolatility,
        yieldCurve: row.yieldCurve,
        rateLevel: row.rateLevel,
        stressBadgeCount: row.stressBadgeCount,
      };
    }),
    regimeDuplicateGroupCount: regimeDuplicateGroups.length,
    regimeDuplicateGroups,
    factorFamilies: factorFamilies.map((family) => ({
      family: family.family,
      factors: family.factors.map((row) => ({
        key: row.factorKey,
        family: row.factorFamily,
        name: row.factorName,
        date: row.factorDate,
        frequency: row.frequency,
        source: row.source,
        sourceSeriesId: row.sourceSeriesId,
        countryCode: row.countryCode,
        region: row.region,
        relatedCurrency: row.relatedCurrency,
        tenor: row.tenor,
        description: row.description,
        isPreliminary: row.isPreliminary,
        value: row.value,
        prevValue: row.prevValue,
        changePct: row.changePct,
        change1mPct: row.change1mPct,
        change3mPct: row.change3mPct,
        change6mPct: row.change6mPct,
        changeSpeed20d: row.changeSpeed20d,
        percentile1y: row.percentile1y,
        volatility20dPct: row.volatility20dPct,
        volatility60dPct: row.volatility60dPct,
        carrySpreadValue: row.carrySpreadValue,
        periodEndDate: row.periodEndDate,
        releaseDate: row.releaseDate,
        observedAt: row.observedAt,
      })),
    })),
  };
}

function loadBenchmarkRows(tickers: string[]) {
  return db
    .select({
      legacyBase44Id: benchmarkSnapshots.legacyBase44Id,
      benchmarkDate: benchmarkSnapshots.benchmarkDate,
      benchmarkTicker: benchmarkSnapshots.benchmarkTicker,
      benchmarkName: benchmarkSnapshots.benchmarkName,
      currency: benchmarkSnapshots.currency,
      closePrice: benchmarkSnapshots.closePrice,
      normalizedIndexValue: benchmarkSnapshots.normalizedIndexValue,
      fxRate: benchmarkSnapshots.fxRate,
      source: benchmarkSnapshots.source,
      base44UpdatedAt: benchmarkSnapshots.base44UpdatedAt,
      createdAt: benchmarkSnapshots.createdAt,
      updatedAt: benchmarkSnapshots.updatedAt,
    })
    .from(benchmarkSnapshots)
    .where(inArray(benchmarkSnapshots.benchmarkTicker, tickers))
    .orderBy(
      asc(benchmarkSnapshots.benchmarkTicker),
      asc(benchmarkSnapshots.benchmarkDate),
    );
}

function loadMarketRegimeRows() {
  return db
    .select({
      legacyBase44Id: marketRegimeDaily.legacyBase44Id,
      regimeDate: marketRegimeDaily.regimeDate,
      account: marketRegimeDaily.account,
      label: marketRegimeDaily.label,
      description: marketRegimeDaily.description,
      driversJson: marketRegimeDaily.driversJson,
      macroStressScore: marketRegimeDaily.macroStressScore,
      regimeScore: marketRegimeDaily.regimeScore,
      newsSentimentScore: marketRegimeDaily.newsSentimentScore,
      avgCorrelation: marketRegimeDaily.avgCorrelation,
      enb: marketRegimeDaily.enb,
      portfolioVolatility: marketRegimeDaily.portfolioVolatility,
      yieldCurve: marketRegimeDaily.yieldCurve,
      rateLevel: marketRegimeDaily.rateLevel,
      stressBadgeCount: marketRegimeDaily.stressBadgeCount,
      base44UpdatedAt: marketRegimeDaily.base44UpdatedAt,
      createdAt: marketRegimeDaily.createdAt,
      updatedAt: marketRegimeDaily.updatedAt,
    })
    .from(marketRegimeDaily)
    .orderBy(asc(marketRegimeDaily.account), asc(marketRegimeDaily.regimeDate));
}

function loadGlobalMarketFactorRows() {
  return db
    .select({
      legacyBase44Id: globalMarketFactors.legacyBase44Id,
      factorDate: globalMarketFactors.factorDate,
      factorKey: globalMarketFactors.factorKey,
      factorFamily: globalMarketFactors.factorFamily,
      factorName: globalMarketFactors.factorName,
      frequency: globalMarketFactors.frequency,
      source: globalMarketFactors.source,
      sourceSeriesId: globalMarketFactors.sourceSeriesId,
      benchmarkKey: globalMarketFactors.benchmarkKey,
      countryCode: globalMarketFactors.countryCode,
      region: globalMarketFactors.region,
      relatedCurrency: globalMarketFactors.relatedCurrency,
      tenor: globalMarketFactors.tenor,
      description: globalMarketFactors.description,
      isPreliminary: globalMarketFactors.isPreliminary,
      value: globalMarketFactors.value,
      prevValue: globalMarketFactors.prevValue,
      changePct: globalMarketFactors.changePct,
      change1mPct: globalMarketFactors.change1mPct,
      change3mPct: globalMarketFactors.change3mPct,
      change6mPct: globalMarketFactors.change6mPct,
      changeSpeed20d: globalMarketFactors.changeSpeed20d,
      percentile1y: globalMarketFactors.percentile1y,
      volatility20dPct: globalMarketFactors.volatility20dPct,
      volatility60dPct: globalMarketFactors.volatility60dPct,
      carrySpreadValue: globalMarketFactors.carrySpreadValue,
      periodEndDate: globalMarketFactors.periodEndDate,
      releaseDate: globalMarketFactors.releaseDate,
      observedAt: globalMarketFactors.observedAt,
      base44UpdatedAt: globalMarketFactors.base44UpdatedAt,
      createdAt: globalMarketFactors.createdAt,
      updatedAt: globalMarketFactors.updatedAt,
    })
    .from(globalMarketFactors)
    .orderBy(
      asc(globalMarketFactors.factorFamily),
      asc(globalMarketFactors.factorKey),
      asc(globalMarketFactors.factorDate),
    );
}

function jsonObjectKeys(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value).sort((left, right) => left.localeCompare(right));
}
