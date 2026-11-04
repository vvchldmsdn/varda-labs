import type { CurrencyTrackedInput, CurrencyTrackedResult } from "./currency-tracked-portfolio";
import { Decimal, type Currency } from "./money.ts";

export type CurrentCompositionPosition = {
  key: string;
  name: string;
  ticker: string | null;
  market: string | null;
  account: string | null;
  currency: string | null;
  value: string | null;
  /** This is a visual share of the stated denominator, never a performance return. */
  displayWeightPct: number | null;
  portfolioWeightPct: number | null;
  reason: string | null;
  priceAsOf: string | null;
  priceFetchedAt: string | null;
  priceReferenceDate: string | null;
  priceTimestampBasis: string | null;
  source: string | null;
  manuallyEntered: boolean;
};

export type CurrentInvestmentComposition = {
  reporting: Currency;
  at: string;
  amount: string | null;
  complete: boolean;
  weightBasis: "portfolio" | "verified_subtotal";
  positions: CurrentCompositionPosition[];
  counts: { positions: number; valued: number; excluded: number; instruments: number; unidentifiedPositions: number };
};

/** Count holdings separately from instruments. A ticker is only an identity when
 * its market is known; unnamed/manual holdings are not merged by display name. */
export function compositionCounts(positions: readonly CurrentCompositionPosition[]) {
  const instruments = new Set<string>();
  let unidentifiedPositions = 0;
  for (const row of positions) {
    if (row.ticker?.trim() && row.market?.trim()) {
      instruments.add(JSON.stringify([row.market.trim().toLowerCase(), row.ticker.trim().toUpperCase()]));
    } else unidentifiedPositions++;
  }
  const valued = positions.filter(row => row.value !== null).length;
  return { positions: positions.length, valued, excluded: positions.length - valued, instruments: instruments.size, unidentifiedPositions };
}

export function isManualValuationSource(source: string | null | undefined) {
  return !!source && /(?:manual|user_entered)/i.test(source);
}

/** Receipt time is not exchange observation time; an official close is dated
 * by its session, even when it deliberately has no intraday timestamp. */
export function compositionPriceTime(position: Pick<CurrentCompositionPosition,"priceAsOf"|"priceFetchedAt"|"priceReferenceDate"|"priceTimestampBasis">) {
  if(position.priceTimestampBasis === "daily_close")return {label:"종가 기준일",value:position.priceReferenceDate};
  if(position.priceTimestampBasis === "collection")return {label:"시세 수집 시각",value:position.priceFetchedAt};
  return {label:"가격 관측",value:position.priceAsOf};
}

/** Display projection of the already admitted report. It cannot admit a quote,
 * convert currency, fill a missing value, or change the report's full weights.
 * Partial charts explicitly use verifiedSubtotal as their own denominator. */
export function trackedInvestmentComposition(
  evidence: CurrencyTrackedInput,
  report: CurrencyTrackedResult,
): CurrentInvestmentComposition | null {
  const current = report.current;
  if (!current) return null;
  const native = new Map(evidence.current.positions.map(row => [row.id, row]));
  const subtotal = Decimal.from(current.verifiedSubtotal);
  const positions = current.positions.map(row => {
    const original = native.get(row.id);
    const source = original?.observation?.source ?? null;
    const displayWeightPct = row.value === null || subtotal.compare(0) <= 0 ? null
      : current.complete ? row.weightPct : Decimal.from(row.value).div(subtotal).mul(100).toNumber();
    return {
      key: row.id, name: row.name, ticker: original?.ticker ?? null, market: original?.market ?? null,
      account: null, currency: original?.observation?.currency ?? null, value: row.value,
      displayWeightPct, portfolioWeightPct: row.weightPct, reason: row.reason,
      priceAsOf: row.priceObservedAt, priceFetchedAt: row.priceFetchedAt,
      priceReferenceDate: row.priceReferenceDate, priceTimestampBasis: row.priceTimestampBasis ?? null,
      source, manuallyEntered: isManualValuationSource(source),
    } satisfies CurrentCompositionPosition;
  });
  return {
    reporting: report.reporting, at: current.at,
    amount: current.coverage.valued > 0 ? current.total ?? current.verifiedSubtotal : null,
    complete: current.complete, weightBasis: current.complete ? "portfolio" : "verified_subtotal",
    positions, counts: compositionCounts(positions),
  };
}
