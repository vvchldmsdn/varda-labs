"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/locale-provider";
import { MoneyInput } from "@/components/first-visit/money-input";
import { formatMoney, parseMoneyInput, type Currency } from "@/lib/money";
import { intlLocale } from "@/lib/i18n/locale";
import { buildNativeContributionPlan, type NativeContributionContextResult, type NativeContributionDocument, type NativeContributionRequest, type SavedNativeContributionPlan } from "@/lib/native-contribution-plan";
import styles from "./currency-tracked-view.module.css";
import plannerStyles from "./native-contribution-planner.module.css";

export function NativeContributionPlanner({ scopeKey, currency }: { scopeKey: string; currency: Currency }) {
  const { locale, t } = useI18n();
  const [loaded, setLoaded] = useState<{ context: NativeContributionContextResult; sessionKey: string; plans: SavedNativeContributionPlan[]; canSave: boolean } | null>(null);
  const [cash, setCash] = useState("");
  const [cashCurrency, setCashCurrency] = useState<Currency>(currency);
  const [useCash, setUseCash] = useState(false);
  const [shown, setShown] = useState<{ document: NativeContributionDocument; saved: boolean } | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const pending = useRef<NativeContributionRequest | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/native-contribution-plans?${new URLSearchParams({ scope: scopeKey, currency })}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const payload = await response.json();
      if (!controller.signal.aborted) setLoaded(payload);
    }).catch(() => { if (!controller.signal.aborted) setError(t("투자 계획을 불러오지 못했어요. 다시 로그인한 뒤 새로고침해 주세요.", "Unable to load plans. Sign in again and refresh.")); });
    return () => controller.abort();
  }, [scopeKey, currency, t]);
  const context = loaded?.context.status === "ready" ? loaded.context : null;
  const money = (value: string | number, code: Currency) => formatMoney(Number(value), code, intlLocale(locale));
  const time = (at: string) => new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" }).format(new Date(at));
  function changed() { pending.current = null; setShown(null); setError(""); }
  function makeRequest(): NativeContributionRequest | null {
    const amount = cash.trim() === "" ? 0 : parseMoneyInput(cash, cashCurrency);
    if (amount === null || amount < 0) { setError(t("투자금과 통화의 소수 자릿수를 확인해 주세요.", "Check the amount and the currency’s precision.")); return null; }
    return pending.current ??= { id: crypto.randomUUID(), scopeKey, reportingCurrency: currency, newMoney: { amount: String(amount), currency: cashCurrency }, useAvailableCash: useCash };
  }
  function calculate(event: FormEvent) {
    event.preventDefault(); setError("");
    const input = makeRequest(); if (!input || !context) return;
    const result = buildNativeContributionPlan(context, input);
    if (result.status === "ready") setShown({ document: result.document, saved: false });
    else setError(t("원가와 해당 시점의 환율 등 계산 근거를 확인해 주세요.", "Check cost evidence and exchange rates for the relevant dates."));
  }
  async function save() {
    const input = makeRequest(); if (!input || !loaded?.canSave || saving || deleting) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/native-contribution-plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionKey: loaded.sessionKey, request: input }) });
      const result = await response.json();
      if (result.error === "temporarily_unavailable") { setLoaded(previous => previous ? { ...previous, canSave: false } : previous); return; }
      if (!response.ok || !result.plan) throw new Error();
      setShown({ document: result.plan.document, saved: true });
      setLoaded(previous => previous ? { ...previous, plans: [result.plan, ...previous.plans.filter(plan => plan.id !== result.plan.id)] } : previous);
    } catch { setError(t("저장하지 못했어요. 보유 정보나 로그인 상태가 바뀌었다면 새로고침해 주세요. 결과가 불확실하면 같은 버튼으로 안전하게 재시도할 수 있어요.", "Unable to save. Refresh if holdings or your account changed. If the outcome is uncertain, retrying this button is safe.")); }
    finally { setSaving(false); }
  }
  async function remove(id: string) {
    if (!loaded || saving || deleting) return;
    setDeleting(true); setError("");
    try {
      const response = await fetch("/api/native-contribution-plans", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionKey: loaded.sessionKey, id }) });
      const result = await response.json();
      if (!response.ok || result.id !== id || !["deleted", "absent"].includes(result.status)) throw new Error();
      setLoaded(previous => previous ? { ...previous, plans: previous.plans.filter(plan => plan.id !== id) } : previous);
      setShown(previous => previous?.document.request.id === id ? null : previous);
      if (pending.current?.id === id) pending.current = null;
      setDeleteId(null);
    } catch { setError(t("삭제하지 못했어요. 계획을 그대로 두었습니다. 다시 시도해 주세요.", "Unable to delete. The plan is still listed; please retry.")); }
    finally { setDeleting(false); }
  }
  const document = shown?.document;
  const result = document?.result;
  return <section className={styles.contribution} aria-label={t("추가 투자 계획", "Contribution plan")}>
    <h2>{t("다음 투자금 나눠보기", "Plan a contribution")}</h2>
    <p className={styles.note}>{t("승인한 목표 비중을 사용합니다. 저장은 계획만 남기며 실제 주문이나 보유 수량을 바꾸지 않아요.", "Uses your approved targets. Saving records a plan without placing orders or changing holdings.")}</p>
    {!loaded ? <p role="status">{t("목표와 보유 정보를 확인하고 있어요.", "Checking targets and holdings.")}</p> : !context ? <p className={styles.notice}>{t("계산에 필요한 전체 평가 또는 승인된 목표를 확인할 수 없어요.", "A complete valuation or approved targets are unavailable.")} <Link href={`/portfolio/targets?scope=${encodeURIComponent(scopeKey)}`}>{t("목표 비중 확인 →", "Review targets →")}</Link></p> : <form onSubmit={calculate} noValidate className={styles.form}>
      <div className={styles.funds}><label>{t("새 투자금", "New money")}<MoneyInput value={cash} onValueChange={value => { setCash(value); changed(); }} allowDecimals={cashCurrency === "USD"} aria-label={t("새 투자금", "New money")} placeholder="0" /></label><label>{t("투자금 통화", "Money currency")}<select value={cashCurrency} onChange={event => { setCashCurrency(event.target.value as Currency); changed(); }}><option>KRW</option><option>USD</option></select></label></div>
      {context.availableCash.length ? <label className={styles.cashChoice}><input type="checkbox" checked={useCash} onChange={event => { setUseCash(event.target.checked); changed(); }} />{t("보유 현금도 사용", "Use available cash")} · {context.availableCash.map((fund, index) => <span key={`${fund.accountId}:${fund.currency}:${index}`}>{money(fund.amount, fund.currency)} </span>)}</label> : null}
      <div className={styles.targets}>{context.input.rows.map(row => <div key={row.allocationKey}><span>{context.names[row.allocationKey]}</span> <strong>{row.targetWeightBps / 100}%</strong></div>)}</div>
      <Link href={`/portfolio/targets?scope=${encodeURIComponent(scopeKey)}`}>{t("승인된 목표 비중 변경 →", "Edit approved targets →")}</Link>
      <p className={styles.note}>{t("원가가 없거나 손실인 자산은 매도하지 않습니다. MA120은 원본 통화와 가격 기준이 일치하는 근거만 적용해요.", "Assets with unknown costs or losses are not sold. MA120 applies only when currency and price basis agree.")}</p>
      <div className={plannerStyles.actions}><button type="submit" className={styles.primary} disabled={saving || deleting}>{t("배분 미리보기", "Preview allocation")}</button>
      {loaded.canSave ? <button type="button" className={styles.primary} disabled={saving || deleting} onClick={save}>{saving ? t("저장 중…", "Saving…") : t("최신 기준으로 계산·저장", "Recalculate and save")}</button> : <span>{t("지금은 미리보기만 이용할 수 있어요.", "Preview is available; saving is currently unavailable.")}</span>}</div>
    </form>}
    {error ? <p role="alert" className={styles.notice}>{error}</p> : null}
    {document && result ? <section className={styles.calculation} id={`native-plan-${document.request.id}`} aria-live="polite"><h3>{shown.saved ? t("저장된 계획", "Saved plan") : t("배분 미리보기", "Allocation preview")} · {result.context.profitCurrency}</h3><p>{time(result.context.asOf)} · {document.basis.scopeLabel}</p>
      <div className={styles.metrics}>{[[t("매수 합계", "Total buys"), result.buys], [t("예상 매도대금", "Planned sale proceeds"), result.sales], [t("남는 투자금", "Unallocated funds"), result.remainingCash]].map(([label, value]) => <div key={String(label)}><p>{label}</p><strong>{money(Number(value), result.context.reportingCurrency)}</strong></div>)}</div>
      {result.rows.map(row => <div className={styles.allocation} key={row.key}><strong>{document.basis.names[row.key]}</strong><span>{t("매수", "Buy")} {money(row.buy, result.context.reportingCurrency)} · {t("매도", "Sell")} {money(row.sell, result.context.reportingCurrency)}</span><small>{row.beforePct.toFixed(2)}% → {row.afterPct.toFixed(2)}% · {t("목표", "Target")} {row.targetPct}%</small></div>)}
      <details className={styles.method}><summary>{t("저장된 계산 기준", "Frozen calculation basis")}</summary><p>{t("수익 판단 통화", "Profit currency")} · {result.context.profitCurrency} · {document.basis.policy.version} · #{document.basis.policy.revision}</p>{result.context.originalFunds.map((fund,index) => <p key={index}>{fund.kind === "native_cash" ? t("보유 현금", "Available cash") : t("새 투자금", "New money")} · {money(fund.amount, fund.currency)}</p>)}<p>{t("당시 기준환율과 예상 매도대금을 사용하며 환전 비용·세금·수수료·수량 단위는 반영하지 않아요. 저장 후 표시 통화가 달라져도 당시 판단은 유지합니다.", "Uses dated reference rates and planned sale proceeds. Conversion costs, taxes, fees and trade quantities are excluded. A saved decision keeps its original currency.")}</p></details>
    </section> : null}
    {loaded?.plans.length ? <section className={plannerStyles.saved}><h3>{t("저장한 계획", "Saved plans")}</h3>{loaded.plans.map(plan => <div key={plan.id} className={plannerStyles.savedRow}><a href={`#native-plan-${plan.id}`} onClick={() => { setShown({ document: plan.document, saved: true }); setError(""); }}>{time(plan.createdAt)} · {plan.document.result.context.profitCurrency} · {t("매수", "Buys")} {money(plan.document.result.buys, plan.document.result.context.reportingCurrency)}</a><span className={plannerStyles.savedActions}>{deleteId === plan.id ? <><button type="button" disabled={saving || deleting} onClick={() => void remove(plan.id)}>{deleting ? t("삭제 중…", "Deleting…") : t("이 계획 삭제 확인", "Confirm plan deletion")}</button><button type="button" disabled={deleting} onClick={() => setDeleteId(null)}>{t("취소", "Cancel")}</button></> : <button type="button" disabled={saving || deleting} onClick={() => setDeleteId(plan.id)}>{t("계획 삭제", "Delete plan")}</button>}</span></div>)}</section> : null}
  </section>;
}
