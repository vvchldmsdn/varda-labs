import "server-only";

import type {
  ClosePrice,
  LiveQuote,
  MarketDataProvider,
  PriceLookupTarget,
  ProviderRequestContext,
  ProviderResult,
} from "./types";

const STUB_WARNING =
  "stub provider only; no external market data request or market data write was performed";

export function createStubMarketDataProvider(): MarketDataProvider {
  return {
    name: "stub",
    supportedMarkets: ["korea", "us"],
    async fetchLiveQuotes(targets, context) {
      return buildStubResult(
        targets.map((target) => toSkippedLiveQuote(target, context)),
        context,
      );
    },
    async fetchClosePrices(targets, context) {
      return buildStubResult(
        targets.map((target) => toSkippedClosePrice(target, context)),
        context,
      );
    },
  };
}

function buildStubResult<TQuote extends LiveQuote | ClosePrice>(
  rows: TQuote[],
  context: ProviderRequestContext,
): ProviderResult<TQuote> {
  return {
    provider: "stub",
    fetchedAt: context.requestedAt,
    rows,
    warnings: [
      STUB_WARNING,
      context.dryRun
        ? "dry run: planned writes only"
        : "write mode requested, but skeleton keeps provider results as guarded no-op",
    ],
  };
}

function toSkippedLiveQuote(
  target: PriceLookupTarget,
  context: ProviderRequestContext,
): LiveQuote {
  return {
    ticker: target.ticker,
    market: target.market,
    currency: target.currency,
    price: null,
    priceAsOf: null,
    fetchedAt: context.requestedAt,
    source: "stub",
    quoteType: "live",
    status: "skipped",
    error: "provider_not_configured",
  };
}

function toSkippedClosePrice(
  target: PriceLookupTarget,
  context: ProviderRequestContext,
): ClosePrice {
  return {
    ticker: target.ticker,
    market: target.market,
    currency: target.currency,
    priceDate: toDateKey(context.requestedAt),
    closePrice: null,
    adjustedClosePrice: null,
    closePriceKrw: null,
    fxRate: null,
    fetchedAt: context.requestedAt,
    source: "stub",
    quoteType: "close",
    status: "skipped",
    error: "provider_not_configured",
  };
}

function toDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}
