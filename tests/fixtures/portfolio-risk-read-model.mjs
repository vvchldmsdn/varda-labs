export function portfolioRiskReadModelFixture({
  observationCount = 30,
  constantKrwPrice = false,
} = {}) {
  const sourceDates = dateRangeEnding("2026-07-09", observationCount + 1);
  const assetRows = [
    {
      account: "brokerage",
      ticker: "069500",
      name: "KODEX 200",
      market: "korea",
      currency: "KRW",
      quantity: "10",
      id: "11111111-1111-4111-8111-111111111111",
      legacyBase44Id: "aaaaaaaaaaaaaaaaaaaaaaaa",
    },
    {
      account: "brokerage",
      ticker: "VOO",
      name: "Vanguard S&P 500 ETF",
      market: "us",
      currency: "USD",
      quantity: "2",
      id: "22222222-2222-4222-8222-222222222222",
      legacyBase44Id: "bbbbbbbbbbbbbbbbbbbbbbbb",
    },
  ];
  const priceRows = sourceDates.flatMap((priceDate, index) => [
    priceRow({
      ticker: "069500",
      market: "korea",
      currency: "KRW",
      priceDate,
      closePrice: constantKrwPrice ? 100 : 100 + index * 0.35,
    }),
    priceRow({
      ticker: "VOO",
      market: "us",
      currency: "USD",
      priceDate,
      closePrice: 200 + index * 0.4 + (index % 3) * 0.15,
    }),
  ]);
  const fxRows = sourceDates.map((rateDate, index) =>
    fxRow({ rateDate, usdKrw: 1300 + index * 0.7 }),
  );

  return {
    selection: { account: "brokerage", window: observationCount },
    queryRange: {
      serviceCycleDate: "2026-07-10",
      priceSourceDateFrom: sourceDates[0],
      fxSourceDateFrom: shiftDate(sourceDates[0], -3),
      sourceDateTo: sourceDates.at(-1),
    },
    assetRows,
    priceRows,
    fxRows,
  };
}

export function priceRow({
  ticker,
  market,
  currency,
  priceDate,
  closePrice,
  source = "fixture_price",
  isSample = false,
}) {
  return {
    ticker,
    market,
    currency,
    priceDate,
    closePrice,
    adjustedClosePrice: null,
    source,
    isSample,
  };
}

export function fxRow({
  rateDate,
  usdKrw,
  source = "fixture_fx",
  status = "ok",
  isSample = false,
}) {
  return { rateDate, usdKrw, source, status, isSample };
}

function dateRangeEnding(endDate, count) {
  return Array.from({ length: count }, (_, index) =>
    shiftDate(endDate, index - count + 1),
  );
}

function shiftDate(date, deltaDays) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + deltaDays);
  return value.toISOString().slice(0, 10);
}
