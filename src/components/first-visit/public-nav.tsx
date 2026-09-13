import { BrandLogo } from "@/components/brand-logo";
import Link from "next/link";
import styles from "./first-visit.module.css";
export function PublicNav({ signedIn = false }: { signedIn?: boolean }) { return <nav className={styles.nav} aria-label="첫 방문 메뉴"><Link className={styles.brand} href="/start"><BrandLogo /></Link><div><Link href="/demo/home">서비스 체험</Link><Link href="/plans">내 계획</Link><Link href={signedIn ? "/" : "/auth/sign-in"} prefetch={false}>{signedIn ? "Home" : "로그인"}</Link></div></nav>; }
