import { localizedMetadata } from "@/lib/i18n/server";
import { readCurrentSessionSubject } from "@/lib/auth/current-session-subject";
import { SecondaryPageHeader } from "@/components/secondary-page-header";
import { PlanLibraries } from "@/components/first-visit/plan-libraries";
import { PublicNav } from "@/components/first-visit/public-nav";
import styles from "@/components/first-visit/first-visit.module.css";
import { getAuthTransportRuntimeState } from "@/lib/auth/auth-transport-runtime";
export const dynamic = "force-dynamic";
export async function generateMetadata() { return localizedMetadata({ title: "내 투자계획 | CAIRN LABS", robots: { index: false, follow: false } }, "My plans | CAIRN LABS"); }
export default async function PlansPage() {
  // Public shell contains no saved data. The owner-checked API is the data boundary.
  const localAuthDisabled = process.env.NODE_ENV === "development" && getAuthTransportRuntimeState().state === "disabled";
  const signedIn = (await readCurrentSessionSubject()).state === "authenticated";
  return signedIn ? <main className="varda-secondary-page"><SecondaryPageHeader /><div className="varda-content"><PlanLibraries localAuthDisabled={localAuthDisabled} showTour={false} /></div></main>
    : <main className={styles.page}><PublicNav /><PlanLibraries localAuthDisabled={localAuthDisabled} /></main>;
}
