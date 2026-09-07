"use client";

import { useId, useMemo, useRef, useState, type PointerEvent } from "react";
import { formatHistoryKrw, formatHistoryPercent } from "@/components/history/history-format";
import type { HistoryOverviewPoint } from "@/lib/history-overview";
import { historyPointMetric, historyPointsWithMetric, type HistoryExplorerMode } from "@/lib/history-explorer";
import { buildMonotoneCurvePath } from "@/lib/svg-monotone-curve";
import styles from "./history-modern.module.css";

const WIDTH = 960;
const HEIGHT = 360;
const LEFT = 12;
const RIGHT = 948;
const TOP = 26;
const BOTTOM = 324;

export function HistoryPerformanceChart({ mode, onSelect, onInspect, points, selectedDate }: {
  mode: HistoryExplorerMode;
  onSelect: (date: string) => void;
  onInspect?: (date: string | null) => void;
  points: readonly HistoryOverviewPoint[];
  selectedDate: string | null;
}) {
  const id = useId();
  const pathRef = useRef<SVGPathElement>(null);
  const displayPoints = useMemo(() => historyPointsWithMetric(points, mode), [mode, points]);
  const geometry = useMemo(() => buildGeometry(displayPoints, mode), [displayPoints, mode]);
  const [pointer, setPointer] = useState<{ x: number; y: number; index: number } | null>(null);
  const selectedIndex = Math.max(0, displayPoints.findIndex((point) => point.date === selectedDate));
  const marker = pointer ?? geometry.points[selectedIndex];
  const activeIndex = Math.min(pointer?.index ?? selectedIndex, displayPoints.length - 1);
  const activePoint = displayPoints[activeIndex];

  function inspect(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(LEFT, Math.min(RIGHT, ((event.clientX - bounds.left) / bounds.width) * WIDTH));
    let index = 0;
    for (let candidate = 1; candidate < geometry.points.length; candidate++) {
      if (Math.abs(geometry.points[candidate]!.x - x) < Math.abs(geometry.points[index]!.x - x)) index = candidate;
    }
    const observed = geometry.points[index];
    if (!observed) return;
    // The visual marker follows the curve; every displayed number remains a saved observation.
    let visual = observed;
    const path = pathRef.current;
    if (path && geometry.points.length > 1) {
      let low = 0;
      let high = path.getTotalLength();
      for (let iteration = 0; iteration < 16; iteration++) {
        const middle = (low + high) / 2;
        if (path.getPointAtLength(middle).x < x) low = middle;
        else high = middle;
      }
      visual = path.getPointAtLength((low + high) / 2);
    }
    setPointer({ x: visual.x, y: visual.y, index });
    onInspect?.(displayPoints[index]!.date);
  }

  function leave() { setPointer(null); onInspect?.(null); }

  if (!displayPoints.length) return (
    <div className="flex min-h-[320px] items-center justify-center border-y border-[var(--line)] text-center">
      <div className="max-w-md px-6"><p className="text-base font-semibold">저장된 수익률 근거가 없습니다.</p><p className="mt-2 text-sm leading-6 text-[var(--muted)]">평가액 보기를 선택하면 저장 평가액 경로는 계속 확인할 수 있습니다. 수익률을 임의 계산하거나 누락값을 보간하지 않습니다.</p></div>
    </div>
  );

  return (
    <div className={styles.chart} data-history-chart>
      <div className="varda-history-chart relative w-full">
        <svg role="img" aria-label={mode === "value" ? "저장된 날짜별 포트폴리오 평가액 흐름" : "저장된 날짜별 포트폴리오 수익률 흐름"}
          className="h-full w-full touch-pan-y overflow-visible" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none"
          onPointerMove={inspect} onPointerDown={inspect} onPointerLeave={leave} onPointerCancel={leave}
          onClick={() => { if (activePoint) onSelect(activePoint.date); }}>
          <defs>
            <pattern id={`${id}-dots`} width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r=".8" fill="var(--ink)" opacity=".16" /></pattern>
            <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="white" stopOpacity=".85" /><stop offset="1" stopColor="white" stopOpacity="0" /></linearGradient>
            <mask id={`${id}-mask`}><rect x="0" y="0" width={WIDTH} height={HEIGHT} fill={`url(#${id}-fade)`} /></mask>
          </defs>
          {[.25, .75].map((ratio) => <line key={ratio} x1={LEFT} x2={RIGHT} y1={TOP + (BOTTOM - TOP) * ratio} y2={TOP + (BOTTOM - TOP) * ratio} stroke="var(--line)" strokeDasharray="1 8" />)}
          {geometry.zeroY !== null ? <line x1={LEFT} x2={RIGHT} y1={geometry.zeroY} y2={geometry.zeroY} stroke="var(--faint)" strokeDasharray="4 6" /> : null}
          <path d={geometry.area} fill={`url(#${id}-dots)`} mask={`url(#${id}-mask)`} className={styles.chartWash} />
          <path key={`${mode}-${displayPoints[0]?.date}`} ref={pathRef} d={geometry.path} fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" className={styles.drawLine} />
          {marker ? <g pointerEvents="none">
            <line x1={marker.x} x2={marker.x} y1={marker.y + 12} y2={BOTTOM} stroke="var(--ink)" strokeOpacity=".18" strokeDasharray="2 5" />
            {pointer && geometry.points[activeIndex] ? <circle cx={geometry.points[activeIndex]!.x} cy={geometry.points[activeIndex]!.y} r="3" fill="var(--ink)" /> : null}
          </g> : null}
        </svg>
        {marker ? <span aria-hidden="true" className={styles.trackingDot} style={{ left: `${marker.x / WIDTH * 100}%`, top: `${marker.y / HEIGHT * 100}%` }} /> : null}
      </div>
      <div className={styles.chartFoot}>
        <span>{displayPoints[0]!.date.replaceAll("-", ".")}</span>
        <span className={styles.observationNote}>{pointer ? "가장 가까운 저장일의 값" : "날짜를 따라 탐색"}</span>
        <span>{displayPoints.at(-1)!.date.replaceAll("-", ".")}</span>
      </div>
      <input className={styles.chartKeyboard} type="range" min="0" max={displayPoints.length - 1} value={selectedIndex}
        aria-label="히스토리 그래프 날짜 탐색"
        aria-valuetext={`${displayPoints[selectedIndex]!.date} ${metricLabel(displayPoints[selectedIndex]!, mode)}`}
        onChange={(event) => { leave(); onSelect(displayPoints[Number(event.target.value)]!.date); }} />
    </div>
  );
}

function buildGeometry(points: readonly HistoryOverviewPoint[], mode: HistoryExplorerMode) {
  if (!points.length) return { points: [], path: "", area: "", zeroY: null };
  const values = points.map((point) => historyPointMetric(point, mode)!);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const padding = Math.max((maximum - minimum) * .13, Math.abs(maximum) * .012, mode === "value" ? 1 : .1);
  const min = minimum - padding;
  const max = maximum + padding;
  const first = Date.parse(`${points[0]!.date}T00:00:00Z`);
  const elapsed = Math.max(1, Date.parse(`${points.at(-1)!.date}T00:00:00Z`) - first);
  const y = (value: number) => BOTTOM - ((value - min) / (max - min)) * (BOTTOM - TOP);
  const chartPoints = points.map((point) => ({ x: points.length === 1 ? (LEFT + RIGHT) / 2 : LEFT + ((Date.parse(`${point.date}T00:00:00Z`) - first) / elapsed) * (RIGHT - LEFT), y: y(historyPointMetric(point, mode)!) }));
  const path = buildMonotoneCurvePath(chartPoints);
  return { points: chartPoints, path, area: `${path} L${chartPoints.at(-1)!.x},${BOTTOM} L${chartPoints[0]!.x},${BOTTOM} Z`, zeroY: mode === "return" && min <= 0 && max >= 0 ? y(0) : null };
}

function metricLabel(point: HistoryOverviewPoint, mode: HistoryExplorerMode) {
  return mode === "value" ? formatHistoryKrw(point.valueKrw) : formatHistoryPercent(point.totalReturnPct);
}
