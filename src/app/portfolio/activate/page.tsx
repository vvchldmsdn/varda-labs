import type { Metadata } from "next";
import { PortfolioActivation } from "@/components/first-visit/portfolio-activation";
import { PublicNav } from "@/components/first-visit/public-nav";
import styles from "@/components/first-visit/first-visit.module.css";

export const metadata: Metadata = { title: "내 자산으로 시작 | CAIRN LABS", robots: { index: false, follow: false } };
// No owner data is rendered here. Every read/write is authenticated by the API.
export default function ActivatePage() {
  return <main className={styles.page}><PublicNav /><PortfolioActivation /></main>;
}
