"use client";

import { useState } from "react";
import { Input } from "@/components/cairn-ui";
import { useMeasuredPlot } from "@/components/use-measured-plot";
import { useI18n } from "@/components/i18n/locale-provider";
import { formatMoney, type Currency } from "@/lib/money";
import styles from "./home-composition.module.css";

/** Draw only complete recorded values. Missing frames break the line. */
export function HomeValuationHistory({ frames, currency }: {
  frames: readonly { at: string; total: string | null; complete: boolean }[];
  currency: Currency;
}) {
  const { t } = useI18n();
  const [measured, ref] = useMeasuredPlot();
  const [selection, setSelection] = useState<number | null>(null);
  const rows = frames.map(frame => {
    const value = frame.complete && frame.total !== null ? Number(frame.total) : null;
    return { ...frame, value: value !== null && Number.isFinite(value) ? value : null };
  });
  const valid = rows.flatMap(row => row.value !== null && Number.isFinite(row.value) ? [row.value] : []);
  if (!rows.length) return <p className={styles.note}>{t("확인된 과거 평가가 아직 없어요.", "No dated valuations are available yet.")}</p>;
  const activeIndex = Math.min(selection ?? rows.length - 1, rows.length - 1);
  const active = rows[activeIndex];
  const width = measured.width || 640, height = 240;
  const first = Date.parse(rows[0].at), duration = Date.parse(rows.at(-1)!.at) - first || 1;
  const low = Math.min(...valid), high = Math.max(...valid), span = high - low || 1;
  const x = (at: string) => 8 + (Date.parse(at) - first) / duration * (width - 16);
  const y = (value: number) => 220 - (value - low) / span * 200;
  const paths: string[] = [];
  let path = "";
  for (const row of rows) {
    if (row.value === null || !Number.isFinite(row.value)) { if (path) paths.push(path); path = ""; }
    else path += `${path ? " L" : "M"}${x(row.at)},${y(row.value)}`;
  }
  if (path) paths.push(path);
  const label = (row: typeof active) => `${row.at.slice(0,10)} · ${row.value === null ? t("전체 평가 확인 필요", "Complete valuation unavailable") : formatMoney(row.value, currency)}`;
  return <figure className={styles.valueHistory}>
    <figcaption>{label(active)}</figcaption>
    <div ref={ref}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("확인된 과거 평가액. 불완전한 평가 구간은 연결하지 않습니다.", "Recorded values. Incomplete valuations break the line.")}>
        {[20,120,220].map(at => <line key={at} x1={8} x2={width-8} y1={at} y2={at} stroke="var(--home-line)" strokeWidth={.7} />)}
        {paths.map((d,i) => <path key={i} d={d} fill="none" stroke="var(--brand,#c64623)" strokeWidth={1.7} vectorEffect="non-scaling-stroke" />)}
        {active.value !== null && Number.isFinite(active.value) && <circle cx={x(active.at)} cy={y(active.value)} r={4} fill="var(--brand,#c64623)" />}
      </svg>
    </div>
    <div className={styles.axis}><span>{rows[0].at.slice(0,10)}</span><span>{rows.at(-1)!.at.slice(0,10)}</span></div>
    <Input type="range" min={0} max={rows.length-1} value={activeIndex} onChange={event => setSelection(Number(event.target.value))} aria-label={t("평가 기록 날짜", "Valuation date")} aria-valuetext={label(active)} />
  </figure>;
}
