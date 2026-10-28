import type { Currency } from './money';
import type { RecoveryKind } from './recovery-navigation';

/** UI hints only. Never used as valuation, ownership, transaction or market evidence. */
export type NativeViewDraft = {
  version: 1; scope: string; view: string; currency: Currency;
  zone?: string; selected?: string; horizon?: number; step?: number;
  fields?: string[]; comparison?: number[]; scenarioId?: string; instruments?: string[];
};
export function parseNativeViewDraft(values: readonly string[], scope: string, view: string, currency: Currency): NativeViewDraft | null {
  if (values.length !== 1 || values[0].length > 12000) return null;
  try {
    const value = JSON.parse(values[0]);
    if (!value || value.version !== 1 || value.scope !== scope || value.view !== view || value.currency !== currency) return null;
    const result: NativeViewDraft = { version: 1, scope, view, currency };
    if (typeof value.zone === 'string' && value.zone.length <= 80) {
      try { new Intl.DateTimeFormat('en', { timeZone: value.zone }); result.zone = value.zone; } catch { /* Ignore an invalid display zone. */ }
    }
    for (const key of ['selected', 'scenarioId'] as const) if (typeof value[key] === 'string' && /^[\w:.-]{1,120}$/.test(value[key])) result[key] = value[key];
    if ([30, 63, 126, 252].includes(value.horizon)) result.horizon = value.horizon;
    if (Number.isInteger(value.step) && value.step >= 0 && value.step <= (result.horizon ?? 252)) result.step = value.step;
    if (Array.isArray(value.fields) && value.fields.length <= 200 && value.fields.every((item: unknown) => typeof item === 'string' && item.length <= 32 && !/[\x00-\x1f]/.test(item))) result.fields = value.fields;
    if (Array.isArray(value.instruments) && value.instruments.length <= 200 && value.instruments.every((item: unknown) => typeof item === 'string' && /^[\w:.-]{1,120}$/.test(item))) result.instruments = value.instruments;
    if (Array.isArray(value.comparison) && value.comparison.length <= 200 && value.comparison.every((item: unknown) => typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 1) && Math.abs(value.comparison.reduce((sum: number, item: number) => sum + item, 0) - 1) < 1e-8) result.comparison = value.comparison;
    return result;
  } catch { return null; }
}

/** Unsupported products and editable local weight errors are not missing market data. */
export function currencyRecoveryKind(reasons: readonly string[]): RecoveryKind | null {
  if (!reasons.length) return null;
  if (reasons.some(reason => /owner_scope_mismatch|unauthorized/.test(reason))) return null;
  if (reasons.some(reason => /fetch_failed|query_failed|conflict|duplicate|invalid|mismatch|future_valuation/.test(reason) && reason !== 'comparison_weights_invalid')) return 'retry';
  if (reasons.some(reason => /trade|ledger|quantity|cash_flow|group_income/.test(reason))) return 'trades';
  if (reasons.some(reason => /price|quote|fx|history_missing|insufficient_history|history_stale|corporate_action.*(missing|pending|provisional)|future_evidence/.test(reason))) return 'market';
  if (reasons.some(reason => /valuation_incomplete|portfolio_scope_incomplete|instrument_unidentified|manual_gold|fractional_value_not_dated|cash_not_observed/.test(reason))) return 'holdings';
  return null;
}
