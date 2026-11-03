'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ChartNoAxesCombined, History, ListChecks, RefreshCw, SlidersHorizontal, Wallet } from 'lucide-react';
import { Button, InfoDisclosure } from '@/components/cairn-ui';
import { useI18n } from '@/components/i18n/locale-provider';
import { recoveryDestination, recoveryHref, recoveryKind, recoveryReturnHref, type RecoveryKind } from '@/lib/recovery-navigation';
import styles from './recovery.module.css';
import { dataIssueLabel } from '@/lib/data-issue-presentation';

const copy = {
  cash: ['현금 기록을 확인해 주세요', '계좌의 시작 잔액과 아직 확인하지 않은 정산 기록을 확인해 주세요. 현금을 모르는 상태를 0원으로 계산하지 않습니다.', '잔액·정산 기록 확인하기', 'Review your cash records', 'Review the opening balance and unsettled records. Unknown cash is not treated as zero.', 'Review balances and settlements'],
  market_review: ['시장 자료 확인이 필요해요', '가격·환율 출처 또는 기업행사 자료를 서비스에서 확인해야 해요. 가격 수집만으로 해결되지 않아요.', '다시 확인하기', 'Market evidence needs review', 'Price or FX sources and corporate-action evidence need service review. Price collection alone will not resolve this.', 'Check again'],
  history: ['저장 기록을 확인해 주세요', '날짜별 평가가 쌓이면 흐름을 볼 수 있어요. 매수·매도 입력이나 현재 원가 수정만으로 과거 평가와 수익률이 만들어지지는 않습니다.', '저장 기록 확인하기', 'Review your saved history', 'Your timeline grows as dated valuations are recorded. Adding trades or changing today’s cost basis does not create historical valuations or returns.', 'Review saved records'],
  targets: ['목표비중을 먼저 확인해 주세요', '원하는 종목별 비중을 저장하면 같은 투자금으로 배분을 계산할 수 있어요.', '목표비중 설정하기', 'Check your target weights', 'Save your target weights, then continue with the same investment amount.', 'Set target weights'],
  holdings: ['보유 자료를 확인해 주세요', '선택한 계좌의 종목과 수량을 확인해 주세요. 보완한 뒤 같은 조건으로 다시 조회할 수 있어요.', '보유종목 확인하기', 'Check your holdings', 'Review the holdings and quantities in this account, then return to the same conditions.', 'Review holdings'],
  trades: ['거래 기록을 확인해 주세요', '이 계좌의 매수·매도와 시작 보유 정보를 확인해 주세요. 현재 원가를 보완해도 과거 수익률이 새로 생기지는 않습니다.', '거래 기록 확인하기', 'Check your transaction records', 'Review this account’s trades and opening holdings. Updating current costs does not create historical returns.', 'Review transactions'],
  market: ['가격·환율 자료가 더 필요해요', '필요한 시점의 시세나 연속 이력이 부족합니다. 보유종목의 분석 데이터 준비 상태를 확인해 주세요. 지원되는 종목은 그 화면에서 자료 준비를 요청할 수 있어요.', '분석 데이터 준비 확인', 'More market data is needed', 'Prices, exchange rates or continuous history are missing. Review analysis data readiness for your holdings and request preparation where supported.', 'Review data readiness'],
  retry: ['자료를 다시 확인해 주세요', '조회가 완료되지 않았거나 계산 기준이 바뀌었습니다. 입력한 조건을 유지하고 다시 불러올 수 있어요.', '다시 불러오기', 'Reload the latest data', 'The read failed or its basis changed. Reload while keeping your inputs.', 'Try again'],
} as const;
const icons = { cash: Wallet, market_review: ChartNoAxesCombined, history: History, targets: SlidersHorizontal, holdings: Wallet, trades: ListChecks, market: ChartNoAxesCombined, retry: RefreshCw };
export function RecoveryTitle({ reasons = [], kind }: { reasons?: readonly string[]; kind?: RecoveryKind }) {
  const { t } = useI18n();
  const c = copy[kind ?? recoveryKind(reasons)];
  return <>{t(c[0], c[3])}</>;
}
export function RecoveryNotice({ reasons = [], kind, scope, beta = false, returnHref, draft, readForm, onRetry, details, allowResolve = true, source = 'inherited', presentation = 'blocking' }: {
  reasons?: readonly string[]; kind?: RecoveryKind; scope?: string; beta?: boolean; returnHref?: string;
  draft?: Record<string, string | string[]>; readForm?: {id: string; fields: readonly string[]}; onRetry?: () => void; details?: string; allowResolve?: boolean;
  source?: 'current' | 'inherited';
  presentation?: 'inline' | 'blocking';
}) {
  const router = useRouter(), { t } = useI18n(), [pending, start] = useTransition();
  const selected = kind ?? recoveryKind(reasons), c = copy[selected];
  const retryOnly = selected === 'retry' || selected === 'market_review';
  const Icon = icons[selected];
  function sourceHref() {
    const url = new URL(returnHref ?? (source === 'inherited' ? recoveryReturnHref(location.hash) : null) ?? location.pathname + location.search + location.hash, location.origin);
    for (const [key, value] of Object.entries(draft ?? {})) { url.searchParams.delete(key); for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, item); }
    const form = readForm && document.getElementById(readForm.id);
    if (form instanceof HTMLFormElement && readForm) {
      const fields = new FormData(form);
      for (const name of readForm.fields) { const value = fields.get(name); if (typeof value === 'string') url.searchParams.set(name, value); }
    }
    return url.pathname + url.search + url.hash;
  }
  function retry() { start(() => { if (onRetry) onRetry(); else router.refresh(); }); }
  function resolve() {
    const query = new URLSearchParams(location.search);
    const reportingCurrency = typeof draft?.currency === 'string' ? draft.currency : query.get('currency') ?? undefined;
    const destination = recoveryDestination(selected, scope ?? query.get('scope') ?? 'all', beta, reportingCurrency);
    const href = destination && recoveryHref(destination, sourceHref());
    if (href) start(() => router.push(href));
  }
  const actions = <div className={styles.actions}>
      {(retryOnly || allowResolve) && <Button type="button" variant="primary" disabled={pending} onClick={retryOnly ? retry : resolve}>{pending ? t('확인 중…', 'Loading…') : t(c[2], c[5])}<ArrowRight size={18} aria-hidden="true" /></Button>}
      {!retryOnly && <Button type="button" variant="ghost" disabled={pending} onClick={retry}><RefreshCw size={16} aria-hidden="true" />{t('다시 조회', 'Reload')}</Button>}
    </div>;
  const explanation = <><p>{t(c[1], c[4])}</p>{(details || reasons.length > 0) && <p className={styles.reason}>{details ?? [...new Set(reasons.map(reason => t(dataIssueLabel(reason), dataIssueLabel(reason, true))))].join(' · ')}</p>}{reasons.length > 0 && <details><summary>{t('진단 정보', 'Diagnostics')}</summary><code>{reasons.join(' · ')}</code></details>}</>;
  const returnNote = !retryOnly && allowResolve && <small>{t('현재 입력을 유지한 채 돌아올 수 있어요.', 'Return with your current inputs preserved.')}</small>;
  return <section className={`${styles.notice} ${presentation === 'inline' ? styles.inline : ''}`} aria-label={t('해결 방법', 'Next steps')} data-recovery-kind={selected} data-recovery-presentation={presentation} aria-busy={pending}>
    {presentation === 'inline' ? <details className={styles.inlineDetails}><summary><RecoveryTitle kind={selected} /><span>{t('해결 방법', 'Next steps')}</span></summary>{explanation}{actions}{returnNote}</details> : <>
      <div className={styles.heading}><span className={styles.icon} aria-hidden="true"><Icon size={24} /></span><h3><RecoveryTitle kind={selected} /></h3></div>
      {actions}{returnNote}
      <InfoDisclosure summary={t('확인이 필요한 이유', 'Why this needs attention')}>{explanation}</InfoDisclosure>
    </>}
  </section>;
}
