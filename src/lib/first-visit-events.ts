"use client";
import { track } from "@vercel/analytics";

export const FIRST_VISIT_EVENTS = ["entry_view", "sample_result", "personal_started", "personal_result", "signup_completed", "plan_saved", "first_holding_created"] as const;
export type FirstVisitEvent = typeof FIRST_VISIT_EVENTS[number];
const sent = new Set<string>();
/** Only fixed names, no data/properties. Dedupe key stays in this browser, never sent. */
export function trackFirstVisit(event: FirstVisitEvent, dedupeKey = "visit") {
  if (!FIRST_VISIT_EVENTS.includes(event)) return;
  const key = `varda.funnel.${event}.${dedupeKey}`;
  if (sent.has(key)) return;
  try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch {}
  sent.add(key);
  // Custom events require an eligible Vercel plan. Disabled until capability is confirmed.
  if (process.env.NEXT_PUBLIC_VARDA_FUNNEL_EVENTS === "1") track(`varda_${event}`);
}
