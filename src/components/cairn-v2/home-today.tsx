"use client";
import type { BetaView } from "@/lib/cairn-v2/read-contract";
import { displayReadMoney } from "@/lib/cairn-v2/read-contract";
import { movementDisplay } from "@/lib/cairn-v2/read-display";
import type { BetaCurrency } from "@/lib/cairn-v2/navigation";
import { ValueText } from "./ui/atoms";
import { formatPercent } from "./ui/format";
import styles from "./home-today.module.css";

export function HomeToday({ view, currency }: { view: BetaView; currency: BetaCurrency }) {
  const current = view.domain?.currentHoldingMovement;
  const legacy = movementDisplay(view);
  const ready = current && !["loading", "unauthorized"].includes(view.domain?.state ?? "");
  const value = ready ? current.returnPct : null;
  const tone = value === null || value === 0 ? "neutral" : value > 0 ? "positive" : "negative";
  if (!view.domain)
    return (
      <div className={styles.body}>
        <p className={styles.headline}>
          <ValueText unit={currency === "KRW" ? "원" : "USD"}>
            {displayReadMoney(view, legacy.value, currency, true, "dashboard")}
          </ValueText>
        </p>
        <p className={styles.note}>가상 데이터 · 전일 기록 대비</p>
      </div>
    );
  return (
    <div className={styles.body}>
      <p className={styles.headline} aria-label="오늘 변동률 · KRW 기준">
        <ValueText tone={tone}>{formatPercent(value, 2, true)}</ValueText>
      </p>
      <p className={styles.amount} data-tone={tone} aria-label={`오늘 변동액 · ${currency}`}>
        {ready && current.changeKrw !== null ? (
          <>
            {displayReadMoney(view, current.changeKrw, currency, true, "dashboard")}{" "}
            <small>{currency === "KRW" ? "원" : "USD"}</small>
          </>
        ) : (
          "비교 근거 확인 전"
        )}
      </p>
      {ready && current.excludedCount > 0 && <p className={styles.note}>일부 종목 기준 · {current.excludedCount}종목 제외</p>}
      {currency === "USD" && <p className={styles.note}>변동률은 KRW 기준</p>}
    </div>
  );
}
