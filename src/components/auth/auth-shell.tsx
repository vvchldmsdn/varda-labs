import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, ChartNoAxesCombined, LockKeyhole, ScanLine, Waypoints } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./auth-experience.module.css";
import { AuthOrbit } from "./auth-orbit";

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
        <p className={styles.preview}>
          화면 미리보기 · 로그인 및 데이터 저장 없음
        </p>
      ) : null}
      <header className={styles.header}>
        <Link href={preview ? "/?preview=design" : "/"} className="varda-wordmark" aria-label="VARDA-LABS 홈">
          <Image src="/varda-mark.png" width={24} height={24} alt="" priority />
          <span>VARDA-LABS</span>
        </Link>
        {alternate ? (
          <Link className={styles.headerLink} href={alternate.href}>
            {alternate.label}
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        ) : null}
      </header>
      <div className={styles.stage}>
        <aside className={styles.introduction}>
          <p className={styles.introEyebrow}>A CLEARER VIEW OF YOUR WEALTH</p>
          <h2>나의 자산을,<br />더 선명하게.</h2>
          <p>흩어진 자산의 오늘을 살펴보고,<br />기록을 바탕으로 다음을 계획하세요.</p>
          <AuthOrbit />
          <div className={styles.introFeatures}>
            <span><ScanLine size={18} aria-hidden="true" />한눈에 보는 자산과 변화</span>
            <span><ChartNoAxesCombined size={18} aria-hidden="true" />기록으로 확인하는 나의 흐름</span>
            <span><Waypoints size={18} aria-hidden="true" />다양한 가정으로 탐색하는 가능성</span>
          </div>
          <p className={styles.introSignature}>YOUR ASSETS. YOUR PERSPECTIVE.</p>
        </aside>
        <div className={styles.formStage}>{children}</div>
      </div>
      <footer className={styles.footer}>
        <span>VARDA-LABS</span>
        <span>
          <LockKeyhole size={12} aria-hidden="true" />
          계좌 비밀번호를 수집하지 않습니다.
        </span>
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
      <h1>{title}</h1>
      <p className={styles.description}>{description}</p>
    </header>
  );
}
