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
      if (context.fixture) {
        return buildStubResult(
          targets.map((target) => toFixtureClosePrice(target, context)),
          context,
        );
      }

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
    priceDate: context.priceDate,
    closePrice: null,
    adjustedClosePrice: null,
    closePriceKrw: null,
    fxRate: null,
    fetchedAt: context.requestedAt,
    source: "stub",
    quoteType: "close",
    status: "skipped",
    isSample: true,
    error: "provider_not_configured",
  };
}

function toFixtureClosePrice(
  target: PriceLookupTarget,
  context: ProviderRequestContext,
): ClosePrice {
  const closePrice = deterministicClosePrice(target);
  const fxRate = target.currency.toLowerCase() === "usd" ? "1380.000000" : null;
  const closePriceKrw =
    fxRate === null
      ? closePrice
      : (Number(closePrice) * Number(fxRate)).toFixed(12);

  return {
    ticker: target.ticker,
    market: target.market,
    currency: target.currency,
    priceDate: context.priceDate,
    closePrice,
    adjustedClosePrice: closePrice,
    closePriceKrw,
    fxRate,
    fetchedAt: context.requestedAt,
    source: "stub_fixture",
    quoteType: "close",
    status: "ok",
    isSample: true,
  };
}

function deterministicClosePrice(target: PriceLookupTarget) {
  const seed = Array.from(`${target.market}:${target.ticker}:${target.currency}`)
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const currency = target.currency.toLowerCase();
  const rawPrice = currency === "usd" ? 20 + (seed % 300) : 5000 + (seed % 90000);

  return rawPrice.toFixed(12);
}
