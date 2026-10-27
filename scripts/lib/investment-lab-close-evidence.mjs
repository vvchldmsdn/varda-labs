import {
  admitAdjustedHistoricalPriceRows,
  admitSharedKisRawHistoricalPriceRows,
  selectPreferredPrivateHistoricalPriceRows,
} from "../../src/lib/market-data/asset-price-consumer-admission.ts";

export function resolvePreferredInvestmentLabCloseEvidence(closeRows) {
  const candidates = closeRows.map((row) => ({
    ticker: row.ticker,
    market: row.market,
    currency: row.currency,
    priceDate: row.price_date,
    closePrice: row.close_price,
    adjustedClosePrice: row.adjusted_close_price,
    adjustedCloseBasis: row.adjusted_close_basis,
    adjustedCloseProvider: row.adjusted_close_provider,
    adjustedCloseSource: row.adjusted_close_source,
    adjustedCloseFetchedAt: row.adjusted_close_fetched_at,
    providerSymbol: row.provider_symbol,
    providerExchange: row.provider_exchange,
    fetchedAt: row.fetched_at,
    source: row.source,
  }));
  const adjusted = admitAdjustedHistoricalPriceRows(candidates);
  const raw = admitSharedKisRawHistoricalPriceRows(candidates);
  const preferred = selectPreferredPrivateHistoricalPriceRows({
    adjustedRows: adjusted.rows,
    privateRawRows: raw.rows,
  });
  const bases = new Set(preferred.rows.map((row) => row.priceBasis));
  const selectedBasis = bases.size === 1 ? [...bases][0] : null;
  const priceBasis =
    selectedBasis === "provider_adjusted_close"
      ? "provider_adjusted_close"
      : selectedBasis === "private_kis_raw_close"
        ? "kis_raw_close"
        : "unavailable";
  const rows = preferred.rows.map(({ row }) => ({
    priceDate: row.priceDate,
    adjustedClose:
      priceBasis === "kis_raw_close"
        ? number(row.closePrice)
        : number(row.adjustedClosePrice),
  }));

  return {
    rows,
    priceBasis,
    adjustedAdmittedRows: adjusted.rows.length,
    privateRawAdmittedRows: raw.rows.length,
  };
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
