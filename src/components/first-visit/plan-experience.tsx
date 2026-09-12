"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { calculatePlan, createPlanDraft, parseDraft, PLAN_STORAGE_KEY, SAMPLE_PLAN, type PlanDraft, type PlanInput } from "@/lib/investment-plan";
import { trackFirstVisit } from "@/lib/first-visit-events";
import { PlanResults } from "./plan-results";
import { MoneyInput } from "./money-input";
import styles from "./first-visit.module.css";

type FormRow = { name: string; value: string; target: string };
const formRows = (input: PlanInput) => input.rows.map(r => ({ name: r.name, value: String(r.value), target: String(r.targetBps / 100) }));
const emptyRows = (): FormRow[] => [{ name: "", value: "", target: "" }, { name: "", value: "", target: "" }];
const readNumber = (s: string, decimals = 0) => (decimals ? /^\d+(\.\d{1,2})?$/ : /^\d+$/).test(s.trim()) ? Number(s) : NaN;
export function PlanExperience({ personal }: { personal: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<FormRow[]>(personal ? emptyRows : formRows(SAMPLE_PLAN));
  const [amount, setAmount] = useState(personal ? "" : String(SAMPLE_PLAN.amount));
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
      const restored = parseDraft(localStorage.getItem(PLAN_STORAGE_KEY));
      if (restored) { setRows(formRows(restored.input)); setAmount(String(restored.input.amount)); setResult(restored.input); setDraft(restored); setStorageNote("이 브라우저에서 계산한 입력을 복원했습니다."); }
      else localStorage.removeItem(PLAN_STORAGE_KEY);
    } catch { setStorageNote("브라우저 임시 저장을 사용할 수 없습니다. 화면에서는 계산할 수 있지만 인증 후 복원하려면 브라우저 저장을 허용해 주세요."); }
    setLoaded(true);});
    return()=>cancelAnimationFrame(frame);
  }, [personal]);
  useEffect(() => {
    if (!draft) return;
    const expire = () => { try { const current = parseDraft(localStorage.getItem(PLAN_STORAGE_KEY)); if (!current || current.id === draft.id) localStorage.removeItem(PLAN_STORAGE_KEY); } catch {} setDraft(null); setStorageNote("임시 보관 기간이 끝났습니다. 저장하려면 다시 계산해 주세요."); };
    const timer = setTimeout(expire, Math.max(0, draft.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [draft]);
  const input: PlanInput = { currency: "KRW", amount: readNumber(amount), rows: rows.map(row => ({ name: row.name, value: readNumber(row.value), targetBps: Math.round(readNumber(row.target, 2) * 100) })) };
  const sampleCalculation = personal ? null : calculatePlan(input);
  function changeRow(index: number, key: keyof FormRow, value: string) { setRows(rows.map((row, i) => i === index ? { ...row, [key]: value } : row)); setResult(null); setError(""); }
  function calculate() {
    const outcome = calculatePlan(input);
    if (!outcome.ok) { setError(outcome.error); requestAnimationFrame(()=>errorRef.current?.focus()); return; }
    setError(""); setResult(input);
    const next = createPlanDraft(input,draft);
    setDraft(next);
    try { localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(next)); setStorageNote("계산한 입력을 이 브라우저에 최대 24시간 임시 보관합니다."); } catch { setStorageNote("임시 저장에 실패했습니다. 결과는 볼 수 있지만 인증 후 입력 복원이 불가능합니다. 브라우저 저장을 허용한 뒤 다시 계산해 주세요."); }
    trackFirstVisit("personal_result", next.id);
    requestAnimationFrame(() => resultRef.current?.focus());
  }
  function save() {
    if (!draft || !result || draft.expiresAt <= Date.now()) { setError("저장 전에 다시 계산해 주세요."); return; }
    try { localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(draft)); if (localStorage.getItem(PLAN_STORAGE_KEY) !== JSON.stringify(draft)) throw new Error(); }
    catch { setError("입력을 임시 보관하지 못했습니다. 브라우저 저장을 허용한 뒤 다시 시도해 주세요."); return; }
    document.cookie = "varda_plan_return=1; Path=/; Max-Age=86400; SameSite=Lax";
    router.push("/plans");
  }
  function clear() { try { localStorage.removeItem(PLAN_STORAGE_KEY); } catch {} document.cookie = "varda_plan_return=; Path=/; Max-Age=0; SameSite=Lax"; setRows(emptyRows()); setAmount(""); setResult(null); setDraft(null); setError(""); setStorageNote("이 브라우저의 임시 입력을 삭제했습니다."); }
  return <div className={styles.workspace}>
    <section><p className={styles.eyebrow}>{personal ? "나의 투자 계획" : "가상의 포트폴리오 · 투자 추천 아님"}</p><h1>{personal ? "이번 투자금, 어디에 얼마씩?" : "예시로 배분을 살펴보세요."}</h1>
      <p className={styles.lead}>{personal ? "보유 금액과 목표 비중을 적고,\n이번 투자금을 나눠보세요." : "금액이나 비중을 바꿔보세요.\n배분 결과가 바로 달라집니다."}</p>
      {!personal?<a className={styles.mobileResultLink} href="#plan-result">배분 결과 보기 ↓</a>:null}
      {!loaded ? <p role="status">임시 입력을 확인하고 있어요.</p> : <form className={styles.form} onSubmit={event => { event.preventDefault(); if (personal) calculate(); }} noValidate>
        <label className={styles.amount}>이번 추가 투자금 · 원 (KRW)<MoneyInput value={amount} onValueChange={value => { setAmount(value); setResult(null); }} placeholder="500,000" aria-describedby="plan-currency" /></label>
        <div className={styles.inputHeading}><h2>나눠 담을 자산</h2><span>목표 비중 합계 100%</span></div>
        {rows.map((row, i) => <fieldset className={styles.assetRow} key={i}><legend className={styles.srOnly}>자산 {i + 1}</legend><div className={styles.fields}>
          <label className={styles.name}>자산 이름<input aria-label={`자산 ${i + 1} 이름`} maxLength={60} value={row.name} onChange={e => changeRow(i, "name", e.target.value)} placeholder={i === 0 ? "예: 미국 주식 ETF" : "예: 채권 ETF"} autoComplete="off" /></label>
          <label>현재 평가금액 · 원<MoneyInput aria-label={`자산 ${i + 1} 평가금액`} value={row.value} onValueChange={value => changeRow(i, "value", value)} placeholder="0" /></label>
          <label>목표 비중 · %<input aria-label={`자산 ${i + 1} 목표 비중`} inputMode="decimal" value={row.target} onChange={e => changeRow(i, "target", e.target.value)} placeholder="50" /></label>
        </div>{rows.length > 1 ? <button className={styles.removeAsset} type="button" aria-label={`자산 ${i + 1} 제외`} onClick={() => { setRows(rows.filter((_, j) => i !== j)); setResult(null); }}><X size={16}/></button> : null}</fieldset>)}
        <div className={styles.inputFooter}><button type="button" className={styles.addAsset} disabled={rows.length >= 12} onClick={() => { setRows([...rows, { name: "", value: "", target: "" }]); setResult(null); }}><Plus size={15} />자산 추가</button><span>현재 합계 <strong>{rows.reduce((s, r) => s + (Number.isFinite(readNumber(r.target, 2)) ? readNumber(r.target, 2) : 0), 0).toFixed(2)}%</strong></span></div>
        <p id="plan-currency" className={styles.privacy}>원화 평가금액을 입력해 주세요. 입력한 자산끼리만 배분합니다.</p>
        {error ? <p ref={errorRef} tabIndex={-1} role="alert" className={styles.error}>{error}</p> : null}
        {personal ? <button className={styles.primary} type="submit">내 배분 결과 보기 <ArrowUpRight size={17} /></button> : null}
      </form>}
      {personal ? <><p className={styles.privacy}>{storageNote || "계산한 입력은 이 브라우저에 최대 24시간 보관됩니다. 공용 기기에서는 사용 후 삭제해 주세요."}</p><button type="button" className={styles.remove} onClick={clear}>임시 입력 삭제</button></> : <div className={styles.actions}><Link className={styles.primary} href="/try?mode=personal">내 자산으로 계산하기 <ArrowUpRight size={17} /></Link></div>}
    </section>
    <div id="plan-result" ref={resultRef} tabIndex={-1}>
      {personal ? result ? <><PlanResults input={result} /><div className={styles.actions}><button className={styles.primary} onClick={save}>저장하고 다음 투자 때 이어서 사용하기</button></div><p className={styles.privacy}>저장할 때 가입·로그인이 필요해요. 취소해도 계산 결과는 남아 있습니다.</p></> : <div className={styles.empty}><p className={styles.eyebrow}>계산하면 알 수 있어요</p><h2>어디에 얼마를 더할지,<br/>목표에 얼마나 가까워질지.</h2><div className={styles.emptyDiagram} aria-hidden="true"><span/><span/><span/></div><p>자산 이름 · 현재 금액 · 원하는 비중<br/>세 가지만 입력하면 됩니다.</p><p className={styles.privacy}>가입 없이 계산하고, 원할 때 계정에 저장하세요.</p></div> : sampleCalculation?.ok ? <PlanResults input={input} sample /> : <p role="alert" className={styles.error}>{sampleCalculation && !sampleCalculation.ok ? sampleCalculation.error : ""}</p>}
    </div>
  </div>;
}
