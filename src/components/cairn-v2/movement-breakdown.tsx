import type { BetaCurrency } from "@/lib/cairn-v2/navigation";
import { displayReadMoney, type BetaView } from "@/lib/cairn-v2/read-contract";
import { percentOrNull } from "@/lib/portfolio-math";
import { formatNumber } from "./ui/format";
import styles from "./movement-breakdown.module.css";
import { impactNames, impactTypes, type ImpactType } from "./home-impact";
import { Button } from "@/components/cairn-ui";

type Props = {
  view: BetaView;
  currency: BetaCurrency;
  priceChangeKrw: number | null;
  fxChangeKrw: number | null;
  previousValueKrw?: number | null;
  tiles?: boolean;
  controls?: { visible: Record<ImpactType, boolean>; toggle: (type: ImpactType) => void } | null;
};

export function MovementBreakdown({ view, currency, priceChangeKrw, fxChangeKrw, previousValueKrw, controls, tiles = false }: Props) {
  const amounts = { price: priceChangeKrw, fx: fxChangeKrw };
  return (
    <span className={styles.breakdown} data-tiles={tiles || !!controls || undefined}>
      {impactTypes.map(type => {
        const amount = amounts[type];
        const label = impactNames[type] + " 변동";
        const money = displayReadMoney(view, amount, currency, true, "dashboard");
        const points = percentOrNull(amount ?? null, previousValueKrw ?? null);
        const tone = amount == null || amount === 0 ? "neutral" : amount > 0 ? "positive" : "negative";
        const content = <>
            <span className={styles.label}>{label}</span>{" "}
            <span data-tone={tone}>{money}{money !== "—" && (currency === "KRW" ? "원" : " USD")}</span>
            {points !== null && <small title="총변동률 기여도"> {formatNumber(points, { maximumFractionDigits: 2, minimumFractionDigits: 2, signDisplay: "exceptZero" })}%p</small>}
        </>;
        return controls ? <Button type="button" variant="bare" key={type} className={styles.tile} data-impact={type}
          aria-label={label + " · 히스토리 막대 표시"} aria-pressed={controls.visible[type]} onClick={() => controls.toggle(type)}>
          {content}<span className={styles.hint}>{controls.visible[type] ? "막대 켜짐" : "막대 보기"}</span>
        </Button> : <span className={tiles ? styles.tile : styles.effect} data-impact={tiles ? type : undefined} key={type}>{content}</span>;
      })}
    </span>
  );
}
