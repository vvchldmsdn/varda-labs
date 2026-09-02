"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import type {
  InvestmentLabScenarioChart,
  InvestmentLabScenarioChartLine,
} from "@/lib/investment-lab-scenario-chart";
import { buildMonotoneCurvePath } from "@/lib/svg-monotone-curve";
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
}: {
  chart: InvestmentLabScenarioChart;
  actual: InvestmentLabScenarioChartLine;
  selected: InvestmentLabScenarioChartLine;
  compact?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(920);
  const [hover, setHover] = useState<number | null>(null);
  const [keyboardIndex, setKeyboardIndex] = useState(0);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const id = useId();
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(240, entry.contentRect.width));
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  const height = compact ? (width < 550 ? 155 : 230) : width < 550 ? 310 : 365;
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
    hover ?? (keyboardFocus ? Math.min(keyboardIndex, dates.length - 1) : null);
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
  const tooltipWidth = Math.min(258, width - 12);
  const tooltipLeft = Math.min(
    Math.max(6, focusX + (focusX > width * 0.58 ? -tooltipWidth - 15 : 15)),
    width - tooltipWidth - 6,
  );

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
    <div className={compact ? "relative mt-2 w-full" : "relative mt-5 w-full"} ref={ref} data-lab-chart>
      <svg
        aria-label={`${labScenarioLabel(selected.id)}와 실제 포트폴리오 평가액 비교`}
        className="block w-full touch-pan-y"
        height={height}
        onPointerLeave={() => setHover(null)}
        onPointerMove={move}
        onPointerDown={move}
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <defs>
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
                {labCompactKrw(value)}
              </text>
            </g>
          );
        })}
        <g clipPath={`url(#${id}-plot)`}>
          {selected.id !== "actual" ? (
            <polygon points={area} fill="var(--brand)" opacity="0.075" />
          ) : null}
          <path
            d={actualPath}
            fill="none"
            stroke="var(--ink)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
          {selected.id !== "actual" ? (
            <path
              d={selectedPath}
              fill="none"
              stroke="var(--brand)"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.3"
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
              stroke="var(--faint)"
              strokeDasharray="3 5"
              x1={focusX}
              x2={focusX}
              y1={top}
              y2={bottom}
            />
            <circle
              cx={focusX}
              cy={y(actualPoint.valueKrw)}
              r="4"
              stroke="var(--ink)"
              strokeWidth="1.5"
              fill="var(--paper)"
            />
            <circle
              cx={focusX}
              cy={y(selectedPoint.valueKrw)}
              r="4"
              stroke="var(--brand)"
              strokeWidth="1.5"
              fill="var(--paper)"
            />
          </g>
        ) : null}
      </svg>
      {actualPoint && selectedPoint ? (
        <div
          className="pointer-events-none absolute top-3 rounded-md border border-[var(--line)] bg-[var(--surface)]/95 p-3 text-xs shadow-lg shadow-[var(--ink)]/5"
          data-lab-tooltip
          style={{ left: tooltipLeft, width: tooltipWidth }}
        >
          <p className="mb-2 border-b border-[var(--wash)] pb-2 font-medium tabular-nums">
            {actualPoint.serviceDate.replaceAll("-", ".")}
          </p>
          <dl className="space-y-2">
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--muted)]">실제 평가액</dt>
              <dd className="tabular-nums">{labKrw(actualPoint.valueKrw)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--brand)]">비교 평가액</dt>
              <dd className="tabular-nums text-[var(--brand)]">
                {labKrw(selectedPoint.valueKrw)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--muted)]">차이</dt>
              <dd
                className={`font-medium tabular-nums ${labMoneyTone(selectedPoint.valueKrw - actualPoint.valueKrw)}`}
              >
                {labKrw(selectedPoint.valueKrw - actualPoint.valueKrw, true)}
              </dd>
            </div>
          </dl>
          {selectedPoint.hasPendingExecution ? (
            <p className="mt-2 text-[11px] text-[var(--warning)]">
              이 평가일에는 대기 거래가 포함됩니다.
            </p>
          ) : null}
        </div>
      ) : null}
      <input
        aria-label="비교 그래프 날짜 탐색"
        aria-valuetext={`${dates[Math.min(keyboardIndex, dates.length - 1)]} 실제 ${labKrw(actual.points[Math.min(keyboardIndex, dates.length - 1)]?.valueKrw ?? null)} 비교 ${labKrw(selected.points[Math.min(keyboardIndex, dates.length - 1)]?.valueKrw ?? null)}`}
        className="absolute inset-x-0 bottom-0 h-3 w-full opacity-0 accent-[var(--brand)] focus:opacity-100"
        max={dates.length - 1}
        min={0}
        onBlur={() => setKeyboardFocus(false)}
        onChange={(event) => setKeyboardIndex(Number(event.target.value))}
        onFocus={() => setKeyboardFocus(true)}
        type="range"
        value={Math.min(keyboardIndex, dates.length - 1)}
      />
    </div>
  );
}
