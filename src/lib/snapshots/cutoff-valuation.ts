import {
  priceInstrumentKey,
  type PriceInstrumentIdentityInput,
} from "../market-data/price-instrument-identity.ts";

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
  maxAgeMs = SNAPSHOT_CUTOFF_QUOTE_MAX_AGE_MS,
}: {
  instrument: PriceInstrumentIdentityInput;
  rows: readonly Row[];
  capturedAt: Date;
  maxAgeMs?: number;
}): SnapshotCutoffQuoteSelection<Row> | null {
  const instrumentKey = priceInstrumentKey(instrument);
  const capturedAtMs = capturedAt.getTime();
  if (!instrumentKey || !Number.isFinite(capturedAtMs) || maxAgeMs < 0) {
    return null;
  }

  const candidates = rows.flatMap((row) => {
    if (priceInstrumentKey(row) !== instrumentKey) return [];
    if (row.provider !== "kis" || row.status !== "ok") return [];
    if (!isLiveQuoteType(row.quoteType)) return [];

    const price = Number(row.price);
    const fetchedAt = toDate(row.fetchedAt);
    const referenceAt = toDate(row.priceAsOf) ?? fetchedAt;
    if (!Number.isFinite(price) || price <= 0 || !fetchedAt || !referenceAt) {
      return [];
    }

    const fetchedAtMs = fetchedAt.getTime();
    const referenceAtMs = referenceAt.getTime();
    if (fetchedAtMs > capturedAtMs || referenceAtMs > capturedAtMs) return [];

    const ageMs = capturedAtMs - fetchedAtMs;
    if (ageMs > maxAgeMs) return [];

    return [{ row, price, referenceAt, fetchedAt, ageMs }];
  });

  candidates.sort((left, right) => {
    const fetchedCompare = right.fetchedAt.getTime() - left.fetchedAt.getTime();
    if (fetchedCompare !== 0) return fetchedCompare;
    const referenceCompare =
      right.referenceAt.getTime() - left.referenceAt.getTime();
    if (referenceCompare !== 0) return referenceCompare;
    return `${left.row.provider}:${left.row.source}`.localeCompare(
      `${right.row.provider}:${right.row.source}`,
    );
  });

  return candidates[0] ?? null;
}

function isLiveQuoteType(value: string) {
  return value === "live" || value === "realtime" || value === "delayed";
}

function toDate(value: TimestampValue) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}
