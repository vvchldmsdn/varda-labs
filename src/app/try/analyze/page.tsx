import type { Metadata } from "next";
import { PublicNav } from "@/components/first-visit/public-nav";
import { QuickPortfolio } from "@/components/first-visit/quick-portfolio";
import styles from "@/components/first-visit/first-visit.module.css";
export const metadata: Metadata = { title: "내 포트폴리오 분석 | VARDA LABS", robots: { index: false, follow: false } };
export default function QuickPortfolioPage() { return <main className={styles.page}><PublicNav /><QuickPortfolio /></main>; }
