"use client";

import { ACTIVATION_STORAGE_KEY } from "@/lib/portfolio-activation";
import Link from "next/link";
import { T } from "@/components/i18n/localized-text";
import { clearPlanReturnCookies, planReturnCancelDestination } from "@/lib/auth/plan-return";
import styles from "./auth-experience.module.css";

export function PlanReturnNotice({ source }: { source?: string } = {}) {
  return <div className={styles.entryNotice}>
    {source !== "quick" ? <p><T ko="로그인 후 계산한 계획을 저장할 수 있어요." en="Sign in to save your plan." /></p> : null}
    <Link href={planReturnCancelDestination(source)} className={styles.textLink} onClick={() => {
      // Cancel the save intent, retaining the input for review.
      try { localStorage.removeItem(ACTIVATION_STORAGE_KEY); } catch {}
      for (const cookie of clearPlanReturnCookies(location.protocol === "https:")) document.cookie = cookie;
    }}><T ko="내 결과로 돌아가기" en="Return to my result" /></Link>
  </div>;
}
