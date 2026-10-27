import { BrandLogo } from "@/components/brand-logo";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ProductFilm } from "@/components/first-visit/product-film";
import { EntryEvent } from "@/components/first-visit/entry-event";
import styles from "@/components/first-visit/product-landing.module.css";
import { T } from "@/components/i18n/localized-text";
import { LocalizedElement } from "@/components/i18n/localized-element";
import { LanguageSwitch } from "@/components/i18n/language-switch";
import { readCurrentSessionSubject } from "@/lib/auth/current-session-subject";
import { localizedMetadata } from "@/lib/i18n/server";

const metadata: Metadata = {
  metadataBase: new URL("https://varda-labs.vercel.app"),
  title: "내 자산을 이해하는 새로운 관점 | CAIRN LABS",
  description: "자산이 왜 움직였는지, 어떤 구조인지, 다른 선택은 어땠을지. 샘플 포트폴리오로 Cairn Labs를 먼저 체험하거나 내 자산의 구성을 가입 없이 살펴보세요.",
  robots: { index: true, follow: true }, alternates: { canonical: "https://varda-labs.vercel.app/start" },
  openGraph: { title: "내 자산을 이해하는 새로운 관점 | CAIRN LABS", description: "먼저 써보세요. 마음에 들면 내 포트폴리오로 이어가세요.", images: [{ url: "/product-demo/poster-desktop.png", width: 1280, height: 800 }], type: "website" },
};
export async function generateMetadata() { return localizedMetadata(metadata, "A new perspective on your portfolio | CAIRN LABS"); }
const chapters = [
  { number: "01 / TODAY", title: "왜 움직였을까?", description: "종목별 기여도와 가격·환율의 영향을 나눠 봅니다.", href: "/demo/today" },
  { number: "02 / STRUCTURE", title: "어디에 모여 있을까?", description: "종목의 비중과 포트폴리오 안의 구조를 살펴봅니다.", href: "/demo/structure" },
  { number: "03 / INVESTMENT LAB", title: "다르게 투자했다면?", description: "같은 기간, 다른 선택의 결과를 나란히 비교합니다.", href: "/demo/lab" },
  { number: "04 / SIMULATION", title: "어떤 미래가 가능할까?", description: "하나의 예측 대신 가정에 따른 가능한 경로를 봅니다.", href: "/demo/simulation" },
];
const chapterEnglish = [
  ["What moved?", "See each holding’s contribution and the effects of prices and exchange rates."],
  ["Where is it concentrated?", "Explore holding weights and your portfolio’s structure."],
  ["What if you invested differently?", "Compare different choices over the same period."],
  ["Which futures are possible?", "Explore possible paths under explicit assumptions."],
];
export default async function StartPage() {
  let signedIn = false;
  try { signedIn = (await readCurrentSessionSubject()).state === "authenticated"; } catch { /* Public introduction remains available during an authentication outage. */ }
  return <main className={styles.page}><EntryEvent />
    <LocalizedElement as="nav" className={styles.nav} aria-label="첫 방문 메뉴" en={{"aria-label":"Main menu"}}><Link className={styles.brand} href="/start"><BrandLogo /></Link><div className={styles.navLinks}><LanguageSwitch /><Link href="/demo/home"><T ko="서비스 체험" en="Demo" /></Link>{signedIn ? <Link href="/"><T ko="홈" en="Home" /></Link> : <><Link href="/auth/sign-up" prefetch={false}><T ko="회원가입" en="Sign up" /></Link><Link href="/auth/sign-in" prefetch={false}><T ko="로그인" en="Sign in" /></Link></>}</div></LocalizedElement>
    <header className={styles.hero}><div><p className={styles.eyebrow}>A NEW PERSPECTIVE ON YOUR PORTFOLIO</p><h1><T ko="내 자산을," en="Your portfolio," /><br /><T ko="조금 더 " en="a little more " /><span><T ko="깊이." en="clearly." /></span></h1></div><div className={styles.heroCopy}><p><T ko="왜 움직였는지, 어디에 모여 있는지." en="Understand what moved and where your assets are concentrated." /><br /><T ko="다른 선택과 가능한 미래까지 살펴보세요." en="Explore other choices and possible futures." /></p><div className={styles.actions}><Link className={styles.primary} href="/try/analyze"><T ko="내 포트폴리오 분석하기" en="Analyze my portfolio" /> <ArrowUpRight size={17} /></Link><Link className={styles.secondary} href="/demo/home"><T ko="샘플로 1분 체험" en="Try a sample in a minute" /> <ArrowUpRight size={17} /></Link></div><p className={styles.note}><T ko="가입 없이 먼저 체험하고, 저장할 때 계정을 만드세요." en="Try it first. Create an account when you want to save." /></p></div></header>
    <ProductFilm />
    <LocalizedElement as="section" className={styles.chapters} aria-label="실제 화면으로 체험하기" en={{"aria-label":"Explore the product"}}>{chapters.map((chapter,index) => <Link key={chapter.href} className={styles.chapter} href={chapter.href}><span>{chapter.number}</span><h2><T ko={chapter.title} en={chapterEnglish[index][0]} /></h2><p><T ko={chapter.description} en={chapterEnglish[index][1]} /></p><ArrowUpRight size={16} aria-hidden="true" /></Link>)}</LocalizedElement>
    <section className={styles.closing}><div><p className={styles.eyebrow}>START WITH WHAT YOU KNOW</p><h2><T ko="처음부터 모든 걸" en="Start with what" /><br /><T ko="입력할 필요는 없어요." en="you already know." /></h2></div><div><p><T ko="종목 이름과 대략적인 평가금액만으로" en="Use holding names and approximate values" /><br /><T ko="내 포트폴리오의 구성을 먼저 확인하세요." en="to explore your portfolio’s structure first." /></p><div className={styles.actions}><Link className={styles.primary} href="/try/analyze"><T ko="내 자산으로 시작하기" en="Start with my portfolio" /> <ArrowUpRight size={17} /></Link><Link className={styles.secondary} href="/try?mode=personal"><T ko="목표 비중으로 투자금 나누기" en="Allocate toward target weights" /></Link></div></div></section>
    <footer className={styles.footer}><span>CAIRN LABS</span><span><T ko="샘플은 가상 데이터입니다. 종목 추천·수익 보장·실제 주문을 제공하지 않습니다." en="Samples use fictional data. No stock recommendations, guaranteed returns or trading orders." /></span></footer>
  </main>;
}
