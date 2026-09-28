import { selectUsableFxRows } from "../market-data/fx-rate-admission.ts";
import { Decimal } from "../money.ts";

type SnapshotFxEvidence = Parameters<typeof selectUsableFxRows>[0][number] & {
  observedAt?: Date | string | null;
  rateKind?: string | null;
};

export const SNAPSHOT_FX_REFERENCE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
export const SNAPSHOT_FX_SPOT_MAX_AGE_MS = 15 * 60 * 1000;

/** A later refresh may overwrite a daily FX row. Its current value cannot
 * stand in for the value observed at an earlier snapshot cutoff. */
export function selectSnapshotCutoffFx<T extends SnapshotFxEvidence>(
  rows: readonly T[],
  asOfDate: string,
  cutoffAt: Date | null,
): T | null {
  const cutoffMs = cutoffAt?.getTime() ?? null;
  if (cutoffMs !== null && !Number.isFinite(cutoffMs)) return null;
  const candidates = selectUsableFxRows(rows).filter((row) => {
    if (row.rateDate > asOfDate) return false;
    if (cutoffMs === null) return true; // Explicit historical backfill uses dated history.
    const fetchedAt = row.fetchedAt ? new Date(row.fetchedAt).getTime() : NaN;
    const observedAt = row.observedAt ? new Date(row.observedAt).getTime() : NaN;
    const maxAge = row.rateKind === "daily_reference" ? SNAPSHOT_FX_REFERENCE_MAX_AGE_MS : SNAPSHOT_FX_SPOT_MAX_AGE_MS;
    return [observedAt, fetchedAt].every(Number.isFinite) && observedAt <= fetchedAt && fetchedAt <= cutoffMs
      && ["spot", "daily_reference"].includes(row.rateKind ?? "") && cutoffMs - observedAt <= maxAge;
  });
  if (cutoffMs === null) return candidates[0] ?? null;
  candidates.sort((left, right) => new Date(right.observedAt!).getTime() - new Date(left.observedAt!).getTime()
    || new Date(right.fetchedAt!).getTime() - new Date(left.fetchedAt!).getTime());
  const latest = candidates[0];
  if (!latest) return null;
  // Equal observation times with different rates are conflicting evidence,
  // not a reason to silently prefer whichever response arrived last.
  const observed = new Date(latest.observedAt!).getTime();
  if (candidates.some(row => new Date(row.observedAt!).getTime() === observed
    && Decimal.from(row.usdKrw!).compare(latest.usdKrw!) !== 0)) return null;
  return latest;
}
