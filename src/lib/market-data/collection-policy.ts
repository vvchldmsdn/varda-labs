export type CollectionKind = "live" | "history" | "fx";
export type CollectionInput = Readonly<{
  kind: CollectionKind; ticker: string; market: string; currency: string;
  startDate?: string; endDate?: string;
}>;
export type CollectionJob = Readonly<{
  key: string; kind: CollectionKind; ticker: string; market: "korea" | "us";
  currency: "KRW" | "USD"; startDate: string | null; endDate: string | null;
}>;

export const MARKET_COLLECTION_POLICY = Object.freeze({
  maximumEnqueueTargets: 40, maximumWorkerJobs: 5, workerBudgetMs: 40_000,
  jobLeaseSeconds: 180, maximumAttempts: 6, historyWindowDays: 90,
  pollAfterSeconds: 10, maximumPendingJobs: 10_000,
} as const);

/** No accounts, quantities, owner identifiers or provider credentials enter this queue. */
export function normalizeCollectionJobs(inputs: readonly CollectionInput[]): CollectionJob[] {
  if (inputs.length > MARKET_COLLECTION_POLICY.maximumEnqueueTargets) throw new Error("collection_target_limit");
  const jobs = new Map<string, CollectionJob>();
  for (const input of inputs) {
    const ticker = input.ticker.trim().toUpperCase();
    const market = input.market.trim().toLowerCase();
    const currency = input.currency.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9.\-]{0,19}$/.test(ticker) ||
        !((market === "korea" && currency === "KRW") || (market === "us" && currency === "USD")) ||
        !["live", "history", "fx"].includes(input.kind) || (input.kind === "fx" && market !== "us")) throw new Error("collection_identity_invalid");
    const windows: Array<{ startDate: string | null; endDate: string | null }> = [];
    if (input.kind === "history") {
      const start = dateMilliseconds(input.startDate), end = dateMilliseconds(input.endDate);
      if (end < start || end - start > 730 * 86_400_000) throw new Error("collection_history_range_invalid");
      // Fixed calendar buckets let overlapping users share work; each slice stays bounded.
      const width = MARKET_COLLECTION_POLICY.historyWindowDays * 86_400_000;
      for (let bucket = Math.floor(start / width) * width; bucket <= end; bucket += width) {
        windows.push({ startDate: dateKey(bucket), endDate: dateKey(Math.min(bucket + width - 86_400_000, end)) });
      }
    } else windows.push({ startDate: null, endDate: null });
    for (const window of windows) {
      const key = input.kind === "fx" ? "kis:fx:USD:KRW" :
        ["kis", input.kind, market, currency, ticker, window.startDate ?? "", window.endDate ?? ""].join(":");
      jobs.set(key, { key, kind: input.kind, ticker, market, currency, ...window });
    }
  }
  return [...jobs.values()];
}

export function collectionRetrySeconds(attempt: number, random = Math.random()) {
  return Math.min(3600, 15 * 2 ** Math.min(8, Math.max(0, attempt - 1))) + Math.floor(Math.max(0, Math.min(1, random)) * 10);
}

export function isProviderCollectionDeferred(error: unknown): error is Error & { retryAfterSeconds: number } {
  return typeof error === "object" && error !== null && "code" in error &&
    ["provider_budget_limited", "provider_token_cooldown"].includes(String(error.code)) &&
    "retryAfterSeconds" in error && Number.isFinite(Number(error.retryAfterSeconds));
}

function dateMilliseconds(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("collection_history_date_invalid");
  const result = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(result) || dateKey(result) !== value) throw new Error("collection_history_date_invalid");
  return result;
}
function dateKey(value: number) { return new Date(value).toISOString().slice(0, 10); }
