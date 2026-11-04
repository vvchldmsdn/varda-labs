'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Field, Input, SectionHeading } from '@/components/cairn-ui';
import { instrumentLabel } from '@/lib/instrument-display';
import { formatMoney, type Currency } from '@/lib/money';
import { useI18n } from '@/components/i18n/locale-provider';
import { intlLocale } from '@/lib/i18n/locale';
import type { ContributionComparisonBasis } from '@/lib/contribution-comparison';
import { compareUserAllocation, expireUserAllocationWorkspace, nativeUserAllocationBasis, PUBLIC_ALLOCATION_WORKSPACE_PREFIX, readUserAllocationWorkspace, updateUserAllocationWorkspace, userAllocationRetentionRemaining, type UserAllocationBasis, type UserAllocationResult, type UserAllocationWorkspace } from '@/lib/user-allocation-comparison';
import styles from './user-allocation-comparison.module.css';

const percent = (value: number | null) => value === null ? '—' : `${value.toFixed(1)}%`;
const gap = (value: number | null, unit: string) => value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(1)}${unit}`;
function message(result: UserAllocationResult, t: (ko: string, en: string) => string) {
  if (result.status === 'ready') return '';
  const messages = { invalid_amount: ['투자금을 확인해 주세요.', 'Check your investment amount.'], fx_missing: ['같은 시점의 환율이 필요해요.', 'An exchange rate from the same time is required.'], invalid_basis: ['보유 평가액과 목표비중을 다시 확인해 주세요.', 'Check the current values and target weights.'], invalid_allocation: ['0 이상의 금액을 입력해 주세요. 원화는 정수, 달러는 소수 둘째 자리까지 가능해요.', 'Enter zero or a positive amount: whole won or up to two decimal places for dollars.'], over_budget: ['배분 금액이 투자금을 넘었어요.', 'Your allocations exceed the investment amount.'], not_buyable: ['이 종목은 새 매수 대상으로 사용할 수 없어요.', 'This asset is unavailable for new purchases.'] } as const;
  const [ko, en] = messages[result.reason];
  return t(ko, en);
}

export function UserAllocationComparison({ basis, amount, currency, ownerKey, scope, publicIdentity }: { basis: ContributionComparisonBasis | UserAllocationBasis; amount: string; currency: Currency; ownerKey?: string; scope: string; publicIdentity?: string }) {
  const model = 'baseCurrency' in basis ? basis : nativeUserAllocationBasis(basis);
  const keys = basis.rows.map(row => row.allocationKey).sort();
  const storageKey = publicIdentity ? `${PUBLIC_ALLOCATION_WORKSPACE_PREFIX}${JSON.stringify([publicIdentity, currency, keys])}` : ownerKey ? `cairn:user-allocation:${JSON.stringify([ownerKey, scope, currency, keys])}` : null;
  // Remount synchronously on identity changes; never show a previous account's inputs.
  return <AllocationEditor key={storageKey ?? `${scope}:${currency}:${keys.join(',')}`} basis={model} amount={amount} currency={currency} storageKey={storageKey} publicPlan={Boolean(publicIdentity)} />;
}

function AllocationEditor({ basis, amount, currency, storageKey, publicPlan }: { basis: UserAllocationBasis; amount: string; currency: Currency; storageKey: string | null; publicPlan: boolean }) {
  const { locale, t } = useI18n();
  const id = useId();
  const [draft, setDraft] = useState<UserAllocationWorkspace>({ savedAt: 0, a: {}, b: {} });
  const [notSaved, setNotSaved] = useState(!storageKey);
  const editRevision = useRef(0);
  useEffect(() => {
    if (!storageKey) return;
    const revision = editRevision.current;
    const frame = window.requestAnimationFrame(() => {
      if (editRevision.current !== revision) return;
      try {
        const raw = sessionStorage.getItem(storageKey);
        const saved = readUserAllocationWorkspace(raw, basis.rows.map(row => row.allocationKey));
        if (saved) setDraft(saved);
        else if (raw) sessionStorage.removeItem(storageKey);
      } catch { setNotSaved(true); }
    });
    return () => window.cancelAnimationFrame(frame);
    // The storage identity contains the instrument set; price changes keep inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  useEffect(() => {
    if (!storageKey || !draft.savedAt) return;
    const timer = window.setTimeout(() => {
      try { expireUserAllocationWorkspace(sessionStorage, storageKey, draft.savedAt); } catch {}
    }, userAllocationRetentionRemaining(draft.savedAt));
    return () => window.clearTimeout(timer);
  }, [storageKey, draft.savedAt]);
  function update(plan: 'a' | 'b', key: string, value: string) {
    editRevision.current++;
    const next = updateUserAllocationWorkspace(draft, plan, key, value);
    setDraft(next);
    if (storageKey) try { sessionStorage.setItem(storageKey, JSON.stringify(next)); setNotSaved(false); } catch { setNotSaved(true); }
  }
  const a = compareUserAllocation(basis, amount, currency, draft.a), b = compareUserAllocation(basis, amount, currency, draft.b);
  return <section className={styles.section} aria-label={t('내 배분 A안 B안 비교', 'Compare my allocations A and B')}>
    <SectionHeading title={t('내 배분으로 비교', 'Compare your own allocations')} description={t('같은 투자금을 두 가지로 나눠 보세요.', 'Split the same investment two different ways.')} />
    <p className={styles.note}>{publicPlan ? t('입력한 평가액에 배분 금액을 더한 비중이에요. 남은 돈은 비중에서 제외해요.', 'Weights use your entered values plus your allocation. Unallocated money is shown separately.') : t('현재 가격으로 투자한 직후의 비중이에요. 남은 돈은 비중에서 제외해요.', 'Weights reflect investing at current prices. Unallocated money is shown separately.')}</p>
    <div className={styles.head} aria-hidden="true"><span>{t('종목', 'Asset')}</span><strong>{t('A안', 'Plan A')} · {currency}</strong><strong>{t('B안', 'Plan B')} · {currency}</strong></div>
    {basis.rows.map(row => {
      const name = instrumentLabel(row.metadata), current = a.status === 'ready' ? a.rows.find(item => item.key === row.allocationKey)?.currentPct : b.status === 'ready' ? b.rows.find(item => item.key === row.allocationKey)?.currentPct : null;
      return <div className={styles.row} key={row.allocationKey}><div className={styles.name}><strong>{name}</strong><small>{t('현재', 'Now')} {percent(current ?? null)}<br />{t('목표', 'Target')} {percent(row.targetWeightBps / 100)}</small></div>{(['a', 'b'] as const).map(plan => {
        const result = plan === 'a' ? a : b, projection = result.status === 'ready' ? result.rows.find(item => item.key === row.allocationKey) : null;
        const error = result.status === 'blocked' && result.key === row.allocationKey;
        const inputId = `${id}-${plan}-${basis.rows.indexOf(row)}`;
        return <div className={styles.input} key={plan}>
          <Field className={styles.srOnly} htmlFor={inputId}>{t(`${name} ${plan.toUpperCase()}안 배분 금액 (${currency})`, `${name} plan ${plan.toUpperCase()} allocation (${currency})`)}</Field>
          <Input id={inputId} inputMode="decimal" maxLength={40} value={draft[plan][row.allocationKey] ?? ''} placeholder="0" aria-invalid={error || undefined} aria-describedby={error ? `${inputId}-error` : undefined} onChange={event => update(plan, row.allocationKey, event.target.value)} />
          {error ? <small role="alert" id={`${inputId}-error`}>{message(result, t)}</small> : projection ? <small>{t('투자 후', 'After')} <b>{percent(projection.afterPct)}</b><span>{t('목표와', 'Target gap')} {gap(projection.gapPp, t('%p', ' pp'))}</span></small> : null}
        </div>;
      })}</div>;
    })}
    <div className={styles.head} aria-live="polite"><span>{t('남은 투자금', 'Unallocated')}</span>{[a, b].map((result, index) => <div key={index}>{result.status === 'ready' ? <strong>{formatMoney(result.remaining, currency, intlLocale(locale))}</strong> : !result.key ? <span role="alert">{message(result, t)}</span> : <span>{t('입력을 확인해 주세요.', 'Check your inputs.')}</span>}</div>)}</div>
    <p className={styles.note}>{publicPlan ? t('직접 비교한 A·B안은 이 탭에 24시간 보관돼요. 계획 저장에는 위의 자동 배분 결과가 저장됩니다.', 'Your A/B inputs stay in this tab for 24 hours. Saving the plan saves the automatic allocation shown above.') : t('직접 입력한 가상 배분이에요. 거래 내역이나 아래의 비율·조정 비교 저장값은 바뀌지 않아요.', 'These are hypothetical allocations. They do not change trades or the ratio/adjusted comparison saved below.')}</p>
    {notSaved && <p role="status">{t('입력은 이 화면에 남아 있어요. 페이지를 나가면 유지되지 않을 수 있어요.', 'Your inputs remain on this screen, but may not survive leaving the page.')}</p>}
  </section>;
}
