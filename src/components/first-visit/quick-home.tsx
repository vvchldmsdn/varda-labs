"use client";
import Link from "next/link";
import { createQuickDraft, QUICK_STORAGE_KEY, type QuickInput } from "@/lib/quick-portfolio";
import { SecondaryPageHeader } from "@/components/secondary-page-header";
import { QuickResults } from "./quick-results";
import styles from "./quick-portfolio.module.css";

export function QuickHome({ input, createdAt, id, preview = false, welcome = false }: { input: QuickInput; createdAt: string; id?: string; preview?: boolean; welcome?: boolean }) {
  function reuse() {
    if (preview) return;
    try { localStorage.setItem(QUICK_STORAGE_KEY, JSON.stringify({ ...createQuickDraft(input), ...(id ? { id } : {}) })); }
    catch { /* The account copy remains in My records if browser storage is unavailable. */ }
  }
  return <main className="varda-secondary-page min-h-screen bg-[var(--paper)] text-[var(--ink)]">
    <SecondaryPageHeader />
    <div id="varda-main-content" className={styles.home}>
      {welcome ? <p className={styles.note} role="status">입력한 자산을 가져왔어요.</p> : null}
      <header className={styles.homeHeading}><h1>내 자산의 구성</h1><Link href="/try/analyze" onClick={reuse}>금액 수정 ↗</Link></header>
      <p className={styles.note}>{new Date(createdAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })} 입력 금액 기준 · 실시간 평가액과 다를 수 있어요.</p>
      <QuickResults input={input} compact />
      <div className={styles.enrichment}>
        <section><h2>다음 투자금 나누기</h2><p>목표 비중을 정하면 새 투자금의 배분을 계산할 수 있어요.</p><Link href="/try?mode=personal&from=quick" onClick={reuse}>목표 비중 정하기 →</Link></section>
        <section><h2>매일의 변화를 보려면</h2><p>보유 수량을 연결하면 가격 변동을 추적할 수 있어요.</p><Link href="/portfolio/holdings/new?from=quick" onClick={reuse}>보유 정보 보완 →</Link></section>
      </div>
      <Link href="/plans" className={styles.note}>저장한 입력 관리</Link>
    </div>
  </main>;
}
