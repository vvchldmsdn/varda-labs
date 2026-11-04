import type { QuoteRefreshResponse } from "./quote-refresh-progress";

/** Progress reads never authorize a new collection. Back off when nothing has
 * changed, especially when every remaining item is waiting on provider quota. */
export function quoteRefreshPollDelay(data?: QuoteRefreshResponse, unchangedChecks = 0, now = Date.now()) {
  const outstanding = data?.progress?.items.filter(item => item.state === "pending" || item.state === "running" || item.state === "delayed") ?? [];
  const delayedOnly = outstanding.length > 0 && outstanding.every(item => item.state === "delayed");
  const nextRetry = delayedOnly ? Math.min(...outstanding.map(item => Date.parse(item.retryAt ?? ""))) - now : 0;
  const adaptive = !data ? 10_000 : delayedOnly && Number.isFinite(nextRetry) && nextRetry > 0
    ? Math.max(3_000, Math.min(30_000, nextRetry))
    : unchangedChecks < 2 ? 2_000 : unchangedChecks < 5 ? 3_000 : unchangedChecks < 10 ? 5_000 : 10_000;
  const requested = Number(data?.retryAfterSeconds ?? 0) * 1_000;
  return Math.max(adaptive, Number.isFinite(requested) ? Math.min(60_000, Math.max(0, requested)) : 0);
}
