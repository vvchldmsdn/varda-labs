"use client";

import Link from "next/link";
import { T } from "@/components/i18n/localized-text";
import { PLAN_RETURN_CANCEL_PATH, PLAN_RETURN_COOKIE } from "@/lib/auth/plan-return";
import styles from "./auth-experience.module.css";

export function PlanReturnNotice() {
  return <div className={styles.entryNotice}>
    <p><T ko="로그인 후 방금 계산한 계획을 확인하고 저장할 수 있어요." en="After signing in, review and save the plan you just calculated." /></p>
    <Link href={PLAN_RETURN_CANCEL_PATH} className={styles.textLink} onClick={() => {
      // Cancel only this navigation intent; the expiring browser draft remains available.
      document.cookie = `${PLAN_RETURN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    }}><T ko="가입·로그인 취소하고 내 계산으로" en="Cancel sign-in and return to my calculation" /></Link>
  </div>;
}
