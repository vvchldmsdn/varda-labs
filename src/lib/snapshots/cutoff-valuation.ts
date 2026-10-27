import {
  priceInstrumentKey,
  type PriceInstrumentIdentityInput,
} from "../market-data/price-instrument-identity.ts";
import { closeCalendarReferenceDateForAsset } from "./market-calendar.ts";
import type { ValuationObservation } from "../currency-valuation.ts";
import { Decimal } from "../money.ts";

export const SNAPSHOT_CUTOFF_QUOTE_MAX_AGE_MS = 15 * 60 * 1000;

type TimestampValue = Date | string | null | undefined;

export type SnapshotCutoffQuoteInput = PriceInstrumentIdentityInput &
  Readonly<{
    provider: string;
    source: string;
    quoteType: string;
    status: string;
    price: string | number;
    priceAsOf: TimestampValue;
    fetchedAt: TimestampValue;
  }>;

export type SnapshotCutoffQuoteSelection<
  Row extends SnapshotCutoffQuoteInput = SnapshotCutoffQuoteInput,
> = Readonly<{
  row: Row;
  price: number;
  referenceAt: Date;
  fetchedAt: Date;
  ageMs: number;
}>;

export function selectSnapshotCutoffQuote<
  Row extends SnapshotCutoffQuoteInput,
>({
  instrument,
  rows,
  capturedAt,
  cycleEndAt,
  maxAgeMs = SNAPSHOT_CUTOFF_QUOTE_MAX_AGE_MS,
}: {
  instrument: PriceInstrumentIdentityInput;
  rows: readonly Row[];
  capturedAt: Date;
  cycleEndAt: Date;
  maxAgeMs?: number;
}): SnapshotCutoffQuoteSelection<Row> | null {
  const instrumentKey = priceInstrumentKey(instrument);
  const capturedAtMs = capturedAt.getTime();
  const cutoffAtMs = cycleEndAt.getTime();
  if (
    !instrumentKey ||
    !Number.isFinite(capturedAtMs) ||
    !Number.isFinite(cutoffAtMs) ||
    capturedAtMs < cutoffAtMs ||
    !Number.isFinite(maxAgeMs) ||
    maxAgeMs < 0
  ) {
    return null;
  }

  const candidates = rows.flatMap((row) => {
    if (priceInstrumentKey(row) !== instrumentKey) return [];
    if (row.provider !== "kis" || row.status !== "ok") return [];
    if (!isLiveQuoteType(row.quoteType)) return [];

    const price = Number(row.price);
    const fetchedAt = toDate(row.fetchedAt);
    const referenceAt = row.priceAsOf == null ? fetchedAt : toDate(row.priceAsOf);
    if (!Number.isFinite(price) || price <= 0 || !fetchedAt || !referenceAt) {
      return [];
    }

    const fetchedAtMs = fetchedAt.getTime();
    const referenceAtMs = referenceAt.getTime();
    // KIS live priceAsOf is collection evidence, not an exchange trade time.
    // A late capture therefore cannot establish what the price was at cutoff.
    if (fetchedAtMs > cutoffAtMs || referenceAtMs > fetchedAtMs) return [];

    const ageMs = cutoffAtMs - fetchedAtMs;
    if (ageMs > maxAgeMs || cutoffAtMs - referenceAtMs > maxAgeMs) return [];

    return [{ row, price, referenceAt, fetchedAt, ageMs }];
  });

  candidates.sort((left, right) => {
    const referenceCompare =
      right.referenceAt.getTime() - left.referenceAt.getTime();
    if (referenceCompare !== 0) return referenceCompare;
    const fetchedCompare = right.fetchedAt.getTime() - left.fetchedAt.getTime();
    if (fetchedCompare !== 0) return fetchedCompare;
    return `${left.row.provider}:${left.row.source}`.localeCompare(
      `${right.row.provider}:${right.row.source}`,
    );
  });

  return hasConflictingLatestSnapshotPrices(candidates) ? null : candidates[0] ?? null;
}

/** A cache receipt and its retained copy cannot vote for different prices at
 * the same latest observation. Reject that live evidence instead of sorting it. */
export function hasConflictingLatestSnapshotPrices(rows: readonly { price: string | number; referenceAt: Date | string }[]) {
  const latest = Math.max(...rows.map(row => new Date(row.referenceAt).getTime()));
  const values = rows.filter(row => new Date(row.referenceAt).getTime() === latest);
  return values.length > 1 && values.some(row => Decimal.from(row.price).compare(values[0].price) !== 0);
}

type SnapshotOfficialClose = Readonly<{
  price: number;
  referenceDate: string | null;
  expectedCloseDate: string | null;
  fromCloseSnapshot: boolean;
}>;

export function isSnapshotCutoffOfficialClose(
  close: SnapshotOfficialClose,
  cycleEndAt: Date,
) {
  const expected = close.expectedCloseDate;
  const parsedExpected = expected ? new Date(`${expected}T00:00:00.000Z`) : null;
  return (
    Number.isFinite(cycleEndAt.getTime()) &&
    close.fromCloseSnapshot &&
    Number.isFinite(close.price) &&
    close.price > 0 &&
    expected !== null &&
    /^\d{4}-\d{2}-\d{2}$/.test(expected) &&
    parsedExpected !== null &&
    Number.isFinite(parsedExpected.getTime()) &&
    parsedExpected.toISOString().slice(0, 10) === expected &&
    close.referenceDate === expected &&
    expected <= cycleEndAt.toISOString().slice(0, 10)
  );
}

export function selectSnapshotCutoffValuation<
  Row extends SnapshotCutoffQuoteInput,
  Close extends SnapshotOfficialClose,
>(input: {
  instrument: PriceInstrumentIdentityInput;
  rows: readonly Row[];
  capturedAt: Date;
  cycleEndAt: Date;
  officialClose: Close;
}) {
  const quote = selectSnapshotCutoffQuote(input);
  if (quote) return { basis: "cutoff_live" as const, quote };
  if (
    input.capturedAt.getTime() >= input.cycleEndAt.getTime() &&
    isSnapshotCutoffOfficialClose(input.officialClose, input.cycleEndAt)
  ) {
    return { basis: "close" as const, close: input.officialClose };
  }
  return null;
}

function isLiveQuoteType(value: string) {
  return value === "live" || value === "realtime" || value === "delayed";
}

/** The same admission contract for raw native observations and legacy quotes.
 * Official closes keep their session date and real collection time separately. */
export function isNativeCutoffObservation(input: {
  instrument: PriceInstrumentIdentityInput; observation: ValuationObservation;
  snapshotDate: string; cycleEndAt: Date; capturedAt: Date;
}) {
  const { observation: row, instrument, cycleEndAt, capturedAt } = input;
  const fetched = toDate(row.priceFetchedAt);
  if (!fetched || fetched > capturedAt || capturedAt < cycleEndAt || !(Number(row.price) > 0) || row.basis !== "raw") return false;
  if (row.priceKind === "close") {
    if (instrument.market !== "us" && instrument.market !== "korea") return false;
    if (row.timestampBasis !== "daily_close" || !row.priceReferenceDate) return false;
    const referenceDate = row.priceReferenceDate;
    return isSnapshotCutoffOfficialClose({price: Number(row.price), referenceDate: referenceDate ?? null,
      expectedCloseDate: closeCalendarReferenceDateForAsset({ market: instrument.market, currency: instrument.currency ?? "" }, input.snapshotDate),
      fromCloseSnapshot: true}, cycleEndAt);
  }
  // Other providers retain their admission/rights gates upstream; no live
  // response fetched after the boundary may establish a pre-boundary quote.
  return selectSnapshotCutoffQuote({instrument, capturedAt, cycleEndAt, rows:[{
    ...instrument, provider:"kis",source:row.source,quoteType:row.priceKind ?? "live",status:"ok",price:row.price,
    priceAsOf:row.priceObservedAt, fetchedAt:fetched,
  }]}) !== null;
}

function toDate(value: TimestampValue) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}
