import type { Metadata } from "next";
import Link from "next/link";
import { PublicNav } from "@/components/first-visit/public-nav";
import { PlanExperience } from "@/components/first-visit/plan-experience";
import styles from "@/components/first-visit/first-visit.module.css";
export const metadata: Metadata = { title: "목표 비중으로 투자금 나누기 | VARDA LABS", robots: { index: false, follow: false } };
export default async function TryPage({searchParams}:{searchParams:Promise<{mode?:string}>}) {
  const personal=(await searchParams).mode === "personal";
  return <main className={styles.page}><PublicNav />
    <nav className={styles.modeNav} aria-label="계산 방식">
      <Link href="/try" aria-current={!personal ? "page" : undefined}>예시로 보기</Link>
      <Link href="/try?mode=personal" aria-current={personal ? "page" : undefined}>내 투자금 계산</Link>
    </nav>
    <PlanExperience key={personal ? "personal" : "sample"} personal={personal} />
  </main>;
}
