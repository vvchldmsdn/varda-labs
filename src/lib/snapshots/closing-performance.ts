import "server-only";
import { readPeriodPerformance } from "../cairn-v2/period-attribution-read";
import { buildCycleForSnapshotDate } from "./market-calendar";
import type { SnapshotWork } from "./durable-work";

/** A daily link can be compounded for any chart range. A cumulative figure would
 * silently preserve the wrong opening day when a historical trade is corrected. */
export async function readClosingPerformance(work: SnapshotWork) {
  const cycle = buildCycleForSnapshotDate(work.snapshotDate, new Date());
  const range = { start: cycle.cycleStartAt.toISOString().slice(0, 10), end: cycle.cycleEndAt.toISOString().slice(0, 10) };
  const ids = new Map<string, string>();
  const result = await readPeriodPerformance({
    tenantContext: { ownerUserId: work.ownerUserId, role: work.role },
    scope: { kind: "account", key: `account:${work.accountId}`, label: work.code, accountCode: work.code, accountId: work.accountId },
    range, includeLive: false,
    onClosedEvidence: rows => { for (const row of rows) ids.set(row.date, row.snapshotId); },
  });
  const point = result.points.find(row => row.date === range.end);
  const snapshotId = ids.get(range.end);
  if (!point || !snapshotId || point.liveAsOf || result.basis === "mixed") return null;
  const dailyReturnPct = point.dailyReturnPct;
  const previousSnapshotId = ids.get(range.start) ?? null;
  if (dailyReturnPct !== null && (!Number.isFinite(dailyReturnPct) || !previousSnapshotId)) {
    throw new Error("invalid_closing_performance");
  }
  const reason = dailyReturnPct === null
    ? result.gaps.find(gap => gap.start <= range.end && gap.end >= range.end)?.reason ?? "valuation"
    : null;
  return { snapshotId, value: {
    version: 1, date: range.end, basis: result.basis, currency: result.currency, revision: work.revision,
    previousSnapshotId, dailyReturnPct, reason, closingFx: result.includesClosingFx, carriedMarks: result.includesCarriedMarks,
    ...(point.canonicalClose && { returnPct: point.returnPct, segment: point.segment, reviewEstimated:point.reviewEstimated }),
  } };
}
