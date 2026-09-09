"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type WakeOutcome = { state: string; signature: string };
let waking: Promise<WakeOutcome> | null = null;
function wakeCollection() {
  waking ??= fetch("/api/portfolio/live-prices/sync", {
    method: "POST", cache: "no-store", credentials: "same-origin",
    signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "poll" }),
  }).then(async response => {
    if (!response.ok) return { state: "unavailable", signature: "unavailable" };
    const data = await response.json() as { state?: string; freshTargetCount?: number; targetCount?: number };
    const state = data.state ?? "unavailable";
    return { state, signature: `${state}:${data.freshTargetCount ?? ""}:${data.targetCount ?? ""}` };
  }).catch(() => ({ state: "unavailable", signature: "unavailable" })).finally(() => { waking = null; });
  return waking;
}

/** Visible UI only, two minutes maximum, no synthetic provider success. */
export function useMarketCollectionPolling(active: boolean, generation?: unknown, keepCheckingHistory = false) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    let cancelled = false, inFlight = false, count = 0, previousSignature = "";
    const reset = window.setTimeout(() => setOutcome(null), 0);
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== "visible" || count >= 12 || inFlight) return;
      count++;
      inFlight = true;
      const { state, signature } = await wakeCollection();
      inFlight = false;
      if (cancelled) return;
      setOutcome(count >= 12 && (state !== "fresh" || keepCheckingHistory) ? "waiting" : state);
      // Refresh only changed quote readiness; history progresses in separate 30s checks.
      if (state !== "unavailable" && (signature !== previousSignature || keepCheckingHistory && (count % 3 === 1 || count === 12))) {
        startTransition(() => router.refresh());
      }
      previousSignature = signature;
      if (count >= 12) window.clearInterval(timer);
    }, 10_000);
    return () => { cancelled = true; window.clearInterval(timer); window.clearTimeout(reset); };
  }, [active, router, generation, keepCheckingHistory]);
  return outcome;
}
