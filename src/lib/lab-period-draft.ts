import type { Currency } from './money';

export type LabPeriodDraft = { version: 1; scope: string; currency: Currency; baseStart: string; baseEnd: string; start: string; end: string };
/** Pending dates are UI hints, separate from the dates of the displayed calculation. */
export function readLabPeriodDraft(values: readonly string[], expected: LabPeriodDraft): LabPeriodDraft | null {
  if (values.length !== 1 || values[0].length > 1000) return null;
  try {
    const value = JSON.parse(values[0]);
    if (!value || value.version !== 1 || value.scope !== expected.scope || value.currency !== expected.currency || value.baseStart !== expected.baseStart || value.baseEnd !== expected.baseEnd) return null;
    if (![value.start, value.end].every(date => typeof date === 'string' && (date === '' || /^\d{4}-\d{2}-\d{2}$/.test(date)))) return null;
    return { ...expected, start: value.start, end: value.end };
  } catch { return null; }
}
