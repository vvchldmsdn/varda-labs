import { sampleVariance } from "./portfolio-risk-statistics.ts";
import type {
  PortfolioRiskReturnRow,
} from "./portfolio-risk-input.ts";
import type { PortfolioRiskMathInstrument } from "./portfolio-risk.ts";

export const PORTFOLIO_RISK_BENCHMARKS = [
  {
    id: "kodex200",
    label: "KODEX 200",
    ticker: "069500",
    market: "korea",
    currency: "KRW",
  },
  {
    id: "voo",
    label: "Vanguard S&P 500 ETF",
    ticker: "VOO",
    market: "us",
    currency: "USD",
  },
] as const;

export type PortfolioRiskPathMetricReason =
  | "portfolio_returns_unavailable"
  | "insufficient_observations"
  | "zero_benchmark_variance";

export type PortfolioRiskPathMetric = Readonly<{
  value: number | null;
  reason: PortfolioRiskPathMetricReason | null;
}>;

export type PortfolioRiskBenchmarkSeries = Readonly<{
  id: (typeof PORTFOLIO_RISK_BENCHMARKS)[number]["id"];
  label: string;
  ticker: string;
  currency: string;
  returnRows: readonly PortfolioRiskReturnRow[];
}>;

export function calculatePortfolioRiskPathAnalytics({
  instruments,
  returnRows,
  benchmarks,
}: {
  instruments: readonly PortfolioRiskMathInstrument[];
  returnRows: readonly PortfolioRiskReturnRow[];
  benchmarks: readonly PortfolioRiskBenchmarkSeries[];
}) {
  const portfolioReturns = buildWeightedPortfolioReturns({
    instruments,
    returnRows,
  });

  return Object.freeze({
    maximumDrawdownPct: calculateMaximumDrawdownPct(portfolioReturns),
    benchmarkBetas: benchmarks.map((benchmark) =>
      Object.freeze({
        id: benchmark.id,
        label: benchmark.label,
        ticker: benchmark.ticker,
        currency: benchmark.currency,
        observationCount: countAlignedObservations(
          portfolioReturns,
          benchmark.returnRows,
        ),
        beta: calculateBeta(portfolioReturns, benchmark.returnRows),
      }),
    ),
  });
}

function buildWeightedPortfolioReturns({
  instruments,
  returnRows,
}: {
  instruments: readonly PortfolioRiskMathInstrument[];
  returnRows: readonly PortfolioRiskReturnRow[];
}) {
  const weights = new Map<string, number>();
  for (const instrument of instruments) {
    if (
      instrument.weight === null ||
      !Number.isFinite(instrument.weight) ||
      instrument.weight < 0
    ) {
      return [];
    }
    weights.set(instrument.instrumentKey, instrument.weight);
  }
  if (weights.size === 0) return [];

  const weightTotal = [...weights.values()].reduce(
    (sum, weight) => sum + weight,
    0,
  );
  if (!(weightTotal > 0)) return [];

  const result: Array<{ serviceDate: string; value: number }> = [];
  for (const row of returnRows) {
    const values = new Map(
      row.returns.map((item) => [item.instrumentKey, item.value]),
    );
    if (values.size !== weights.size) return [];

    let value = 0;
    for (const [instrumentKey, weight] of weights) {
      const instrumentReturn = values.get(instrumentKey);
      if (instrumentReturn === undefined || !Number.isFinite(instrumentReturn)) {
        return [];
      }
      value += (weight / weightTotal) * instrumentReturn;
    }
    result.push({ serviceDate: row.serviceDate, value });
  }
  return result;
}

function calculateMaximumDrawdownPct(
  returns: readonly { serviceDate: string; value: number }[],
): PortfolioRiskPathMetric {
  if (returns.length < 2) {
    return metricUnavailable(
      returns.length === 0
        ? "portfolio_returns_unavailable"
        : "insufficient_observations",
    );
  }

  let nav = 1;
  let peak = 1;
  let maximumDrawdown = 0;
  for (const row of returns) {
    nav *= 1 + row.value;
    peak = Math.max(peak, nav);
    maximumDrawdown = Math.max(maximumDrawdown, 1 - nav / peak);
  }
  return { value: maximumDrawdown * 100, reason: null };
}

function calculateBeta(
  portfolioReturns: readonly { serviceDate: string; value: number }[],
  benchmarkRows: readonly PortfolioRiskReturnRow[],
): PortfolioRiskPathMetric {
  if (portfolioReturns.length === 0) {
    return metricUnavailable("portfolio_returns_unavailable");
  }
  const aligned = alignBenchmarkReturns(portfolioReturns, benchmarkRows);
  if (aligned.portfolio.length < 2) {
    return metricUnavailable("insufficient_observations");
  }
  const benchmarkVariance = sampleVariance(aligned.benchmark);
  if (benchmarkVariance <= 1e-18) {
    return metricUnavailable("zero_benchmark_variance");
  }

  const portfolioMean = mean(aligned.portfolio);
  const benchmarkMean = mean(aligned.benchmark);
  let covariance = 0;
  for (let index = 0; index < aligned.portfolio.length; index += 1) {
    covariance +=
      (aligned.portfolio[index] - portfolioMean) *
      (aligned.benchmark[index] - benchmarkMean);
  }
  covariance /= aligned.portfolio.length - 1;
  return { value: covariance / benchmarkVariance, reason: null };
}

function countAlignedObservations(
  portfolioReturns: readonly { serviceDate: string; value: number }[],
  benchmarkRows: readonly PortfolioRiskReturnRow[],
) {
  return alignBenchmarkReturns(portfolioReturns, benchmarkRows).portfolio.length;
}

function alignBenchmarkReturns(
  portfolioReturns: readonly { serviceDate: string; value: number }[],
  benchmarkRows: readonly PortfolioRiskReturnRow[],
) {
  const benchmarkByDate = new Map<string, number>();
  for (const row of benchmarkRows) {
    const value = row.returns[0]?.value;
    if (row.returns.length === 1 && value !== undefined && Number.isFinite(value)) {
      benchmarkByDate.set(row.serviceDate, value);
    }
  }

  const portfolio: number[] = [];
  const benchmark: number[] = [];
  for (const row of portfolioReturns) {
    const benchmarkReturn = benchmarkByDate.get(row.serviceDate);
    if (benchmarkReturn === undefined) continue;
    portfolio.push(row.value);
    benchmark.push(benchmarkReturn);
  }
  return { portfolio, benchmark };
}

function metricUnavailable(
  reason: PortfolioRiskPathMetricReason,
): PortfolioRiskPathMetric {
  return { value: null, reason };
}

function mean(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
