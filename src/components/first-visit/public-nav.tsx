"use client";

import { BrandLogo } from "@/components/brand-logo";
import Link from "next/link";
import { LanguageSwitch } from "@/components/i18n/language-switch";
import { useI18n } from "@/components/i18n/locale-provider";
import styles from "./first-visit.module.css";
import quickStyles from "./quick-portfolio.module.css";
export function PublicNav({ signedIn = false }: { signedIn?: boolean }) {
  const { t } = useI18n();
  return <nav className={`${styles.nav} ${quickStyles.publicNav}`} aria-label={t("첫 방문 메뉴", "Main menu")}><Link className={styles.brand} href="/start"><BrandLogo /></Link><div><LanguageSwitch /><Link href="/demo/home">{t("서비스 체험", "Demo")}</Link><Link href="/plans">{t("내 계획", "My plans")}</Link><Link href={signedIn ? "/" : "/auth/sign-in"} prefetch={false}>{signedIn ? "Home" : t("로그인", "Sign in")}</Link></div></nav>;
}
