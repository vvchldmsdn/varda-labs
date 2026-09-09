import type { PortfolioStructureResult } from "./portfolio-structure.ts";
import { currentKstDate } from "./current-kst-date.ts";
import { TENANT_LIVE_PRICE_SYNC_POLICY } from "./market-data/tenant-live-price-sync-policy.ts";

export type HistoryLiveValuation = Readonly<{
  state: "ready" | "partial" | "empty" | "unavailable";
  date: string;
  capturedAt: string;
  valueKrw: number | null;
  holdingCount: number;
  excludedHoldingCount: number;
  freshQuoteCount: number;
  recordedPriceCount: number;
  oldestPriceAt: string | null;
  priceSources: readonly string[];
}>;

/** An ephemeral current-position valuation. Never a daily snapshot, return or risk observation. */
export function buildHistoryLiveValuation(structure: PortfolioStructureResult | null, now: Date): HistoryLiveValuation {
  const base = { date: currentKstDate(now), capturedAt: now.toISOString(), valueKrw: null, holdingCount: 0, excludedHoldingCount: 0, freshQuoteCount: 0, recordedPriceCount: 0, oldestPriceAt: null, priceSources: Object.freeze([]) };
  if (!structure) return Object.freeze({ ...base, state: "unavailable" });
  const rows = structure.holdingRows;
  const invalidCount = rows.filter(row => !Number.isFinite(row.currentValueKrw) || row.currentValueKrw < 0 || !Number.isFinite(row.quantity) || row.quantity < 0 || !Number.isFinite(row.currentPrice) || row.currentPrice <= 0).length;
  const excludedHoldingCount = structure.excludedHoldingCount + invalidCount;
  const dates = rows.map(row => row.priceAsOf ?? row.priceFetchedAt).filter((date): date is string => date !== null && Number.isFinite(Date.parse(date))).sort();
  const freshQuoteCount = rows.filter(row => {
    const fetched = Date.parse(row.priceFetchedAt ?? row.priceAsOf ?? "");
    const age = now.getTime() - fetched;
    const observationAge = now.getTime() - Date.parse(row.priceAsOf ?? row.priceFetchedAt ?? "");
    return row.priceEvidenceSource === "live_price_quote" && Number.isFinite(age) && age >= 0 && age <= TENANT_LIVE_PRICE_SYNC_POLICY.freshnessMilliseconds
      && Number.isFinite(observationAge) && observationAge >= 0 && observationAge <= TENANT_LIVE_PRICE_SYNC_POLICY.freshnessMilliseconds;
  }).length;
  const valueKrw = excludedHoldingCount === 0 && rows.length > 0 ? rows.reduce((total, row) => total + row.currentValueKrw, 0) : null;
  return Object.freeze({
    ...base, state: excludedHoldingCount > 0 || (valueKrw !== null && !Number.isFinite(valueKrw)) ? "partial" : valueKrw === null ? "empty" : "ready",
    valueKrw: valueKrw !== null && Number.isFinite(valueKrw) ? valueKrw : null,
    holdingCount: rows.length, excludedHoldingCount, freshQuoteCount, recordedPriceCount: rows.length - freshQuoteCount,
    oldestPriceAt: dates[0] ?? null,
    priceSources: Object.freeze([...new Set(rows.map(row => row.priceSource).filter((value): value is string => Boolean(value)))].sort()),
  });
}
