import {
  annualizedSharpe,
  arithmeticMean,
  correlationMatrixFromCovariance,
  matrixVectorProduct,
  sampleCovarianceMatrix,
  standardDeviations,
  weightedAveragePairCorrelation,
  ZERO_VARIANCE_EPSILON,
} from "./portfolio-risk-statistics.ts";
import type {
  PortfolioRiskInstrumentMetrics,
  PortfolioRiskMathInstrument,
  PortfolioRiskMetric,
  PortfolioRiskStressMetrics,
} from "./portfolio-risk-types.ts";

export function buildRiskInstrumentMetrics({
  instrument,
  returns,
  volatilityDaily,
  annualizationScale,
  annualizationFactor,
  dailyRiskFreeRate,
  riskContribution,
}: {
  instrument: PortfolioRiskMathInstrument;
  returns: readonly number[];
  volatilityDaily: number;
  annualizationScale: number;
  annualizationFactor: number;
  dailyRiskFreeRate: number;
  riskContribution: RiskContributionRow | null;
}): PortfolioRiskInstrumentMetrics {
  return {
    ...instrument,
    observationCount: returns.length,
    meanReturnDaily: arithmeticMean(returns),
    volatilityDaily,
    volatilityAnnualized: volatilityDaily * annualizationScale,
    sharpe: annualizedSharpe({
      returns,
      dailyRiskFreeRate,
      annualizationFactor,
    }),
    marginalRiskDaily: riskContribution?.marginalRiskDaily ?? null,
    signedRiskContributionDaily:
      riskContribution?.signedRiskContributionDaily ?? null,
    signedRiskContributionAnnualized:
      riskContribution?.signedRiskContributionAnnualized ?? null,
    signedRiskContributionPct:
      riskContribution?.signedRiskContributionPct ?? null,
    absoluteRiskContributionDaily:
      riskContribution?.absoluteRiskContributionDaily ?? null,
    absoluteRiskSharePct: riskContribution?.absoluteRiskSharePct ?? null,
    riskContributionReason:
      riskContribution === null
        ? "insufficient_instruments"
        : riskContribution.reason,
  };
}

export function calculateRiskContribution({
  covariance,
  weights,
  portfolioVariance,
  annualizationScale,
}: {
  covariance: readonly number[][];
  weights: readonly number[];
  portfolioVariance: number;
  annualizationScale: number;
}) {
  if (portfolioVariance <= ZERO_VARIANCE_EPSILON) {
    return emptyRiskContributionResult(weights.length);
  }

  const portfolioVolatility = Math.sqrt(portfolioVariance);
  const covarianceTimesWeights = matrixVectorProduct(covariance, weights);
  const signed = weights.map(
    (weight, index) =>
      (weight * covarianceTimesWeights[index]) / portfolioVolatility,
  );
  const signedTotal = signed.reduce((sum, value) => sum + value, 0);
  const absoluteTotal = signed.reduce(
    (sum, value) => sum + Math.abs(value),
    0,
  );
  if (
    Math.abs(signedTotal) <= ZERO_VARIANCE_EPSILON ||
    absoluteTotal <= ZERO_VARIANCE_EPSILON
  ) {
    return emptyRiskContributionResult(weights.length);
  }

  const absoluteShares = signed.map((value) => Math.abs(value) / absoluteTotal);
  return {
    rows: signed.map((value, index) => ({
      marginalRiskDaily:
        covarianceTimesWeights[index] / portfolioVolatility,
      signedRiskContributionDaily: value,
      signedRiskContributionAnnualized: value * annualizationScale,
      signedRiskContributionPct: (value / signedTotal) * 100,
      absoluteRiskContributionDaily: Math.abs(value),
      absoluteRiskSharePct: absoluteShares[index] * 100,
      reason: null,
    })),
    enb: {
      value:
        1 /
        absoluteShares.reduce((sum, share) => sum + share ** 2, 0),
      reason: null,
    } as PortfolioRiskMetric,
  };
}

export function calculateRiskStressMetrics({
  series,
  weights,
  portfolioReturns,
  minimumObservations,
}: {
  series: readonly number[][];
  weights: readonly number[];
  portfolioReturns: readonly number[];
  minimumObservations: number;
}): PortfolioRiskStressMetrics {
  const downDayIndexes = portfolioReturns
    .map((value, index) => (value < 0 ? index : -1))
    .filter((index) => index >= 0);
  if (downDayIndexes.length < minimumObservations) {
    return {
      minimumObservations,
      downDayObservations: downDayIndexes.length,
      correlationMatrix: null,
      weightedAverageCorrelation: {
        value: null,
        reason: "insufficient_down_days",
      },
    };
  }

  const stressSeries = series.map((values) =>
    downDayIndexes.map((index) => values[index]),
  );
  const covariance = sampleCovarianceMatrix(stressSeries);
  const deviations = standardDeviations(covariance);
  const correlationMatrix = correlationMatrixFromCovariance(
    covariance,
    deviations,
  );
  return {
    minimumObservations,
    downDayObservations: downDayIndexes.length,
    correlationMatrix,
    weightedAverageCorrelation: weightedAveragePairCorrelation(
      correlationMatrix,
      weights,
    ),
  };
}

type RiskContributionRow = {
  marginalRiskDaily: number | null;
  signedRiskContributionDaily: number | null;
  signedRiskContributionAnnualized: number | null;
  signedRiskContributionPct: number | null;
  absoluteRiskContributionDaily: number | null;
  absoluteRiskSharePct: number | null;
  reason: "zero_portfolio_volatility" | null;
};

function emptyRiskContributionResult(instrumentCount: number) {
  return {
    rows: Array.from({ length: instrumentCount }, () =>
      emptyRiskContribution(),
    ),
    enb: {
      value: null,
      reason: "zero_portfolio_volatility",
    } as PortfolioRiskMetric,
  };
}

function emptyRiskContribution(): RiskContributionRow {
  return {
    marginalRiskDaily: null,
    signedRiskContributionDaily: null,
    signedRiskContributionAnnualized: null,
    signedRiskContributionPct: null,
    absoluteRiskContributionDaily: null,
    absoluteRiskSharePct: null,
    reason: "zero_portfolio_volatility",
  };
}
