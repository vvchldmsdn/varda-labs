"use client";
import Link from "next/link";
import { createQuickDraft, QUICK_STORAGE_KEY, type QuickInput } from "@/lib/quick-portfolio";
import { SecondaryPageHeader } from "@/components/secondary-page-header";
import { useI18n } from "@/components/i18n/locale-provider";
import { intlLocale } from "@/lib/i18n/locale";
import { QuickResults } from "./quick-results";
import styles from "./quick-portfolio.module.css";

export function QuickHome({ input, createdAt, id, preview = false, welcome = false }: { input: QuickInput; createdAt: string; id?: string; preview?: boolean; welcome?: boolean }) {
  const { locale, t } = useI18n();
  const researchHref = preview ? "/portfolio/research?preview=currency" : id ? `/portfolio/research?draft=${encodeURIComponent(id)}` : "/portfolio/research";
  function reuse() {
    if (preview) return;
    try { localStorage.setItem(QUICK_STORAGE_KEY, JSON.stringify({ ...createQuickDraft(input), ...(id ? { id } : {}) })); }
    catch { /* The account copy remains in My records if browser storage is unavailable. */ }
  }
  return <main className="varda-secondary-page min-h-screen bg-[var(--paper)] text-[var(--ink)]">
    <SecondaryPageHeader researchHref={researchHref} />
    <div id="varda-main-content" className={styles.home}>
      {welcome ? <p className={styles.note} role="status">{t("입력한 자산을 가져왔어요.", "Your assets are here.")}</p> : null}
      <header className={styles.homeHeading}><h1>{t("내 자산의 구성", "My portfolio")}</h1><Link href="/try/analyze" onClick={reuse}>{t("금액 수정 ↗", "Edit amounts ↗")}</Link></header>
      <p className={styles.note}>{new Date(input.asOf ?? createdAt).toLocaleDateString(intlLocale(locale), { timeZone: input.timeZone ?? "Asia/Seoul" })} · {t("입력 금액 기준 · 실시간 평가액과 다를 수 있어요.", "Entered values, not live prices.")}</p>
      <QuickResults input={input} compact />
      <div className={styles.enrichment}>
        <section><h2>{t("다른 가능성 살펴보기", "Explore other possibilities")}</h2><p>{t("입력한 구성과 시장 이력으로 가상 분석을 확인해요.", "Explore hypothetical outcomes using your composition and market history.")}</p><Link href={researchHref} onClick={reuse}>{t("비교 · 시뮬레이션 →", "Comparisons and simulation →")}</Link></section>
        <section><h2>{t("다음 투자금 나누기", "Plan your next contribution")}</h2><p>{t("목표 비중을 정하면 새 투자금의 배분을 계산할 수 있어요.", "Set your target weights to allocate new money.")}</p><Link href="/try?mode=personal&from=quick" onClick={reuse}>{t("목표 비중 정하기 →", "Set target weights →")}</Link></section>
        <section><h2>{t("매일의 변화를 보려면", "Follow daily changes")}</h2><p>{t("보유 수량을 연결하면 가격 변동을 추적할 수 있어요.", "Add actual quantities to follow price changes.")}</p><Link href="/portfolio/holdings/new?from=quick" onClick={reuse}>{t("보유 정보 보완 →", "Add holding details →")}</Link></section>
      </div>
      <Link href="/plans" className={styles.note}>{t("저장한 입력 관리", "Manage saved inputs")}</Link>
    </div>
  </main>;
}
