"use client";
import { CompositionBar } from "@/components/portfolio/composition-bar";
import { Button as CairnButton } from "@/components/cairn-ui";

import {useState} from "react";
import {ArrowRight} from "./icons";
import styles from "./contribution.module.css";
type FundingRow = { key: string; name: string; amount: number };
const FUND_COLORS = ["#ef5a32", "#30362f", "#cda680", "#8b9d89", "#80909b", "#bdbbae"];

export function ContributionFundingVisual({ cash, trims, total, residual, rows }: {
  cash: number;
  trims: number;
  total: number;
  residual: number;
  rows: readonly FundingRow[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const positive = rows.filter(row => row.amount > 0).toSorted((a, b) => b.amount - a.amount);
  const visible = positive.slice(0, 4);
  const others = positive.slice(4);
  const segments: FundingRow[] = [
    ...visible,
    ...(others.length ? [{ key: "other", name: (`그 외 ${others.length}종목`), amount: others.reduce((sum, row) => sum + row.amount, 0) }] : []),
    ...(residual > 0 ? [{ key: "cash", name: ("남는 현금"), amount: residual }] : []),
  ];
  const active = segments.find(row => row.key === (hovered ?? selected)) ?? segments[0];
  const signature = segments.map(row => `${row.key}:${row.amount}`).join("|");
  return (
    <div className={styles.fundingVisual}>
      <div className={styles.fundingSources}><span>{"신규"}{" "}{formatKrw(cash)}</span><i aria-hidden="true">+</i><span>{"계산상 매도"}{" "}{formatKrw(trims)}</span></div>
      <div className={styles.fundingTotal}><span>{"매수 가능 재원"}</span><strong>{formatKrw(total)}</strong></div>
      <CompositionBar key={signature} className={styles.fundingBar} label="매수 가능 재원의 배분"
        selectedKey={selected} hoveredKey={hovered} onHover={setHovered} onSelect={setSelected}
        entries={segments.map((row, index) => ({ key: row.key, label: row.name, share: total > 0 ? row.amount / total * 100 : 0,
          color: FUND_COLORS[index % FUND_COLORS.length], description: row.name + ", " + formatKrw(row.amount) + ", " + (total > 0 ? row.amount / total * 100 : 0).toFixed(1) + "%" }))} />
      <div className={styles.fundingSelection} aria-live="polite"><span>{active?.name ?? "배분 가능한 종목 없음"}</span><strong>{active ? formatKrw(active.amount) : "—"}</strong><ArrowRight size={14} aria-hidden="true" /></div>
      <div className={styles.fundingLegend} aria-label={("배분 종목 선택")}>{segments.map((row, index) => <CairnButton variant="bare" key={row.key} type="button" aria-pressed={active?.key === row.key} onPointerEnter={event => { if (event.pointerType !== "touch") setHovered(row.key); }} onPointerLeave={() => setHovered(null)} onFocus={() => setHovered(row.key)} onBlur={() => setHovered(null)} onClick={() => setSelected(row.key)}><i style={{ background: FUND_COLORS[index % FUND_COLORS.length] }} />{row.name}</CairnButton>)}</div>
    </div>
  );
}

function formatKrw(value: number) { return new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(value); }
