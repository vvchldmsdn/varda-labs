"use client";

import { useState, type CSSProperties } from "react";
import { Button } from "@/components/cairn-ui";
import { PortfolioAllocationRing } from "@/components/cairn-v2/portfolio-allocation-ring";
import { useI18n } from "@/components/i18n/locale-provider";
import styles from "./home-composition.module.css";

export type HomeAllocationEntry = { key: string; name: string; weightPct: number; color?: string };
const palette = ["#c64623", "#343932", "#cca17b", "#8c9f89", "#697f8c"];

/** Presentation only: callers supply the same admitted weights as their total. */
export function HomeAllocation({ entries, selectedKey, onSelect }: {
  entries: HomeAllocationEntry[]; selectedKey?: string; onSelect?: (key: string) => void;
}) {
  const { t } = useI18n();
  const [localSelected, setLocalSelected] = useState("");
  const [expanded, setExpanded] = useState(false);
  const active = entries.find(row => row.key === (selectedKey ?? localSelected)) ?? entries[0];
  const rows = entries.map((entry, i) => ({ ...entry, color: entry.color ?? palette[i % palette.length] }));
  const select = onSelect ?? setLocalSelected;
  const visible = expanded ? rows : rows.filter((row, index) => index < 5 || row.key === active?.key);
  if (!rows.length) return <p className={styles.note}>{t("평가할 수 있는 보유자산이 없어요.", "No holdings have a verified value yet.")}</p>;
  return <div className={styles.allocation}>
    <div className={styles.ring}><PortfolioAllocationRing entries={rows} selectedKey={active.key} onSelect={select} compositionOnly showHint={false} /></div>
    <div><ul className={styles.list} style={{ "--selected-row": visible.findIndex(row => row.key === active.key) } as CSSProperties} aria-label={t("종목별 비중", "Allocation by holding")}>
      {visible.map(row => <li key={row.key}><Button variant="bare" type="button" style={{"--holding-color":row.color} as CSSProperties} aria-pressed={active.key === row.key} onClick={() => select(row.key)}>
        <i style={{ background: row.color }} aria-hidden="true" /><span title={row.name}>{row.name}</span><strong>{row.weightPct.toFixed(1)}%</strong>
      </Button></li>)}
    </ul>{rows.length > 5 && <Button variant="bare" className={styles.showAll} type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? t("접기", "Show less") : t(`보유 ${rows.length}건 모두 보기`, `Show all ${rows.length} holdings`)}</Button>}</div>
  </div>;
}
