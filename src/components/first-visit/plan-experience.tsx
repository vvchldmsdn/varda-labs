"use client";
import Link from "next/link";
import { clearPlanReturnCookies, planReturnIntentCookies } from "@/lib/auth/plan-return";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { calculatePlan, createPlanDraft, parseDraft, PLAN_STORAGE_KEY, SAMPLE_PLAN, type PlanDraft, type PlanInput } from "@/lib/investment-plan";
import { trackFirstVisit } from "@/lib/first-visit-events";
import { analyzeQuickPortfolio, parseQuickDraft, QUICK_STORAGE_KEY, type QuickInput } from "@/lib/quick-portfolio";
import { Decimal, moneyFromMinor, parseMoneyInput, type Currency } from "@/lib/money";
import { useI18n } from "@/components/i18n/locale-provider";
import { PlanResults, planErrorCopy } from "./plan-results";
import { MoneyInput } from "./money-input";
import styles from "./first-visit.module.css";

type FormRow = { name: string; value: string; target: string };
const formRows = (input: PlanInput) => input.rows.map(r => ({ name: r.name, value: String(r.value), target: String(r.targetBps / 100) }));
const emptyRows = (): FormRow[] => [{ name: "", value: "", target: "" }, { name: "", value: "", target: "" }];
const readNumber = (s: string, decimals = 0) => (decimals ? /^\d+(\.\d{1,2})?$/ : /^\d+$/).test(s.trim()) ? Number(s) : NaN;

/** Allocation is a new rounded plan; original entered amounts/FX remain in the quick draft. */
export function quickInputForPlan(input: QuickInput) {
  const analysis = analyzeQuickPortfolio(input);
  if (!analysis.complete) return { ok: false as const };
  return { ok: true as const, currency: input.currency, asOf: input.asOf,
    rows: analysis.rows.map(row => ({ name: row.name,
      value: String(moneyFromMinor(Decimal.from(row.reportingValue!).minor(input.currency, "nearest"), input.currency)), target: "" })) };
}

export function PlanExperience({ personal, fromQuick = false }: { personal: boolean; fromQuick?: boolean }) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const [rows, setRows] = useState<FormRow[]>(personal ? emptyRows : formRows(SAMPLE_PLAN));
  const [amount, setAmount] = useState(personal ? "" : String(SAMPLE_PLAN.amount));
  const [currency, setCurrency] = useState<Currency>("KRW");
  const [asOf, setAsOf] = useState<string | undefined>();
  const [versioned, setVersioned] = useState(personal);
  const [quickBlocked, setQuickBlocked] = useState(false);
  const [result, setResult] = useState<PlanInput | null>(null);
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [error, setError] = useState("");
  const [storageNote, setStorageNote] = useState("");
  const [loaded, setLoaded] = useState(!personal);
  const resultRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!personal) { trackFirstVisit("sample_result"); return; }
    trackFirstVisit("personal_started");
    const frame=requestAnimationFrame(()=>{try {
      const quick = fromQuick ? parseQuickDraft(localStorage.getItem(QUICK_STORAGE_KEY)) : null;
      if (fromQuick) {
        const bridge = quick ? quickInputForPlan(quick.input) : null;
        if (!bridge?.ok) { setQuickBlocked(true); setLoaded(true); return; }
        setCurrency(bridge.currency); setAsOf(bridge.asOf ?? new Date().toISOString()); setVersioned(true);
        setRows(bridge.rows); setAmount(""); setResult(null); setDraft(null);
        setStorageNote("목표 비중과 이번 투자금만 더하면 돼요."); setLoaded(true); return;
      }
      const restored = parseDraft(localStorage.getItem(PLAN_STORAGE_KEY));
      if (restored) { setCurrency(restored.input.currency); setAsOf(restored.input.asOf); setVersioned(restored.input.version === 2); setRows(formRows(restored.input)); setAmount(String(restored.input.amount)); setResult(restored.input); setDraft(restored); setStorageNote("이 브라우저에서 계산한 입력을 복원했습니다."); }
      else { localStorage.removeItem(PLAN_STORAGE_KEY); setAsOf(new Date().toISOString()); }
    } catch { if (fromQuick) setQuickBlocked(true); setAsOf(new Date().toISOString()); setStorageNote("브라우저 임시 저장을 사용할 수 없습니다. 화면에서는 계산할 수 있지만 인증 후 복원하려면 브라우저 저장을 허용해 주세요."); }
    setLoaded(true);});
    return()=>cancelAnimationFrame(frame);
  }, [personal, fromQuick]);
  useEffect(() => {
    if (!draft) return;
    const expire = () => { try { const current = parseDraft(localStorage.getItem(PLAN_STORAGE_KEY)); if (!current || current.id === draft.id) localStorage.removeItem(PLAN_STORAGE_KEY); } catch {} setDraft(null); setStorageNote("임시 보관 기간이 끝났습니다. 저장하려면 다시 계산해 주세요."); };
    const timer = setTimeout(expire, Math.max(0, draft.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [draft]);
  const input: PlanInput = { currency, amount: parseMoneyInput(amount, currency) ?? NaN, rows: rows.map(row => ({ name: row.name, value: parseMoneyInput(row.value, currency) ?? NaN, targetBps: Math.round(readNumber(row.target, 2) * 100) })), ...(versioned ? { version: 2, asOf } : {}) };
  const sampleCalculation = personal ? null : calculatePlan(input);
  function changeRow(index: number, key: keyof FormRow, value: string) { setRows(rows.map((row, i) => i === index ? { ...row, [key]: value } : row)); setResult(null); setError(""); }
  function calculate() {
    const outcome = calculatePlan(input);
    if (!outcome.ok) { setError(outcome.error); requestAnimationFrame(()=>errorRef.current?.focus()); return; }
    setError(""); setResult(input);
    const next = createPlanDraft(input,draft);
    setDraft(next);
    let persisted = false;
    try { localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(next)); persisted = true; setStorageNote("계산한 입력을 이 브라우저에 최대 24시간 임시 보관합니다."); } catch { setStorageNote("임시 저장에 실패했습니다. 결과는 볼 수 있지만 인증 후 입력 복원이 불가능합니다. 브라우저 저장을 허용한 뒤 다시 계산해 주세요."); }
    trackFirstVisit("personal_result", next.id);
    if (fromQuick && persisted) router.replace("/try?mode=personal", { scroll: false });
    requestAnimationFrame(() => resultRef.current?.focus());
  }
  function save() {
    if (!draft || !result || draft.expiresAt <= Date.now()) { setError("저장 전에 다시 계산해 주세요."); return; }
    try { localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(draft)); if (localStorage.getItem(PLAN_STORAGE_KEY) !== JSON.stringify(draft)) throw new Error(); }
    catch { setError("입력을 임시 보관하지 못했습니다. 브라우저 저장을 허용한 뒤 다시 시도해 주세요."); return; }
    for (const cookie of planReturnIntentCookies("allocation", location.protocol === "https:")) document.cookie = cookie;
    router.push("/plans");
  }
  function clear() { try { localStorage.removeItem(PLAN_STORAGE_KEY); } catch {} for (const cookie of clearPlanReturnCookies(location.protocol === "https:")) document.cookie = cookie; setRows(emptyRows()); setAmount(""); setAsOf(new Date().toISOString()); setVersioned(true); setResult(null); setDraft(null); setError(""); setQuickBlocked(false); setStorageNote("이 브라우저의 임시 입력을 삭제했습니다."); }
  const storageEnglish: Record<string, string> = {
    "목표 비중과 이번 투자금만 더하면 돼요.": "Add your target weights and this month’s investment.",
    "이 브라우저에서 계산한 입력을 복원했습니다.": "Your previous inputs are restored.",
    "브라우저 임시 저장을 사용할 수 없습니다. 화면에서는 계산할 수 있지만 인증 후 복원하려면 브라우저 저장을 허용해 주세요.": "Calculations work, but allow browser storage to keep inputs through sign-in.",
    "임시 보관 기간이 끝났습니다. 저장하려면 다시 계산해 주세요.": "Your temporary draft expired. Calculate again to save it.",
    "계산한 입력을 이 브라우저에 최대 24시간 임시 보관합니다.": "Your inputs stay in this browser for up to 24 hours.",
    "임시 저장에 실패했습니다. 결과는 볼 수 있지만 인증 후 입력 복원이 불가능합니다. 브라우저 저장을 허용한 뒤 다시 계산해 주세요.": "The result is visible, but inputs could not be kept for sign-in. Allow browser storage and calculate again.",
    "이 브라우저의 임시 입력을 삭제했습니다.": "The temporary inputs were removed from this browser.",
  };
  const currencyLocked = Boolean(draft || amount.trim() || rows.some(row => row.value.trim()));
  const storageFailed = /실패|사용할 수 없/.test(storageNote);
  const errorCopy = error === "저장 전에 다시 계산해 주세요." ? t(error, "Calculate again before saving.") : error === "입력을 임시 보관하지 못했습니다. 브라우저 저장을 허용한 뒤 다시 시도해 주세요." ? t(error, "Allow browser storage and try saving again.") : planErrorCopy(error, currency, locale);
  return <div className={styles.workspace}>
    <section><p className={styles.eyebrow}>{personal ? t("나의 투자 계획", "MY INVESTMENT PLAN") : t("가상의 포트폴리오 · 투자 추천 아님", "SAMPLE PORTFOLIO · NOT A RECOMMENDATION")}</p><h1>{personal ? t("이번 투자금, 어디에 얼마씩?", "Where should this month’s money go?") : t("예시로 배분을 살펴보세요.", "Try a sample allocation.")}</h1>
      <p className={styles.lead}>{personal ? t("보유 금액과 목표 비중으로\n이번 투자금을 나눠보세요.", "Split new money toward your own targets.") : t("금액이나 비중을 바꿔보세요.\n배분 결과가 바로 달라집니다.", "Change an amount or target.\nSee the allocation respond.")}</p>
      {!personal?<a className={styles.mobileResultLink} href="#plan-result">{t("배분 결과 보기", "View allocation")} ↓</a>:null}
      {!loaded ? <p role="status">{t("임시 입력을 확인하고 있어요.", "Restoring your inputs…")}</p> : quickBlocked ? <section className={styles.saveUnavailable}><h2>{t("환산 기준을 먼저 확인해 주세요.", "Check the exchange-rate basis first.")}</h2><p>{t("서로 다른 통화는 같은 기준으로 환산해야 배분할 수 있어요. 원래 입력은 그대로 유지됩니다.", "Mixed currencies need a matching exchange rate before allocation. Your original inputs are kept.")}</p><Link className={styles.primary} href="/try/analyze">{t("입력과 환율 확인하기", "Review inputs and exchange rate")}</Link></section> : <form className={styles.form} onSubmit={event => { event.preventDefault(); if (personal) calculate(); }} noValidate>
        {personal ? <div className={styles.inputHeading}><span>{t("계산 통화", "Calculation currency")}</span><div className={styles.actions}>{(["KRW", "USD"] as const).map(value => <button key={value} type="button" className={value === currency ? styles.primary : styles.secondary} disabled={currencyLocked && value !== currency} aria-pressed={value === currency} onClick={() => { if (!currencyLocked) { setCurrency(value); setVersioned(true); setAsOf(new Date().toISOString()); setError(""); } }}>{value}</button>)}</div></div> : null}
        <label className={styles.amount}>{t("이번 추가 투자금", "New investment")} · {currency}<MoneyInput allowDecimals={currency === "USD"} value={amount} onValueChange={value => { setAmount(value); setResult(null); }} placeholder={currency === "USD" ? "500.00" : "500,000"} aria-describedby="plan-currency" /></label>
        <div className={styles.inputHeading}><h2>{t("나눠 담을 자산", "Your assets")}</h2><span>{t("목표 비중 합계 100%", "Targets total 100%")}</span></div>
        {rows.map((row, i) => <fieldset className={styles.assetRow} key={i}><legend className={styles.srOnly}>{t(`자산 ${i + 1}`, `Asset ${i + 1}`)}</legend><div className={styles.fields}>
          <label className={styles.name}>{t("자산 이름", "Asset name")}<input aria-label={t(`자산 ${i + 1} 이름`, `Asset ${i + 1} name`)} maxLength={60} value={row.name} onChange={e => changeRow(i, "name", e.target.value)} placeholder={i === 0 ? t("예: 미국 주식 ETF", "e.g. Equity ETF") : t("예: 채권 ETF", "e.g. Bond ETF")} autoComplete="off" /></label>
          <label>{t("현재 평가금액", "Current value")} · {currency}<MoneyInput allowDecimals={currency === "USD"} aria-label={t(`자산 ${i + 1} 평가금액`, `Asset ${i + 1} value`)} value={row.value} onValueChange={value => changeRow(i, "value", value)} placeholder={currency === "USD" ? "0.00" : "0"} /></label>
          <label>{t("목표 비중", "Target weight")} · %<input aria-label={t(`자산 ${i + 1} 목표 비중`, `Asset ${i + 1} target weight`)} inputMode="decimal" value={row.target} onChange={e => changeRow(i, "target", e.target.value)} placeholder="50" /></label>
        </div>{rows.length > 1 ? <button className={styles.removeAsset} type="button" aria-label={t(`자산 ${i + 1} 제외`, `Remove asset ${i + 1}`)} onClick={() => { setRows(rows.filter((_, j) => i !== j)); setResult(null); }}><X size={16}/></button> : null}</fieldset>)}
        <div className={styles.inputFooter}><button type="button" className={styles.addAsset} disabled={rows.length >= 12} onClick={() => { setRows([...rows, { name: "", value: "", target: "" }]); setResult(null); }}><Plus size={15} />{t("자산 추가", "Add asset")}</button><span>{t("현재 합계", "Total")} <strong>{rows.reduce((s, r) => s + (Number.isFinite(readNumber(r.target, 2)) ? readNumber(r.target, 2) : 0), 0).toFixed(2)}%</strong></span></div>
        <p id="plan-currency" className={styles.privacy}>{t(`입력한 ${currency} 금액끼리만 배분합니다.`, `Allocation uses only the entered ${currency} values.`)}</p>
        {error ? <p ref={errorRef} tabIndex={-1} role="alert" className={styles.error}>{errorCopy}</p> : null}
        {personal ? <button className={styles.primary} type="submit">{t("내 배분 결과 보기", "Calculate allocation")} <ArrowUpRight size={17} /></button> : null}
      </form>}
      {personal ? <>{storageFailed ? <p role="alert" className={styles.error}>{t(storageNote, storageEnglish[storageNote])}</p> : null}<details className={styles.privacy}><summary>{t("입력 보관 안내", "Temporary storage")}</summary><p>{storageNote && !storageFailed ? t(storageNote, storageEnglish[storageNote]) : t("계산한 입력은 이 브라우저에 최대 24시간 보관됩니다. 공용 기기에서는 사용 후 삭제해 주세요.", "Inputs stay in this browser for up to 24 hours. Remove them after using a shared device.")}</p><button type="button" className={styles.remove} onClick={clear}>{t("임시 입력 삭제", "Remove temporary inputs")}</button></details></> : <div className={styles.actions}><Link className={styles.primary} href="/try?mode=personal">{t("내 자산으로 계산하기", "Use my own assets")} <ArrowUpRight size={17} /></Link></div>}
    </section>
    <div id="plan-result" ref={resultRef} tabIndex={-1}>
      {personal ? result ? <><PlanResults input={result} /><div className={styles.actions}><button className={styles.primary} onClick={save}>{t("저장하고 다음 투자 때 이어서 사용하기", "Save for your next investment")}</button></div><p className={styles.privacy}>{t("저장은 가입·로그인 후 가능합니다. 취소해도 결과는 남아요.", "Sign in to save. Cancelling sign-in keeps your result here.")}</p></> : !quickBlocked ? <div className={styles.empty}><p className={styles.eyebrow}>{t("계산하면 알 수 있어요", "SEE YOUR NEXT STEP")}</p><h2>{t("어디에 얼마를 더할지,", "How much to add,")}<br/>{t("목표에 얼마나 가까워질지.", "and how close you get.")}</h2><div className={styles.emptyDiagram} aria-hidden="true"><span/><span/><span/></div><p className={styles.privacy}>{t("가입 없이 계산하고, 원할 때 저장하세요.", "Calculate first. Save when you’re ready.")}</p></div> : null : sampleCalculation?.ok ? <PlanResults input={input} sample /> : <p role="alert" className={styles.error}>{sampleCalculation && !sampleCalculation.ok ? planErrorCopy(sampleCalculation.error, currency, locale) : ""}</p>}
    </div>
  </div>;
}
