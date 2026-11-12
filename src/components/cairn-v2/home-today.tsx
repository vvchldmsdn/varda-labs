"use client";

import { displayReadMoney, type BetaView } from "@/lib/cairn-v2/read-contract";
import { movementDisplay } from "@/lib/cairn-v2/read-display";
import type { BetaCurrency } from "@/lib/cairn-v2/navigation";
import { MovementBreakdown } from "./movement-breakdown";
import { movementExclusionLabel } from "./movement-exclusion-label";
import { formatPercent } from "./ui/format";
import styles from "./home-today.module.css";

export function HomeToday({ view, currency }: { view: BetaView; currency: BetaCurrency }) {
  const domain = view.domain;
  const market = domain && !["loading", "unauthorized"].includes(domain.state) ? domain.currentHoldingMovement : null;
  const change = domain ? market?.changeKrw ?? null : movementDisplay(view).value;
  const amount = displayReadMoney(view, change, currency, true, "dashboard");
  const rate = market?.returnPct;
  const excluded = market?.exclusions?.filter(row => row.subject !== "aggregate") ?? [];
  const showFactors = market ? market.includedCount > 0 : !domain && view.rows.length > 0 && change !== null;
  return <div className={styles.body}>
    <div className={styles.headline}>
      <span aria-label={`오늘 변동액 · ${currency}`}>{amount}{amount !== "—" && <small>{currency === "KRW" ? "원" : "USD"}</small>}</span>
      {rate != null && <strong aria-label="오늘 변동률 · KRW 기준" data-tone={rate === 0 ? "neutral" : rate > 0 ? "positive" : "negative"}>{formatPercent(rate, 2, true)}</strong>}
    </div>
    {showFactors && <MovementBreakdown compact view={view} currency={currency}
      priceChangeKrw={domain ? market?.priceChangeKrw ?? null : view.priceMoveKrw}
      fxChangeKrw={domain ? market?.fxChangeKrw ?? null : view.fxMoveKrw} />}
    {domain && amount === "—" && <p className={styles.note}>{change != null && currency === "USD" ? "환산할 환율 확인 전" : "비교 근거 확인 전"}</p>}
    {!!market?.excludedCount && <details className={styles.exclusions}>
      <summary>{market.excludedCount}종목 제외</summary>
      {excluded.length ? <ul>{excluded.map((row,i) => <li key={i}>{row.assetName ?? row.ticker ?? "종목 확인 전"} · {movementExclusionLabel(row.reason)}</li>)}</ul> : <p>제외 사유 확인 전</p>}
    </details>}
    {!domain ? <p className={styles.note}>예시 · 전일 대비</p> : currency === "USD" && rate != null && <p className={styles.note}>변동률은 KRW 기준</p>}
  </div>;
}
