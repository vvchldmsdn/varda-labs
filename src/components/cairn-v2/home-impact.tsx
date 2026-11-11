"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/cairn-ui";
import type { BetaHeatmapRead } from "@/lib/cairn-v2/heatmap-contract";
import { percentOrNull, sumComplete } from "@/lib/portfolio-math";
import { displayReadMoney, type BetaView } from "@/lib/cairn-v2/read-contract";
import type { BetaCurrency } from "@/lib/cairn-v2/navigation";
import styles from "./home-impact.module.css";

export const impactTypes = ["price", "fx"] as const;
export type ImpactType = typeof impactTypes[number];
export const impactNames = { price: "가격", fx: "환율" };
type DailyImpact = { date: string; value: number | null; price: number | null; fx: number | null };
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
    const sum = (field: "priceChangeKrw" | "fxChangeKrw" | "marketValueKrw") => sumComplete(history.rows, row => {
      const cell = row.cells[i];
      return cell?.date === date ? cell[field] : null;
    });
    return { date, value: sum("marketValueKrw"), price: sum("priceChangeKrw"), fx: sum("fxChangeKrw") };
  });
}

export function HomeImpactProvider({ read, children }: { read?: BetaHeatmapRead | null; children: ReactNode }) {
  const days = useMemo(() => recordedDays(read), [read]);
  const [visible, setVisible] = useState({ price: false, fx: false });
  return <Context.Provider value={{ days, visible, toggle: type => setVisible(prev => ({ ...prev, [type]: !prev[type] })) }}>{children}</Context.Provider>;
}

export type ImpactPlot = { start: string; end: string; x: (date: string) => number; top: number; bottom: number };


const dayMs = 86_400_000;
type Window = { start: string; end: string };
type Range = { date: string; from: number; via: number; to: number };

// A price-to-FX bridge only makes sense when the two effects explain the
// observed change for the same basket. Trades, scope changes and gaps can break it.
export function alignedRanges(days: DailyImpact[], rows: {date:string; valueKrw:number|null; segment?:string|number|null; valueSegment?:string|number|null}[]) {
  const byDate = new Map(days.map(day => [day.date, day]));
  const ranges: Range[] = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1], row = rows[i];
    const day = byDate.get(row.date), prior = byDate.get(prev.date);
    if (!day || (day.price === null && day.fx === null)) continue;
    const from = prev.valueKrw, to = row.valueKrw;
    if (from === null || to === null || prior?.value == null || day.value === null ||
        day.price === null || day.fx === null || Date.parse(row.date) - Date.parse(prev.date) !== dayMs ||
        (row.valueSegment ?? row.segment) !== (prev.valueSegment ?? prev.segment) ||
        Math.abs(from - prior.value) > 0.01 || Math.abs(to - day.value) > 0.01 ||
        Math.abs(to - from - day.price - day.fx) > 0.01) return [];
    ranges.push({ date: row.date, from, via: from + day.price, to });
  }
  const start = rows[0]?.date, end = rows.at(-1)?.date;
  const observed = days.filter(day => start && end && day.date > start && day.date <= end &&
    (day.price !== null || day.fx !== null));
  return observed.length === ranges.length ? ranges : [];
}

export function ImpactBars({ chart, plot, ranges, y }: {
  chart: ImpactContext; plot: ImpactPlot; ranges?: Range[]; y?: (value: number) => number;
}) {
  if (!chart.visible.price && !chart.visible.fx) return null;
  const days = chart.days.filter(day => day.date > plot.start && day.date <= plot.end);
  const aligned = !!ranges?.length && !!y;
  const extent = Math.max(1, ...days.flatMap(day => impactTypes.map(type => Math.abs(day[type] ?? 0))));
  const zero = plot.top + (plot.bottom - plot.top) * .78;
  const scale = (value: number) => zero - value / extent * (plot.bottom - plot.top) * .18;
  return <g pointerEvents="none" aria-hidden="true">
    {!aligned && days.some(day => impactTypes.some(type => chart.visible[type] && day[type] !== null)) &&
      <line x1={plot.x(plot.start)} x2={plot.x(plot.end)} y1={zero} y2={zero} stroke="currentColor" opacity=".2" strokeDasharray="2 4" />}
    {impactTypes.map(type => {
      if (!chart.visible[type]) return null;
      const bars = aligned ? ranges.map(r => ({date:r.date,
        start:y(type === "price" ? r.from : r.via), end:y(type === "price" ? r.via : r.to)})) :
        days.flatMap(day => day[type] === null ? [] : [{date:day.date, start:zero, end:scale(day[type])}]);
      if (!bars.length) return null;
      return <g key={type} data-history-impact={type} className={styles.series}>
        {bars.map(bar => <rect key={bar.date} x={plot.x(bar.date) - (type === "price" ? 3 : 0)}
          y={Math.min(bar.start, bar.end)} width="3" height={Math.max(1, Math.abs(bar.end - bar.start))} rx="1" />)}
      </g>;
    })}
  </g>;
}

export function periodImpact(days: DailyImpact[], window: Window, type: ImpactType) {
  const within = days.filter(day => day.date > window.start && day.date <= window.end);
  const count = (Date.parse(window.end) - Date.parse(window.start)) / dayMs;
  if (!count || within.length !== count || within.some((day,i) => Date.parse(day.date) !== Date.parse(window.start) + (i+1)*dayMs)) return null;
  return sumComplete(within, day => day[type]);
}

type LegendProps = {
  chart: ImpactContext; window: Window; view: BetaView; currency: BetaCurrency; returns: boolean;
  value: string; label: string; inspecting?: string; aligned?: boolean;
};

export function ImpactLegend({ chart, window, view, currency, returns, value, label, inspecting, aligned }: LegendProps) {
  const day = chart.days.find(row => row.date === inspecting);
  const base = chart.days.find(row => row.date === window.start)?.value ?? null;
  function display(amount: number | null) {
    if (returns) {
      const pct = percentOrNull(amount, base);
      return pct === null ? "자료 없음" : pct.toLocaleString("ko-KR",{signDisplay:"exceptZero",maximumFractionDigits:2})+"%p";
    }
    const money = displayReadMoney(view, amount, currency, true);
    return money === "—" ? "자료 없음" : money + (currency === "KRW" ? "원" : " USD");
  }
  const basis = returns ? "현재 보유 종목의 가격·환율 변동 · 기간 첫날 보유 평가액 대비 · 막대는 별도 눈금" :
    aligned ? "같은 보유 종목의 가격·환율 변동 · 평가액 눈금" : "현재 보유 종목의 일별 가격·환율 변동 · 막대는 별도 눈금";
  return <div className={styles.legend} aria-label={inspecting ? inspecting+" 선택일 지표" : "선택 기간 지표"}>
    <div><span>{label}</span><strong>{value}</strong></div>
    {impactTypes.map(type => <Button title={basis} key={type} type="button" variant="bare" data-impact={type}
      aria-pressed={chart.visible[type]} aria-label={impactNames[type] + " 일별 변동 막대"}
      onClick={() => chart.toggle(type)}>
      <span>{impactNames[type]} <small>{chart.visible[type] ? "막대 숨기기" : "막대 보기"}</small></span>
      <strong>{display(inspecting ? day?.[type] ?? null : periodImpact(chart.days, window, type))}</strong>
    </Button>)}
    {(chart.visible.price || chart.visible.fx) && <p className={styles.basis}>{basis}</p>}
  </div>;
}
