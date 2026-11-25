/** Mark attached to an actual account/07:00 portfolio snapshot when approved
 * historical quantities, marks and performance are materialized together. */
export const CANONICAL_REVIEW_RULE = "broker_account_review_close_v1";

export type CanonicalBasket = { excludedLabels: string[]; excludedTickers: string[] };
export type CanonicalClose = CanonicalBasket & {
  date: string; returnPct: number | null; dailyReturnPct: number | null;
  segment: string | null; reviewEstimated: boolean; reviewEvidenceHash: string;
};

export function parseCanonicalClose(input: unknown, date: string): CanonicalClose | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Record<string, unknown>;
  const nullablePct = (v: unknown) => v === null || typeof v === "number" && Number.isFinite(v);
  const labels = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 100 &&
    v.every(label => typeof label === "string" && label.trim().length > 0 && label.length <= 120);
  if (row.version !== 1 || row.currency !== "KRW" || row.basis !== "invested_assets_excluding_cash" ||
      row.date !== date || !nullablePct(row.returnPct) || !nullablePct(row.dailyReturnPct) ||
      (row.segment !== null && (typeof row.segment !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.segment) || row.segment > date)) ||
      (row.returnPct !== null && row.segment === null) || typeof row.reviewEstimated !== "boolean" ||
      typeof row.reviewEvidenceHash !== "string" || !/^[0-9a-f]{64}$/.test(row.reviewEvidenceHash) ||
      !labels(row.excludedLabels) || !labels(row.excludedTickers)) return null;
  return { date, returnPct: row.returnPct as number | null, dailyReturnPct: row.dailyReturnPct as number | null,
    segment: row.segment, reviewEstimated: row.reviewEstimated, reviewEvidenceHash: row.reviewEvidenceHash,
    excludedLabels: row.excludedLabels, excludedTickers: row.excludedTickers };
}

export function canonicalBasketIncludes(basket: CanonicalBasket) {
  const normalize = (value: string) => value.trim().normalize("NFC").toUpperCase();
  const names = new Set(basket.excludedLabels.map(normalize)), tickers = new Set(basket.excludedTickers.map(normalize));
  return (asset: { name?: string | null; ticker?: string | null }) =>
    !names.has(normalize(asset.name ?? "")) && !tickers.has(normalize(asset.ticker ?? ""));
}
