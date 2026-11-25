import type { BetaView } from "./read-contract";
import type { PeriodPerformance } from "./period-performance";
import { cutoffDateForValuation, valuationDateForCutoff } from "./history-date.ts";

import type { AccountHistoryReview } from "../../db/queries/account-history-review";
export type { AccountHistoryReview } from "../../db/queries/account-history-review";

export const reviewedSource = "broker_account_review_v1";
const day = 86_400_000;
const adjacent = (before: string, after: string) => Date.parse(after) - Date.parse(before) === day;
export const withinReview = (review: AccountHistoryReview, date: string) =>
  date >= review.startDate && date <= review.endDate;
export const withinReviewedValuationDates = (review: AccountHistoryReview, date: string) =>
  date >= valuationDateForCutoff(review.startDate) && date <= valuationDateForCutoff(review.endDate);

export function reviewedValues(original: BetaView["history"], review: AccountHistoryReview): BetaView["history"] {
  if (review.materialized) {
    // The approved dated receipts now live in the same close table as tomorrow's mark.
    // Do not synthesize old points outside the requested history window.
    const priced = new Set(review.points.filter(p => p.valueKrw !== null).map(p => valuationDateForCutoff(p.date)));
    return original.filter(row => !withinReviewedValuationDates(review, row.date) ||
      row.source === "varda_manual_daily_snapshot" && priced.has(row.date));
  }
  let segment = 0;
  const rows = review.points.filter(p => withinReview(review, p.date)).map((point, index, points) => {
    if (index && !adjacent(points[index - 1].date, point.date)) segment++;
    return { date: valuationDateForCutoff(point.date), storageSnapshotDate: point.date,
      source: reviewedSource, rowKind: "reviewed", valueKrw: point.valueKrw,
      exampleReturnPct: point.returnPct, valueSegment: reviewedSource + ":" + segment,
      segment: point.segment ? reviewedSource + ":" + valuationDateForCutoff(point.segment) : undefined };
  });
  return [...original.filter(row => !withinReviewedValuationDates(review, row.date)), ...rows].sort((a, b) => a.date.localeCompare(b.date));
}

/** A reviewed close and native account performance can have different baskets.
 * The chart keeps independent segments on either side of the reviewed interval. */
export function reviewedPerformance(original: PeriodPerformance, review: AccountHistoryReview): PeriodPerformance {
  if (review.materialized) return original;
  const start = valuationDateForCutoff(review.startDate);
  const end = valuationDateForCutoff(review.endDate);
  if (end < original.range.start || start > original.range.end) return original;
  const rows = review.points.filter(row => withinReview(review, row.date)).map(row => ({
    ...row,date:valuationDateForCutoff(row.date),segment:row.segment && valuationDateForCutoff(row.segment),
  }));
  const reviewed = new Map(rows.map(row => [row.date, row]));
  const points = original.points.filter(point => !withinReviewedValuationDates(review, point.date));
  const remaining = original.gaps.flatMap(gap => {
    if (gap.end < start || gap.start > end) return [gap];
    const parts: PeriodPerformance["gaps"] = [];
    if (gap.start < start) parts.push({ ...gap, end: valuationDateForCutoff(start) });
    if (gap.end > end) parts.push({ ...gap, start: cutoffDateForValuation(end) });
    return parts;
  });
  const gaps: PeriodPerformance["gaps"] = [];
  const from = Date.parse(start > original.range.start ? start : original.range.start);
  const to = Date.parse(end < original.range.end ? end : original.range.end);
  for (let at = from; at <= to; at += day) {
    const date = new Date(at).toISOString().slice(0, 10);
    const row = reviewed.get(date);
    points.push({ date, returnPct: row?.returnPct ?? null, dailyReturnPct: row?.dailyReturnPct ?? null,
      segment: row?.segment ?? null, accountReview: true, reviewEstimated: row?.estimated });
    if (row?.returnPct != null && (row.dailyReturnPct != null || row.segment === date)) continue;
    const reason = row?.valueKrw == null ? "valuation" : "trade";
    const last = gaps.at(-1);
    if (last?.reason === reason && adjacent(last.end, date)) last.end = date;
    else gaps.push({ start: date, end: date, reason });
  }
  return { ...original, points: points.sort((a, b) => a.date.localeCompare(b.date)),
    gaps: [...remaining, ...gaps].sort((a, b) => a.start.localeCompare(b.start)) };
}
