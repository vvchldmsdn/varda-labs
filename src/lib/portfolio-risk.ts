import {
  buildRiskInstrumentMetrics,
  calculateRiskContribution,
  calculateRiskStressMetrics,
} from "./portfolio-risk-derived-metrics.ts";
import {
  annualizedSharpe,
  arithmeticMean,
  correlationMatrixFromCovariance,
  safePortfolioVariance,
  sampleCovarianceMatrix,
  sampleVariance,
  standardDeviations,
  weightedAveragePairCorrelation,
  weightedSeries,
  ZERO_VARIANCE_EPSILON,
} from "./portfolio-risk-statistics.ts";
import type {
  PortfolioRiskCalculationReason,
  PortfolioRiskMathInput,
  PortfolioRiskMathInstrument,
  PortfolioRiskResult,
} from "./portfolio-risk-types.ts";

export type {
  PortfolioRiskCalculationReason,
  PortfolioRiskCalculationStatus,
  PortfolioRiskInstrumentMetrics,
  PortfolioRiskMathInput,
  PortfolioRiskMathInstrument,
  PortfolioRiskMetric,
  PortfolioRiskMetricReason,
  PortfolioRiskPortfolioMetrics,
  PortfolioRiskResult,
  PortfolioRiskStressMetrics,
} from "./portfolio-risk-types.ts";

const DEFAULT_ANNUALIZATION_FACTOR = 252;
const DEFAULT_MINIMUM_STRESS_OBSERVATIONS = 10;
const WEIGHT_SUM_TOLERANCE = 1e-6;

type PreparedRiskData = {
  instruments: readonly PortfolioRiskMathInstrument[];
  weights: number[];
  series: number[][];
  observationCount: number;
};

export function calculatePortfolioRisk(
  input: PortfolioRiskMathInput,
): PortfolioRiskResult {
  const policy = resolveMathPolicy(input);
  const base = baseResult(input, policy);
  if (!policy.valid) return unavailableResult(base, "invalid", "invalid_input");
  if (input.inputStatus === "blocked") {
    return unavailableResult(base, "unavailable", "input_blocked");
  }
  if (input.inputStatus === "insufficient_coverage") {
    return unavailableResult(
      base,
      "unavailable",
      "input_insufficient_coverage",
    );
  }
  if (input.instruments.length === 0) {
    return unavailableResult(base, "unavailable", "no_instruments");
  }

  const prepared = prepareRiskData(input);
  if (!prepared) return unavailableResult(base, "invalid", "invalid_input");
  if (prepared.observationCount < 2) {
    return unavailableResult(base, "invalid", "insufficient_observations");
  }

  if (input.inputStatus === "insufficient_instruments") {
    if (prepared.instruments.length !== 1) {
      return unavailableResult(base, "invalid", "invalid_input");
    }
    return standaloneResult(base, prepared);
  }
  if (
    (input.inputStatus !== "ready" && input.inputStatus !== "partial") ||
    prepared.instruments.length < 2
  ) {
    return unavailableResult(base, "invalid", "invalid_input");
  }

  return completeResult(base, prepared, policy.minimumStressObservations);
}

function completeResult(
  base: ReturnType<typeof baseResult>,
  prepared: PreparedRiskData,
  minimumStressObservations: number,
): PortfolioRiskResult {
  const covariance = sampleCovarianceMatrix(prepared.series);
  const deviations = standardDeviations(covariance);
  const correlationMatrix = correlationMatrixFromCovariance(
    covariance,
    deviations,
  );
  const portfolioVariance = safePortfolioVariance(
    covariance,
    prepared.weights,
  );
  if (portfolioVariance === null) {
    return unavailableResult(base, "invalid", "invalid_covariance");
  }

  const annualizationScale = Math.sqrt(base.annualizationFactor);
  const portfolioReturns = weightedSeries(prepared.series, prepared.weights);
  const portfolioVolatilityDaily = Math.sqrt(portfolioVariance);
  const riskContribution = calculateRiskContribution({
    covariance,
    weights: prepared.weights,
    portfolioVariance,
    annualizationScale,
  });
  const zeroVarianceInstruments = prepared.instruments
    .filter((_, index) => covariance[index][index] <= ZERO_VARIANCE_EPSILON)
    .map((instrument) => instrument.instrumentKey);
  const instruments = prepared.instruments.map((instrument, index) =>
    buildRiskInstrumentMetrics({
      instrument,
      returns: prepared.series[index],
      volatilityDaily: deviations[index],
      annualizationScale,
      annualizationFactor: base.annualizationFactor,
      dailyRiskFreeRate: base.dailyRiskFreeRate,
      riskContribution: riskContribution.rows[index],
    }),
  );

  return {
    ...base,
    calculationStatus: "complete",
    reason: null,
    observationCount: prepared.observationCount,
    instruments,
    portfolio: {
      observationCount: prepared.observationCount,
      meanReturnDaily: arithmeticMean(portfolioReturns),
      volatilityDaily: portfolioVolatilityDaily,
      volatilityAnnualized: portfolioVolatilityDaily * annualizationScale,
      weightedAverageStandaloneVolatilityAnnualized: prepared.weights.reduce(
        (sum, weight, index) =>
          sum + weight * deviations[index] * annualizationScale,
        0,
      ),
      sharpe: annualizedSharpe({
        returns: portfolioReturns,
        dailyRiskFreeRate: base.dailyRiskFreeRate,
        annualizationFactor: base.annualizationFactor,
      }),
      correlationMatrix,
      weightedAverageCorrelation: weightedAveragePairCorrelation(
        correlationMatrix,
        prepared.weights,
      ),
      riskContributionEnb: riskContribution.enb,
      stress: calculateRiskStressMetrics({
        series: prepared.series,
        weights: prepared.weights,
        portfolioReturns,
        minimumObservations: minimumStressObservations,
      }),
    },
    dataHealth: { zeroVarianceInstruments },
  };
}

function standaloneResult(
  base: ReturnType<typeof baseResult>,
  prepared: PreparedRiskData,
): PortfolioRiskResult {
  const returns = prepared.series[0];
  const volatilityDaily = Math.sqrt(sampleVariance(returns));
  const instrument = buildRiskInstrumentMetrics({
    instrument: prepared.instruments[0],
    returns,
    volatilityDaily,
    annualizationScale: Math.sqrt(base.annualizationFactor),
    annualizationFactor: base.annualizationFactor,
    dailyRiskFreeRate: base.dailyRiskFreeRate,
    riskContribution: null,
  });

  return {
    ...base,
    calculationStatus: "standalone_only",
    reason: null,
    observationCount: prepared.observationCount,
    instruments: [instrument],
    portfolio: null,
    dataHealth: {
      zeroVarianceInstruments:
        volatilityDaily ** 2 <= ZERO_VARIANCE_EPSILON
          ? [instrument.instrumentKey]
          : [],
    },
  };
}

function prepareRiskData(input: PortfolioRiskMathInput): PreparedRiskData | null {
  const keys = input.instruments.map((instrument) => instrument.instrumentKey);
  if (new Set(keys).size !== keys.length) return null;
  const rawWeights = input.instruments.map((instrument) => instrument.weight);
  if (
    rawWeights.some(
      (weight) => weight === null || !Number.isFinite(weight) || weight < 0,
    )
  ) {
    return null;
  }
  const numericWeights = rawWeights as number[];
  const weightSum = numericWeights.reduce((sum, value) => sum + value, 0);
  if (
    !(weightSum > 0) ||
    Math.abs(weightSum - 1) > WEIGHT_SUM_TOLERANCE
  ) {
    return null;
  }

  const series = keys.map(() => [] as number[]);
  let previousServiceDate: string | null = null;
  for (const row of input.returnRows) {
    if (previousServiceDate && row.serviceDate <= previousServiceDate) return null;
    previousServiceDate = row.serviceDate;
    const values = new Map<string, number>();
    for (const item of row.returns) {
      if (
        values.has(item.instrumentKey) ||
        !Number.isFinite(item.value) ||
        item.value <= -1
      ) {
        return null;
      }
      values.set(item.instrumentKey, item.value);
    }
    if (values.size !== keys.length) return null;
    for (let index = 0; index < keys.length; index += 1) {
      const value = values.get(keys[index]);
      if (value === undefined) return null;
      series[index].push(value);
    }
  }

  return {
    instruments: input.instruments,
    weights: numericWeights.map((weight) => weight / weightSum),
    series,
    observationCount: input.returnRows.length,
  };
}

function resolveMathPolicy(input: PortfolioRiskMathInput) {
  const annualRiskFreeRate = input.annualRiskFreeRate ?? 0;
  const valid =
    Number.isFinite(annualRiskFreeRate) &&
    annualRiskFreeRate > -1;

  return {
    valid,
    annualizationFactor: DEFAULT_ANNUALIZATION_FACTOR,
    annualRiskFreeRate: valid ? annualRiskFreeRate : 0,
    minimumStressObservations: DEFAULT_MINIMUM_STRESS_OBSERVATIONS,
  };
}

function baseResult(
  input: PortfolioRiskMathInput,
  policy: ReturnType<typeof resolveMathPolicy>,
) {
  return {
    formulaVersion: "portfolio_risk_v1" as const,
    returnCurrencyMode: "krw_investor" as const,
    returnType: "simple" as const,
    covarianceType: "sample" as const,
    inputStatus: input.inputStatus,
    annualizationFactor: policy.annualizationFactor,
    annualRiskFreeRate: policy.annualRiskFreeRate,
    dailyRiskFreeRate:
      (1 + policy.annualRiskFreeRate) **
        (1 / policy.annualizationFactor) -
      1,
  };
}

function unavailableResult(
  base: ReturnType<typeof baseResult>,
  calculationStatus: "unavailable" | "invalid",
  reason: PortfolioRiskCalculationReason,
): PortfolioRiskResult {
  return {
    ...base,
    calculationStatus,
    reason,
    observationCount: 0,
    instruments: [],
    portfolio: null,
    dataHealth: { zeroVarianceInstruments: [] },
  };
}
