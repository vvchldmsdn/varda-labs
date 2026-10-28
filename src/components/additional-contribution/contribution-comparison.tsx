"use client";

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDownRight, ArrowUpRight, Equal } from 'lucide-react';
import { Button, Field, Input, Select, PageTitle, SectionHeading, Metric, MetricGroup, Status } from '@/components/cairn-ui';
import { RecoveryNotice } from '@/components/recovery/recovery-notice';
import { compareContribution, evaluateContributionScenario, type ComparisonBasisResult, type ContributionComparison } from '@/lib/contribution-comparison';
import type { Currency } from '@/lib/money';
import styles from './contribution-comparison.module.css';
import { ContributionEffectTracking, type EffectTrackingProps } from './contribution-effect-tracking';

const won = (n: number) => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(n);
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${won(Math.abs(n))}`;
const pct = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
const cases = [
  { name: '변화 없음', price: 0, fx: 0 },
  { name: '가격 상승', price: 10, fx: 0 },
  { name: '가격 하락', price: -10, fx: 0 },
  { name: '달러 강세', price: 0, fx: 5 },
  { name: '달러 약세', price: 0, fx: -5 },
] as const;

export function ContributionComparisonView({ basis, initialAmount = '1000000', initialCurrency = 'KRW', preview = false, backHref, tracking }: {
  basis: ComparisonBasisResult; initialAmount?: string; initialCurrency?: Currency; preview?: boolean; backHref: string; tracking?: EffectTrackingProps;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(initialAmount);
  const [currency, setCurrency] = useState<Currency>(initialCurrency);
  const [price, setPrice] = useState('0');
  const [fx, setFx] = useState('0');
  const [horizon, setHorizon] = useState('30');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const backQuery = new URLSearchParams(backHref.split('?')[1] ?? '');
  const scope = backQuery.get('scope') ?? 'all';
  const beta = backHref.startsWith('/beta?') || backHref === '/beta';
  const recoveryQuery = new URLSearchParams({ scope, amount, currency, ...(beta ? { from: 'beta' } : {}), ...(preview ? { preview: 'design' } : {}) });
  const returnHref = `/additional-contribution/compare?${recoveryQuery}`;
  const recoveryDraft = { amount, currency };
  const comparison = useMemo(() => basis.status === 'ready' ? compareContribution(basis, amount, currency) : basis, [basis, amount, currency]);
  const rowPricePct = Object.fromEntries(Object.entries(overrides).filter(([, value]) => value.trim() !== '').map(([key, value]) => [key, Number(value)]));
  const valid = price.trim() !== '' && fx.trim() !== '';
  const result = comparison.status === 'ready' && valid ? evaluateContributionScenario(comparison, { pricePct: Number(price), usdKrwPct: Number(fx), rowPricePct }) : null;
  const setCase = (p: number, f: number) => { setPrice(String(p)); setFx(String(f)); setOverrides({}); };
  return <div className={styles.content} id="varda-main-content">
    <a href={backHref} className={styles.back}>← 추가투입으로 돌아가기</a>
    <header className={styles.header}><div><p className={styles.eyebrow}>CONTRIBUTION / COMPARE</p><PageTitle>같은 투자금, 다른 배분</PageTitle><p className={styles.lead}>비율대로 샀을 때와 환율·이동평균선을 반영했을 때를 비교해 보세요.</p></div><span className={styles.badge}>가정 비교 · 실제 성과 아님</span></header>
    {preview && <Status>화면 검증용 예시 데이터입니다. 실제 계좌와 연결되지 않습니다.</Status>}
    {basis.status !== 'ready' ? basis.reason === 'choose_one_account' ? <Status tone="warning">비교할 계좌를 위에서 선택해 주세요. 계좌 사이의 자금 이동은 계산하지 않습니다.</Status> : <RecoveryNotice reasons={[basis.reason]} scope={scope} beta={beta} returnHref={returnHref} draft={recoveryDraft} onRetry={() => router.refresh()} details={`${reasonLabel(basis.reason)}${basis.unavailableHoldings?.length ? ` 확인 필요: ${basis.unavailableHoldings.join(', ')}.` : ''}`} /> : <>
      <div className={styles.context}>{basis.scopeLabel}<span>기준 {new Date(basis.asOf).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })} KST</span><span>목표비중 승인 {basis.policyRevision}차</span></div>
      <section className={styles.controls} aria-label="공통 비교 조건">
        <Field label="새 투자금"><Input aria-label="새 투자금" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></Field>
        <Field label="투자금 통화"><Select value={currency} onChange={event => setCurrency(event.target.value as Currency)}><option value="KRW">KRW · 원화</option><option value="USD">USD · 달러</option></Select></Field>
        <Field label="비교 시점"><Select value={horizon} onChange={event => setHorizon(event.target.value)}><option value="10">10일 뒤</option><option value="30">30일 뒤</option><option value="90">90일 뒤</option></Select></Field>
        <p>동일 종목 · 동일 진입 가격<br />신규 투자금만 · 매도 없이 비교</p>
      </section>
      {comparison.status !== 'ready' ? comparison.reason === 'invalid_amount' ? <Status tone="warning">{reasonLabel(comparison.reason)}</Status> : <RecoveryNotice reasons={[comparison.reason]} scope={scope} beta={beta} returnHref={returnHref} draft={recoveryDraft} onRetry={() => router.refresh()} details={reasonLabel(comparison.reason)} /> : <>
        <div className={styles.sectionHeading}><SectionHeading title="01. 투자금을 어떻게 나누나요?" description="설정한 비율대로 매수하거나, 기존 보유의 부족 비중과 확인된 조정 근거를 반영합니다." /></div>
        <div className={styles.plans}>
          <Plan title="비율대로 매수" subtitle="새 투자금 × 목표비중" plan={comparison.ratio} comparison={comparison} />
          <Plan title="환율·MA120 조정" subtitle="목표 부족분 → MA120 → 환율 계수" plan={comparison.adjusted} comparison={comparison} adjusted />
        </div>
        <p className={styles.note}>비교 재원 {won(comparison.budget)}원{currency === 'USD' ? ` · USD/KRW ${won(basis.usdKrw!)}로 원화 환산 · 달러 자금에는 환율 매수 조정 미적용` : ''}. 보류금은 {currency === 'USD' ? '달러로 유지하고 미래 환율로 원화 환산' : '원화 현금으로 포함'}하며 이자는 0%로 가정합니다.</p>
        <p className={styles.note}>확인된 조정: MA120 {comparison.evidence.filter(row => row.ma < 1).length}종목 · 환율 {comparison.evidence.filter(row => row.fx < 1).length}종목{comparison.evidence.some(row => row.maReason === 'evidence_unavailable' || row.fxStatus === 'unavailable') ? ' · 일부 근거 부족으로 해당 조정 미적용' : ''}. 종목별 설정과 계수는 아래 근거에서 확인할 수 있습니다.</p>
        <section className={styles.scenario} aria-label="미래 조건 비교">
          <SectionHeading title={`02. ${horizon}일 뒤, 이런 상황이라면?`} description="기간 전체의 누적 변화를 입력합니다. 기간을 바꿔도 변화율을 자동으로 늘리거나 예측하지 않습니다." />
          <div className={styles.presets} role="group" aria-label="시나리오 선택">{cases.map(item => <Button key={item.name} variant="selection" aria-pressed={Number(price) === item.price && Number(fx) === item.fx && !Object.values(overrides).some(v => v.trim())} onClick={() => setCase(item.price, item.fx)}>{item.name}</Button>)}</div>
          <div className={styles.scenarioInputs}>
            <Field label="종목 가격 변화 (%)" hint="각 종목의 거래 통화 기준"><Input type="number" min="-100" max="200" step="0.1" value={price} onChange={event => { setPrice(event.target.value); setOverrides({}); }} /></Field>
            <Field label="USD/KRW 변화 (%)" hint="+는 달러 강세 · USD 종목만 환산"><Input type="number" min="-100" max="200" step="0.1" value={fx} onChange={event => setFx(event.target.value)} /></Field>
          </div>
          {result ? <div className={styles.outcome} aria-live="polite">
            <div className={styles.gap} data-direction={result.gap > 0 ? 'positive' : result.gap < 0 ? 'negative' : 'flat'}>
              <span>{result.gap > 0 ? <ArrowUpRight size={20} /> : result.gap < 0 ? <ArrowDownRight size={20} /> : <Equal size={20} />}{horizon}일 뒤 조정안의 평가액 차이</span>
              <strong>{signed(result.gap)}<small>원</small></strong>
              <p>{Math.abs(result.gap) < .5 ? '이 가정에서는 두 안의 차이가 없습니다.' : result.gap > 0 ? '이 가정에서는 조정안이 유리합니다.' : '이 가정에서는 비율 매수가 유리합니다.'}</p>
            </div>
            <MetricGroup><Metric label="비율 매수 · 가정 평가액" value={won(result.ratio)} unit="원" note={`투자금 대비 ${pct(result.ratioReturnPct)}`} /><Metric label="조정 매수 · 가정 평가액" value={won(result.adjusted)} unit="원" note={`투자금 대비 ${pct(result.adjustedReturnPct)}`} /></MetricGroup>
            <div className={styles.attribution}><span>차이의 구성</span><p>목표 부족분 반영 <b>{signed(result.alignmentEffect)}원</b></p><span>+</span><p>환율·MA120 조정 <b>{signed(result.adjustmentEffect)}원</b></p><span>=</span><b>{signed(result.gap)}원</b></div>
          </div> : <Status tone="warning">변화율을 −100%부터 200% 사이 숫자로 입력해 주세요.</Status>}
          <details className={styles.details}><summary>종목별 변화율 직접 입력</summary><div className={styles.rowInputs}>{basis.rows.map(row => <Field key={row.allocationKey} label={`${row.metadata.name} · ${row.metadata.currency} (%)`}><Input type="number" min="-100" max="200" step="0.1" placeholder={price} value={overrides[row.allocationKey] ?? ''} onChange={event => setOverrides({ ...overrides, [row.allocationKey]: event.target.value })} /></Field>)}</div><p className={styles.note}>비워두면 공통 가격 변화율을 사용합니다. 원화 상장 해외자산은 환율 영향까지 포함한 원화 가격 변화를 입력하세요.</p></details>
        </section>
        <section className={styles.matrixSection}><SectionHeading title="여러 상황을 한눈에" description="모든 종목에 같은 가격 변화율을 적용한 공통 가정입니다. 위 종목별 입력과는 독립적으로 비교합니다." /><div className={styles.tableScroll}><table className={styles.table}><caption className={styles.srOnly}>공통 시나리오별 평가액 차이</caption><thead><tr><th>상황</th><th>가격 / 환율</th><th>비율 매수</th><th>조정 매수</th><th>조정안 차이</th></tr></thead><tbody>{cases.map(item => { const value = evaluateContributionScenario(comparison, { pricePct: item.price, usdKrwPct: item.fx })!; return <tr key={item.name}><th scope="row">{item.name}</th><td>{item.price}% / {item.fx}%</td><td>{won(value.ratio)}원</td><td>{won(value.adjusted)}원</td><td data-tone={value.gap > 0 ? 'positive' : value.gap < 0 ? 'negative' : 'flat'}>{signed(value.gap)}원</td></tr>; })}</tbody></table></div></section>
        <details className={styles.details}><summary>배분 금액과 조정 근거</summary><div className={styles.tableScroll}><table className={styles.table}><caption className={styles.srOnly}>종목별 배분과 적용 계수</caption><thead><tr><th>종목</th><th>목표</th><th>비율 매수</th><th>조정 매수</th><th>MA120</th><th>환율</th></tr></thead><tbody>{basis.rows.map(row => { const e = comparison.evidence.find(item => item.key === row.allocationKey)!; return <tr key={row.allocationKey}><th scope="row">{row.metadata.name}</th><td>{row.targetWeightBps / 100}%</td><td>{won(comparison.ratio.amounts[row.allocationKey])}원</td><td>{won(comparison.adjusted.amounts[row.allocationKey])}원</td><td>{e.ma.toFixed(2)}×<small>{maLabel(e.maReason)}</small></td><td>{e.fx.toFixed(2)}×<small>{e.fxStatus === 'ready' ? '확인된 근거' : e.fxStatus === 'not_applicable' ? '적용 대상 아님' : '근거 없음 / 미적용'}</small></td></tr>; })}</tbody></table></div></details>
        <footer className={styles.method}><SectionHeading title="이 비교의 기준" /><p>현재 보유 평가액은 배분의 부족분을 계산할 때만 사용합니다. 결과는 새 투자금과 보류금의 가치이며 계좌 전체 수익률이 아닙니다.</p><p>같은 시점에 소수점 단위로 매수했다고 가정합니다. 매도·보유 현금 사용·다른 위험 조정·최소 집행 보충은 제외한 비교용 배분이므로 실제 전체 추천안과 다를 수 있습니다. 확인할 수 없는 환율·MA120 계수는 적용하지 않습니다.</p><p>배분은 원 단위로 계산하고 1원 미만 환산 잔액은 보류금에 포함합니다. 표시 금액은 각각 반올림하므로 표시된 합계나 차이에 1원 차이가 생길 수 있습니다.</p><p>수수료·세금·배당·환전 스프레드·현금 이자·실제 주문 단위는 반영하지 않습니다. 직접 입력한 시나리오는 가정입니다. 아래에서 배분안을 저장하면 이후 확인된 시세와 실제 매수 기록을 연결해 볼 수 있습니다.</p></footer>
      </>}
    </>}
    {tracking && <ContributionEffectTracking tracking={tracking} amount={amount} currency={currency} evidenceVersion={basis.status === "ready" ? basis.evidenceVersion : undefined} canCalculate={comparison.status === "ready"} />}
  </div>;
}

function Plan({ title, subtitle, plan, comparison, adjusted = false }: { title: string; subtitle: string; plan: ContributionComparison['ratio']; comparison: ContributionComparison; adjusted?: boolean }) {
  const cashPct = plan.cash / comparison.budget * 100;
  return <section className={styles.plan} data-adjusted={adjusted} aria-label={title}><SectionHeading title={title} description={subtitle} /><p className={styles.planAmount} data-large={comparison.budget - plan.cash >= 1e9}>{won(comparison.budget - plan.cash)}<span>원 매수</span></p><div className={styles.bar} role="img" aria-label={`매수 ${(100 - cashPct).toFixed(1)}%, 현금 보류 ${cashPct.toFixed(1)}%`}><span style={{ width: `${100 - cashPct}%` }} /><i style={{ width: `${cashPct}%` }} /></div><div className={styles.planLegend}><span>● 매수 {(100 - cashPct).toFixed(1)}%</span><span>보류 {won(plan.cash)}원</span></div></section>;
}
function maLabel(reason: string) { return reason === 'evidence_unavailable' ? '근거 부족 / 미적용' : reason === 'asset_rule_disabled' ? '설정에서 꺼짐' : reason === 'asset_class_exempt' ? '적용 대상 아님' : reason.startsWith('below') ? '이동평균선 아래' : '이동평균선 이상'; }
function reasonLabel(reason: string) { const labels: Record<string, string> = { invalid_amount: '새 투자금을 1원 이상, 최대 1,000억 원까지 입력해 주세요. 원화는 정수, 달러는 소수 둘째 자리까지 입력할 수 있습니다.', fx_missing: '같은 기준 시점의 환율을 확인할 수 없습니다.', choose_one_account: '추가투입할 계좌 하나를 선택해 주세요. 계좌 간 자금 이동은 가정하지 않습니다.', approved_targets_required: '현재 보유에 맞는 목표비중을 먼저 승인해 주세요.', valuation_incomplete: '일부 보유 평가 근거를 확인할 수 없습니다. 가격과 수량을 확인해 주세요.', target_universe_changed: '보유 구성이 바뀌었습니다. 목표비중을 다시 확인해 주세요.', unbuyable_target: '매수할 수 없는 목표 종목이 있어 공정한 비교를 보류합니다.', scope_unavailable: '선택한 조회 범위를 확인할 수 없습니다.' }; return labels[reason] ?? '보유 평가액·목표비중·환율 근거를 확인한 뒤 다시 시도해 주세요.'; }
