import Link from 'next/link';
import { redirect } from 'next/navigation';
import { effectSession } from '@/lib/auth/contribution-effect-session';
import { resolveCurrentTenantContext } from '@/lib/auth/current-tenant-context';
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from '@/db/queries/portfolio-analysis-scopes';
import { readContributionEffects } from '@/db/queries/contribution-effects';
import { SecondaryPageHeader } from '@/components/secondary-page-header';
import { PageTitle, Status } from '@/components/cairn-ui';
import { PortfolioText } from '@/components/portfolio/portfolio-text';
import { RecoveryNotice } from '@/components/recovery/recovery-notice';
import { ContributionJourneyNav } from '@/components/additional-contribution/contribution-journey';
import { ContributionEffectLibrary, type EffectTrackingProps } from '@/components/additional-contribution/contribution-effect-tracking';
import { contributionJourneyHref } from '@/lib/contribution-journey';
import styles from '@/components/additional-contribution/contribution-comparison.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: '저장한 배분안·매수 연결 | CAIRN LABS', robots: { index: false, follow: false } };
export default async function ContributionTrackingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const preview = process.env.NODE_ENV === 'development' && params.preview === 'design';
  const journey = { scope: typeof params.scope === 'string' ? params.scope : 'all', amount: typeof params.amount === 'string' ? params.amount : undefined, currency: params.currency === 'USD' ? 'USD' as const : 'KRW' as const, beta: params.from === 'beta', preview };
  let accounts: { key: string; label: string }[] = [], tracking: EffectTrackingProps | undefined;
  let unavailable = false;
  if (preview) {
    const { contributionEffectPreview } = await import('@/lib/contribution-effect-preview');
    tracking = { accountId: 'demo', sessionKey: 'demo', items: [contributionEffectPreview()], preview: true };
  } else {
    const tenant = await resolveCurrentTenantContext();
    if (!tenant.ok) redirect(`/auth/sign-in?returnTo=${encodeURIComponent(contributionJourneyHref('tracking', journey, typeof params.effectId === 'string' ? params.effectId : undefined))}`);
    const scopes = await getReadOnlyTenantPortfolioAnalysisScopeContext({ tenantContext: tenant.tenantContext, scope: journey.scope });
    unavailable = scopes.state !== 'ready';
    if (scopes.state === 'ready') accounts = scopes.catalog.scopes.filter(item => item.kind === 'account').map(item => ({ key: item.key, label: item.label }));
    if (accounts.some(item => item.key === journey.scope)) {
      const accountId = journey.scope.slice(8);
      // Saved records remain readable even if today's target policy cannot calculate a new plan.
      const [auth, saved] = await Promise.all([effectSession(), readContributionEffects(tenant.tenantContext, accountId).then(items => ({ items, unavailable: false })).catch(() => ({ items: [], unavailable: true }))]);
      if (auth) tracking = { accountId, sessionKey: auth.key, ...saved };
      else unavailable = true;
    }
  }
  return <main className={styles.page}><SecondaryPageHeader /><div className={styles.content} id="varda-main-content">
    <header className={styles.header}><div><PageTitle><PortfolioText ko="저장한 배분안·매수 연결" en="Saved allocations & linked buys" /></PageTitle><p className={styles.lead}><PortfolioText ko="저장한 조건은 그대로 두고, 실제 매수와 현재 가격을 확인하세요." en="Keep the saved assumptions and review your actual buys at current prices." /></p></div></header>
    <ContributionJourneyNav journey={journey} current="tracking" />
    {accounts.length > 0 && <nav className={styles.accountChoices} aria-label="저장 기록을 확인할 계좌">{accounts.map(account => <Link prefetch={false} key={account.key} aria-current={account.key === journey.scope ? 'page' : undefined} href={contributionJourneyHref('tracking', { ...journey, scope: account.key })}>{account.label}</Link>)}</nav>}
    {preview && <Status>화면 검증용 예시입니다. 저장·거래 기록은 변경하지 않습니다.</Status>}
    {tracking ? <ContributionEffectLibrary key={`${tracking.sessionKey}:${tracking.accountId}`} tracking={tracking} journey={journey} selectedId={typeof params.effectId === 'string' ? params.effectId : undefined} /> : unavailable ? <RecoveryNotice kind="retry" /> : <Status tone="warning"><PortfolioText ko="저장 기록을 확인할 계좌를 선택해 주세요. 계좌별 기록과 거래를 구분합니다." en="Choose an account. Saved allocations and trades are kept separate by account." /></Status>}
    <p className={styles.note}>보유 기반 계획의 매도·현금 포함 계산과 별개인 신규 투자금의 매수 비교 기록입니다. 매수 연결은 이미 기록한 거래를 이 배분안에 연결하며 주문을 실행하지 않습니다.</p>
  </div></main>;
}
