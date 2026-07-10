import type {
  PortfolioRiskInputStatus,
  PortfolioRiskReturnRow,
} from "./portfolio-risk-input-types.ts";

export type PortfolioRiskMetricReason =
  | "insufficient_observations"
  | "zero_variance"
  | "zero_portfolio_volatility"
  | "insufficient_instruments"
  | "undefined_pair_correlation"
  | "no_positive_weight_pairs"
  | "insufficient_down_days";

export type PortfolioRiskMetric = {
  value: number | null;
  reason: PortfolioRiskMetricReason | null;
};

export type PortfolioRiskMathInstrument = {
  instrumentKey: string;
  ticker: string;
  names: string[];
  market: string;
  currency: string;
  accounts: string[];
  weight: number | null;
};

export type PortfolioRiskMathInput = {
  inputStatus: PortfolioRiskInputStatus;
  instruments: readonly PortfolioRiskMathInstrument[];
  returnRows: readonly PortfolioRiskReturnRow[];
  annualRiskFreeRate?: number;
};

export type PortfolioRiskInstrumentMetrics = PortfolioRiskMathInstrument & {
  observationCount: number;
  meanReturnDaily: number;
  volatilityDaily: number;
  volatilityAnnualized: number;
  sharpe: PortfolioRiskMetric;
  marginalRiskDaily: number | null;
  signedRiskContributionDaily: number | null;
  signedRiskContributionAnnualized: number | null;
  signedRiskContributionPct: number | null;
  absoluteRiskContributionDaily: number | null;
  absoluteRiskSharePct: number | null;
  riskContributionReason: PortfolioRiskMetricReason | null;
};

export type PortfolioRiskStressMetrics = {
  minimumObservations: number;
  downDayObservations: number;
  correlationMatrix: Array<Array<number | null>> | null;
  weightedAverageCorrelation: PortfolioRiskMetric;
};

export type PortfolioRiskPortfolioMetrics = {
  observationCount: number;
  meanReturnDaily: number;
  volatilityDaily: number;
  volatilityAnnualized: number;
  weightedAverageStandaloneVolatilityAnnualized: number;
  sharpe: PortfolioRiskMetric;
  correlationMatrix: Array<Array<number | null>>;
  weightedAverageCorrelation: PortfolioRiskMetric;
  riskContributionEnb: PortfolioRiskMetric;
  stress: PortfolioRiskStressMetrics;
};

export type PortfolioRiskCalculationStatus =
  | "complete"
  | "standalone_only"
  | "unavailable"
  | "invalid";

export type PortfolioRiskCalculationReason =
  | "input_blocked"
  | "input_insufficient_coverage"
  | "no_instruments"
  | "invalid_input"
  | "insufficient_observations"
  | "invalid_covariance";

export type PortfolioRiskResult = {
  formulaVersion: "portfolio_risk_v1";
  returnCurrencyMode: "krw_investor";
  returnType: "simple";
  covarianceType: "sample";
  calculationStatus: PortfolioRiskCalculationStatus;
  reason: PortfolioRiskCalculationReason | null;
  inputStatus: PortfolioRiskInputStatus;
  annualizationFactor: number;
  annualRiskFreeRate: number;
  dailyRiskFreeRate: number;
  observationCount: number;
  instruments: PortfolioRiskInstrumentMetrics[];
  portfolio: PortfolioRiskPortfolioMetrics | null;
  dataHealth: {
    zeroVarianceInstruments: string[];
  };
};
