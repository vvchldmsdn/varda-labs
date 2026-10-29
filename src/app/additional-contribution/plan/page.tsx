import { redirect } from 'next/navigation';
import { effectSession } from '@/lib/auth/contribution-effect-session';
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from '@/db/queries/portfolio-analysis-scopes';
import { PortfolioAnalysisScopeBoundary } from '@/components/portfolio-analysis-scope-boundary';
import { SecondaryPageHeader } from '@/components/secondary-page-header';
import { NativeContributionPlanner } from '@/components/native-contribution-planner';
import { PageTitle } from '@/components/cairn-ui';
import { contributionJourneyHref } from '@/lib/contribution-journey';
import { PortfolioText } from '@/components/portfolio/portfolio-text';
import { parseSaleExclusionKeys } from '@/lib/additional-contribution-sale-exclusions';
import styles from '@/components/additional-contribution/contribution-comparison.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: '보유 기반 투자계획 | CAIRN LABS', robots: { index: false, follow: false } };
export default async function ContributionPlanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  // No fixture exists for the native plan API. Reject preview before auth or portfolio reads.
  if (params.preview === 'design') return <main className={styles.page}><div className={styles.content} id="varda-main-content"><PageTitle><PortfolioText ko="보유 기반 투자계획" en="Holdings-based investment plan" /></PageTitle><p role="status"><PortfolioText ko="예시 화면에서는 보유 기반 계획을 계산하거나 저장하지 않습니다." en="Holdings plans cannot be calculated or saved in design preview." /></p></div></main>;
  const currency = params.currency === 'USD' ? 'USD' as const : 'KRW' as const;
  const exclusions = parseSaleExclusionKeys(params.excludeSell);
  const journey = { scope: typeof params.scope === 'string' ? params.scope : 'all', amount: typeof params.amount === 'string' ? params.amount : undefined, reportingCurrency:currency, currency: params.fundingCurrency === 'USD' ? 'USD' as const : params.fundingCurrency === 'KRW' ? 'KRW' as const : currency, useCash:params.useCash==='1', excludeSell:exclusions.ok?exclusions.keys:[], beta: params.from === 'beta' };
  const session = await effectSession();
  if (!session) redirect(`/auth/sign-in?returnTo=${encodeURIComponent(contributionJourneyHref('plan', journey))}`);
  const scope = await getReadOnlyTenantPortfolioAnalysisScopeContext({ tenantContext: session.tenant, scope: journey.scope });
  if (scope.state !== 'ready' || scope.resolution.state !== 'resolved') return <PortfolioAnalysisScopeBoundary basePath="/additional-contribution/plan" context={scope} title="보유 기반 투자계획" titleEn="Holdings plan" />;
  return <main className={styles.page}><SecondaryPageHeader /><div className={styles.content} id="varda-main-content">
    <PageTitle><PortfolioText ko="보유 기반 투자계획" en="Holdings-based investment plan" /></PageTitle>
    <p className={styles.lead}><PortfolioText ko="현재 보유와 목표를 기준으로 계산하고, 저장 당시 결과를 다시 열어볼 수 있습니다." en="Calculate from your holdings and targets, then revisit the result as saved." /></p>
    <NativeContributionPlanner key={`${session.key}:${journey.scope}:${currency}`} scopeKey={journey.scope} currency={currency} accounts={scope.catalog.scopes.filter(item => item.kind === 'account').map(item => ({ key:item.key,label:item.label }))} />
  </div></main>;
}
