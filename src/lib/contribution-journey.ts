import { Decimal, type Currency } from './money';
import { recoveryHref } from './recovery-navigation';

/** Display/navigation hints only. The destination verifies account ownership and calculation inputs. */
export type ContributionJourney = { scope: string; amount?: string; currency?: Currency; reportingCurrency?: Currency; useCash?: boolean; beta?: boolean; preview?: boolean; excludeSell?: readonly string[] };
export function contributionJourneyHref(path: 'compare' | 'tracking' | 'plan', journey: ContributionJourney, effectId?: string) {
  const query = new URLSearchParams({ scope: journey.scope, currency: journey.currency ?? 'KRW' });
  if (journey.amount !== undefined) query.set('amount', journey.amount);
  if (journey.beta) query.set('from', 'beta');
  if (journey.preview) query.set('preview', 'design');
  if (path === 'plan') {
    query.set('fundingCurrency', journey.currency ?? 'KRW');
    query.set('currency', journey.reportingCurrency ?? journey.currency ?? 'KRW');
    if (journey.useCash !== undefined) query.set('useCash', journey.useCash ? '1' : '0');
    for (const key of journey.excludeSell ?? []) query.append('excludeSell', key);
  }
  if (path === 'tracking' && effectId && /^[0-9a-f-]{36}$/i.test(effectId)) query.set('effectId', effectId);
  return `/additional-contribution/${path}?${query}`;
}
export function savedEffectFundingAmount(comparison: { funding: Currency; budget: number; basis: { usdKrw: number | null } }): string | undefined {
  try {
    const amount = Decimal.from(comparison.budget).div(comparison.funding === 'USD' ? comparison.basis.usdKrw! : 1);
    // Reuse only an exactly recoverable input; never round a stored budget into a new instruction.
    amount.minor(comparison.funding);
    return amount.toExactString();
  } catch { return undefined; }
}
export function contributionTargetsHref(journey: ContributionJourney, returnHref: string) {
  const query = new URLSearchParams({ scope: journey.scope, currency: 'KRW' });
  // Beta's target editor has no design fixture; use the existing read-only original preview.
  const useBeta = journey.beta && !journey.preview;
  if (journey.preview) query.set('preview', 'design');
  if (useBeta) query.set('mode', 'domain');
  const destination = `${useBeta ? '/beta' : ''}/portfolio/targets?${query}`;
  return recoveryHref(destination, returnHref) ?? recoveryHref(destination, contributionJourneyHref('compare', journey)) ?? destination;
}
export function contributionTradeHref(journey: ContributionJourney, effectId: string) {
  const query = new URLSearchParams({ scope: journey.scope, currency: journey.currency ?? 'KRW', action: 'buy' });
  if (/^account:[0-9a-f-]{36}$/i.test(journey.scope)) query.set('accountId', journey.scope.slice(8));
  if (journey.beta) query.set('mode', 'domain');
  return recoveryHref(`${journey.beta ? '/beta' : ''}/portfolio/ledger?${query}`, contributionJourneyHref('tracking', journey, effectId))!;
}
export type ComparisonDraft = { horizon: string; price: string; fx: string; overrides: Record<string, string> };
type SearchValues = Record<string, string | string[] | undefined>;
const decimal = (value: unknown, fallback: string) => typeof value === 'string' && value.length <= 24 && /^-?\d*(\.\d*)?$/.test(value) ? value : fallback;
export function comparisonDraft(params: SearchValues): ComparisonDraft {
  let overrides: Record<string, string> = {};
  if (typeof params.scenarioRows === 'string' && params.scenarioRows.length <= 8000) {
    try {
      const rows: unknown = JSON.parse(params.scenarioRows);
      if (Array.isArray(rows) && rows.length <= 100) overrides = Object.fromEntries(rows.filter((row): row is [string, string] => Array.isArray(row) && row.length === 2 && typeof row[0] === 'string' && /^[\w:.-]{1,160}$/.test(row[0]) && typeof row[1] === 'string' && decimal(row[1], 'invalid') !== 'invalid'));
    } catch { /* Invalid display hints never become calculation evidence. */ }
  }
  return { horizon: typeof params.horizon === 'string' && ['10', '30', '90'].includes(params.horizon) ? params.horizon : '30', price: decimal(params.pricePct, '0'), fx: decimal(params.fxPct, '0'), overrides };
}
export function comparisonDraftQuery(draft: ComparisonDraft) {
  return { horizon: draft.horizon, pricePct: draft.price, fxPct: draft.fx, scenarioRows: JSON.stringify(Object.entries(draft.overrides)) };
}
