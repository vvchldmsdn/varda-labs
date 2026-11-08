import { BrandLogo } from "@/components/brand-logo";
import Link from "next/link";
import type { ReactNode } from "react";
import { demoHref, type DemoAccount, type DemoView } from "@/lib/demo-portfolio";
import { EntryEvent } from "@/components/first-visit/entry-event";
import { T } from "@/components/i18n/localized-text";
import { LocalizedElement } from "@/components/i18n/localized-element";
import { LanguageSwitch } from "@/components/i18n/language-switch";
import styles from "./demo.module.css";
import { PageTitle as CairnPageTitle } from "@/components/cairn-ui";

const titles: Record<DemoView, [string, string]> = {
  home: ["자산의 흐름", "Your portfolio at a glance"],
  today: ["오늘, 무엇이 움직였을까?", "What moved today?"],
  structure: ["내 포트폴리오의 구조", "Your portfolio mix"],
  contribution: ["이번 투자금, 어떻게 나눌까?", "How will your next investment fit?"],
  lab: ["다른 선택을 했다면", "Explore a different choice"],
  simulation: ["미래는 하나의 선이 아니니까", "Explore possible outcomes"],
  history: ["쌓여가는 자산의 기록", "Your portfolio over time"],
};
const navigation: [DemoView, string, string][] = [
  ["home", "홈", "Home"], ["today", "오늘 변동", "Today"], ["structure", "포트 구조", "Allocation"],
  ["contribution", "추가투입", "Contribute"], ["lab", "투자 랩", "Investment Lab"],
  ["simulation", "시뮬레이션", "Simulation"], ["history", "히스토리", "History"],
];
const accounts: [DemoAccount, string, string][] = [
  ["all", "전체", "All"], ["brokerage", "증권", "Brokerage"], ["isa", "ISA", "ISA"], ["irp", "IRP", "IRP"],
];

export function DemoShell({ view, account, children }: { view: DemoView; account: DemoAccount; children: ReactNode }) {
  return <main className={styles.page} data-demo-view={view}>
    <EntryEvent event="demo_started" />
    <header className={styles.header}>
      <Link href="/start" className={styles.logo}><BrandLogo /></Link>
      <span className={styles.badge}><T ko="체험 모드 · 샘플 데이터" en="Demo · Sample data" /></span>
      <div className={styles.headerActions}>
        <LanguageSwitch />
        <Link href="/try/analyze" className={styles.convert}><T ko="내 포트폴리오로 계속하기 ↗" en="Try my portfolio ↗" /></Link>
      </div>
    </header>
    <LocalizedElement as="nav" className={styles.nav} aria-label="체험 화면" en={{ "aria-label": "Demo pages" }}>
      {navigation.map(([key, ko, en]) => <Link key={key} href={demoHref(key, account)} prefetch={false} aria-current={key === view ? "page" : undefined}><T ko={ko} en={en} /></Link>)}
    </LocalizedElement>
    <section className={styles.stage}>
      <div className={styles.heading}>
        <CairnPageTitle><T ko={titles[view][0]} en={titles[view][1]} /></CairnPageTitle>
        {["home", "today", "structure", "contribution", "history"].includes(view) ? <LocalizedElement as="nav" className={styles.accounts} aria-label="샘플 계좌 선택" en={{ "aria-label": "Sample accounts" }}>
          {accounts.map(([key, ko, en]) => <Link prefetch={false} key={key} href={demoHref(view, key)} aria-current={account === key ? "page" : undefined}><T ko={ko} en={en} /></Link>)}
        </LocalizedElement> : null}
      </div>
      {view === "home" ? <LocalizedElement as="nav" className={`${styles.disclaimer} ${styles.shortcuts}`} aria-label="체험 추천 경로" en={{ "aria-label": "Explore the demo" }}>
        <Link href={demoHref("today", account)}><T ko="오늘 왜 움직였는지 →" en="What moved today →" /></Link>
        <Link href={demoHref("structure", account)}><T ko="포트 구조 →" en="Portfolio mix →" /></Link>
        <Link href={demoHref("lab", account)}><T ko="다른 선택 비교 →" en="Compare choices →" /></Link>
      </LocalizedElement> : null}
      {children}
    </section>
    <footer className={styles.footer}>
      <div><strong><T ko="이번엔 내 자산으로 살펴볼까요?" en="Ready to explore your own portfolio?" /></strong>
        <p className={styles.disclaimer}><T ko="샘플은 실시간 시세나 투자 추천이 아닙니다." en="Sample data, not live prices or investment recommendations." /></p></div>
      <Link href="/try/analyze" className={styles.convert}><T ko="내 포트폴리오 분석하기 →" en="Analyze my portfolio →" /></Link>
    </footer>
  </main>;
}
