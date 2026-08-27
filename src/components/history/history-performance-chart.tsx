"use client";

import { useMemo, useState } from "react";

import {
  formatHistoryKrw,
  formatHistoryPercent,
} from "@/components/history/history-format";
import type { HistoryOverviewPoint } from "@/lib/history-overview";
import {
  historyPointMetric,
  historyPointsWithMetric,
  type HistoryExplorerMode,
} from "@/lib/history-explorer";
import { buildMonotoneCurvePath } from "@/lib/svg-monotone-curve";

const CHART_WIDTH = 960;
const CHART_HEIGHT = 360;
const PLOT_TOP = 32;
const PLOT_BOTTOM = 304;
const PLOT_LEFT = 12;
const PLOT_RIGHT = 920;

export function HistoryPerformanceChart({
  mode,
  onSelect,
  points,
  selectedDate,
}: {
  mode: HistoryExplorerMode;
  onSelect: (date: string) => void;
  points: readonly HistoryOverviewPoint[];
  selectedDate: string | null;
}) {
  const displayPoints = useMemo(
    () => historyPointsWithMetric(points, mode),
    [mode, points],
  );
  const geometry = useMemo(
    () => buildGeometry(displayPoints, mode),
    [displayPoints, mode],
  );
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const hoveredIndex = displayPoints.findIndex(
    (point) => point.date === hoveredDate,
  );
  const hoveredPoint = hoveredIndex >= 0 ? displayPoints[hoveredIndex]! : null;
  const hoveredGeometry =
    hoveredIndex >= 0 ? geometry.points[hoveredIndex] ?? null : null;

  if (displayPoints.length === 0) {
    return (
      <div className="flex min-h-[360px] items-center justify-center border-y border-[#e1e4df] text-center">
        <div className="max-w-md px-6">
          <p className="text-base font-semibold">
            저장된 수익률 근거가 없습니다.
          </p>
          <p className="mt-2 text-sm leading-6 text-[#737970]">
            평가액 보기를 선택하면 저장 평가액 경로는 계속 확인할 수 있습니다.
            수익률을 임의 계산하거나 누락값을 보간하지 않습니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div
        className="relative aspect-[2.4/1] min-h-[350px] w-full"
        onPointerLeave={() => setHoveredDate(null)}
      >
        <svg
          role="img"
          aria-label={
            mode === "value"
              ? "저장된 날짜별 포트폴리오 평가액 흐름"
              : "저장된 날짜별 포트폴리오 수익률 흐름"
          }
          className="h-full w-full overflow-visible"
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          preserveAspectRatio="none"
        >
          {[0.25, 0.5, 0.75].map((fraction) => (
            <line
              key={fraction}
              x1={PLOT_LEFT}
              x2={PLOT_RIGHT}
              y1={PLOT_TOP + (PLOT_BOTTOM - PLOT_TOP) * fraction}
              y2={PLOT_TOP + (PLOT_BOTTOM - PLOT_TOP) * fraction}
              stroke="#e7eae5"
              strokeDasharray="2 8"
            />
          ))}
          {geometry.zeroY !== null ? (
            <line
              x1={PLOT_LEFT}
              x2={PLOT_RIGHT}
              y1={geometry.zeroY}
              y2={geometry.zeroY}
              stroke="#cfd4ce"
              strokeDasharray="4 6"
            />
          ) : null}
          <line
            x1={PLOT_LEFT}
            x2={PLOT_RIGHT}
            y1={PLOT_BOTTOM}
            y2={PLOT_BOTTOM}
            stroke="#d9ddd7"
          />
          {geometry.points.map((point, index) => (
            <rect
              key={`bar:${displayPoints[index]?.date}`}
              x={point.x - Math.max(1, geometry.barWidth / 2)}
              y={point.y + 8}
              width={geometry.barWidth}
              height={Math.max(0, PLOT_BOTTOM - point.y - 8)}
              fill="#e9ece8"
              opacity="0.58"
            />
          ))}
          <path
            d={geometry.path}
            fill="none"
            stroke={mode === "return" ? "#d66758" : "#25302a"}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          {geometry.points.map((point, index) => {
            const value = displayPoints[index];
            const previous = geometry.points[index - 1];
            const next = geometry.points[index + 1];
            if (!value) return null;
            const hitStart = previous ? (previous.x + point.x) / 2 : PLOT_LEFT;
            const hitEnd = next ? (point.x + next.x) / 2 : PLOT_RIGHT;
            const active = value.date === selectedDate;

            return (
              <g key={`point:${value.date}`}>
                {active ? (
                  <>
                    <line
                      x1={point.x}
                      x2={point.x}
                      y1={PLOT_TOP}
                      y2={PLOT_BOTTOM}
                      stroke="#74887e"
                      strokeDasharray="2 6"
                    />
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r="5"
                      fill="#f8faf7"
                      stroke={mode === "return" ? "#d66758" : "#347e62"}
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    />
                  </>
                ) : null}
                <rect
                  role="button"
                  tabIndex={0}
                  aria-label={`${formatDate(value.date)} ${metricLabel(mode)} ${formatMetric(value, mode)}`}
                  x={hitStart}
                  y={PLOT_TOP}
                  width={Math.max(1, hitEnd - hitStart)}
                  height={PLOT_BOTTOM - PLOT_TOP}
                  fill="transparent"
                  className="cursor-crosshair outline-none"
                  onClick={() => onSelect(value.date)}
                  onFocus={() => setHoveredDate(value.date)}
                  onBlur={() => setHoveredDate(null)}
                  onPointerDown={(event) => event.preventDefault()}
                  onPointerEnter={() => setHoveredDate(value.date)}
                />
              </g>
            );
          })}
        </svg>

        <ChartScale geometry={geometry} mode={mode} />
        {hoveredPoint && hoveredGeometry ? (
          <ChartTooltip
            geometry={hoveredGeometry}
            mode={mode}
            point={hoveredPoint}
          />
        ) : null}
      </div>
      <ChartDateLabels points={displayPoints} />
    </div>
  );
}

function ChartScale({
  geometry,
  mode,
}: {
  geometry: ReturnType<typeof buildGeometry>;
  mode: HistoryExplorerMode;
}) {
  return (
    <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-12 text-[10px] tabular-nums text-[#858a83] sm:block">
      <span className="absolute right-0 top-[7%]">
        {formatScaleValue(geometry.maxValue, mode)}
      </span>
      <span className="absolute right-0 top-[48%]">
        {formatScaleValue((geometry.maxValue + geometry.minValue) / 2, mode)}
      </span>
      <span className="absolute bottom-[12%] right-0">
        {formatScaleValue(geometry.minValue, mode)}
      </span>
    </div>
  );
}

function ChartTooltip({
  geometry,
  mode,
  point,
}: {
  geometry: { x: number; y: number };
  mode: HistoryExplorerMode;
  point: HistoryOverviewPoint;
}) {
  const left = Math.min(75, Math.max(2, (geometry.x / CHART_WIDTH) * 100));
  const top = Math.min(66, Math.max(3, (geometry.y / CHART_HEIGHT) * 100));

  return (
    <div
      className="pointer-events-none absolute z-10 min-w-48 border border-[#d8ddd7] bg-[#fbfcf9]/96 px-4 py-3 text-xs shadow-[0_12px_34px_rgba(36,43,38,0.12)] backdrop-blur-sm"
      style={{ left: `${left}%`, top: `${top}%` }}
    >
      <p className="font-semibold">{formatDate(point.date)}</p>
      <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 text-[#686f67]">
        <span>{metricLabel(mode)}</span>
        <span className="text-right font-medium text-[#20231f]">
          {formatMetric(point, mode)}
        </span>
        <span>평가액</span>
        <span className="text-right font-medium text-[#20231f]">
          {formatHistoryKrw(point.valueKrw)}
        </span>
        <span>이전 대비</span>
        <span className={`text-right font-medium ${tone(point.movementKrw)}`}>
          {formatSignedKrw(point.movementKrw)}
        </span>
      </div>
    </div>
  );
}

function ChartDateLabels({ points }: { points: readonly HistoryOverviewPoint[] }) {
  if (points.length === 0) return null;
  const indexes = [
    ...new Set([
      0,
      Math.floor((points.length - 1) / 3),
      Math.floor(((points.length - 1) * 2) / 3),
      points.length - 1,
    ]),
  ];
  return (
    <div className="mt-1 flex justify-between text-[11px] text-[#858a83]">
      {indexes.map((index) => (
        <span key={points[index]!.date}>{shortDate(points[index]!.date)}</span>
      ))}
    </div>
  );
}

function buildGeometry(
  points: readonly HistoryOverviewPoint[],
  mode: HistoryExplorerMode,
) {
  if (points.length === 0) {
    return {
      points: [],
      path: "",
      barWidth: 1,
      minValue: 0,
      maxValue: 0,
      zeroY: null,
    };
  }

  const values = points.map((point) => historyPointMetric(point, mode)!);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = Math.max(
    (rawMax - rawMin) * 0.16,
    Math.abs(rawMax) * 0.015,
    mode === "value" ? 1 : 0.1,
  );
  const minValue = rawMin - padding;
  const maxValue = rawMax + padding;
  const xStep =
    points.length > 1 ? (PLOT_RIGHT - PLOT_LEFT) / (points.length - 1) : 0;
  const chartPoints = points.map((point, index) => ({
    x:
      points.length === 1
        ? (PLOT_LEFT + PLOT_RIGHT) / 2
        : PLOT_LEFT + xStep * index,
    y:
      PLOT_BOTTOM -
      ((historyPointMetric(point, mode)! - minValue) /
        Math.max(maxValue - minValue, Number.EPSILON)) *
        (PLOT_BOTTOM - PLOT_TOP),
  }));

  return {
    points: chartPoints,
    path: buildMonotoneCurvePath(chartPoints),
    barWidth: Math.max(2, Math.min(8, xStep * 0.42 || 5)),
    minValue,
    maxValue,
    zeroY:
      mode === "return" && minValue <= 0 && maxValue >= 0
        ? PLOT_BOTTOM -
          ((0 - minValue) / Math.max(maxValue - minValue, Number.EPSILON)) *
            (PLOT_BOTTOM - PLOT_TOP)
        : null,
  };
}

function metricLabel(mode: HistoryExplorerMode) {
  return mode === "value" ? "평가액" : "저장 수익률";
}

function formatMetric(point: HistoryOverviewPoint, mode: HistoryExplorerMode) {
  return mode === "value"
    ? formatHistoryKrw(point.valueKrw)
    : formatSignedPercent(point.totalReturnPct);
}

function formatScaleValue(value: number, mode: HistoryExplorerMode) {
  if (mode === "return") return formatHistoryPercent(value);
  if (Math.abs(value) >= 100_000_000) return `${Math.round(value / 100_000_000)}억`;
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 10_000)}만`;
  return formatHistoryKrw(value);
}

function tone(value: number | null) {
  if (value === null || value === 0) return "text-[#20231f]";
  return value > 0 ? "text-[#347e62]" : "text-[#cb5551]";
}

function formatSignedKrw(value: number | null) {
  if (value === null) return "기록 없음";
  if (value === 0) return "₩0";
  return `${value > 0 ? "+" : "-"}${formatHistoryKrw(Math.abs(value))}`;
}

function formatSignedPercent(value: number | null) {
  if (value === null) return "기록 없음";
  const formatted = formatHistoryPercent(Math.abs(value));
  if (value === 0) return formatted;
  return `${value > 0 ? "+" : "-"}${formatted}`;
}

function formatDate(value: string) {
  return value.replaceAll("-", ".");
}

function shortDate(value: string) {
  return value.slice(5).replace("-", ".");
}
