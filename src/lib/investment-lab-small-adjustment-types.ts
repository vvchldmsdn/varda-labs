export const INVESTMENT_LAB_SMALL_ADJUSTMENT_POLICY = Object.freeze({
  version: "same_account_cash_neutral_direct_holdings_v1",
  valuationBasis: "current_portfolio_structure_read_model",
  accountTransfer: "forbidden",
  externalCashKrw: 0,
  transactionCostsKrw: 0,
  persistence: "none_client_memory_only",
  targetRecommendationOrOrderAuthority: "excluded",
} as const);

export type InvestmentLabSmallAdjustmentAccount =
  | "brokerage"
  | "isa"
  | "irp";

export type InvestmentLabSmallAdjustmentHolding = Readonly<{
  key: string;
  account: InvestmentLabSmallAdjustmentAccount;
  name: string;
  ticker: string | null;
  market: string;
  currency: string;
  currentValueKrw: number;
  currentWeightPct: number;
}>;

export type InvestmentLabSmallAdjustmentAccountBlocker =
  | "incomplete_valuation_coverage"
  | "insufficient_holdings"
  | "invalid_portfolio_values";

export type InvestmentLabSmallAdjustmentAccountModel = Readonly<{
  account: InvestmentLabSmallAdjustmentAccount;
  status: "ready" | "unavailable";
  totalValueKrw: number;
  holdings: readonly InvestmentLabSmallAdjustmentHolding[];
  excludedHoldingCount: number;
  exclusionReasonCounts: Readonly<{
    missingPrice: number;
    missingFx: number;
    unsupportedCurrency: number;
  }>;
  blockers: readonly InvestmentLabSmallAdjustmentAccountBlocker[];
}>;

export type InvestmentLabSmallAdjustmentModel = Readonly<{
  policy: typeof INVESTMENT_LAB_SMALL_ADJUSTMENT_POLICY;
  accounts: readonly InvestmentLabSmallAdjustmentAccountModel[];
}>;

export type InvestmentLabSmallAdjustmentCalculationBlocker =
  | "account_unavailable"
  | "source_holding_unavailable"
  | "destination_holding_unavailable"
  | "same_holding"
  | "invalid_transfer_amount"
  | "insufficient_source_value"
  | "invalid_calculation_result";

export type InvestmentLabSmallAdjustmentConcentration = Readonly<{
  largestHoldingWeightPct: number;
  hhiPoints: number;
}>;

export type InvestmentLabSmallAdjustmentCurrencyExposure = Readonly<{
  currency: string;
  beforeValueKrw: number;
  afterValueKrw: number;
  beforeWeightPct: number;
  afterWeightPct: number;
  changePercentagePoints: number;
}>;

export type InvestmentLabSmallAdjustmentCalculation =
  | Readonly<{
      status: "ready";
      policy: typeof INVESTMENT_LAB_SMALL_ADJUSTMENT_POLICY;
      account: InvestmentLabSmallAdjustmentAccount;
      transferAmountKrw: number;
      totalValueKrw: number;
      source: Readonly<{
        key: string;
        name: string;
        ticker: string | null;
        beforeValueKrw: number;
        afterValueKrw: number;
        beforeWeightPct: number;
        afterWeightPct: number;
      }>;
      destination: Readonly<{
        key: string;
        name: string;
        ticker: string | null;
        beforeValueKrw: number;
        afterValueKrw: number;
        beforeWeightPct: number;
        afterWeightPct: number;
      }>;
      beforeConcentration: InvestmentLabSmallAdjustmentConcentration;
      afterConcentration: InvestmentLabSmallAdjustmentConcentration;
      currencyExposures: readonly InvestmentLabSmallAdjustmentCurrencyExposure[];
      blockers: readonly [];
    }>
  | Readonly<{
      status: "blocked";
      policy: typeof INVESTMENT_LAB_SMALL_ADJUSTMENT_POLICY;
      account: InvestmentLabSmallAdjustmentAccount;
      blockers: readonly InvestmentLabSmallAdjustmentCalculationBlocker[];
    }>;
