"use client";

import Link from "next/link";
import { T } from "@/components/i18n/localized-text";
import { clearPlanReturnCookies, planReturnCancelDestination } from "@/lib/auth/plan-return";
import styles from "./auth-experience.module.css";

export function PlanReturnNotice({ source }: { source?: string } = {}) {
  return <div className={styles.entryNotice}>
    <p><T ko={source === "quick" ? "로그인 후 방금 입력한 포트폴리오를 확인하고 저장할 수 있어요." : "로그인 후 방금 계산한 계획을 확인하고 저장할 수 있어요."} en={source === "quick" ? "After signing in, review and save the portfolio you just entered." : "After signing in, review and save the plan you just calculated."} /></p>
    <Link href={planReturnCancelDestination(source)} className={styles.textLink} onClick={() => {
      // Cancel only this navigation intent; the expiring browser draft remains available.
      for (const cookie of clearPlanReturnCookies(location.protocol === "https:")) document.cookie = cookie;
    }}><T ko="가입·로그인 취소하고 내 계산으로" en="Cancel sign-in and return to my calculation" /></Link>
  </div>;
}
