export type PriceSyncMode = "live" | "close";

export type PriceLookupTarget = {
  key: string;
  ticker: string;
  market: string;
  currency: string;
  assetIds: string[];
  assetNames: string[];
};

export type ProviderRequestContext = {
  mode: PriceSyncMode;
  dryRun: boolean;
  requestedAt: Date;
};

export type ProviderQuoteStatus = "ok" | "empty" | "error" | "skipped";

export type LiveQuote = {
  ticker: string;
  market: string;
  currency: string;
  price: string | null;
  priceAsOf: Date | null;
  fetchedAt: Date;
  source: string;
  quoteType: "live";
  status: ProviderQuoteStatus;
  error?: string;
};

export type ClosePrice = {
  ticker: string;
  market: string;
  currency: string;
  priceDate: string;
  closePrice: string | null;
  adjustedClosePrice: string | null;
  closePriceKrw: string | null;
  fxRate: string | null;
  fetchedAt: Date;
  source: string;
  quoteType: "close";
  status: ProviderQuoteStatus;
  error?: string;
};

export type ProviderResult<TQuote extends LiveQuote | ClosePrice> = {
  provider: string;
  fetchedAt: Date;
  rows: TQuote[];
  warnings: string[];
};

export type MarketDataProvider = {
  name: string;
  supportedMarkets: string[];
  fetchLiveQuotes(
    targets: PriceLookupTarget[],
    context: ProviderRequestContext,
  ): Promise<ProviderResult<LiveQuote>>;
  fetchClosePrices(
    targets: PriceLookupTarget[],
    context: ProviderRequestContext,
  ): Promise<ProviderResult<ClosePrice>>;
};
