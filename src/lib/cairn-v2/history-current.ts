import type { BetaView } from "./read-contract";
import type { BetaCurrency } from "./navigation";
import { originalCurrentValueSummary } from "./current-value-presentation";
import { percentOrNull } from "../portfolio-math.ts";
import { liveHistoryDate, valuationDateForCutoff } from "./history-date.ts";
import { withinReviewedValuationDates } from "./reviewed-history-series.ts";

export const CURRENT_VALUATION_SOURCE = "current_investment_valuation";

export function currentHistoryValuation(view: BetaView, currency: BetaCurrency) {
  const domain = view.domain;
  if (!domain || !["ready", "partial"].includes(domain.state)) return null;
  if (domain.currentValuePresentation) {
    return originalCurrentValueSummary(domain.currentValuePresentation, currency);
  }
  return {amount: domain.valueState === "ready" && currency === "KRW" ? view.totalKrw : null,
    asOf: domain.refreshedAt, coverage: null, complete: domain.valueState === "ready"};
}

export function historyValuationChange(current: number, previous: number) {
  if (!Number.isFinite(current) || current < 0 || !Number.isFinite(previous) || previous <= 0) return null;
  const changeKrw = current - previous;
  return {changeKrw, returnPct: percentOrNull(changeKrw, previous)};
}

export function reviewedLiveBaseline(view: BetaView) {
  const current = currentHistoryValuation(view, "KRW");
  const review = view.domain?.accountHistoryReview;
  if (!review || !current?.asOf || !Number.isFinite(Date.parse(current.asOf))) return null;
  const date = liveHistoryDate(new Date(current.asOf));
  const mark = review.points.find(point => point.date === date);
  return mark?.valueKrw != null ? mark : null;
}

export function todayChangeForHistory(view: BetaView) {
  const current = currentHistoryValuation(view, "KRW");
  const baseline = reviewedLiveBaseline(view);
  if (!baseline) {
    const carried = view.domain?.manualCarryClose;
    if (!carried || !current?.complete || current.amount == null || !current.asOf ||
        !Number.isFinite(Date.parse(current.asOf)) || liveHistoryDate(new Date(current.asOf)) !== carried.cutoffDate ||
        Math.abs(Number(current.amount) - carried.valueKrw) > 0.01) return null;
    const change = historyValuationChange(carried.valueKrw, carried.previousValueKrw);
    if (!change) return null;
    return {...carried, ...change, baselineDate: valuationDateForCutoff(carried.cutoffDate)};
  }
  const valueKrw = current?.complete && current.amount != null ? Number(current.amount) : null;
  const previousValueKrw = baseline.valueKrw!;
  const change = valueKrw === null ? null : historyValuationChange(valueKrw, previousValueKrw);
  return {baselineDate: valuationDateForCutoff(baseline.date), cutoffDate: baseline.date, manualNames: [],
    valueKrw, previousValueKrw, ...change};
}

/** A read-time point, never a saved close or a newly calculated return.
 * Historical sources remain intact and individually selectable. */
export function historyWithCurrentValue(view: BetaView): BetaView {
  const domain = view.domain;
  if (
    !domain ||
    domain.historyDisplayCurrency !== "KRW" ||
    !["ready", "partial"].includes(domain.state) ||
    (domain.historyViewSource && domain.historyViewSource !== "observed")
  )
    return view;
  const current = currentHistoryValuation(view, "KRW");
  if (!current?.complete || current.amount === null || !current.asOf) return view;
  const valueKrw = Number(current.amount);
  const observed = Date.parse(current.asOf);
  if (!Number.isFinite(observed) || !Number.isFinite(valueKrw)) return view;
  const date = liveHistoryDate(new Date(observed));
  const review = domain.accountHistoryReview;
  if (review && withinReviewedValuationDates(review, date)) return view;
  const saved = view.history.filter((row) => row.source !== CURRENT_VALUATION_SOURCE);
  if (saved.some((row) => row.date > date)) return view;
  const point: BetaView["history"][number] = {
    date,
    valueKrw,
    liveAsOf: current.asOf,
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
  const value = currentHistoryValuation(view, "KRW")?.asOf;
  if (!value || !Number.isFinite(Date.parse(value))) return "조회 시각 확인 전";
  return (
    new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(5, 16).replace("T", " ") + " KST"
  );
}
