'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Checkbox, EmptyState, Field, Metric, MetricGroup, SectionHeading, Status } from '@/components/cairn-ui';
import type { ContributionEffectView } from '@/db/queries/contribution-effects';
import { parseMoneyInput, type Currency } from '@/lib/money';
import styles from './contribution-comparison.module.css';

export type EffectTrackingProps = { accountId: string; sessionKey: string; items: ContributionEffectView[]; preview?: boolean; unavailable?: boolean };
const amountText = (n: number) => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(n);
const signed = (n: number) => `${n > 0 ? '+' : ''}${amountText(n)}`;
const date = (at: string) => new Date(at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
export function effectReason(reason: string) {
  return ({ trades_not_linked: '실제 매수 기록을 선택해 연결하면 체결 기준 성과를 확인할 수 있습니다.', execution_fx_missing: '체결일 환율이 없어 실제 매수 성과 계산을 보류했습니다.', subsequent_disposal: '연결된 종목에 이후 매도 또는 분할이 있습니다. 매도 수량의 귀속을 확정하기 전까지 실제 성과를 보류합니다.', split_requires_rebase: '주식 분할 이후 가격 기준을 다시 맞춰야 합니다.', budget_exceeded: '연결한 체결금액이 저장한 투자금을 초과합니다. 해당 투입의 거래만 선택해 주세요.', trade_unavailable: '취소·수정된 거래 또는 저장 이전 거래가 포함되어 연결을 다시 확인해야 합니다.', basis_changed: '가격이나 목표비중이 바뀌었습니다. 새로고침 후 배분안을 확인하고 저장해 주세요.', entry_quote_missing: '일부 종목의 진입 가격이 없어 사후 추적을 시작할 수 없습니다.', link_conflict: '이미 다른 추적에 연결된 거래이거나 기록이 변경됐습니다. 새로고침해 주세요.', save_conflict_or_limit: '기록이 변경됐거나 저장 한도에 도달했습니다. 새로고침 후 확인해 주세요.', quote_unavailable: '현재 가격 근거가 부족해 비교를 보류했습니다.', price_or_fx_unavailable: '가격·환율 근거가 부족해 비교를 보류했습니다.', market_incomplete: '현재 평가 근거를 확인 중입니다.', account_changed: '로그인 계정이 변경됐습니다. 새로고침해 주세요.' } as Record<string, string>)[reason] ?? '지금은 저장할 수 없습니다. 입력을 유지했으니 새로고침 후 다시 시도해 주세요.';
}
export function ContributionEffectTracking({ tracking, amount, currency, evidenceVersion, canCalculate }: { tracking: EffectTrackingProps; amount: string; currency: Currency; evidenceVersion?: string; canCalculate: boolean }) {
  const router = useRouter(), pendingId = useRef<{ key: string; id: string } | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function save() {
    if (tracking.preview) { setMessage('예시 모드에서는 저장하지 않습니다. 실제 화면에서는 현재 배분안과 진입 가격을 저장합니다.'); return; }
    const normalizedAmount = parseMoneyInput(amount, currency);
    if (normalizedAmount === null || normalizedAmount <= 0) return;
    const key = `${normalizedAmount}:${currency}:${evidenceVersion}`;
    if (pendingId.current?.key !== key) pendingId.current = { key, id: crypto.randomUUID() };
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/contribution-effects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionKey: tracking.sessionKey, id: pendingId.current.id, accountId: tracking.accountId, amount: String(normalizedAmount), currency, evidenceVersion }) });
      const result = await response.json();
      if (!response.ok) setMessage(effectReason(result.reason));
      else { setMessage('배분안을 저장했습니다. 이후 기록한 매수를 연결해 주세요.'); pendingId.current = null; router.refresh(); }
    } catch { setMessage(effectReason('unavailable')); } finally { setBusy(false); }
  }
  return <section className={styles.tracking} aria-label="추가투입 사후 추적">
    <SectionHeading title="이번 선택, 나중에 다시 확인" description="배분안과 현재 가격을 저장한 뒤, 실제 매수 기록을 연결하세요. 다음 방문에는 확인된 시세로 비교합니다." />
    <Button disabled={busy || !canCalculate || (!evidenceVersion && !tracking.preview) || tracking.unavailable} onClick={save}>{busy ? '저장 중…' : '이 배분안으로 추적 시작'}</Button>
    {message && <Status>{message}</Status>}
    {tracking.unavailable ? <Status tone="warning">저장한 추적 기록을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.</Status> : tracking.items.length === 0 ? <EmptyState title="아직 저장한 비교가 없어요" description="현재 가격과 배분안을 지금부터 보관합니다. 과거 추천을 소급해 만들지는 않습니다." /> : tracking.items.map(item => <EffectRecord key={`${item.id}:${item.revision}`} item={item} tracking={tracking} />)}
    <p className={styles.note}>동일 시작 가격으로 계산한 두 배분안의 차이와 실제 체결 결과는 별개입니다. 실제 결과에는 체결 시점·가격 차이도 포함되므로 환율·MA120만의 효과로 단정하지 않습니다. 수수료·세금·배당·현금 이자는 제외합니다. 남은 투자금은 비교용 보류금이며 실제 계좌 현금이 아닙니다.</p>
  </section>;
}
function EffectRecord({ item, tracking }: { item: ContributionEffectView; tracking: EffectTrackingProps }) {
  const router = useRouter();
  const [selected, setSelected] = useState(item.tradeIds), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const result = item.result;
  async function link() {
    if (tracking.preview) { setMessage('예시 거래입니다. 실제 금융 기록은 변경하지 않습니다.'); return; }
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/contribution-effects', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionKey: tracking.sessionKey, id: item.id, accountId: tracking.accountId, revision: item.revision, tradeIds: selected }) });
      const data = await response.json();
      if (!response.ok) setMessage(effectReason(data.reason)); else { setMessage('체결 연결을 저장했습니다.'); router.refresh(); }
    } catch { setMessage(effectReason('unavailable')); } finally { setBusy(false); }
  }
  return <article className={styles.trackingRecord}>
    <SectionHeading title={`${date(item.createdAt)} · ${amountText(item.document.comparison.budget)}원`} description={`목표비중 승인 ${item.document.comparison.basis.policyRevision}차 · ${item.document.comparison.funding} 투자금 · 저장 당시 배분 유지`} />
    {result.status === 'ready' ? <>
      <MetricGroup><Metric label="비율 매수 가정" value={`${amountText(result.ratio)}원`} note={`${result.ratioReturnPct.toFixed(2)}%`} /><Metric label="조정 매수 가정" value={`${amountText(result.adjusted)}원`} note={`${result.adjustedReturnPct.toFixed(2)}%`} /><Metric label="같은 조건에서의 차이" value={`${signed(result.gap)}원`} /></MetricGroup>
      <p className={styles.note}>부족비중 반영 {signed(result.alignmentEffect)}원 + 환율·MA120 조정 {signed(result.adjustmentEffect)}원 · 평가 {date(result.asOf)}</p>
      {result.actual.status === 'ready' ? <div className={styles.actualResult}><SectionHeading title="연결한 실제 매수" description={`${result.actual.count}건 · 체결가와 수량 기준 · 비교용 보류금 포함`} /><MetricGroup><Metric label="현재 가치" value={`${amountText(result.actual.total)}원`} note={`투자자산 ${amountText(result.actual.investedValue)}원 + 보류금 ${amountText(result.actual.remainingBudgetValue)}원`} /><Metric label="투자금 대비 손익" value={`${signed(result.actual.profit)}원`} note={`${result.actual.returnPct.toFixed(2)}%`} /><Metric label="비율 매수 가정과 차이" value={`${signed(result.actual.gapToRatio)}원`} note="체결 시점·가격 차이 포함" /></MetricGroup></div> : <Status>{effectReason(result.actual.reason)}</Status>}
    </> : <Status tone="warning">{effectReason(result.reason)}</Status>}
    <details className={styles.details}><summary>실제 매수 연결 · {item.tradeIds.length}건</summary>
      <p className={styles.note}>이 투자금으로 매수한 기록만 선택하세요. 같은 거래를 여러 추적에 중복 연결할 수 없습니다. 시각을 모르는 당일 거래는 저장 전후를 구분할 수 없어 제외됩니다.</p>
      <div className={styles.tradeChoices}>{item.candidates.map(trade => <Field key={trade.id}><Checkbox checked={selected.includes(trade.id)} onChange={event => setSelected(event.target.checked ? [...selected, trade.id] : selected.filter(id => id !== trade.id))} /><span>{trade.name}<small>{date(trade.at)} · {trade.quantity}주 × {trade.price} {trade.currency}</small></span></Field>)}</div>
      {!item.candidates.length && <p>저장 이후 연결할 수 있는 매수 기록이 없습니다.</p>}
      {item.tradeIds.some(id => !item.candidates.some(t => t.id === id)) && <Button variant="bare" onClick={() => setSelected(selected.filter(id => item.candidates.some(t => t.id === id)))}>확인할 수 없는 연결 해제</Button>}
      <Button disabled={busy} onClick={link}>{busy ? '연결 중…' : `선택한 ${selected.length}건 연결 저장`}</Button>
      {message && <Status>{message}</Status>}
    </details>
  </article>;
}
