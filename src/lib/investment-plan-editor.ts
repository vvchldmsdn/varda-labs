import { isPlanId, PLAN_TTL_MS } from './investment-plan.ts';
import type { Currency } from './money.ts';

export const PLAN_EDITOR_KEY = 'cairn.plan-editor.v1';
export type PlanEditorRow = { name: string; value: string; target: string };
export type PlanEditorDraft = {
  version: 1; expiresAt: number; calculationId: string | null; quickId: string | null;
  currency: Currency; amount: string; rows: PlanEditorRow[]; asOf?: string; versioned: boolean; calculated: boolean;
};
/** Preserve incomplete strings as editing state, never as a calculated/storable plan. */
export function parsePlanEditor(raw: string | null, now = Date.now()): PlanEditorDraft | null {
  try {
    if (!raw || raw.length > 20_000) return null;
    const d = JSON.parse(raw);
    if (d?.version !== 1 || !Number.isFinite(d.expiresAt) || d.expiresAt <= now || d.expiresAt > now + PLAN_TTL_MS
      || !['KRW', 'USD'].includes(d.currency) || typeof d.amount !== 'string' || d.amount.length > 64
      || typeof d.versioned !== 'boolean' || typeof d.calculated !== 'boolean'
      || (d.calculationId !== null && !isPlanId(d.calculationId)) || (d.quickId !== null && !isPlanId(d.quickId))
      || (d.asOf !== undefined && (typeof d.asOf !== 'string' || !Number.isFinite(Date.parse(d.asOf))))
      || !Array.isArray(d.rows) || d.rows.length < 1 || d.rows.length > 12) return null;
    if (d.rows.some((r: PlanEditorRow) => !r || typeof r.name !== 'string' || r.name.length > 60
      || typeof r.value !== 'string' || r.value.length > 64 || typeof r.target !== 'string' || r.target.length > 64)) return null;
    return { version: 1, expiresAt: d.expiresAt, calculationId: d.calculationId, quickId: d.quickId,
      currency: d.currency, amount: d.amount, rows: d.rows.map((r: PlanEditorRow) => ({ name: r.name, value: r.value, target: r.target })),
      asOf: d.asOf, versioned: d.versioned, calculated: d.calculated };
  } catch { return null; }
}
