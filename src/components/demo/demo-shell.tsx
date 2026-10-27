import { BrandLogo } from "@/components/brand-logo";
import Link from "next/link";
import type { ReactNode } from "react";
import type { DemoAccount, DemoView } from "@/lib/demo-portfolio";
import { EntryEvent } from "@/components/first-visit/entry-event";
import styles from "./demo.module.css";

export const demoTitles: Record<DemoView, string> = { home: "자산의 흐름", today: "오늘, 무엇이 움직였을까?", structure: "내 포트폴리오의 구조", contribution: "이번 투자금, 어떻게 나눌까?", lab: "다른 선택을 했다면", simulation: "미래는 하나의 선이 아니니까", history: "쌓여가는 자산의 기록" };
const navigation: [DemoView, string][] = [["home", "홈"], ["today", "오늘 변동"], ["structure", "포트 구조"], ["contribution", "추가투입"], ["lab", "투자 랩"], ["simulation", "시뮬레이션"], ["history", "히스토리"]];
export function DemoShell({ view, account, children }: { view: DemoView; account: DemoAccount; children: ReactNode }) {
  return <main className={styles.page} data-demo-view={view}><EntryEvent event="demo_started" />
    <header className={styles.header}><Link href="/start" className={styles.logo}><BrandLogo /></Link><span className={styles.badge}>체험 모드 · 샘플 데이터</span><Link href="/try/analyze" className={styles.convert}>내 포트폴리오로 계속하기 ↗</Link></header>
    <nav className={styles.nav} aria-label="체험 화면">{navigation.map(([key, label]) => <Link key={key} href={`/demo/${key}?account=${account}`} prefetch={false} aria-current={key === view ? "page" : undefined}>{label}</Link>)}</nav>
    <section className={styles.stage}><div className={styles.heading}><div><h1>{demoTitles[view]}</h1></div>{["home", "today", "structure", "contribution", "history"].includes(view) ? <nav className={styles.accounts} aria-label="샘플 계좌 선택">{([ ["all", "전체"], ["brokerage", "증권"], ["isa", "ISA"], ["irp", "IRP"] ] as const).map(([key, label]) => <Link prefetch={false} key={key} href={`/demo/${view}?account=${key}`} aria-current={account === key ? "page" : undefined}>{label}</Link>)}</nav> : null}</div>
      {view === "home" ? <nav className={styles.disclaimer} aria-label="체험 추천 경로"><Link href="/demo/today">오늘 왜 움직였는지 →</Link>{"　"}<Link href="/demo/structure">포트 구조 →</Link>{"　"}<Link href="/demo/lab">다른 선택 비교 →</Link></nav> : null}
      {children}
    </section>
    <footer className={styles.footer}><div><strong>이번엔 내 자산으로 살펴볼까요?</strong><p className={styles.disclaimer}>샘플은 실시간 시세나 투자 추천이 아닙니다.</p></div><Link href="/try/analyze" className={styles.convert}>내 포트폴리오 분석하기 →</Link></footer>
  </main>;
}
