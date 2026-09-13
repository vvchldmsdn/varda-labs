import { listPortfolioDrafts } from "@/db/queries/portfolio-drafts";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { readCurrentSessionSubject } from "@/lib/auth/current-session-subject";
import type { Metadata } from "next";
import { PublicNav } from "@/components/first-visit/public-nav";
import { QuickPortfolio } from "@/components/first-visit/quick-portfolio";
import styles from "@/components/first-visit/first-visit.module.css";
export const metadata: Metadata = { title: "내 포트폴리오 분석 | CAIRN LABS", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export default async function QuickPortfolioPage() {
  let signedIn = false;
  try { signedIn = (await readCurrentSessionSubject()).state === "authenticated"; }
  catch { /* Public input remains available during an authentication outage. */ }
  let initialSaved;
  if (signedIn) {
    const resolution = await resolveCurrentTenantContext();
    if (resolution.ok) {
      try { initialSaved = (await listPortfolioDrafts(resolution.tenantContext))[0]; }
      catch { /* The personal browser draft and new input remain usable. */ }
    }
  }
  return <main className={styles.page}><PublicNav signedIn={signedIn} /><QuickPortfolio signedIn={signedIn} initialSaved={initialSaved} /></main>;
}
