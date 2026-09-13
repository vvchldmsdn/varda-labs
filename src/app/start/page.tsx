import { BrandLogo } from "@/components/brand-logo";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ProductFilm } from "@/components/first-visit/product-film";
import { EntryEvent } from "@/components/first-visit/entry-event";
import styles from "@/components/first-visit/product-landing.module.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://varda-labs.vercel.app"),
  title: "내 자산을 이해하는 새로운 관점 | CAIRN LABS",
  description: "자산이 왜 움직였는지, 어떤 구조인지, 다른 선택은 어땠을지. 샘플 포트폴리오로 Cairn Labs를 먼저 체험하거나 내 자산의 구성을 가입 없이 살펴보세요.",
  robots: { index: true, follow: true }, alternates: { canonical: "https://varda-labs.vercel.app/start" },
  openGraph: { title: "내 자산을 이해하는 새로운 관점 | CAIRN LABS", description: "먼저 써보세요. 마음에 들면 내 포트폴리오로 이어가세요.", images: [{ url: "/product-demo/poster-desktop.png", width: 1280, height: 800 }], type: "website" },
};
const chapters = [
  { number: "01 / TODAY", title: "왜 움직였을까?", description: "종목별 기여도와 가격·환율의 영향을 나눠 봅니다.", href: "/demo/today" },
  { number: "02 / STRUCTURE", title: "어디에 모여 있을까?", description: "종목의 비중과 포트폴리오 안의 구조를 살펴봅니다.", href: "/demo/structure" },
  { number: "03 / INVESTMENT LAB", title: "다르게 투자했다면?", description: "같은 기간, 다른 선택의 결과를 나란히 비교합니다.", href: "/demo/lab" },
  { number: "04 / SIMULATION", title: "어떤 미래가 가능할까?", description: "하나의 예측 대신 가정에 따른 가능한 경로를 봅니다.", href: "/demo/simulation" },
];
export default function StartPage() {
  return <main className={styles.page}><EntryEvent />
    <nav className={styles.nav} aria-label="첫 방문 메뉴"><Link className={styles.brand} href="/start"><BrandLogo /></Link><div className={styles.navLinks}><Link href="/demo/home">서비스 체험</Link><Link href="/plans">내 기록</Link><Link href="/auth/sign-in" prefetch={false}>로그인</Link></div></nav>
    <header className={styles.hero}><div><p className={styles.eyebrow}>A NEW PERSPECTIVE ON YOUR PORTFOLIO</p><h1>내 자산을,<br />조금 더 <span>깊이.</span></h1></div><div className={styles.heroCopy}><p>왜 움직였는지, 어디에 모여 있는지.<br />다른 선택과 가능한 미래까지 살펴보세요.</p><div className={styles.actions}><Link className={styles.primary} href="/try/analyze">내 포트폴리오 분석하기 <ArrowUpRight size={17} /></Link><Link className={styles.secondary} href="/demo/home">샘플로 1분 체험 <ArrowUpRight size={17} /></Link></div><p className={styles.note}>가입 없이 먼저 체험하고, 저장할 때 계정을 만드세요.</p></div></header>
    <ProductFilm />
    <section className={styles.chapters} aria-label="실제 화면으로 체험하기">{chapters.map(chapter => <Link key={chapter.href} className={styles.chapter} href={chapter.href}><span>{chapter.number}</span><h2>{chapter.title}</h2><p>{chapter.description}</p><ArrowUpRight size={16} aria-hidden="true" /></Link>)}</section>
    <section className={styles.closing}><div><p className={styles.eyebrow}>START WITH WHAT YOU KNOW</p><h2>처음부터 모든 걸<br />입력할 필요는 없어요.</h2></div><div><p>종목 이름과 대략적인 평가금액만으로<br />내 포트폴리오의 구성을 먼저 확인하세요.</p><p>목표 비중이 있다면 이번 투자금의 배분도 계산할 수 있어요. 실제 보유종목 등록은 그다음에 이어가면 됩니다.</p><div className={styles.actions}><Link className={styles.primary} href="/try/analyze">내 자산으로 시작하기 <ArrowUpRight size={17} /></Link><Link className={styles.secondary} href="/try?mode=personal">목표 비중으로 투자금 나누기</Link></div></div></section>
    <footer className={styles.footer}><span>CAIRN LABS</span><span>샘플은 가상 데이터입니다. 종목 추천·수익 보장·실제 주문을 제공하지 않습니다.</span></footer>
  </main>;
}
