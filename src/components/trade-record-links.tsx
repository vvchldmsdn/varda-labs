"use client";
import Link from "next/link";
import { useI18n } from "@/components/i18n/locale-provider";
import { tradeRecordHref } from "@/lib/trade-record-intent";
import styles from "./trade-record-links.module.css";

export function TradeRecordLinks({ variant = "panel", accountId, onNavigate }: { variant?: "topbar" | "panel" | "menu"; accountId?: string; onNavigate?: () => void }) {
  const { t } = useI18n();
  return <div className={styles[variant]} role="group" aria-label={t("매매 기록", "Trade records")}>
    <Link className={styles.link} href={tradeRecordHref({ accountId, action: "buy" })} prefetch={false} onClick={onNavigate}>{t("매수 기록", "Record buy")}</Link>
    <Link className={styles.link} href={tradeRecordHref({ accountId, action: "sell" })} prefetch={false} onClick={onNavigate}>{t("매도 기록", "Record sell")}</Link>
  </div>;
}
