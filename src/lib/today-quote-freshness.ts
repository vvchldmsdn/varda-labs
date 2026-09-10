import type { DashboardHolding } from "./portfolio-dashboard";
import { TENANT_LIVE_PRICE_SYNC_POLICY } from "./market-data/tenant-live-price-sync-policy.ts";
import { TENANT_LIVE_FX_SYNC_POLICY } from "./market-data/tenant-live-fx-sync-policy.ts";

type EvidenceRange = Readonly<{ oldest: string | null; newest: string | null }>;
type QuoteHolding = Pick<DashboardHolding, "movementEligible" | "currency" | "currentPrice" | "priceStatus" | "priceFetchedAt" | "priceAsOf">;

/** Retrieval freshness and the provider's recorded price time are separate evidence. */
export function buildTodayQuoteFreshness({ holdings, fxFetchedAt, now }: {
  holdings: readonly QuoteHolding[];
  fxFetchedAt: string | null;
  now: string;
}) {
  const nowMs = Date.parse(now);
  const eligible = holdings.filter(holding => holding.movementEligible);
  const quotes = eligible.filter(holding => holding.priceStatus === "ok" && Number.isFinite(holding.currentPrice) && holding.currentPrice > 0);
  const fetched = quotes.map(holding => validTimestamp(holding.priceFetchedAt, nowMs)).filter((value): value is number => value !== null);
  const observed = quotes.map(holding => validTimestamp(holding.priceAsOf, nowMs)).filter((value): value is number => value !== null);
  const hasFxExposure = eligible.some(holding => holding.currency.trim().toUpperCase() === "USD");
  const fxMs = hasFxExposure ? validTimestamp(fxFetchedAt, nowMs) : null;
  const isStale = (value: number) => nowMs - value > TENANT_LIVE_PRICE_SYNC_POLICY.freshnessMilliseconds;
  return {
    fetched: evidenceRange(fetched),
    observed: evidenceRange(observed),
    missingQuoteCount: eligible.length - fetched.length,
    staleQuoteCount: fetched.filter(isStale).length,
    hasFxExposure,
    fxFetchedAt: fxMs === null ? null : new Date(fxMs).toISOString(),
    fxNeedsRefresh: hasFxExposure && (fxMs === null || nowMs - fxMs > TENANT_LIVE_FX_SYNC_POLICY.freshnessMilliseconds),
  };
}

function validTimestamp(value: string | null, nowMs: number) {
  if (!value || !Number.isFinite(nowMs)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= nowMs + 60_000 ? parsed : null;
}

function evidenceRange(values: readonly number[]): EvidenceRange {
  if (!values.length) return { oldest: null, newest: null };
  return { oldest: new Date(Math.min(...values)).toISOString(), newest: new Date(Math.max(...values)).toISOString() };
}

/** Include the date on older evidence; a previous day's clock time must not look current. */
export function formatTodayEvidenceRange(range: EvidenceRange, now: string) {
  if (!range.oldest || !range.newest) return "—";
  const reference = kstDate(now);
  const spansDates = kstDate(range.oldest) !== kstDate(range.newest);
  const format = (value: string) => {
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
    return !spansDates && kstDate(value) === reference ? time : `${kstDate(value)} ${time}`;
  };
  return `${format(range.oldest)}${range.oldest === range.newest ? "" : `–${format(range.newest)}`} KST`;
}

function kstDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}
