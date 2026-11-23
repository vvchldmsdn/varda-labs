import type { BetaView } from "./read-contract";
import type { PeriodPerformance } from "./period-performance";

import type { AccountHistoryReview } from "../../db/queries/account-history-review";
export type { AccountHistoryReview } from "../../db/queries/account-history-review";

export const reviewedSource = "broker_account_review_v1";
const day = 86_400_000;
const adjacent = (before: string, after: string) => Date.parse(after) - Date.parse(before) === day;
export const withinReview = (review: AccountHistoryReview, date: string) =>
  date >= review.startDate && date <= review.endDate;

export function reviewedValues(original: BetaView["history"], review: AccountHistoryReview): BetaView["history"] {
  let segment = 0;
  const rows = review.points.filter(p => withinReview(review, p.date)).map((point, index, points) => {
    if (index && !adjacent(points[index - 1].date, point.date)) segment++;
    return { date: point.date, source: reviewedSource, rowKind: "reviewed", valueKrw: point.valueKrw,
      exampleReturnPct: point.returnPct, valueSegment: reviewedSource + ":" + segment,
      segment: point.segment ? reviewedSource + ":" + point.segment : undefined };
  });
  return [...original.filter(row => !withinReview(review, row.date)), ...rows].sort((a, b) => a.date.localeCompare(b.date));
}

/** A reviewed close and native account performance can have different baskets.
 * The chart keeps independent segments on either side of the reviewed interval. */
export function reviewedPerformance(original: PeriodPerformance, review: AccountHistoryReview): PeriodPerformance {
  if (review.endDate < original.range.start || review.startDate > original.range.end) return original;
  const rows = review.points.filter(row => withinReview(review, row.date) &&
    row.date >= original.range.start && row.date <= original.range.end);
  const reviewed = new Map(rows.map(row => [row.date, row]));
  const points = original.points.filter(point => !withinReview(review, point.date));
  const remaining = original.gaps.flatMap(gap => {
    if (gap.end < review.startDate || gap.start > review.endDate) return [gap];
    const parts: PeriodPerformance["gaps"] = [];
    if (gap.start < review.startDate) parts.push({ ...gap, end: new Date(Date.parse(review.startDate) - day).toISOString().slice(0, 10) });
    if (gap.end > review.endDate) parts.push({ ...gap, start: new Date(Date.parse(review.endDate) + day).toISOString().slice(0, 10) });
    return parts;
  });
  const gaps: PeriodPerformance["gaps"] = [];
  const from = Date.parse(review.startDate > original.range.start ? review.startDate : original.range.start);
  const to = Date.parse(review.endDate < original.range.end ? review.endDate : original.range.end);
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
