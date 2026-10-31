import { AuthText } from "./auth-localized";
import { BrandLogo } from "@/components/brand-logo";
import Link from "next/link";
import { ArrowUpRight, LockKeyhole } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./auth-experience.module.css";
import { AuthOrbit } from "./auth-orbit";
import { LanguageSwitch } from "@/components/i18n/language-switch";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { PageHeader, SectionTitle as CairnSectionTitle } from "@/components/cairn-ui";


export function AuthShell({
  children,
  alternate,
  preview = false,
  compact = false,
}: {
  children: ReactNode;
  alternate?: { href: string; label: string };
  preview?: boolean;
  compact?: boolean;
}) {
  return (
    <main className={styles.shell}>
      {preview ? (
        <p className={styles.preview}><AuthText>{"화면 미리보기 · 로그인 및 데이터 저장 없음"}</AuthText></p>
      ) : null}
      <header className={styles.header}>
        <LocalizedLink href={preview ? "/?preview=design" : "/"} className="varda-wordmark" aria-label="CAIRN LABS 홈" en={{"aria-label":"CAIRN LABS home"}}>
          <BrandLogo />
        </LocalizedLink>
        <div className="varda-auth-language-actions">
        <LanguageSwitch />
        {alternate ? (
          <Link className={styles.headerLink} href={alternate.href}>
            <AuthText>{alternate.label}</AuthText>
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        ) : null}
        </div>
      </header>
      <div className={`${styles.stage} ${compact ? styles.compactStage : ""}`}>
        {!compact ? <aside className={styles.introduction}>
          <CairnSectionTitle><AuthText>{"나의 자산을,"}</AuthText><br /><AuthText>{"더 선명하게."}</AuthText></CairnSectionTitle>
          <AuthOrbit />
        </aside> : null}
        <div className={styles.formStage}>{children}</div>
      </div>
      <footer className={styles.footer}>
        <span>CAIRN LABS</span>
        <span>
          <LockKeyhole size={12} aria-hidden="true" /><AuthText>{"계좌 비밀번호를 수집하지 않습니다."}</AuthText></span>
      </footer>
    </main>
  );
}

export function AuthHeading({
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: ReactNode;
}) {
  return (
    <PageHeader className={styles.heading}
      title={<AuthText>{title}</AuthText>}
      description={<AuthText>{description}</AuthText>} />
  );
}
