"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createQuickDraft, parseQuickDraft, QUICK_INSTRUMENTS, QUICK_STORAGE_KEY, validateQuickPortfolio, type QuickDraft, type QuickInput } from "@/lib/quick-portfolio";
import { trackFirstVisit } from "@/lib/first-visit-events";
import { MoneyInput } from "./money-input";
import { QuickResults } from "./quick-results";
import styles from "./quick-portfolio.module.css";
type Row = { key: string; name: string; value: string; instrumentId: string | null };
const blank = (key: string): Row => ({ key, name: "", value: "", instrumentId: null });
export function QuickPortfolio() {
  const [rows, setRows] = useState<Row[]>([blank("0"), blank("1")]);
  const [draft, setDraft] = useState<QuickDraft | null>(null);
  const [result, setResult] = useState<QuickInput | null>(null);
  const [error, setError] = useState(""); const [storageWarning, setStorageWarning] = useState("");
  useEffect(() => { const frame = requestAnimationFrame(() => { try { const stored = parseQuickDraft(localStorage.getItem(QUICK_STORAGE_KEY));
    if (stored) { setRows(stored.input.rows.map((row, index) => ({ ...row, key: String(index), value: String(row.value) }))); setDraft(stored); setResult(stored.input); }
    else localStorage.removeItem(QUICK_STORAGE_KEY);
  } catch { setStorageWarning("브라우저 임시 저장이 차단되어 있어요. 계산은 가능하지만 새로고침하면 입력이 사라집니다."); } }); return () => cancelAnimationFrame(frame); }, []);
  useEffect(() => { if (!draft) return; const timer = setTimeout(() => { try { const stored = parseQuickDraft(localStorage.getItem(QUICK_STORAGE_KEY)); if (!stored || stored.id === draft.id) localStorage.removeItem(QUICK_STORAGE_KEY); } catch {} setDraft(null); setStorageWarning("24시간 보관이 끝났습니다. 결과를 다시 계산하면 보관 기간이 새로 시작됩니다."); }, Math.max(0, draft.expiresAt - Date.now())); return () => clearTimeout(timer); }, [draft]);
  function update(key: string, patch: Partial<Row>) { trackFirstVisit("portfolio_input_started"); setRows(current => current.map(row => row.key === key ? { ...row, ...patch } : row)); setResult(null); setError(""); }
  function calculate() {
    const parsed = validateQuickPortfolio({ currency: "KRW", rows: rows.filter(row => row.name.trim() || row.value).map(row => ({ name: row.name, value: /^\d+$/.test(row.value) ? Number(row.value) : NaN, instrumentId: row.instrumentId })) });
    if (!parsed.ok) { setError(parsed.error); return; }
    const next = createQuickDraft(parsed.input, draft); setDraft(next); setResult(parsed.input); trackFirstVisit("portfolio_result_viewed", next.id); setError("");
    try { localStorage.setItem(QUICK_STORAGE_KEY, JSON.stringify(next)); setStorageWarning(""); } catch { setStorageWarning("입력을 브라우저에 보관하지 못했어요. 결과는 볼 수 있지만 로그인 후 자동 복원할 수 없습니다."); }
    requestAnimationFrame(() => document.getElementById("quick-result")?.focus());
  }
  function clear() { setRows([blank("0"), blank("1")]); setDraft(null); setResult(null); setError(""); try { localStorage.removeItem(QUICK_STORAGE_KEY); setStorageWarning(""); } catch { setStorageWarning("브라우저에서 임시 입력을 삭제하지 못했어요. 브라우저의 사이트 데이터 설정에서 삭제할 수 있습니다."); } }
  return <section className={styles.workspace}><p className={styles.eyebrow}>내 포트폴리오로 시작</p><h1>자산 이름과 금액이면 충분해요.</h1><p>지금 가진 자산이 어떻게 나뉘어 있는지, 가입 전에 확인하세요.</p>
    <div className={styles.grid}><form className={styles.form} onSubmit={e => { e.preventDefault(); calculate(); }} noValidate>
      {rows.map((row, index) => { const matches = row.name.trim().length && !row.instrumentId ? QUICK_INSTRUMENTS.filter(item => `${item.name} ${item.ticker}`.toLowerCase().includes(row.name.trim().toLowerCase())).slice(0, 4) : []; return <fieldset className={styles.row} key={row.key}><legend>자산 {index + 1}</legend><label>종목명<input autoComplete="off" maxLength={60} aria-label={`자산 ${index + 1} 이름`} value={row.name} onChange={e => update(row.key, { name: e.target.value, instrumentId: null })} placeholder="종목 검색 또는 직접 입력" /></label><label>현재 금액 · 원<MoneyInput aria-label={`자산 ${index + 1} 금액`} value={row.value} onValueChange={value => update(row.key, { value })} placeholder="0" /></label><button type="button" aria-label={`자산 ${index + 1} 제외`} disabled={rows.length === 1} onClick={() => { setRows(current => current.filter(item => item.key !== row.key)); setResult(null); }}>×</button>
        {matches.length ? <div className={styles.suggestions} aria-label={`자산 ${index + 1} 검색 결과`}>{matches.map(item => <button type="button" key={item.id} onClick={() => update(row.key, { name: item.name, instrumentId: item.id })}>{item.name} · {item.ticker}</button>)}</div> : null}{row.instrumentId ? <p className={styles.selectedLabel}>종목 확인됨 · {QUICK_INSTRUMENTS.find(item => item.id === row.instrumentId)?.currency}</p> : null}</fieldset>; })}
      <div className={styles.actions}><button type="button" disabled={rows.length >= 12} onClick={() => setRows(current => [...current, blank(crypto.randomUUID())])}>＋ 자산 추가</button><button type="button" onClick={clear}>입력 지우기</button></div><p className={styles.note}>해외 자산도 원화 환산 금액을 입력해 주세요. 검색은 일부 종목을 지원하며, 목록에 없어도 이름으로 시작할 수 있어요.</p>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}<div className={styles.actions}><button className={styles.primary} type="submit">내 포트폴리오 구조 보기</button></div>
      <p className={styles.note}>계산한 입력은 이 브라우저에 24시간 보관합니다. ‘입력 지우기’로 삭제할 수 있어요. 계정 저장은 로그인 후 직접 확인합니다.</p>{storageWarning ? <p role="status" className={styles.note}>{storageWarning}</p> : null}
    </form><div id="quick-result" tabIndex={-1}>{result ? <><QuickResults input={result} /><div className={styles.actions}>{!storageWarning && draft ? <><Link href="/plans" className={styles.primary}>이 포트폴리오 저장하고 이어가기</Link><Link href="/try?mode=personal&from=quick">다음 투자금 배분 계산</Link></> : null}</div><p className={styles.note}>지금은 현재 구성을 알 수 있어요. 가격 이력이 필요한 변동 분석과 시뮬레이션은 샘플에서 먼저 체험하세요.</p><div className={styles.actions}><Link href="/demo/structure">샘플 포트 구조</Link><Link href="/demo/simulation">샘플 시뮬레이션</Link></div></> : <section className={styles.empty}><h2>내 자산이 한눈에.</h2><p>가장 큰 자산의 비중과 확인된 자산 종류를 보여드려요. 이름만으로 알 수 없는 정보는 추측하지 않습니다.</p><Link href="/demo/home">입력 전에 샘플 체험하기 →</Link></section>}</div></div>
  </section>;
}
