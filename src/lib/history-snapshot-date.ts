import { portfolioDashboardHistoryDisplayDate } from "./portfolio-dashboard-history.ts";

type SnapshotDateEvidence = Readonly<{
  snapshotDate: string;
  source: string;
  /** Display date only. Null means conflicting aggregate date evidence. */
  valuationDate?: string | null;
}>;

export function historySnapshotDisplayDate(row: SnapshotDateEvidence) {
  const storedDate = new Date(`${row.snapshotDate}T00:00:00Z`);
  if (!Number.isFinite(storedDate.getTime()) || storedDate.toISOString().slice(0, 10) !== row.snapshotDate) return null;
  return row.valuationDate === undefined
    ? portfolioDashboardHistoryDisplayDate(row)
    : row.valuationDate;
}

/** An aggregate cannot claim a single observation date when its inputs disagree. */
export function commonHistoryValuationDate(rows: readonly SnapshotDateEvidence[]) {
  const dates = rows.map(historySnapshotDisplayDate);
  const first = dates[0] ?? null;
  return first !== null && dates.every(date => date === first) ? first : null;
}
