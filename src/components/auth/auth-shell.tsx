import { AuthText } from "./auth-localized";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, ChartNoAxesCombined, LockKeyhole, ScanLine, Waypoints } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./auth-experience.module.css";
import { AuthOrbit } from "./auth-orbit";
import { LanguageSwitch } from "@/components/i18n/language-switch";
import { LocalizedLink } from "@/components/i18n/localized-link";

export function AuthShell({
  children,
  alternate,
  preview = false,
}: {
  children: ReactNode;
  alternate?: { href: string; label: string };
  preview?: boolean;
}) {
  return (
    <main className={styles.shell}>
      {preview ? (
        <p className={styles.preview}><AuthText>{"화면 미리보기 · 로그인 및 데이터 저장 없음"}</AuthText></p>
      ) : null}
      <header className={styles.header}>
        <LocalizedLink href={preview ? "/?preview=design" : "/"} className="varda-wordmark" aria-label="VARDA-LABS 홈" en={{"aria-label":"VARDA-LABS home"}}>
          <Image src="/varda-mark.png" width={24} height={24} alt="" priority />
          <span>VARDA-LABS</span>
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
      <div className={styles.stage}>
        <aside className={styles.introduction}>
          <p className={styles.introEyebrow}>A CLEARER VIEW OF YOUR WEALTH</p>
          <h2><AuthText>{"나의 자산을,"}</AuthText><br /><AuthText>{"더 선명하게."}</AuthText></h2>
          <p><AuthText>{"흩어진 자산의 오늘을 살펴보고,"}</AuthText><br /><AuthText>{"기록을 바탕으로 다음을 계획하세요."}</AuthText></p>
          <AuthOrbit />
          <div className={styles.introFeatures}>
            <span><ScanLine size={18} aria-hidden="true" /><AuthText>{"한눈에 보는 자산과 변화"}</AuthText></span>
            <span><ChartNoAxesCombined size={18} aria-hidden="true" /><AuthText>{"기록으로 확인하는 나의 흐름"}</AuthText></span>
            <span><Waypoints size={18} aria-hidden="true" /><AuthText>{"다양한 가정으로 탐색하는 가능성"}</AuthText></span>
          </div>
          <p className={styles.introSignature}>YOUR ASSETS. YOUR PERSPECTIVE.</p>
        </aside>
        <div className={styles.formStage}>{children}</div>
      </div>
      <footer className={styles.footer}>
        <span>VARDA-LABS</span>
        <span>
          <LockKeyhole size={12} aria-hidden="true" /><AuthText>{"계좌 비밀번호를 수집하지 않습니다."}</AuthText></span>
      </footer>
    </main>
  );
}

export function AuthHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: ReactNode;
}) {
  return (
    <header className={styles.heading}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h1><AuthText>{title}</AuthText></h1>
      <p className={styles.description}><AuthText>{description}</AuthText></p>
    </header>
  );
}
