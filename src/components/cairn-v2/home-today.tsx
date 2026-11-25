"use client";

import { displayReadMoney, type BetaView } from "@/lib/cairn-v2/read-contract";
import { movementDisplay } from "@/lib/cairn-v2/read-display";
import { todayChangeForHistory } from "@/lib/cairn-v2/history-current";
import { reviewedMovementForView } from "@/lib/cairn-v2/reviewed-current-movement";
import type { BetaCurrency } from "@/lib/cairn-v2/navigation";
import { MovementBreakdown } from "./movement-breakdown";
import { movementExclusionLabel } from "./movement-exclusion-label";
import { formatPercent } from "./ui/format";
import styles from "./home-today.module.css";

export function HomeToday({ view, currency }: { view: BetaView; currency: BetaCurrency }) {
  const domain = view.domain;
  const market = domain && !["loading", "unauthorized"].includes(domain.state) ? domain.currentHoldingMovement : null;
  const reviewChange = todayChangeForHistory(view);
  const manualNames = reviewChange?.manualNames.join(", ");
  const reviewedMovement = reviewedMovementForView(view, reviewChange);
  const change = reviewChange ? reviewChange.changeKrw ?? null : domain ? market?.changeKrw ?? null : movementDisplay(view).value;
  const amount = displayReadMoney(view, change, currency, true, "dashboard");
  const rate = reviewChange ? reviewChange.returnPct : market?.returnPct;
  const unavailable = amount === "—";
  const excluded = market?.exclusions?.filter(row => row.subject !== "aggregate") ?? [];
  const hasLocalPriceEvidence = excluded.some(row => row.localPurchases);
  const factors = reviewChange && !manualNames ? reviewedMovement : market;
  const showFactors = reviewChange && !manualNames ? !!reviewedMovement : market ? market.includedCount > 0 : !domain && view.rows.length > 0 && change !== null;
  return <div className={styles.body} data-available={!unavailable}>
    <div className={styles.headline}>
      {unavailable
        ? <p className={styles.unavailable} role="status">{change != null && currency === "USD" ? "환산할 환율 확인 전" : hasLocalPriceEvidence ? "원화 변동액 확인 전" : "비교 근거 확인 전"}</p>
        : <span aria-label={`오늘 변동액 · ${currency}`}>{amount}<small>{currency === "KRW" ? "원" : "USD"}</small></span>}
      {rate != null && <strong aria-label="오늘 변동률 · KRW 기준" data-tone={rate === 0 ? "neutral" : rate > 0 ? "positive" : "negative"}>{formatPercent(rate, 2, true)}</strong>}
    </div>
    {showFactors && <MovementBreakdown compact view={view} currency={currency}
      priceChangeKrw={domain ? factors?.priceChangeKrw ?? null : view.priceMoveKrw}
      fxChangeKrw={domain ? factors?.fxChangeKrw ?? null : view.fxMoveKrw}
      quantityChangeKrw={reviewedMovement?.quantityChangeKrw} />}
    <div className={styles.context}>
      {!reviewChange && !!market?.excludedCount && <details className={styles.exclusions}>
        <summary>{market.excludedCount}종목 제외</summary>
        {excluded.length ? <ul>{excluded.map((row,i) => <li key={i}>{row.assetName ?? row.ticker ?? "종목 확인 전"} · {movementExclusionLabel(row.reason)}</li>)}</ul> : <p>제외 사유 확인 전</p>}
      </details>}
      {reviewChange ? <p className={styles.note}>오전 7시 마감 평가액 대비{manualNames ? ` · ${manualNames} 수동 평가액 유지` : !reviewedMovement && !unavailable ? " · 가격·환율 근거 확인 전" : ""}</p> : market?.partial && rate != null ? <p className={styles.note}>시세 비교 종목 기준 · KRW</p> : !domain ? <p className={styles.note}>예시 · 전일 대비</p> : currency === "USD" && rate != null && <p className={styles.note}>변동률은 KRW 기준</p>}
    </div>
  </div>;
}
