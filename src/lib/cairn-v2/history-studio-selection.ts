import type { BetaContext } from "./navigation.ts";
import { calendarAttributionRange } from "./period-attribution.ts";

export type HistoryStudioPreferences = {
  identity: string;
  mode: "value" | "return" | "impact" | "compare";
  preset: "thisMonth" | "lastMonth" | "custom";
  range: { start: string; end: string };
};

export function historyStudioIdentity(context: BetaContext, displayBinding?: string) {
  return JSON.stringify([context.mode, context.scope, context.currency, displayBinding]);
}

/** Called only after the existing history-return boundary admits the date and scope. */
export function restoreHistoryStudioSelection({ current, context, displayBinding, date, metric }: {
  current: HistoryStudioPreferences | null; context: BetaContext; displayBinding?: string;
  date: string | null; metric: "value" | "return";
}): HistoryStudioPreferences | null {
  const identity = historyStudioIdentity(context, displayBinding);
  const scoped = current?.identity === identity ? current : null;
  if (!date) return scoped ? { ...scoped, mode: metric } : null;
  if (scoped && date >= scoped.range.start && date <= scoped.range.end) return { ...scoped, mode: metric };
  // A legacy ALL/6M link restores its actual observation into a bounded visible
  // month. This selects dates only; no prices, balances or missing days are made.
  return { identity, mode: metric, preset: "custom", range: calendarAttributionRange("thisMonth", date) };
}
