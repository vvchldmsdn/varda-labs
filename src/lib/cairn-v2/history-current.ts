import type { BetaView } from "./read-contract";

export const CURRENT_VALUATION_SOURCE = "current_investment_valuation";

/** A read-time point, never a saved close or a newly calculated return.
 * Historical sources remain intact and individually selectable. */
export function historyWithCurrentValue(view: BetaView): BetaView {
  const domain = view.domain;
  if (
    !domain ||
    domain.valueState !== "ready" ||
    domain.historyDisplayCurrency !== "KRW" ||
    !["ready", "partial"].includes(domain.state) ||
    (domain.historyViewSource && domain.historyViewSource !== "observed") ||
    view.totalKrw === null ||
    !Number.isFinite(view.totalKrw) ||
    !domain.refreshedAt
  )
    return view;
  const observed = Date.parse(domain.refreshedAt);
  if (!Number.isFinite(observed)) return view;
  const date = new Date(observed + 9 * 3600000).toISOString().slice(0, 10);
  const saved = view.history.filter((row) => row.source !== CURRENT_VALUATION_SOURCE);
  if (saved.some((row) => row.date > date)) return view;
  const point: BetaView["history"][number] = {
    date,
    valueKrw: view.totalKrw,
    exampleReturnPct: null,
    source: CURRENT_VALUATION_SOURCE,
    rowKind: "live",
    segment: "current-valuation",
    valueSegment: "current-valuation",
  };
  return {
    ...view,
    history: [...saved.filter((row) => row.date !== date), point],
    domain: {
      ...domain,
      historyState: saved.length
        ? domain.historyState === "unavailable" || domain.historyState === "empty"
          ? "partial"
          : domain.historyState
        : "ready",
    },
  };
}

export function currentValuationTime(view: BetaView) {
  const value = view.domain?.refreshedAt;
  if (!value || !Number.isFinite(Date.parse(value))) return "조회 시각 확인 전";
  return (
    new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(5, 16).replace("T", " ") + " KST"
  );
}
