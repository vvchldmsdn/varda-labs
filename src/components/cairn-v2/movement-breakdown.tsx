import type { BetaCurrency } from "@/lib/cairn-v2/navigation";
import { displayReadMoney, type BetaView } from "@/lib/cairn-v2/read-contract";
import { percentOrNull } from "@/lib/portfolio-math";
import { formatNumber } from "./ui/format";
import styles from "./movement-breakdown.module.css";
import { impactNames, impactTypes } from "./home-impact";

type Props = {
  view: BetaView;
  currency: BetaCurrency;
  priceChangeKrw: number | null;
  fxChangeKrw: number | null;
  previousValueKrw?: number | null;
  compact?: boolean;
};

export function MovementBreakdown({ view, currency, priceChangeKrw, fxChangeKrw, previousValueKrw, compact }: Props) {
  const amounts = { price: priceChangeKrw, fx: fxChangeKrw };
  return <span className={styles.breakdown} data-compact={compact || undefined}>
    {impactTypes.map(type => {
      const amount = amounts[type];
      const money = displayReadMoney(view, amount, currency, true, "dashboard");
      const points = percentOrNull(amount, previousValueKrw ?? null);
      const tone = amount == null || amount === 0 ? "neutral" : amount > 0 ? "positive" : "negative";
      return <span key={type} className={styles.effect} data-impact={type}>
        <span className={styles.label}>{impactNames[type]}{compact ? "" : " 변동"}</span>{" "}
        <span data-tone={tone}>{money}{money !== "—" && (currency === "KRW" ? "원" : " USD")}</span>
        {points !== null && <small title="총변동률 기여도"> {formatNumber(points, { maximumFractionDigits: 2, minimumFractionDigits: 2, signDisplay: "exceptZero" })}%p</small>}
      </span>;
    })}
  </span>;
}
