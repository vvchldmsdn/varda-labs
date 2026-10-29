import { redirect } from 'next/navigation';
import { effectSession } from '@/lib/auth/contribution-effect-session';
import { readContributionEffects } from '@/db/queries/contribution-effects';
import type { EffectTrackingProps } from '@/components/additional-contribution/contribution-effect-tracking';
import { SecondaryPageHeader } from '@/components/secondary-page-header';
import { ContributionComparisonView } from '@/components/additional-contribution/contribution-comparison';
import { resolveCurrentTenantContext } from '@/lib/auth/current-tenant-context';
import { readNativeContributionContext } from '@/db/queries/native-contribution-context';
import { prepareContributionComparison, type ComparisonBasisResult } from '@/lib/contribution-comparison';
import styles from '@/components/additional-contribution/contribution-comparison.module.css';
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from '@/db/queries/portfolio-analysis-scopes';
import { comparisonDraft, comparisonDraftQuery, contributionJourneyHref } from '@/lib/contribution-journey';

export const dynamic = 'force-dynamic';
export const metadata = { title: '추가투입 효과 비교 | CAIRN LABS', robots: { index: false, follow: false } };
export default async function ContributionComparisonPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const preview = process.env.NODE_ENV === 'development' && params.preview === 'design';
  const scope = typeof params.scope === 'string' ? params.scope : 'all';
  const query = new URLSearchParams({ scope });
  if (preview) query.set('preview', 'design');
  const returnQuery = new URLSearchParams(query);
  if (typeof params.amount === 'string' && (params.from !== 'beta' || params.currency !== 'USD')) returnQuery.set(params.from === 'beta' ? 'cashAmountKrw' : 'amount', params.amount);
  returnQuery.set('currency', params.currency === 'USD' ? 'USD' : 'KRW');
  if (params.from === 'beta') returnQuery.set('mode', 'domain');
  const backHref = params.from === 'beta' ? `/beta?${returnQuery}` : `/additional-contribution?${returnQuery}`;
  let basis: ComparisonBasisResult;
  let tracking: EffectTrackingProps | undefined;
  let accounts: { key: string; label: string }[] = [];
  if (preview) {
    const { contributionComparisonPreview } = await import('@/lib/contribution-comparison-preview');
    basis = contributionComparisonPreview();
    const { contributionEffectPreview } = await import("@/lib/contribution-effect-preview");
    tracking = { accountId: "demo", sessionKey: "demo", items: [contributionEffectPreview()], preview: true };
  } else {
    const tenant = await resolveCurrentTenantContext();
    if (!tenant.ok) {
      const continuation = contributionJourneyHref('compare', {scope,amount:typeof params.amount === 'string' ? params.amount : undefined,currency:params.currency === 'USD' ? 'USD' : 'KRW',beta:params.from === 'beta'});
      redirect(`/auth/sign-in?returnTo=${encodeURIComponent(`${continuation}&${new URLSearchParams(comparisonDraftQuery(comparisonDraft(params)))}`)}`);
    }
    const scopes = await getReadOnlyTenantPortfolioAnalysisScopeContext({ tenantContext: tenant.tenantContext, scope });
    if (scopes.state === 'ready') accounts = scopes.catalog.scopes.filter(item => item.kind === 'account').map(item => ({ key: item.key, label: item.label }));
    // Read once on the server. Scenario controls only recompute the supplied snapshot.
    if (accounts.some(item => item.key === scope)) {
      const accountId = scope.slice(8);
      const [context, auth, saved] = await Promise.all([readNativeContributionContext(tenant.tenantContext, scope, 'KRW', true), effectSession(), readContributionEffects(tenant.tenantContext, accountId).then(items => ({ items, unavailable: false })).catch(() => ({ items: [], unavailable: true }))]);
      basis = prepareContributionComparison(context);
      if (auth) tracking = { accountId, sessionKey: auth.key, ...saved };
    } else basis = { status: 'blocked', reason: 'choose_one_account' };
  }
  return <main className={styles.page}><SecondaryPageHeader />{accounts.length > 0 && <nav className={styles.accounts} aria-label="비교할 계좌">{accounts.map(account => <a key={account.key} aria-current={scope === account.key ? 'page' : undefined} href={`/additional-contribution/compare?${new URLSearchParams({ scope: account.key, ...(typeof params.amount === 'string' ? { amount: params.amount } : {}), currency: params.currency === 'USD' ? 'USD' : 'KRW', ...(params.from === 'beta' ? { from: 'beta' } : {}) })}`}>{account.label}</a>)}</nav>}<ContributionComparisonView key={scope} basis={basis} initialDraft={comparisonDraft(params)} initialAmount={typeof params.amount === 'string' ? params.amount : undefined} initialCurrency={params.currency === 'USD' ? 'USD' : 'KRW'} preview={preview} backHref={backHref} tracking={tracking} /></main>;
}
