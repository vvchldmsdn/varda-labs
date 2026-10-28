// Date metadata only; no valuation or return calculations.
// Limited port: src/lib/portfolio-dashboard-history.ts, SHA256 b193ff72242954bc8b05ff116e03e7e8c274442f27b7223d2cc039eb06377d72.
// Keep the original storage key separate from the completed-day display date.
export function betaHistoryValuationDate(
  row: Readonly<{ snapshotDate: string; source: string | null; cycleEndAt?: Date | string | null }>,
) {
  if (row.source !== "varda_manual_daily_snapshot" && !row.source?.startsWith("broker_reconstructed_close_v1:")) return row.snapshotDate;
  const cycleEnd = timestamp(row.cycleEndAt ?? null);
  const cutoffDate = cycleEnd > 0
    ? new Date(cycleEnd + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : row.snapshotDate;
  return shiftIsoDate(cutoffDate, -1);
}


export function commonBetaHistoryValuationDate(rows: readonly Readonly<{ valuationDate: string | null }>[]) {
  const first = rows[0]?.valuationDate ?? null;
  return first !== null && rows.every(row => row.valuationDate === first) ? first : null;
}

export function historyObservationDate(row: Readonly<{ snapshotDate: string; source: string; cycleEndAt?: Date | string | null; valuationDate?: string | null }>) {
  if (!isDateKey(row.snapshotDate)) return null;
  const date = row.valuationDate === undefined ? betaHistoryValuationDate(row) : row.valuationDate;
  return date !== null && isDateKey(date) ? date : null;
}

function isDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const at = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(at.getTime()) && at.toISOString().slice(0, 10) === value;
}

function timestamp(value: Date | string | null) {
  if (!value) return 0;
  const result = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(result) ? result : 0;
}

function shiftIsoDate(value: string, dayDelta: number) {
  const at = Date.parse(`${value}T00:00:00Z`);
  return new Date(at + dayDelta * 86_400_000).toISOString().slice(0, 10);
}
