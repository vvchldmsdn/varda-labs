/** UI continuations only. Every destination still admits scope and ownership itself. */
const paths = new Set([
  '/', '/additional-contribution', '/additional-contribution/compare', '/history', '/today',
  '/portfolio/risk', '/portfolio/structure', '/portfolio/targets', '/portfolio/holdings',
  '/portfolio/holdings/new', '/portfolio/first-look', '/portfolio/ledger', '/portfolio/events', '/portfolio/accounts',
  '/portfolio/manage', '/portfolio/portfolio-snapshots', '/simulation', '/investment-lab', '/market', '/plans',
  '/beta', '/beta/history', '/beta/analysis', '/beta/simulation', '/beta/investment-lab',
  '/beta/portfolio/targets', '/beta/portfolio/structure', '/beta/portfolio/holdings',
  '/beta/portfolio/holdings/new', '/beta/portfolio/holdings/manage', '/beta/portfolio/ledger',
  '/beta/history/events', '/beta/history/snapshots', '/beta/portfolio/accounts', '/beta/portfolio/accounts/manage', '/beta/plans', '/beta/etfs', '/etfs',
]);
const fields = new Set(['scope', 'account', 'accountId', 'currency', 'amount', 'cashAmountKrw',
  'excludeSell', 'fundingCurrency', 'useCash', 'from', 'mode', 'fixture', 'preview', 'window',
  'horizon', 'end', 'start', 'period', 'metric', 'date', 'analysis', 'run', 'kodexWeight', 'basketAnchor', 'q', 'asOfDate',
  'view', 'detail', 'model', 'range', 'selectedDate', 'historyDate', 'historyPeriod', 'historyMetric', 'historySource',
  '_historyDate', '_historyPeriod', '_historyMetric', '_historyScope', '_historyCurrency', '_historyReturn', '_historyDateBasis',
  '_historyViewPeriod', '_historyViewMetric', '_historyViewScope', '_historyViewCurrency', '_nativeView']);
export const RECOVERY_FRAGMENT = '#cairn-return=';
export type RecoveryKind = 'targets' | 'holdings' | 'trades' | 'market' | 'history' | 'retry';

export function safeRecoveryUrl(raw: string): string | null {
  if (raw.length > 16000 || !raw.startsWith('/') || raw.startsWith('//') || /[\\\x00-\x20\x7f]/.test(raw)) return null;
  try {
    const url = new URL(raw, 'https://cairn.invalid');
    if (url.origin !== 'https://cairn.invalid' || !paths.has(url.pathname)) return null;
    for (const key of [...url.searchParams.keys()]) if (!fields.has(key)) url.searchParams.delete(key);
    if (url.hash.startsWith(RECOVERY_FRAGMENT)) url.hash = '';
    if (url.hash && !/^#[a-zA-Z0-9_-]{1,80}$/.test(url.hash)) url.hash = '';
    return url.pathname + url.search + url.hash;
  } catch { return null; }
}
export function recoveryReturnHref(hash: string): string | null {
  if (!hash.startsWith(RECOVERY_FRAGMENT)) return null;
  try { return safeRecoveryUrl(decodeURIComponent(hash.slice(RECOVERY_FRAGMENT.length))); } catch { return null; }
}
export function recoveryHref(destination: string, source: string): string | null {
  const to = safeRecoveryUrl(destination), back = safeRecoveryUrl(source);
  if (!to || !back) return null;
  return to.split('#')[0] + RECOVERY_FRAGMENT + encodeURIComponent(back);
}
export function carryRecoveryFragment(href: string, hash: string): string {
  return recoveryReturnHref(hash) ? href.split('#')[0] + hash : href;
}
export function recoveryKind(reasons: readonly string[]): RecoveryKind {
  // A changed/read-failed basis is retried, never 'repaired' by overwriting targets.
  if (reasons.some(r => /fetch_failed|query_failed|basis_changed|request_mismatch|conflict|integrity/.test(r))) return 'retry';
  if (reasons.some(r => /target.*missing|targets_required|target.*universe|target_universe_changed/.test(r))) return 'targets';
  if (reasons.includes('owner_input_unavailable')) return 'holdings';
  if (reasons.some(r => /trade|event|flow|cost_basis/.test(r))) return 'trades';
  if (reasons.some(r => /price|quote|fx|histor|observation|market|input_matrix_unavailable/.test(r))) return 'market';
  if (reasons.some(r => /holding|valuation|empty|account/.test(r))) return 'holdings';
  return 'retry';
}
export function recoveryDestination(kind: RecoveryKind, scope: string, beta: boolean): string | null {
  if (kind === 'retry') return null;
  const path = kind === 'history' ? '/history' : kind === 'targets' ? '/portfolio/targets' : kind === 'trades' ? '/portfolio/ledger' : kind === 'holdings' && beta ? '/portfolio/holdings/manage' : '/portfolio/holdings';
  const query = new URLSearchParams({ scope, currency: 'KRW' });
  if (kind === 'trades' && /^account:[0-9a-f-]{36}$/i.test(scope)) query.set('accountId', scope.slice(8));
  if (kind === 'history') query.set('detail', 'raw');
  const useBeta = beta && kind !== 'market' && kind !== 'history';
  if (useBeta) query.set('mode', 'domain');
  return `${useBeta ? '/beta' : ''}${path}?${query}`;
}
