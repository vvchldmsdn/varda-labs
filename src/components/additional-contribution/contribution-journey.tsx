'use client';
import Link from 'next/link';
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
  return <nav className={styles.next} aria-label={t('투자 계획 이어가기', 'Continue your investment plan')}>
    {!journey.preview && <Link prefetch={false} href={contributionJourneyHref('plan', journey)}><strong>{t('보유 기반 계획 계산·저장', 'Calculate & save a holdings plan')} <span aria-hidden="true">↗</span></strong><small>{t('매도·보유 현금 조건을 포함해 계산하고 당시 결과를 보관합니다.', 'Calculate with sale and available-cash conditions and keep the dated result.')}</small></Link>}
    <Link prefetch={false} href={contributionJourneyHref('compare', journey)}><strong>{t('새 투자금 배분 비교·저장', 'Compare & save new-money allocations')} <span aria-hidden="true">↗</span></strong><small>{t('매도 없이 두 매수 배분안을 비교하고 실제 매수를 연결합니다.', 'Compare two buy-only allocations, then link your actual purchases.')}</small></Link>
    <Link prefetch={false} href={contributionJourneyHref('tracking', journey)}><strong>{t('저장한 배분안·매수 연결', 'Saved allocations & linked buys')} <span aria-hidden="true">↗</span></strong><small>{t('저장 당시 조건을 유지하고 현재 시세로 다시 확인합니다.', 'Keep the original assumptions and review them at current prices.')}</small></Link>
  </nav>;
}
