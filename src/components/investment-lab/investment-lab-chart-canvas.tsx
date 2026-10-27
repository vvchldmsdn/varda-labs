"use client";

import { LabText, useLabI18n } from "./lab-text";
import { labEnglish } from "./lab-copy";
import { LocalizedElement } from "@/components/i18n/localized-element";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import type {
  InvestmentLabScenarioChart,
  InvestmentLabScenarioChartLine,
} from "@/lib/investment-lab-scenario-chart";
import { buildMonotoneCurvePath } from "@/lib/svg-monotone-curve";
import styles from "./investment-lab-modern.module.css";
import {
  labCompactKrw,
  labKrw,
  labMoneyTone,
  labScenarioLabel,
  labValueDomain,
  nearestLabDateIndex,
} from "./investment-lab-chart-presentation";

export function InvestmentLabChartCanvas({
  chart,
  actual,
  selected,
  compact = false,
  sidebar,
  sample = false,
}: {
  chart: InvestmentLabScenarioChart;
  actual: InvestmentLabScenarioChartLine;
  selected: InvestmentLabScenarioChartLine;
  compact?: boolean;
  sidebar?: ReactNode;
  sample?: boolean;
}) {
  const { locale } = useLabI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(920);
  const [plotHeight, setPlotHeight] = useState(370);
  const [hover, setHover] = useState<number | null>(null);
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);
  const id = useId();
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) { setWidth(Math.max(180, entry.contentRect.width)); setPlotHeight(Math.max(160, entry.contentRect.height)); }
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  const height = compact ? (width < 550 ? 155 : 230) : plotHeight;
  const left = width < 550 ? 42 : 54;
  const right = 12;
  const top = 24;
  const bottom = height - 40;
  const domain = useMemo(() => labValueDomain(chart.lines), [chart.lines]);
  const { dates, firstTime, timeRange, x, y, actualPath, selectedPath, area } =
    useMemo(() => {
      const dates = actual.points.map((point) => point.serviceDate);
      const firstTime = Date.parse(`${dates[0]}T00:00:00Z`);
      const lastTime = Date.parse(`${dates.at(-1)}T00:00:00Z`);
      const timeRange = Math.max(1, lastTime - firstTime);
      const x = (date: string) =>
        left +
        ((Date.parse(`${date}T00:00:00Z`) - firstTime) / timeRange) *
          (width - left - right);
      const y = (value: number) =>
        bottom -
        ((value - domain.minimum) / (domain.maximum - domain.minimum)) *
          (bottom - top);
      const actualCoordinates = actual.points.map((point) => ({
        x: x(point.serviceDate),
        y: y(point.valueKrw),
      }));
      const selectedCoordinates = selected.points.map((point) => ({
        x: x(point.serviceDate),
        y: y(point.valueKrw),
      }));
      return {
        dates,
        firstTime,
        timeRange,
        x,
        y,
        actualPath: buildMonotoneCurvePath(actualCoordinates),
        selectedPath: buildMonotoneCurvePath(selectedCoordinates),
        area: [...selectedCoordinates, ...actualCoordinates.toReversed()]
          .map((point) => `${point.x},${point.y}`)
          .join(" "),
      };
    }, [actual.points, selected.points, width, left, bottom, domain]);
  const focusIndex =
    Math.max(0, Math.min(hover ?? pinnedIndex ?? dates.length - 1, dates.length - 1));
  const actualPoint = focusIndex === null ? null : actual.points[focusIndex];
  const selectedPoint =
    focusIndex === null ? null : selected.points[focusIndex];
  const axisCount = width < 550 ? 3 : 5;
  const ticks = [
    ...new Set(
      Array.from({ length: axisCount }, (_, index) =>
        Math.round((index / (axisCount - 1)) * (dates.length - 1)),
      ),
    ),
  ];
  const focusX = actualPoint ? x(actualPoint.serviceDate) : 0;

  function move(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const position = ((event.clientX - rect.left) / rect.width) * width;
    const ratio = Math.max(
      0,
      Math.min(1, (position - left) / (width - left - right)),
    );
    setHover(nearestLabDateIndex(dates, firstTime + ratio * timeRange));
  }

  return (
    <div className={compact ? styles.compactCanvas : styles.chartCanvas} data-lab-chart>
      <aside className={styles.chartRail}>
        {sidebar}
      {actualPoint && selectedPoint ? (
        <div className={styles.chartReadout} data-lab-tooltip>
          <div><p>{actualPoint.serviceDate.replaceAll("-", ".")}<span><LabText value={hover === null && pinnedIndex === null ? "종료일의 차이" : "선택일의 차이"} /></span></p><strong className={labMoneyTone(selectedPoint.valueKrw - actualPoint.valueKrw)}>{labKrw(selectedPoint.valueKrw - actualPoint.valueKrw, true)}</strong></div>
          <dl><div><dt><LabText value={sample ? "샘플 보유" : "실제"} /></dt><dd>{labKrw(actualPoint.valueKrw)}</dd></div><div><dt><LabText value={sample ? "비교 전략" : "가상"} /></dt><dd>{labKrw(selectedPoint.valueKrw)}</dd></div></dl>
          {selectedPoint.hasPendingExecution ? <p className="text-[11px] text-[var(--warning)]"><LabText value="이 평가일에는 대기 거래가 포함됩니다." /></p> : null}
        </div>
      ) : null}
      </aside>
      <div className={styles.chartPlot} ref={ref}>
      <LocalizedElement as="svg"
        aria-label={`${labScenarioLabel(selected.id)}와 ${sample ? "샘플" : "실제"} 포트폴리오 평가액 비교`}
        className="block h-full w-full touch-pan-y"
        height={height}
        onPointerLeave={() => setHover(null)}
        onPointerMove={move}
        onPointerDown={move}
        onClick={() => setPinnedIndex(hover)}
        role="img"
        viewBox={`0 0 ${width} ${height}`} en={{"aria-label": sample ? "Sample portfolio and example strategy comparison" : labEnglish(`${labScenarioLabel(selected.id)}와 실제 포트폴리오 평가액 비교`)}}
      >
        <defs>
          <pattern id={`${id}-dots`} width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".75" fill="var(--accent)" opacity=".32" /></pattern>
          <clipPath id={`${id}-plot`}>
            <rect
              x={left - 1}
              y={top - 1}
              width={width - left - right + 2}
              height={bottom - top + 2}
            />
          </clipPath>
        </defs>
        {Array.from({ length: 4 }, (_, index) => {
          const value =
            domain.minimum + ((domain.maximum - domain.minimum) * index) / 3;
          const lineY = y(value);
          return (
            <g key={index}>
              <line
                stroke="var(--wash)"
                strokeDasharray="3 6"
                x1={left}
                x2={width - right}
                y1={lineY}
                y2={lineY}
              />
              <text
                fill="var(--faint)"
                fontSize="10"
                textAnchor="end"
                x={left - 10}
                y={lineY + 3}
              >
                {labCompactKrw(value, locale)}
              </text>
            </g>
          );
        })}
        <g clipPath={`url(#${id}-plot)`}>
          {selected.id !== "actual" ? (
            <polygon key={`area-${selected.id}`} points={area} fill={`url(#${id}-dots)`} className={styles.chartReveal} />
          ) : null}
          <path
            d={actualPath}
            fill="none"
            stroke="var(--ink)"
            className={styles.drawLine}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.6"
          />
          {selected.id !== "actual" ? (
            <path
              key={selected.id}
              d={selectedPath}
              fill="none"
              stroke="var(--accent)"
              className={styles.drawLine}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="3"
            />
          ) : null}
        </g>
        {ticks.map((index) => (
          <text
            fill="var(--faint)"
            fontSize="10"
            key={index}
            textAnchor={
              index === 0
                ? "start"
                : index === dates.length - 1
                  ? "end"
                  : "middle"
            }
            x={x(dates[index]!)}
            y={height - 14}
          >
            {dates[index]!.slice(5).replace("-", ".")}
          </text>
        ))}
        {actualPoint && selectedPoint ? (
          <g>
            <line
              stroke="var(--line)"
              strokeDasharray="3 5"
              x1={focusX}
              x2={focusX}
              y1={top}
              y2={bottom}
            />
            <line stroke="var(--accent)" strokeWidth="2" x1={focusX} x2={focusX} y1={y(actualPoint.valueKrw)} y2={y(selectedPoint.valueKrw)} />
            <circle
              cx={focusX}
              cy={y(actualPoint.valueKrw)}
              r="5"
              stroke="var(--ink)"
              strokeWidth="1.5"
              fill="var(--ink)"
            />
            <circle
              cx={focusX}
              cy={y(selectedPoint.valueKrw)}
              r="6"
              stroke="var(--paper)"
              strokeWidth="2.5"
              fill="var(--accent)"
            />
          </g>
        ) : null}
      </LocalizedElement>
      <LocalizedElement as="input"
        aria-label="비교 그래프 날짜 탐색"
        aria-valuetext={`${dates[focusIndex]} 실제 ${labKrw(actualPoint?.valueKrw ?? null)} 비교 ${labKrw(selectedPoint?.valueKrw ?? null)}`}
        className="absolute inset-x-0 bottom-0 h-3 w-full opacity-0 accent-[var(--brand)] focus:opacity-100"
        max={dates.length - 1}
        min={0}
        onChange={(event) => { setHover(null); setPinnedIndex(Number(event.target.value)); }}
        type="range"
        value={focusIndex} en={{"aria-label": labEnglish("비교 그래프 날짜 탐색"), "aria-valuetext": labEnglish(`${dates[focusIndex]} 실제 ${labKrw(actualPoint?.valueKrw ?? null)} 비교 ${labKrw(selectedPoint?.valueKrw ?? null)}`)}}
      />
      </div>
    </div>
  );
}
