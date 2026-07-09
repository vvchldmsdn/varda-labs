export function crossMarketRiskFixture() {
  return {
    holdings: [
      {
        account: "brokerage",
        ticker: "069500",
        name: "KODEX 200",
        market: "korea",
        currency: "KRW",
        quantity: 1,
      },
      {
        account: "brokerage",
        ticker: "VOO",
        name: "VOO",
        market: "us",
        currency: "USD",
        quantity: 1,
      },
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

export function duplicateFxCarryFixture(duplicateRateDate) {
  const fixture = crossMarketRiskFixture();
  return {
    ...fixture,
    fxRows: [
      ...fixture.fxRows,
      fx(duplicateRateDate, 995),
      fx(duplicateRateDate, 995),
    ],
  };
}

export function price(ticker, market, currency, priceDate, closePrice) {
  return {
    ticker,
    market,
    currency,
    priceDate,
    closePrice,
  };
}

export function fx(rateDate, usdKrw) {
  return {
    rateDate,
    usdKrw,
    status: "ok",
  };
}
