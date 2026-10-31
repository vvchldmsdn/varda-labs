'use client';
import { RecoveryJourneyLink as Link } from '@/components/recovery/recovery-return';
import { ActionGroup, ActionContent } from '@/components/cairn-ui';
import { Bookmark, ArrowLeftRight, ReceiptText } from 'lucide-react';
import { useI18n } from '@/components/i18n/locale-provider';
import { contributionJourneyHref, contributionTargetsHref, type ContributionJourney } from '@/lib/contribution-journey';
import styles from './contribution-journey.module.css';

export function ContributionJourneyNav({ journey, current, returnHref }: { journey: ContributionJourney; current: 'plan' | 'compare' | 'tracking'; returnHref?: string }) {
  const { t } = useI18n();
  const back = returnHref ?? contributionJourneyHref(current, journey);
  return <nav className={styles.steps} aria-label={t('추가투입 진행 단계', 'Contribution workflow')}>
    <Link prefetch={false} href={contributionTargetsHref(journey, back)}>{t('목표 설정', 'Targets')}</Link><span aria-hidden="true">→</span>
    <Link prefetch={false} href={contributionJourneyHref(current === 'plan' && !journey.preview ? 'plan' : 'compare', journey)} aria-current={current !== 'tracking' ? 'step' : undefined}>{t('계산·저장', 'Calculate & save')}</Link><span aria-hidden="true">→</span>
    <Link prefetch={false} href={contributionJourneyHref('tracking', journey)} aria-current={current === 'tracking' ? 'step' : undefined}>{current === 'plan' ? t('새 투자금 배분·매수 연결', 'New-money allocations & buys') : t('매수 연결·다시 확인', 'Link buys & revisit')}</Link>
  </nav>;
}

/** Both frontends expose the same existing writers, without equating their different calculations. */
export function ContributionNextSteps({ journey }: { journey: ContributionJourney }) {
  const { t } = useI18n();
  return <ActionGroup label={t('투자 계획 이어가기', 'Continue your investment plan')}>
    {!journey.preview && <Link prefetch={false} data-primary="true" href={contributionJourneyHref('plan', journey)}><ActionContent icon={<Bookmark />} title={t('이 조건으로 계획 만들기', 'Create a plan with these inputs')} description={t('매도·보유 현금 포함', 'Includes sales and available cash')} /></Link>}
    <Link prefetch={false} href={contributionJourneyHref('compare', journey)}><ActionContent icon={<ArrowLeftRight />} title={t('두 배분안 비교하기', 'Compare two allocations')} description={t('새 투자금만 · 매도 없이', 'New money only · No sales')} /></Link>
    <Link prefetch={false} href={contributionJourneyHref('tracking', journey)}><ActionContent icon={<ReceiptText />} title={t('저장한 배분안 보기', 'View saved allocations')} description={t('매수 기록 연결·효과 확인', 'Link buys and review results')} /></Link>
  </ActionGroup>;
}
