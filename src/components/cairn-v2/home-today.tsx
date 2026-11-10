"use client";
import type { BetaView } from "@/lib/cairn-v2/read-contract";
import { displayReadMoney } from "@/lib/cairn-v2/read-contract";
import { movementDisplay } from "@/lib/cairn-v2/read-display";
import type { BetaCurrency } from "@/lib/cairn-v2/navigation";
import { ValueText } from "./ui/atoms";
import { MovementBreakdown } from "./movement-breakdown";
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
          <ValueText tone={legacy.value === null || legacy.value === 0 ? "neutral" : legacy.value > 0 ? "positive" : "negative"} unit={currency === "KRW" ? "원" : "USD"}>
            {displayReadMoney(view, legacy.value, currency, true, "dashboard")}
          </ValueText>
        </p>
        {view.rows.length > 0 && legacy.value !== null &&
          <MovementBreakdown view={view} currency={currency} priceChangeKrw={view.priceMoveKrw} fxChangeKrw={view.fxMoveKrw} />}
        <p className={styles.note}>예시 · 전일 대비</p>
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
      {ready && current.includedCount > 0 &&
        <MovementBreakdown view={view} currency={currency} priceChangeKrw={current.priceChangeKrw} fxChangeKrw={current.fxChangeKrw} />}
      {ready && current.excludedCount > 0 && <p className={styles.note}>일부 종목 기준 · {current.excludedCount}종목 제외</p>}
      {currency === "USD" && <p className={styles.note}>변동률은 KRW 기준</p>}
    </div>
  );
}
