import type { Metadata } from "next";
import { PublicNav } from "@/components/first-visit/public-nav";
import { ProductTour } from "@/components/first-visit/product-tour";
import styles from "@/components/first-visit/first-visit.module.css";
export const metadata: Metadata = { title: "투자 랩·시뮬레이션 체험 | VARDA LABS", robots: { index: false, follow: false } };
export default function ExplorePage() { return <main className={styles.page}><PublicNav/><div className={styles.tourPage}><ProductTour standalone/></div></main>; }
