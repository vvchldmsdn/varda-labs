export function balanceRow(overrides = {}) {
  return Object.freeze({
    balanceDate: "2026-07-01",
    cash: "100",
    brokerage: "1000",
    isa: "500",
    irp: "400",
    ...overrides,
  });
}

export function portfolioRow(overrides = {}) {
  return Object.freeze({
    snapshotDate: "2026-07-01",
    account: "brokerage",
    source: "base44_import",
    totalMarketValue: "1000",
    ...overrides,
  });
}

export function completeNamedPortfolioRows(overrides = {}) {
  return Object.freeze([
    portfolioRow({ account: "brokerage", totalMarketValue: "1000", ...overrides }),
    portfolioRow({ account: "isa", totalMarketValue: "500", ...overrides }),
    portfolioRow({ account: "irp", totalMarketValue: "400", ...overrides }),
  ]);
}
