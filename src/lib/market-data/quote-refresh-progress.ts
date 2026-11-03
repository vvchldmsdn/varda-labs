import type { CollectionProgressRow } from "./collection-queue";

export type QuoteRefreshItem = {
  id: string; label: string; provider: string;
  state: "ready" | "pending" | "running" | "delayed" | "failed" | "unavailable";
  priceAsOf: string | null; checkedAt: string | null; retryAt: string | null;
};
export type QuoteRefreshProgress = {
  items: QuoteRefreshItem[]; total: number; completed: number; pending: number; failed: number;
};
export type QuoteRefreshResponse = {
  state?: string; startedAt?: string; readVersion?: string; retryAfterSeconds?: number;
  freshTargetCount?: number; targetCount?: number; progress?: QuoteRefreshProgress;
};
export const MANUAL_REFRESH_MAX_CHECKS = 180;
export function refreshItem(input: {
  id: string; label: string; provider: string; fresh: boolean; valid: boolean;
  priceAsOf?: string | null; checkedAt?: string | null; job?: CollectionProgressRow;
  startedAt: string; now?: number; supported?: boolean; readAt?: string;
}): QuoteRefreshItem {
  const now = input.now ?? Date.now(), job = input.job;
  // Completion of this explicit operation does not expire halfway through a
  // slow queue. A queue success alone never supplies a missing/invalid price.
  const collected = input.valid && job?.status === "done" &&
    Date.parse(job.completedAt ?? "") >= Date.parse(input.startedAt);
  // A live quote can be written before the job's close revalidation finishes.
  // The durable job remains authoritative until all of its work terminates.
  const completedAfterRead = job?.status === "done" && input.readAt !== undefined && Date.parse(job.completedAt ?? "") >= Date.parse(input.readAt);
  const state = input.supported === false ? "unavailable" : completedAfterRead ? "running" :
    job?.status === "failed" ? "failed" : job?.status === "running" ? "running" :
      job?.status === "pending" ? Date.parse(job.availableAt ?? "") > now ? "delayed" : "pending" :
        input.valid && (input.fresh || collected) ? "ready" : "unavailable";
  return { id: input.id, label: input.label, provider: input.provider, state,
    priceAsOf: input.priceAsOf ?? null, checkedAt: collected ? job!.completedAt : input.checkedAt ?? null,
    retryAt: state === "delayed" ? job?.availableAt ?? null : null };
}
export function refreshProgress(items: QuoteRefreshItem[]): QuoteRefreshProgress {
  return { items, total: items.length, completed: items.filter(row => row.state === "ready").length,
    pending: items.filter(row => ["pending", "running", "delayed"].includes(row.state)).length,
    failed: items.filter(row => ["failed", "unavailable"].includes(row.state)).length };
}
export function refreshProgressState(progress: QuoteRefreshProgress) {
  return progress.pending ? "queued" : progress.failed ? "partial" : progress.total ? "fresh" : "empty";
}
