import type { PortfolioMovementExclusion } from "@/lib/portfolio-movement";
import { formatNumber, formatPercent } from "./ui/format";
import styles from "./today-detail.module.css";

type PurchaseEvidence = Omit<NonNullable<PortfolioMovementExclusion["localPurchases"]>, "currency"> & { currency: string };

export function TodayPurchaseBreakdown({ purchase }: { purchase: PurchaseEvidence }) {
  const { currency, boughtQuantity, openingQuantity } = purchase;
  const isUsd = currency === "USD";
  const money = (value: number, signed = false) => formatNumber(value, {
    minimumFractionDigits: isUsd ? 2 : 0, maximumFractionDigits: isUsd ? 2 : 0,
    signDisplay: signed ? "exceptZero" : "auto",
  }) + (isUsd ? " USD" : "원");
  const quantity = (value: number) => formatNumber(value, { maximumFractionDigits: 8 }) + "주";
  return <div className={styles.purchase} aria-label="체결가 기준 가격손익">
    <dl>
      {openingQuantity !== null && openingQuantity > 0 && <div><dt>기존 보유 {quantity(openingQuantity)}</dt>
        <dd>{purchase.openingPriceChangeLocal === null ? "기준가 확인 전" : money(purchase.openingPriceChangeLocal, true)}</dd></div>}
      <div><dt>오늘 매수 {quantity(boughtQuantity)}</dt><dd>{money(purchase.buyPriceChangeLocal, true)}
        {purchase.buyPriceReturnPctLocal != null && <small> ({formatPercent(purchase.buyPriceReturnPctLocal, 2, true)})</small>}</dd></div>
      {openingQuantity !== null && openingQuantity > 0 && purchase.totalPriceChangeLocal !== null && <div><dt>가격손익 합계</dt><dd>{money(purchase.totalPriceChangeLocal, true)}</dd></div>}
    </dl>
    <p>평균 체결가 {money(purchase.averageBuyPrice)} → 현재가 {money(purchase.currentPrice)} · 수수료 전</p>
  </div>;
}
