import { localizedMetadata } from "@/lib/i18n/server";
import { readCurrentSessionSubject } from "@/lib/auth/current-session-subject";
import { T } from "@/components/i18n/localized-text";
import { LocalizedElement } from "@/components/i18n/localized-element";
import Link from "next/link";
import { PublicNav } from "@/components/first-visit/public-nav";
import { PlanExperience } from "@/components/first-visit/plan-experience";
import styles from "@/components/first-visit/first-visit.module.css";
export async function generateMetadata() { return localizedMetadata({ title: "목표 비중으로 투자금 나누기 | CAIRN LABS", robots: { index: false, follow: false } }, "Allocate a contribution | CAIRN LABS"); }
export default async function TryPage({searchParams}:{searchParams:Promise<{mode?:string;from?:string}>}) {
  const params = await searchParams;
  const personal=params.mode === "personal";
  let signedIn = false;
  try { signedIn = (await readCurrentSessionSubject()).state === "authenticated"; } catch { /* Public calculation remains usable during an authentication outage. */ }
  return <main className={styles.page}><PublicNav signedIn={signedIn} />
    <LocalizedElement as="nav" className={styles.modeNav} aria-label="계산 방식" en={{"aria-label":"Calculation mode"}}>
      <Link href="/try" aria-current={!personal ? "page" : undefined}><T ko="예시로 보기" en="Sample allocation" /></Link>
      <Link href="/try?mode=personal" aria-current={personal ? "page" : undefined}><T ko="내 투자금 계산" en="My contribution" /></Link>
    </LocalizedElement>
    <PlanExperience key={personal ? "personal" : "sample"} personal={personal} fromQuick={personal && params.from === "quick"} />
  </main>;
}
