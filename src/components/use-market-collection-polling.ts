"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MANUAL_REFRESH_MAX_CHECKS, type QuoteRefreshResponse } from "@/lib/market-data/quote-refresh-progress";

type WakeOutcome = { state: string; signature: string; data?: QuoteRefreshResponse };
type PollingOutcome = { state: string; generation: unknown; startedAt?: string; keepCheckingHistory: boolean };
const waking = new Map<string, { promise: Promise<WakeOutcome>; controller: AbortController }>();
const subscribers = new Map<string, number>();
function wakeCollection(startedAt?: string): Promise<WakeOutcome> {
  const key = startedAt ?? "history";
  const existing = waking.get(key);
  if (existing) return existing.promise;
  const controller = new AbortController();
  const request = fetch("/api/portfolio/live-prices/sync", {
    method: "POST", cache: "no-store", credentials: "same-origin",
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "poll", ...(startedAt ? { startedAt } : {}) }),
  }).then(async response => {
    if (!response.ok) return { state: "unavailable", signature: "unavailable" };
    const data = await response.json() as QuoteRefreshResponse;
    const state = data.state ?? "unavailable";
    return { state, data, signature: `${state}:${data.freshTargetCount ?? ""}:${data.targetCount ?? ""}:${data.readVersion ?? ""}` };
  }).catch(() => ({ state: "unavailable", signature: "unavailable" })).finally(() => {
    if (waking.get(key)?.promise === request) waking.delete(key);
  });
  waking.set(key, { promise: request, controller });
  return request;
}

/** Visible UI only. Explicit quote operations may finish a bounded slow queue;
 * history checks retain their shorter window. Neither creates new demand. */
export function useMarketCollectionPolling(active: boolean, generation?: unknown, keepCheckingHistory = false, startedAt?: string, onProgress?: (data: QuoteRefreshResponse) => void) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<PollingOutcome | null>(null);
  useEffect(() => {
    if (!active) return;
    const key = startedAt ?? "history";
    subscribers.set(key, (subscribers.get(key) ?? 0) + 1);
    let cancelled = false, inFlight = false, count = 0, previousSignature = "";
    const maximum = startedAt && !keepCheckingHistory ? MANUAL_REFRESH_MAX_CHECKS : 12;
    const recordOutcome = (state: string) => setOutcome({ state, generation, startedAt, keepCheckingHistory });
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== "visible" || count >= maximum || inFlight) return;
      if (startedAt && Date.now() - Date.parse(startedAt) > 30 * 60_000) {
        recordOutcome("waiting"); window.clearInterval(timer); return;
      }
      count++;
      inFlight = true;
      const { state, signature, data } = await wakeCollection(startedAt);
      inFlight = false;
      if (cancelled) return;
      if (data) onProgress?.(data);
      // This endpoint reports current quotes only. History readiness remains a
      // server-read concern; continuing its refreshes must not relabel fresh quotes.
      const complete = ["fresh", "partial", "empty"].includes(state);
      recordOutcome(count >= maximum && !complete ? "waiting" : state);
      // Refresh changed evidence too: equal ready counts can hide price/FX updates.
      // History progresses in separate 30s checks.
      if (state !== "unavailable" && (signature !== previousSignature || keepCheckingHistory && (count % 3 === 1 || count === 12))) {
        startTransition(() => router.refresh());
      }
      previousSignature = signature;
      if (count >= maximum || !keepCheckingHistory && complete) window.clearInterval(timer);
    }, 10_000);
    return () => {
      cancelled = true; window.clearInterval(timer);
      const remaining = (subscribers.get(key) ?? 1) - 1;
      if (remaining) subscribers.set(key, remaining);
      else {
        subscribers.delete(key);
        waking.get(key)?.controller.abort();
        waking.delete(key);
      }
    };
  }, [active, router, generation, keepCheckingHistory, startedAt, onProgress]);
  // A new operation must not render the previous operation's terminal state,
  // even before its effects run or its first poll finishes.
  return active && outcome && Object.is(outcome.generation, generation) && outcome.startedAt === startedAt && outcome.keepCheckingHistory === keepCheckingHistory ? outcome.state : null;
}
