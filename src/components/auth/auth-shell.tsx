import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, LockKeyhole } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./auth-experience.module.css";

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
        <Link href="/" className="varda-wordmark" aria-label="VARDA-LABS 홈">
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
      <div className={styles.stage}>{children}</div>
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
