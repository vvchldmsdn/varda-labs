export const TENANT_LIVE_PRICE_SYNC_POLICY = Object.freeze({
  version: "tenant_live_price_sync_v1",
  provider: "kis",
  freshnessMilliseconds: 5 * 60 * 1000,
  maximumTargetCount: 40,
} as const);

export type TenantLivePriceTarget = Readonly<{
  ticker: string;
  market: string;
  currency: string;
}>;

export type TenantLivePriceQuoteEvidence = Readonly<{
  ticker: string;
  market: string;
  currency: string;
  provider: string;
  status: string;
  price: string | number;
  fetchedAt: Date | string;
}>;

export type TenantLivePriceSyncPlan = Readonly<{
  targets: readonly TenantLivePriceTarget[];
  staleTargets: readonly TenantLivePriceTarget[];
  freshTargetCount: number;
  staleTargetCount: number;
}>;

export function normalizeTenantLivePriceTarget(
  input: Partial<TenantLivePriceTarget>,
): TenantLivePriceTarget | null {
  const ticker = normalizeTicker(input.ticker);
  const market = normalizeText(input.market);
  const currency = normalizeText(input.currency);

  if (!ticker || !market || !currency) return null;

  return Object.freeze({ ticker, market, currency });
}

export function planTenantLivePriceSync({
  now = new Date(),
  quotes,
  targets,
}: {
  now?: Date;
  quotes: readonly TenantLivePriceQuoteEvidence[];
  targets: readonly TenantLivePriceTarget[];
}): TenantLivePriceSyncPlan {
  const normalizedTargets = dedupeTargets(targets);
  const quoteByTargetKey = new Map<string, TenantLivePriceQuoteEvidence>();

  for (const quote of quotes) {
    const target = normalizeTenantLivePriceTarget(quote);
    if (!target || quote.provider !== TENANT_LIVE_PRICE_SYNC_POLICY.provider) {
      continue;
    }

    const existing = quoteByTargetKey.get(targetKey(target));
    if (
      !existing ||
      timestampMilliseconds(quote.fetchedAt) >
        timestampMilliseconds(existing.fetchedAt)
    ) {
      quoteByTargetKey.set(targetKey(target), quote);
    }
  }

  const staleTargets = normalizedTargets.filter((target) => {
    const quote = quoteByTargetKey.get(targetKey(target));
    return !isFreshQuote(quote, now);
  });

  return Object.freeze({
    targets: Object.freeze(normalizedTargets),
    staleTargets: Object.freeze(staleTargets),
    freshTargetCount: normalizedTargets.length - staleTargets.length,
    staleTargetCount: staleTargets.length,
  });
}

function dedupeTargets(targets: readonly TenantLivePriceTarget[]) {
  const byKey = new Map<string, TenantLivePriceTarget>();

  for (const input of targets) {
    const target = normalizeTenantLivePriceTarget(input);
    if (target) byKey.set(targetKey(target), target);
  }

  return Array.from(byKey.values()).sort((left, right) =>
    targetKey(left).localeCompare(targetKey(right)),
  );
}

function isFreshQuote(
  quote: TenantLivePriceQuoteEvidence | undefined,
  now: Date,
) {
  if (!quote || quote.status !== "ok" || Number(quote.price) <= 0) return false;

  const fetchedAt = timestampMilliseconds(quote.fetchedAt);
  if (!Number.isFinite(fetchedAt)) return false;

  const age = now.getTime() - fetchedAt;
  return (
    age >= -60_000 &&
    age <= TENANT_LIVE_PRICE_SYNC_POLICY.freshnessMilliseconds
  );
}

function targetKey(target: TenantLivePriceTarget) {
  return `${target.market}:${target.ticker}:${target.currency}`;
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function normalizeTicker(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return normalized || null;
}

function timestampMilliseconds(value: Date | string) {
  const parsed = value instanceof Date ? value : new Date(value);
  return parsed.getTime();
}
