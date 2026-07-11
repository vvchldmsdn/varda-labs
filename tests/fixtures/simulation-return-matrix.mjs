export const SIMULATION_SERVICE_DATES = Object.freeze([
  "2026-07-04",
  "2026-07-07",
  "2026-07-08",
]);

export function crossMarketSimulationFixture() {
  return {
    requestedServiceDates: [...SIMULATION_SERVICE_DATES],
    instruments: [
      instrument("069500", "korea", "KRW"),
      instrument("VOO", "us", "USD"),
    ],
    priceRows: [
      price("069500", "korea", "KRW", "2026-07-03", 100),
      price("069500", "korea", "KRW", "2026-07-06", 101),
      price("069500", "korea", "KRW", "2026-07-07", 102),
      price("VOO", "us", "USD", "2026-07-02", 100),
      price("VOO", "us", "USD", "2026-07-06", 100),
      price("VOO", "us", "USD", "2026-07-07", 100),
    ],
    fxRows: [
      fx("2026-07-03", 1000),
      fx("2026-07-06", 1010),
      fx("2026-07-07", 1020),
    ],
  };
}

export function instrument(ticker, market, currency, historyStatus = "instrument_keyed") {
  return { ticker, market, currency, historyStatus };
}

export function price(ticker, market, currency, priceDate, adjustedClosePrice) {
  return {
    ticker,
    market,
    currency,
    priceDate,
    adjustedClosePrice,
  };
}

export function fx(rateDate, usdKrw, status = "ok") {
  return { rateDate, usdKrw, status };
}
