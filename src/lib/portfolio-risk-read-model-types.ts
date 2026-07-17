export type PortfolioRiskAccount = "brokerage" | "isa" | "irp" | "all";
export type PortfolioRiskWindow = 30 | 90 | 252;

type NumericSourceValue = number | string | null;

export type PortfolioRiskAssetSourceRow = {
  account: string;
  ticker: string | null;
  name: string;
  market: string;
  currency: string;
  assetType?: string | null;
  quantity: NumericSourceValue;
};

export type PortfolioRiskPriceSourceRow = {
  ticker: string;
  market: string;
  currency: string;
  priceDate: string;
  closePrice: NumericSourceValue;
  adjustedClosePrice: NumericSourceValue;
  source: string | null;
  isSample: boolean;
};

export type PortfolioRiskFxSourceRow = {
  rateDate: string;
  usdKrw: NumericSourceValue;
  source: string | null;
  status: string | null;
  isSample: boolean;
};

export type PortfolioRiskQueryRange = {
  serviceCycleDate: string;
  priceSourceDateFrom: string;
  fxSourceDateFrom: string;
  sourceDateTo: string;
};

export type PortfolioRiskSelection = {
  account: PortfolioRiskAccount;
  window: PortfolioRiskWindow;
};

export type PortfolioRiskReadRepository = {
  loadAssets(
    account: PortfolioRiskAccount,
  ): Promise<PortfolioRiskAssetSourceRow[]>;
  loadPrices(options: {
    tickers: string[];
    sourceDateFrom: string;
    sourceDateTo: string;
  }): Promise<PortfolioRiskPriceSourceRow[]>;
  loadFxRates(options: {
    sourceDateFrom: string;
    sourceDateTo: string;
  }): Promise<PortfolioRiskFxSourceRow[]>;
};
