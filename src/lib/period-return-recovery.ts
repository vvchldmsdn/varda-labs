import { calculateInvestmentLabModifiedDietz, INVESTMENT_LAB_MODIFIED_DIETZ_POLICY } from './investment-lab-modified-dietz.ts';

export type RecoveredReturnCurve = Readonly<{
  baseDate: string; endDate: string; currency: 'KRW'; revision: number;
  points: readonly { date: string; valueKrw: number | null; returnPct: number | null }[];
  missingDays: number;
}>;

/** A recovered period return is never an acquisition-cost return. Recalculate
 * with the existing engine; do not trust a serialized percentage. No interpolation. */
export function parseRecoveredReturnCurve(value: unknown): RecoveredReturnCurve | null {
  try {
    if (!value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    if (v.version !== 1 || v.currency !== 'KRW' || v.basis !== 'invested_assets_excluding_cash'
      || !Number.isSafeInteger(v.revision) || Number(v.revision) < 1
      || !Array.isArray(v.points) || v.points.length < 2 || v.points.length > 1000
      || !Array.isArray(v.flows) || v.flows.length > 5000) return null;
    if (!v.policy || typeof v.policy !== 'object' || Object.entries(INVESTMENT_LAB_MODIFIED_DIETZ_POLICY).some(([key, expected]) => (v.policy as Record<string, unknown>)[key] !== expected)) return null;
    const validDate = (date: unknown): date is string => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date;
    const points: { date: string; valueKrw: number | null; returnPct: number | null }[] = [];
    for (const point of v.points) {
      if (!point || typeof point !== 'object' || !validDate(point.date)
        || (points.length && point.date <= points.at(-1)!.date)
        || (point.valueKrw !== null && (typeof point.valueKrw !== 'number' || !Number.isFinite(point.valueKrw) || point.valueKrw <= 0))) return null;
      points.push({ date: point.date, valueKrw: point.valueKrw, returnPct: null });
    }
    if (v.baseDate !== points[0].date || v.endDate !== points.at(-1)!.date || points[0].valueKrw === null || points.at(-1)!.valueKrw === null) return null;
    const valuations = points.flatMap(p => p.valueKrw === null ? [] : [{ serviceDate: p.date, valueKrw: p.valueKrw }]);
    const flows = v.flows.map(f => ({ effectiveServiceDate: f.effectiveServiceDate, sequence: f.sequence, direction: f.direction, amountKrw: f.amountKrw }));
    const result = calculateInvestmentLabModifiedDietz({ valuations, flows });
    if (result.status !== 'ready') return null;
    const cumulative = new Map<string, number>([[points[0].date, 0]]);
    let linked = 1;
    for (const p of result.periods) { linked *= 1 + p.periodReturn; cumulative.set(p.endServiceDate, (linked - 1) * 100); }
    for (const p of points) p.returnPct = cumulative.get(p.date) ?? null;
    return { baseDate: points[0].date, endDate: points.at(-1)!.date, currency: 'KRW', revision: Number(v.revision), points, missingDays: points.filter(p => p.valueKrw === null).length };
  } catch { return null; }
}
