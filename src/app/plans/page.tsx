import type { Metadata } from "next";
import { PlanLibrary } from "@/components/first-visit/plan-library";
import { PublicNav } from "@/components/first-visit/public-nav";
import styles from "@/components/first-visit/first-visit.module.css";
import { getAuthTransportRuntimeState } from "@/lib/auth/auth-transport-runtime";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "내 투자계획 | VARDA LABS", robots: { index: false, follow: false } };
export default function PlansPage() {
  // Public shell contains no saved data. The owner-checked API is the data boundary.
  const localAuthDisabled = process.env.NODE_ENV === "development" && getAuthTransportRuntimeState().state === "disabled";
  return <main className={styles.page}><PublicNav /><PlanLibrary localAuthDisabled={localAuthDisabled} /></main>;
}
