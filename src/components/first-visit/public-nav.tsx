import Link from "next/link";
import styles from "./first-visit.module.css";
export function PublicNav() { return <nav className={styles.nav} aria-label="첫 방문 메뉴"><Link className={styles.brand} href="/start">VARDA</Link><div><Link href="/explore">서비스 체험</Link><Link href="/plans">내 계획</Link><Link href="/auth/sign-in">로그인</Link></div></nav>; }
