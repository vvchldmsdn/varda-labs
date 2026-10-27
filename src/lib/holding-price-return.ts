import { isSamePriceInstrument } from "./market-data/price-instrument-identity.ts";
import { resolveOperationalClosePrice } from "./market-data/asset-price-consumer-admission.ts";
import { hasFreshMovementPrice, type PortfolioMovementCycle, type PortfolioMovementHoldingInput, type PortfolioMovementPriceSnapshotInput } from "./portfolio-movement.ts";

export type HoldingPriceReturn = Readonly<{
  changePct: number | null;
  currentPrice: number | null;
  previousClose: number | null;
  previousCloseDate: string | null;
  currency: string;
  observedAt: string | null;
  reason: "missing_current_quote" | "missing_previous_close" | "conflicting_previous_close" | null;
}>;

const MARKET_DATE_FORMATS = {
  us: new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }),
  korea: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }),
};

/** Operational raw-price return: quantity, cash flows, cost and FX never enter this calculation. */
export function buildHoldingPriceReturn({ holding, priceRows, movementCycle, now }: {
  holding: PortfolioMovementHoldingInput;
  priceRows: readonly PortfolioMovementPriceSnapshotInput[];
  movementCycle: PortfolioMovementCycle;
  now: Date;
}): HoldingPriceReturn {
  // A new fetch cannot promote a known older market observation to today's quote.
  const observedMs = holding.priceAsOf ? timestamp(holding.priceAsOf) : timestamp(holding.priceFetchedAt);
  const currentPrice = Number.isFinite(holding.currentPrice) && holding.currentPrice > 0 ? holding.currentPrice : null;
  const evidence = { currentPrice, currency: holding.currency, observedAt: observedMs > 0 ? new Date(observedMs).toISOString() : null };
  const missing = (reason: Exclude<HoldingPriceReturn["reason"], null>): HoldingPriceReturn => Object.freeze({ ...evidence, changePct: null, previousClose: null, previousCloseDate: null, reason });
  if (currentPrice === null || observedMs <= 0 || observedMs > now.getTime() || !hasFreshMovementPrice({ ...holding, priceFetchedAt: evidence.observedAt }, movementCycle)) return missing("missing_current_quote");

  const parts = MARKET_DATE_FORMATS[holding.market === "us" ? "us" : "korea"].formatToParts(new Date(observedMs));
  const part = (type: string) => parts.find(value => value.type === type)!.value;
  const quoteDate = `${part("year")}-${part("month")}-${part("day")}`;
  // No weekday/holiday branching: absent closes naturally select the latest observed close.
  const candidates = priceRows.filter(row => isSamePriceInstrument(row, holding) && validDate(row.priceDate) && row.priceDate < quoteDate
    && Date.parse(`${quoteDate}T00:00:00Z`) - Date.parse(`${row.priceDate}T00:00:00Z`) <= 10 * 86_400_000
    && resolveOperationalClosePrice(row) !== null).toSorted((a, b) => b.priceDate.localeCompare(a.priceDate));
  const previous = candidates[0];
  if (!previous) return missing("missing_previous_close");
  const previousClose = resolveOperationalClosePrice(previous)!;
  if (candidates.some(row => row.priceDate === previous.priceDate && resolveOperationalClosePrice(row) !== previousClose)) return missing("conflicting_previous_close");
  return Object.freeze({ ...evidence, changePct: ((currentPrice - previousClose) / previousClose) * 100, previousClose, previousCloseDate: previous.priceDate, reason: null });
}

function timestamp(value: Date | string | null) {
  const result = value instanceof Date ? value.getTime() : value ? Date.parse(value) : 0;
  return Number.isFinite(result) ? result : 0;
}
function validDate(value: string) {
  const parsed = new Date(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
