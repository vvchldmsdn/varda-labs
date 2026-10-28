import type { RecoveredReturnCurve } from './period-return-recovery.ts';

export type StoredReturnPoint = Readonly<{ date: string; returnPct: number | null; segment?: string }>;
export type ReturnTimelinePoint = Readonly<{
  date: string; storedPct: number | null; recoveredPct: number | null;
  returnPct: number | null; basis: 'stored' | 'recovered'; segment?: string;
}>;

/** A shared date axis, not a splice of incompatible financial measures.
 * Stored acquisition-cost returns retain their values. Recovery retains its 0% baseline. */
export function buildReturnTimeline(stored: readonly StoredReturnPoint[], curve: RecoveredReturnCurve, rangeDays?: number) {
  const valid = (v: number | null) => v !== null && Number.isFinite(v) ? v : null;
  const rows = stored.filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(Date.parse(p.date)));
  const lastStored = rows.filter(p => valid(p.returnPct) !== null).map(p => p.date).sort().at(-1);
  const end = lastStored && lastStored > curve.endDate ? lastStored : curve.endDate;
  const start = rangeDays ? new Date(Date.parse(end + 'T00:00:00Z') - rangeDays * 86400000).toISOString().slice(0, 10) : '';
  const saved = new Map<string, StoredReturnPoint>();
  const conflicts = new Set<string>();
  for (const p of rows) {
    if (saved.has(p.date) && (saved.get(p.date)!.returnPct !== p.returnPct || saved.get(p.date)!.segment !== p.segment)) conflicts.add(p.date);
    else saved.set(p.date, p);
  }
  const recovered = new Map(curve.points.map(p => [p.date, p]));
  const dates = [...new Set([...rows.filter(p => p.date <= (lastStored ?? '')).map(p => p.date), ...recovered.keys()])].filter(d => d >= start && d <= end).sort();
  return dates.map((date): ReturnTimelinePoint => {
    const original = saved.get(date), recovery = recovered.get(date);
    const storedPct = conflicts.has(date) ? null : valid(original?.returnPct ?? null);
    const recoveredPct = valid(recovery?.returnPct ?? null);
    const basis = recovery ? 'recovered' : 'stored';
    return { date, storedPct, recoveredPct, returnPct: basis === 'recovered' ? recoveredPct : storedPct, basis, segment: original?.segment };
  });
}

export function returnTimelineSegments(points: readonly ReturnTimelinePoint[], field: 'storedPct' | 'recoveredPct') {
  const segments: ReturnTimelinePoint[][] = []; let current: ReturnTimelinePoint[] = [];
  for (const p of points) {
    const prior = current.at(-1);
    if (p[field] === null || (field === 'storedPct' && prior && prior.segment !== p.segment)) {
      if (current.length) segments.push(current); current = [];
    }
    if (p[field] !== null) current.push(p);
  }
  if (current.length) segments.push(current);
  return segments;
}

export function returnTimelineLabel(point: ReturnTimelinePoint) {
  return point.basis === 'stored' ? '저장 수익률' : '복구 기간 수익률 · 추정';
}
