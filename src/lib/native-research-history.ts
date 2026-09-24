import { Decimal } from "./money.ts";
import type { CurrencyResearchHistory } from "./currency-research.ts";
import type { TwelveDataEvidence } from "./market-data/twelve-data-service.ts";
import { mapRiskEvidenceDateToServiceDate, isRiskDate } from "./portfolio-risk-calendar.ts";
import { admitSharedKisRawHistoricalPriceRows, type RawHistoricalPriceConsumerEvidenceRow } from "./market-data/asset-price-consumer-admission.ts";

/** KIS admission proves instrument identity, not a split-free interval. Keep its
 * observed raw bars available while the return engine independently gates actions. */
export function normalizeStoredNativeResearchHistory(instrumentId: string, rows: readonly RawHistoricalPriceConsumerEvidenceRow[], asOf: string): CurrencyResearchHistory {
  const empty: CurrencyResearchHistory = { instrumentId, source: "stored_kis_raw_close", admission: "shared_kis_raw", points: [] };
  const admitted = admitSharedKisRawHistoricalPriceRows(rows);
  if (admitted.rows.length !== rows.length) return empty;
  try {
    const points = admitted.rows.map(row => {
      const at = new Date(`${mapRiskEvidenceDateToServiceDate(row.priceDate)}T07:00:00+09:00`).toISOString();
      if (!["KRW", "USD"].includes(row.currency) || Date.parse(at) > Date.parse(asOf) || !row.fetchedAt || new Date(row.fetchedAt).getTime() > Date.parse(asOf)) throw new Error("unavailable_history_time");
      return { at, price: Decimal.from(row.closePrice!).toExactString(), currency: row.currency as "KRW" | "USD", basis: "raw_price" as const, dataset: `${row.source}|${row.providerExchange}|${row.providerSymbol}|raw` };
    }).sort((a, b) => a.at.localeCompare(b.at));
    return { ...empty, points, corporateActions: { status: "unknown", source: "kis_raw_price_does_not_establish_corporate_actions", from: points[0]?.at ?? asOf, through: points.at(-1)?.at ?? asOf } };
  } catch { return empty; }
}

/** Split-only price return series. Cash dividends are not reinvested or added here. */
export function normalizeNativeResearchHistory(instrumentId: string, data: TwelveDataEvidence, asOf: string): CurrencyResearchHistory {
  const empty: CurrencyResearchHistory = { instrumentId, source: "twelve_data_raw", admission: "normalized_provider_raw", points: [] };
  if (data.status !== "admitted" || data.refreshDue || data.corporateActionCoverage !== "complete") return empty;
  try {
    const observedThrough = Date.parse(asOf);
    if (!Number.isFinite(observedThrough) || !data.prices.length || data.prices.some(row => !row.exchangeDate || !isRiskDate(row.exchangeDate) || row.currency !== "USD" || row.basis !== "raw" || row.session !== "regular" || row.source !== "twelve_data" || !Number.isFinite(Date.parse(row.fetchedAt)) || Date.parse(row.fetchedAt) > observedThrough) || new Set(data.prices.map(row => row.instrumentKey)).size !== 1) return empty;
    if (data.corporateActions.some(action => !isRiskDate(action.date) || !["split", "dividend"].includes(action.type) || action.source !== "twelve_data" || !Number.isFinite(Date.parse(action.fetchedAt)) || Date.parse(action.fetchedAt) > observedThrough)) return empty;
    const points = data.prices.map(row => {
      let price = Decimal.from(row.value);
      for (const action of data.corporateActions) if (action.type === "split" && row.exchangeDate! < action.date) {
        if (!action.fromFactor || !action.toFactor || Decimal.from(action.fromFactor).compare(0) <= 0 || Decimal.from(action.toFactor).compare(0) <= 0) throw new Error("invalid_split");
        // Twelve's 4-for-1 response uses from_factor=4, to_factor=1.
        price = price.mul(action.toFactor).div(action.fromFactor);
      }
      const at = new Date(`${mapRiskEvidenceDateToServiceDate(row.exchangeDate!)}T07:00:00+09:00`).toISOString();
      if (Date.parse(at) > Date.parse(asOf)) throw new Error("future_bar");
      return { at, price: price.toExactString(), currency: row.currency, basis: "split_adjusted" as const, dataset: `twelve_data:${row.instrumentKey}:split_only_no_dividend_reinvestment` };
    }).sort((a, b) => a.at.localeCompare(b.at));
    return { ...empty, points, corporateActions: { status: "verified_split_adjusted", source: "twelve_data_splits_and_unadjusted_dividends", from: points[0]?.at ?? asOf, through: points.at(-1)?.at ?? asOf } };
  } catch { return empty; }
}
