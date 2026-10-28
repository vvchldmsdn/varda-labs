"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/locale-provider";
import { MoneyInput } from "@/components/first-visit/money-input";
import { formatMoney, parseMoneyInput, type Currency } from "@/lib/money";
import { intlLocale } from "@/lib/i18n/locale";
import { buildNativeContributionPlan, type NativeContributionContextResult, type NativeContributionDocument, type NativeContributionRequest, type SavedNativeContributionPlan } from "@/lib/native-contribution-plan";
import {SaleExclusionPicker} from "./sale-exclusion-picker";
import { RecoveryNotice } from "@/components/recovery/recovery-notice";
import { parseSaleExclusionKeys } from "@/lib/additional-contribution-sale-exclusions";
import { recoveryHref } from "@/lib/recovery-navigation";
import styles from "./currency-tracked-view.module.css";
import plannerStyles from "./native-contribution-planner.module.css";
import { Button as CairnButton, Field as CairnField, Form as CairnForm, Input as CairnInput, SectionTitle as CairnSectionTitle, Select as CairnSelect, Status as CairnStatus } from "@/components/cairn-ui";


export function NativeContributionPlanner({ scopeKey, currency }: { scopeKey: string; currency: Currency }) {
  const { locale, t } = useI18n();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [loaded, setLoaded] = useState<{ context: NativeContributionContextResult; sessionKey: string; plans: SavedNativeContributionPlan[]; canSave: boolean } | null>(null);
  const [cash, setCash] = useState(() => searchParams.get("amount") ?? "");
  const [cashCurrency, setCashCurrency] = useState<Currency>(() => searchParams.get("fundingCurrency") === "USD" ? "USD" : searchParams.get("fundingCurrency") === "KRW" ? "KRW" : currency);
  const [useCash, setUseCash] = useState(() => searchParams.get("useCash") === "1");
  const [shown, setShown] = useState<{ document: NativeContributionDocument; saved: boolean } | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const pending = useRef<NativeContributionRequest | null>(null);
  const [saleDraft,setSaleDraft]=useState<{key:string;keys:string[]}>(() => {
    const restored = parseSaleExclusionKeys(searchParams.getAll("excludeSell"));
    return { key: "", keys: restored.ok ? restored.keys : [] };
  });
  const [loadFailed, setLoadFailed] = useState(false);
  const [readAttempt, setReadAttempt] = useState(0);
  const [calculationBlock, setCalculationBlock] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/native-contribution-plans?${new URLSearchParams({ scope: scopeKey, currency })}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const payload = await response.json();
      if (!controller.signal.aborted) setLoaded(payload);
    }).catch(() => { if (!controller.signal.aborted) setLoadFailed(true); });
    return () => controller.abort();
  }, [scopeKey, currency, readAttempt]);
  const context = loaded?.context.status === "ready" && loaded.context.scopeKey===scopeKey && loaded.context.input.reportingCurrency===currency ? loaded.context : null;
  // Sale exclusions are a draft, not evidence. A reread keeps them within the
  // same account/session; the existing engine still validates the current keys.
  const saleKey=JSON.stringify([scopeKey,currency,loaded?.sessionKey]);
  const excludedSales=saleDraft && (!saleDraft.key || !loaded || saleDraft.key===saleKey)?saleDraft.keys:[];
  const returnHref = `${pathname}?${searchParams}`;
  const recoveryDraft = { scope: scopeKey, currency, amount: cash, fundingCurrency: cashCurrency, useCash: useCash ? "1" : "0", excludeSell: excludedSales };
  const beta = pathname === "/beta" || pathname.startsWith("/beta/");
  const draftQuery = new URLSearchParams(searchParams.toString());
  for (const [key, value] of Object.entries(recoveryDraft)) {
    draftQuery.delete(key);
    for (const entry of Array.isArray(value) ? value : [value]) draftQuery.append(key, entry);
  }
  const targetsHref = recoveryHref(`${beta ? '/beta' : ''}/portfolio/targets?${new URLSearchParams({ scope: scopeKey })}`, `${pathname}?${draftQuery}`)!;
  const money = (value: string | number, code: Currency) => formatMoney(Number(value), code, intlLocale(locale));
  const time = (at: string) => new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" }).format(new Date(at));
  function changed() { pending.current = null; setShown(null); setError(""); setCalculationBlock(""); }
  function retryRead() {
    if (saving || deleting) return;
    setLoadFailed(false); setLoaded(null); setError(""); setCalculationBlock("");
    setReadAttempt(previous => previous + 1);
  }
  function makeRequest(): NativeContributionRequest | null {
    const amount = cash.trim() === "" ? 0 : parseMoneyInput(cash, cashCurrency);
    if (amount === null || amount < 0) { setError(t("투자금과 통화의 소수 자릿수를 확인해 주세요.", "Check the amount and the currency’s precision.")); return null; }
    const request:NativeContributionRequest = { id: crypto.randomUUID(), scopeKey, reportingCurrency: currency, newMoney: { amount: String(amount), currency: cashCurrency }, useAvailableCash: useCash, ...(excludedSales.length?{excludedSellKeys:excludedSales}:{}), ...(context?.evidenceVersion?{previewEvidenceVersion:context.evidenceVersion}:{}) };
    const signature=(r:NativeContributionRequest)=>JSON.stringify([r.scopeKey,r.reportingCurrency,r.newMoney,r.useAvailableCash,r.previewEvidenceVersion,r.excludedSellKeys??[]]);
    if(!pending.current||signature(pending.current)!==signature(request))pending.current=request;
    return pending.current;
  }
  function calculate(event: FormEvent) {
    event.preventDefault(); setError(""); setCalculationBlock("");
    const input = makeRequest(); if (!input || !context) return;
    const result = buildNativeContributionPlan(context, input);
    if (result.status === "ready") setShown({ document: result.document, saved: false });
    else if (result.reason === 'choose_account_for_funding' || result.reason === 'invalid_request' || result.reason === 'invalid_sale_exclusions') setError(result.reason==='choose_account_for_funding'?t('투자할 계좌 하나를 선택해 주세요. 계좌 사이의 자금 이동은 계산하지 않아요.','Choose one account. Transfers between accounts are not assumed.'):t("투자금과 매도 제외 종목을 확인해 주세요.", "Check your new money and sale exclusions."));
    else setCalculationBlock(result.reason);
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
      if(result.basisChanged)setError(t('보유·목표 또는 계산 근거가 바뀌어 최신 기준으로 저장했어요.','Holdings, targets or evidence changed. The plan was saved using the latest verified basis.'));
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
  const comparisonHref = `/additional-contribution/compare?${new URLSearchParams({ scope: scopeKey, amount: cash.trim() || (cashCurrency === 'USD' ? '1000' : '1000000'), currency: cashCurrency })}`;
  const document = shown?.document;
  const result = document?.result;
  return <section className={styles.contribution} aria-label={t("추가 투자 계획", "Contribution plan")}>
    <CairnSectionTitle>{t("다음 투자금 나눠보기", "Plan a contribution")}</CairnSectionTitle>
    <Link href={comparisonHref}>{t('비율 매수와 환율·MA120 조정 효과 비교 →', 'Compare proportional buying with FX / MA120 adjustments →')}</Link>
    <p className={styles.note}>{t("승인한 목표 비중을 사용합니다. 저장은 계획만 남기며 실제 주문이나 보유 수량을 바꾸지 않아요.", "Uses your approved targets. Saving records a plan without placing orders or changing holdings.")}</p>
    {!loaded ? loadFailed ? <RecoveryNotice kind="retry" scope={scopeKey} beta={beta} returnHref={returnHref} draft={recoveryDraft} onRetry={retryRead} details={t("투자 계획을 불러오지 못했어요. 입력한 투자금과 조건은 유지됩니다.", "Unable to load plans. Your investment amount and conditions are preserved.")} /> : <CairnStatus as="p" tone="neutral" role="status">{t("목표와 보유 정보를 확인하고 있어요.", "Checking targets and holdings.")}</CairnStatus> : !context ? <RecoveryNotice reasons={[loaded.context.status === "blocked" ? loaded.context.reason : "context_mismatch"]} scope={scopeKey} beta={beta} returnHref={returnHref} draft={recoveryDraft} onRetry={retryRead} /> : <CairnForm onSubmit={calculate} noValidate className={styles.form}>
      <div className={styles.funds}><CairnField>{t("새 투자금", "New money")}<MoneyInput value={cash} onValueChange={value => { setCash(value); changed(); }} allowDecimals={cashCurrency === "USD"} aria-label={t("새 투자금", "New money")} placeholder="0" /></CairnField><CairnField>{t("투자금 통화", "Money currency")}<CairnSelect value={cashCurrency} onChange={event => { setCashCurrency(event.target.value as Currency); changed(); }}><option>KRW</option><option>USD</option></CairnSelect></CairnField></div>
      {context.availableCash.length ? <CairnField className={styles.cashChoice}><CairnInput type="checkbox" checked={useCash} onChange={event => { setUseCash(event.target.checked); changed(); }} />{t("보유 현금도 사용", "Use available cash")} · {context.availableCash.map((fund, index) => <span key={`${fund.accountId}:${fund.currency}:${index}`}>{money(fund.amount, fund.currency)} </span>)}</CairnField> : null}
      <SaleExclusionPicker english={locale==="en"} value={excludedSales} disabled={saving||deleting} onChange={keys=>{setSaleDraft({key:saleKey,keys});changed();}} options={context.input.rows.filter(row=>Number(row.value.amount)>0).map(row=>({key:row.allocationKey,label:context.names[row.allocationKey]??row.allocationKey,detail:[(row.metadata as {accountName?:string; ticker?:string; market?:string})?.accountName??context.scopeLabel,(row.metadata as {ticker?:string})?.ticker,row.value.currency].filter(Boolean).join(" · ")}))}/>
      <div className={styles.targets}>{context.input.rows.map(row => <div key={row.allocationKey}><span>{context.names[row.allocationKey]}</span> <strong>{row.targetWeightBps / 100}%</strong></div>)}</div>
      <Link href={targetsHref}>{t("승인된 목표 비중 변경 →", "Edit approved targets →")}</Link>
      <p className={styles.note}>{t("원가가 없거나 손실인 자산은 매도하지 않습니다. MA120은 원본 통화와 가격 기준이 일치하는 근거만 적용해요.", "Assets with unknown costs or losses are not sold. MA120 applies only when currency and price basis agree.")}</p>
      <div className={plannerStyles.actions}><CairnButton variant="primary" type="submit" className={styles.primary} disabled={saving || deleting}>{t("배분 미리보기", "Preview allocation")}</CairnButton>
      {loaded.canSave ? <CairnButton variant="primary" type="button" className={styles.primary} disabled={saving || deleting} onClick={save}>{saving ? t("저장 중…", "Saving…") : t("최신 기준으로 계산·저장", "Recalculate and save")}</CairnButton> : <span>{t("지금은 미리보기만 이용할 수 있어요.", "Preview is available; saving is currently unavailable.")}</span>}</div>
    </CairnForm>}
    {calculationBlock ? <RecoveryNotice reasons={[calculationBlock]} scope={scopeKey} beta={beta} returnHref={returnHref} draft={recoveryDraft} onRetry={retryRead} /> : null}
    {error ? <CairnStatus as="p" tone="danger" role="alert" className={styles.notice}>{error}</CairnStatus> : null}
    {document && result ? <section className={styles.calculation} id={`native-plan-${document.request.id}`} aria-live="polite"><CairnSectionTitle level="h3">{shown.saved ? t("저장된 계획", "Saved plan") : t("배분 미리보기", "Allocation preview")} · {result.context.profitCurrency}</CairnSectionTitle><p>{time(result.context.asOf)} · {document.basis.scopeLabel}</p>
      <p>{t('새 투자금','New money')} {money(document.request.newMoney.amount,document.request.newMoney.currency)} · {t('보유 현금','Available cash')} {result.context.originalFunds.filter(fund=>fund.kind==='native_cash').map(fund=>money(fund.amount,fund.currency)).join(' + ')||money(0,result.context.reportingCurrency)}</p>
      <div className={styles.metrics}>{[[t("매수 합계", "Total buys"), result.buys], [t("예상 매도대금", "Planned sale proceeds"), result.sales], [t("남는 투자금", "Unallocated funds"), result.remainingCash]].map(([label, value]) => <div key={String(label)}><p>{label}</p><strong>{money(Number(value), result.context.reportingCurrency)}</strong></div>)}</div>
      {result.rows.map(row => <div className={styles.allocation} key={row.key}><strong>{document.basis.names[row.key]}{row.trimReason==="user_sale_excluded"?<small> · {t("매도 제외 · 이번 계산","Excluded from sales · this calculation")}</small>:null}</strong><span>{t("매수", "Buy")} {money(row.buy, result.context.reportingCurrency)} · {t("매도", "Sell")} {money(row.sell, result.context.reportingCurrency)}</span><small>{row.beforePct.toFixed(2)}% → {row.afterPct.toFixed(2)}% · {t("목표", "Target")} {row.targetPct}%</small></div>)}
      {result.modifierEvidence?<details className={styles.method}><summary>{t('감액·보충 계산 근거','Reduction and topup evidence')}</summary>
        <p>{result.minimumExecutionEvidenceAvailable?t('적격 후보의 부족액 안에서만 최소집행을 보충합니다.','Topup stays within eligible holdings’ remaining gaps.'):t('시장 근거가 부족해 최소집행 보충은 적용하지 않았어요.','Minimum deployment topup was not applied because market evidence is incomplete.')}</p>
        {result.rows.map(row=>row.modifierBreakdown?<div key={row.key} className={styles.allocation}><strong>{document.basis.names[row.key]}</strong><p>{t('원배분','Raw allocation')} {money(row.rawAllocation,result.context.reportingCurrency)} → {t('감액 후','After reductions')} {money(row.modifierBreakdown.penalizedAllocationKrw,result.context.reportingCurrency)} · {t('보충','Topup')} {money(row.modifierBreakdown.topupAllocationKrw,result.context.reportingCurrency)}</p>
          <p>{(['fx','rc','regime','event','performance'] as const).map(key=><span key={key}>{({fx:t('환율','FX'),rc:t('위험기여','Risk contribution'),regime:t('시장','Regime'),event:t('뉴스','News'),performance:t('성과','Performance')})[key]} {row.modifierBreakdown!.multipliers[key].status==='unavailable'?t('근거 부족 · 미적용','Missing evidence · not applied'):row.modifierBreakdown!.multipliers[key].status==='not_applicable'?t('적용 제외','Not applicable'):`×${row.modifierBreakdown!.multipliers[key].value.toFixed(2)}`} · </span>)}</p>
          <small>{row.modifierBreakdown.topupEligible?t('보충 적격','Eligible for topup'):t('보충 제외','Excluded from topup')} · {t('점수','Score')} {row.modifierBreakdown.topupScore.toFixed(2)}</small></div>:null)}
      </details>:null}
      <details className={styles.method}><summary>{t("저장된 계산 기준", "Frozen calculation basis")}</summary><p>{t("수익 판단 통화", "Profit currency")} · {result.context.profitCurrency} · {document.basis.policy.version} · #{document.basis.policy.revision}</p>{result.context.originalFunds.map((fund,index) => <p key={index}>{fund.kind === "native_cash" ? t("보유 현금", "Available cash") : t("새 투자금", "New money")} · {money(fund.amount, fund.currency)}</p>)}<p>{t("당시 기준환율과 예상 매도대금을 사용하며 환전 비용·세금·수수료·수량 단위는 반영하지 않아요. 저장 후 표시 통화가 달라져도 당시 판단은 유지합니다.", "Uses dated reference rates and planned sale proceeds. Conversion costs, taxes, fees and trade quantities are excluded. A saved decision keeps its original currency.")}</p></details>
    </section> : null}
    {loaded?.plans.length ? <section className={plannerStyles.saved}><CairnSectionTitle level="h3">{t("저장한 계획", "Saved plans")}</CairnSectionTitle>{loaded.plans.map(plan => <div key={plan.id} className={plannerStyles.savedRow}><a href={`#native-plan-${plan.id}`} onClick={() => { setShown({ document: plan.document, saved: true }); setError(""); }}>{time(plan.createdAt)} · {plan.document.result.context.profitCurrency} · {t("매수", "Buys")} {money(plan.document.result.buys, plan.document.result.context.reportingCurrency)}</a><span className={plannerStyles.savedActions}>{deleteId === plan.id ? <><CairnButton variant="secondary" type="button" disabled={saving || deleting} onClick={() => void remove(plan.id)}>{deleting ? t("삭제 중…", "Deleting…") : t("이 계획 삭제 확인", "Confirm plan deletion")}</CairnButton><CairnButton variant="secondary" type="button" disabled={deleting} onClick={() => setDeleteId(null)}>{t("취소", "Cancel")}</CairnButton></> : <CairnButton variant="secondary" type="button" disabled={saving || deleting} onClick={() => setDeleteId(plan.id)}>{t("계획 삭제", "Delete plan")}</CairnButton>}</span></div>)}</section> : null}
  </section>;
}
