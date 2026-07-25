export type PriceInstrumentIdentityInput = Readonly<{
  market: string | null | undefined;
  currency: string | null | undefined;
  ticker: string | null | undefined;
}>;

export type PriceInstrumentIdentity = Readonly<{
  market: string;
  currency: string;
  ticker: string;
}>;

export function normalizePriceInstrumentIdentity(
  input: PriceInstrumentIdentityInput,
): PriceInstrumentIdentity | null {
  const market = normalizeText(input.market)?.toLowerCase();
  const currency = normalizeText(input.currency)?.toUpperCase();
  const ticker = normalizeText(input.ticker)?.toUpperCase();

  if (!market || !currency || !ticker) return null;
  return Object.freeze({ market, currency, ticker });
}

export function priceInstrumentKey(
  input: PriceInstrumentIdentityInput,
): string | null {
  const identity = normalizePriceInstrumentIdentity(input);
  return identity
    ? `${identity.market}\u0000${identity.currency}\u0000${identity.ticker}`
    : null;
}

export function groupPriceRowsByInstrument<
  Row extends PriceInstrumentIdentityInput,
>(rows: readonly Row[]): Map<string, Row[]> {
  const grouped = new Map<string, Row[]>();

  for (const row of rows) {
    const key = priceInstrumentKey(row);
    if (!key) continue;
    const instrumentRows = grouped.get(key) ?? [];
    instrumentRows.push(row);
    grouped.set(key, instrumentRows);
  }

  return grouped;
}

export function priceRowsForInstrument<
  Row extends PriceInstrumentIdentityInput,
>(
  rowsByInstrument: ReadonlyMap<string, Row[]>,
  instrument: PriceInstrumentIdentityInput,
): readonly Row[] {
  const key = priceInstrumentKey(instrument);
  return key ? (rowsByInstrument.get(key) ?? []) : [];
}

export function isSamePriceInstrument(
  left: PriceInstrumentIdentityInput,
  right: PriceInstrumentIdentityInput,
) {
  const leftKey = priceInstrumentKey(left);
  return leftKey !== null && leftKey === priceInstrumentKey(right);
}

function normalizeText(value: string | null | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
