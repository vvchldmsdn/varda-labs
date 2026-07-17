type NumericInput = number | string | null | undefined;

export type PortfolioRiskInputPolicy = {
  requestedReturnObservations: number;
  maxPriceCarryDays: number;
  maxFxCarryDays: number;
  minimumReturnCoveragePct: number;
  minimumInstruments: number;
};

export type PortfolioRiskHoldingInput = {
  account: string;
  ticker: string | null;
  name: string;
  market: string;
  currency: string;
  assetType?: string | null;
  quantity: NumericInput;
};

export type PortfolioRiskPriceInput = {
  ticker: string;
  market: string;
  currency: string;
  priceDate: string;
  closePrice: NumericInput;
  adjustedClosePrice?: NumericInput;
};

export type PortfolioRiskFxInput = {
  rateDate: string;
  usdKrw: NumericInput;
  status?: string | null;
};

export type PortfolioRiskInputExclusion = {
  account: string;
  ticker: string | null;
  name: string;
  market: string;
  currency: string;
  assetType: string | null;
  reason:
    | "missing_ticker"
    | "non_positive_holding"
    | "unsupported_currency";
};

export type PortfolioRiskInputBlocker =
  | {
      reason: "duplicate_price_date";
      instrumentKey: string;
      dates: string[];
    }
  | {
      reason: "duplicate_fx_date";
      dates: string[];
    };

export type PortfolioRiskValueObservation = {
  instrumentKey: string;
  sourcePriceDate: string;
  priceCarryDays: number;
  localClose: number;
  sourceFxDate: string | null;
  fxCarryDays: number;
  fxRate: number;
  unitValueKrw: number;
  holdingValueKrw: number;
};

export type PortfolioRiskValueRow = {
  serviceDate: string;
  complete: boolean;
  observations: PortfolioRiskValueObservation[];
  missing: Array<{
    instrumentKey: string;
    reason: "missing_price" | "stale_price" | "missing_fx" | "stale_fx";
  }>;
};

export type PortfolioRiskReturnRow = {
  previousServiceDate: string;
  serviceDate: string;
  returns: Array<{
    instrumentKey: string;
    value: number;
  }>;
};

export type PortfolioRiskInputStatus =
  | "blocked"
  | "ready"
  | "partial"
  | "insufficient_coverage"
  | "insufficient_instruments";

export type AggregatedRiskInstrument = {
  key: string;
  ticker: string;
  market: string;
  currency: "KRW" | "USD";
  names: Set<string>;
  accounts: Set<string>;
  quantity: number;
};

export type RiskPriceObservation = {
  sourceDate: string;
  serviceDate: string;
  localClose: number;
};

export type RiskFxObservation = {
  sourceDate: string;
  serviceDate: string;
  rate: number;
};
