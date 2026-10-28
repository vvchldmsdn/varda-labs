import type { BetaView, ReadState } from "./read-contract";
export function readStateText(state: ReadState | undefined, empty: string) {
  if (state === "loading") return "조회 중";
  if (state === "unavailable") return "조회 불가 · 다시 시도해 주세요";
  if (state === "unauthorized") return "접근 확인 필요 · 조회 범위를 다시 선택해 주세요";
  return state === "empty" ? empty : null;
}
export function movementTone(value: number | null) {
  return value === null ? "unknown" : value > 0 ? "positive" : value < 0 ? "negative" : "neutral";
}
export type HistoryPoint = BetaView["history"][number];
export type HistoryPeriod = "1M" | "3M" | "6M" | "ALL";
const day = (date: string) => Date.parse(date + "T00:00:00Z") / 86400000;
// Inclusive calendar window anchored to the latest recorded date, not today.
// Subtract calendar months, clamping the day to the target month's last day.
export function historyRows(view: BetaView, period: HistoryPeriod) {
  const rows = view.history.filter(r => Number.isFinite(day(r.date))).toSorted((a, b) => a.date.localeCompare(b.date));
  if (period === "ALL" || !rows.length) return rows;
  const end = new Date(rows.at(-1)!.date + "T00:00:00Z");
  const months = period === "1M" ? 1 : period === "3M" ? 3 : 6;
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months + 1, 0)).getUTCDate();
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months, Math.min(end.getUTCDate(), lastDay))).toISOString().slice(0, 10);
  return rows.filter(r => r.date >= start);
}
export function historyAxis(rows: HistoryPoint[]) {
  const dates = [...new Set(rows.map(r => r.date))].sort();
  const start = dates.length ? day(dates[0]) : 0, end = dates.length ? day(dates.at(-1)!) : 0;
  const fraction = (date: string) => end === start ? .5 : (day(date) - start) / (end - start);
  const nearest = (at: number) => dates.reduce((best, date) => Math.abs(day(date) - at) < Math.abs(day(best) - at) ? date : best, dates[0]);
  const labels = [...new Set([0, .33, .66, 1].map(f => nearest(start + f * (end - start))))].filter(Boolean);
  // Keep labels at their actual time coordinates without crowding adjacent dates.
  const spacedLabels = labels.filter((date, i) => i === 0 || i === labels.length - 1 || (fraction(date) - fraction(labels[i - 1]) >= .18 && 1 - fraction(date) >= .18));
  return { dates, start, end, day, fraction, nearest, labels: spacedLabels };
}
export function historyComparison(rows: HistoryPoint[], domain: boolean) {
  const first = rows[0], last = rows.at(-1);
  if (!first || !last || first.date === last.date) return { value: null, reason: "비교 가능한 두 날짜가 필요합니다" };
  if (first.valueKrw === null || last.valueKrw === null) return { value: null, reason: "비교 금액 확인 전" };
  if (domain) {
    const scope = (r: HistoryPoint) => r.includedAccounts?.length ? [...new Set(r.includedAccounts)].sort().join("|") : r.account && r.account !== "all" ? r.account : null;
    if (first.rowKind === "partial" || last.rowKind === "partial" || !first.source || first.source !== last.source || !first.rowKind || first.rowKind !== last.rowKind || !scope(first) || scope(first) !== scope(last) || rows.filter(r => r.date === first.date).length !== 1 || rows.filter(r => r.date === last.date).length !== 1)
      return { value: null, reason: "포함 범위·출처 확인 전 · 전체 변화 비교 불가" };
  }
  return { value: last.valueKrw - first.valueKrw, reason: "입출금이 포함된 평가액의 변화" };
}
