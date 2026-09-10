import { selectUsableFxRows } from "../market-data/fx-rate-admission.ts";

type SnapshotFxEvidence = Parameters<typeof selectUsableFxRows>[0][number];

/** A later refresh may overwrite a daily FX row. Its current value cannot
 * stand in for the value observed at an earlier snapshot cutoff. */
export function selectSnapshotCutoffFx<T extends SnapshotFxEvidence>(
  rows: readonly T[],
  asOfDate: string,
  cutoffAt: Date | null,
): T | null {
  const cutoffMs = cutoffAt?.getTime() ?? null;
  if (cutoffMs !== null && !Number.isFinite(cutoffMs)) return null;
  return selectUsableFxRows(rows).find((row) => {
    if (row.rateDate > asOfDate) return false;
    if (cutoffMs === null) return true; // Explicit historical backfill uses dated history.
    const observedAt = row.fetchedAt ? new Date(row.fetchedAt).getTime() : NaN;
    return Number.isFinite(observedAt) && observedAt <= cutoffMs;
  }) ?? null;
}
