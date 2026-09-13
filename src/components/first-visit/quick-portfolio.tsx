"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createQuickDraft, parseQuickDraft, QUICK_INSTRUMENTS, QUICK_STORAGE_KEY, validateQuickPortfolio, type QuickDraft, type QuickInput } from "@/lib/quick-portfolio";
import { trackFirstVisit } from "@/lib/first-visit-events";
import { MoneyInput } from "./money-input";
import { QuickResults } from "./quick-results";
import { ContinueWithPortfolio } from "./portfolio-activation";
import { ACTIVATION_STORAGE_KEY } from "@/lib/portfolio-activation";
import styles from "./quick-portfolio.module.css";
type Row = { key: string; name: string; value: string; instrumentId: string | null };
const blank = (key: string): Row => ({ key, name: "", value: "", instrumentId: null });
export function QuickPortfolio({ signedIn = false, initialSaved, preview = false }: { signedIn?: boolean; preview?: boolean; initialSaved?: { id: string; input: QuickInput } }) {
  const [rows, setRows] = useState<Row[]>([blank("0")]);
  const [draft, setDraft] = useState<QuickDraft | null>(null);
  const [result, setResult] = useState<QuickInput | null>(null);
  const [error, setError] = useState(""); const [storageWarning, setStorageWarning] = useState("");
  useEffect(() => { const frame = requestAnimationFrame(() => { try { const stored = parseQuickDraft(localStorage.getItem(QUICK_STORAGE_KEY)) ?? (initialSaved ? { ...createQuickDraft(initialSaved.input), id: initialSaved.id } : null);
    if (stored) { setRows(stored.input.rows.map((row, index) => ({ ...row, key: String(index), value: String(row.value) }))); setDraft(stored); setResult(stored.input); localStorage.setItem(QUICK_STORAGE_KEY, JSON.stringify(stored)); }
    else localStorage.removeItem(QUICK_STORAGE_KEY);
  } catch { setStorageWarning("브라우저 임시 저장이 차단되어 있어요. 계산은 가능하지만 새로고침하면 입력이 사라집니다."); } }); return () => cancelAnimationFrame(frame); }, [initialSaved]);
  useEffect(() => { if (!draft) return; const timer = setTimeout(() => { try { const stored = parseQuickDraft(localStorage.getItem(QUICK_STORAGE_KEY)); if (!stored || stored.id === draft.id) localStorage.removeItem(QUICK_STORAGE_KEY); } catch {} setDraft(null); setStorageWarning("24시간 보관이 끝났습니다. 결과를 다시 계산하면 보관 기간이 새로 시작됩니다."); }, Math.max(0, draft.expiresAt - Date.now())); return () => clearTimeout(timer); }, [draft]);
  function update(key: string, patch: Partial<Row>) { trackFirstVisit("portfolio_input_started"); setRows(current => current.map(row => row.key === key ? { ...row, ...patch } : row)); setResult(null); setError(""); }
  function calculate() {
    const parsed = validateQuickPortfolio({ currency: "KRW", rows: rows.filter(row => row.name.trim() || row.value).map(row => ({ name: row.name, value: /^\d+$/.test(row.value) ? Number(row.value) : NaN, instrumentId: row.instrumentId })) });
    if (!parsed.ok) { setError(parsed.error); return; }
    const next = createQuickDraft(parsed.input, draft); setDraft(next); setResult(parsed.input); trackFirstVisit("portfolio_result_viewed", next.id); setError("");
    try { localStorage.setItem(QUICK_STORAGE_KEY, JSON.stringify(next)); setStorageWarning(""); } catch { setStorageWarning("입력을 브라우저에 보관하지 못했어요. 결과는 볼 수 있지만 로그인 후 자동 복원할 수 없습니다."); }
    requestAnimationFrame(() => document.getElementById("quick-result")?.focus());
  }
  function clear() { setRows([blank("0")]); setDraft(null); setResult(null); setError(""); try { localStorage.removeItem(QUICK_STORAGE_KEY); localStorage.removeItem(ACTIVATION_STORAGE_KEY); setStorageWarning(""); } catch { setStorageWarning("브라우저에서 임시 입력을 삭제하지 못했어요. 브라우저의 사이트 데이터 설정에서 삭제할 수 있습니다."); } }
  return <section className={styles.workspace}><h1>어떤 자산을 가지고 있나요?</h1><p>정확하지 않아도 괜찮아요.</p>
    <div className={styles.grid}><form className={styles.form} onSubmit={e => { e.preventDefault(); calculate(); }} noValidate>
      {rows.map((row, index) => { const matches = row.name.trim().length && !row.instrumentId ? QUICK_INSTRUMENTS.filter(item => `${item.name} ${item.ticker}`.toLowerCase().includes(row.name.trim().toLowerCase())).slice(0, 4) : []; return <fieldset className={styles.row} key={row.key}><legend>자산 {index + 1}</legend><label>종목명<input autoComplete="off" maxLength={60} aria-label={`자산 ${index + 1} 이름`} value={row.name} onChange={e => update(row.key, { name: e.target.value, instrumentId: null })} placeholder="종목 검색 또는 직접 입력" /></label><label>현재 금액 · 원<MoneyInput aria-label={`자산 ${index + 1} 금액`} value={row.value} onValueChange={value => update(row.key, { value })} placeholder="0" /></label><button type="button" aria-label={`자산 ${index + 1} 제외`} disabled={rows.length === 1} onClick={() => { setRows(current => current.filter(item => item.key !== row.key)); setResult(null); }}>×</button>
        {matches.length ? <div className={styles.suggestions} aria-label={`자산 ${index + 1} 검색 결과`}>{matches.map(item => <button type="button" key={item.id} onClick={() => update(row.key, { name: item.name, instrumentId: item.id })}>{item.name} · {item.ticker}</button>)}</div> : null}{QUICK_INSTRUMENTS.find(item => item.id === row.instrumentId)?.currency === "USD" ? <p className={styles.selectedLabel}>해외 자산은 원화로 환산한 금액을 넣어주세요.</p> : null}</fieldset>; })}
      <div className={styles.actions}><button type="button" disabled={rows.length >= 12} onClick={() => setRows(current => current.some(row => !row.name.trim() && !row.value) ? current : [...current, blank(crypto.randomUUID())])}>＋ 자산 추가</button><button type="button" onClick={clear}>입력 지우기</button></div>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}<div className={styles.actions}><button className={styles.primary} type="submit">구성 확인하기</button></div>
      <details className={styles.method}><summary>입력 보관 안내</summary><p>계산한 입력은 이 브라우저에 24시간 보관하며 ‘입력 지우기’로 삭제할 수 있습니다. 계정 저장에는 로그인이 필요합니다. 저장한 입력은 내 기록에서 삭제할 수 있습니다.</p></details>{storageWarning ? <p role="status" className={styles.note}>{storageWarning}</p> : null}
    </form><div id="quick-result" tabIndex={-1}>{result ? <><QuickResults input={result} compact action={!storageWarning && draft ? <ContinueWithPortfolio draft={draft} signedIn={signedIn} preview={preview} /> : null} /></> : <section className={styles.empty}><h2>내 자산이 한눈에.</h2><Link href="/demo/home">입력 전에 샘플 체험하기 →</Link></section>}</div></div>
  </section>;
}
