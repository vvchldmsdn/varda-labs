"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/cairn-ui";
import type { BetaHeatmapRead } from "@/lib/cairn-v2/heatmap-contract";
import { sumComplete } from "@/lib/portfolio-math";
import styles from "./home-impact.module.css";

export const impactTypes = ["price", "fx"] as const;
export type ImpactType = typeof impactTypes[number];
export const impactNames = { price: "가격", fx: "환율" };
type DailyImpact = { date: string; price: number | null; fx: number | null };
type ImpactContext = {
  days: DailyImpact[];
  visible: Record<ImpactType, boolean>;
  toggle: (type: ImpactType) => void;
};
const Context = createContext<ImpactContext | null>(null);
export const useHomeImpact = () => useContext(Context);

function recordedDays(read?: BetaHeatmapRead | null): DailyImpact[] {
  const history = read?.history;
  if (!history?.rows.length || !read || !["ready", "partial"].includes(read.state)) return [];
  return history.dates.map((date, i) => {
    const sum = (field: "priceChangeKrw" | "fxChangeKrw") => sumComplete(history.rows, row => {
      const cell = row.cells[i];
      return cell?.date === date ? cell[field] : null;
    });
    return { date, price: sum("priceChangeKrw"), fx: sum("fxChangeKrw") };
  });
}

export function HomeImpactProvider({ read, children }: { read?: BetaHeatmapRead | null; children: ReactNode }) {
  const days = useMemo(() => recordedDays(read), [read]);
  const [visible, setVisible] = useState({ price: false, fx: false });
  return <Context.Provider value={{ days, visible, toggle: type => setVisible(prev => ({ ...prev, [type]: !prev[type] })) }}>{children}</Context.Provider>;
}

export type ImpactPlot = { start: string; end: string; x: (date: string) => number; top: number; bottom: number };

export function ImpactLines({ chart, plot }: { chart: ImpactContext; plot: ImpactPlot }) {
  const days = chart.days.filter(day => day.date >= plot.start && day.date <= plot.end);
  // Both daily amounts use one symmetric KRW scale, independent of the main metric.
  const extent = Math.max(1, ...days.flatMap(day => impactTypes.map(type => Math.abs(day[type] ?? 0))));
  const middle = (plot.top + plot.bottom) / 2;
  return <g pointerEvents="none" aria-hidden="true">{impactTypes.map(type => {
    if (!chart.visible[type]) return null;
    let path = "";
    let previous = NaN;
    const dots = days.map(day => {
      const amount = day[type];
      if (amount === null) return null;
      const time = Date.parse(day.date);
      const x = plot.x(day.date);
      const y = middle - amount / extent * (middle - plot.top);
      path += (time - previous === 86400000 ? " L" : " M") + x + "," + y;
      previous = time;
      return <circle key={day.date} cx={x} cy={y} r="1.5" />;
    });
    if (!path) return null;
    return <g key={type} data-history-impact={type} className={styles.series}>
      <path d={path.trim()} fill="none" stroke="currentColor" strokeWidth="1.25" strokeDasharray={type === "fx" ? "4 4" : undefined} />
      {dots}
    </g>;
  })}</g>;
}

export function ImpactLegend({ chart, date, value, label }: { chart: ImpactContext; date: string; value: string; label: string }) {
  const day = chart.days.find(row => row.date === date);
  return <div className={styles.legend} aria-label={date + " 선택일 지표"}>
    <div><span>{label}</span><strong>{value}</strong></div>
    {impactTypes.map(type => {
      const amount = day?.[type];
      return <Button title="현재 보유 종목의 날짜별 변동액 · 원화 별도 축 · 모든 종목의 자료가 있는 날만 표시" key={type} type="button" variant="bare" data-impact={type}
        aria-pressed={chart.visible[type]} aria-label={impactNames[type] + " 일별 변동선"}
        onClick={() => chart.toggle(type)}>
        <span>{impactNames[type]} · 일별 <small>{chart.visible[type] ? "선 숨기기" : "선 보기"}</small></span>
        <strong>{amount == null ? "자료 없음" : amount.toLocaleString("ko-KR", { maximumFractionDigits: 0, signDisplay: "exceptZero" }) + "원"}</strong>
      </Button>;
    })}
    {(chart.visible.price || chart.visible.fx) && <p className={styles.basis}>현재 보유 종목의 일별 변동액 · 전 종목 확인일 기준. 평가액·수익률과 별도 눈금(원)으로 표시해요.</p>}
  </div>;
}
