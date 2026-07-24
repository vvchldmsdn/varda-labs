export type PriceSyncMode = "live" | "close";

export type PriceLookupTarget = {
  key: string;
  ticker: string;
  market: string;
  currency: string;
  accounts: string[];
  assetIds: string[];
  assetNames: string[];
};

export type ProviderRequestContext = {
  mode: PriceSyncMode;
  dryRun: boolean;
  requestedAt: Date;
  fixture: boolean;
  priceDate: string;
};

export type ProviderQuoteStatus = "ok" | "empty" | "error" | "skipped";

export const ADJUSTED_CLOSE_BASIS = Object.freeze({
  provider: "provider_adjusted_close_v1",
  syntheticFixture: "synthetic_fixture_adjusted_close_v1",
} as const);

export type AdjustedCloseBasis =
  (typeof ADJUSTED_CLOSE_BASIS)[keyof typeof ADJUSTED_CLOSE_BASIS];

export type LiveQuote = {
  ticker: string;
  market: string;
  currency: string;
  price: string | null;
  priceAsOf: Date | null;
  fetchedAt: Date;
  source: string;
  quoteType: "live" | "delayed" | "realtime";
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
  adjustedCloseBasis: AdjustedCloseBasis | null;
  adjustedCloseProvider: string | null;
  adjustedCloseSource: string | null;
  adjustedCloseFetchedAt: Date | null;
  closePriceKrw: string | null;
  fxRate: string | null;
  providerSymbol: string | null;
  providerExchange: string | null;
  fetchedAt: Date;
  source: string;
  quoteType: "close";
  status: ProviderQuoteStatus;
  isSample?: boolean;
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
