import type { BetaCurrency } from "@/lib/cairn-v2/navigation";
import { displayReadMoney, type BetaView } from "@/lib/cairn-v2/read-contract";
import { percentOrNull } from "@/lib/portfolio-math";
import { formatNumber } from "./ui/format";
import styles from "./movement-breakdown.module.css";

type Props = {
  view: BetaView;
  currency: BetaCurrency;
  priceChangeKrw: number | null;
  fxChangeKrw: number | null;
  previousValueKrw?: number | null;
};

export function MovementBreakdown({ view, currency, priceChangeKrw, fxChangeKrw, previousValueKrw }: Props) {
  const effects = [
    { label: "가격 변동", amount: priceChangeKrw },
    { label: "환율 변동", amount: fxChangeKrw },
  ];
  return (
    <span className={styles.breakdown}>
      {effects.map(({ label, amount }) => {
        const money = displayReadMoney(view, amount, currency, true, "dashboard");
        const points = percentOrNull(amount ?? null, previousValueKrw ?? null);
        const tone = amount == null || amount === 0 ? "neutral" : amount > 0 ? "positive" : "negative";
        return (
          <span className={styles.effect} key={label}>
            <span className={styles.label}>{label}</span>{" "}
            <span data-tone={tone}>{money}{money !== "—" && (currency === "KRW" ? "원" : " USD")}</span>
            {points !== null && <small title="총변동률 기여도"> {formatNumber(points, { maximumFractionDigits: 2, minimumFractionDigits: 2, signDisplay: "exceptZero" })}%p</small>}
          </span>
        );
      })}
    </span>
  );
}
