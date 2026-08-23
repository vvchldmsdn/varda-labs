"use client";

import { useMemo, useState } from "react";

import {
  formatDate,
  formatKrw,
  formatPercent,
  formatShortDate,
} from "@/components/home/portfolio-format";
import type { TodayHoldingHistoryPoint } from "@/lib/today-movement-view";
import { buildMonotoneCurvePath } from "@/lib/svg-monotone-curve";

const WIDTH = 900;
const HEIGHT = 250;
const PLOT_LEFT = 18;
const PLOT_RIGHT = 882;
const PLOT_TOP = 30;
const PLOT_BOTTOM = 198;

export function SelectedHoldingHistoryChart({
  currency,
  name,
  points,
}: {
  currency: string;
  name: string;
  points: readonly TodayHoldingHistoryPoint[];
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const geometry = useMemo(() => buildChartGeometry(points), [points]);
  const activePoint = activeIndex === null ? null : points[activeIndex] ?? null;
  const activeGeometry = activeIndex === null ? null : geometry.points[activeIndex] ?? null;
  const basis = points[0]?.basis ?? null;
  const firstDate = points[0]?.date;
  const lastDate = points.at(-1)?.date;

  return (
    <div className="border-t border-[#e0e3de] py-6">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
        <div>
          <p className="text-[11px] font-medium text-[#7b8079]">HOLDING HISTORY</p>
          <h3 className="mt-1 text-base font-medium">
            {basis === "normalized_return" ? "종목 흐름" : "평가액 흐름"}
          </h3>
        </div>
        <p className="text-xs text-[#777d75]">
          {basis === "normalized_return"
            ? "저장된 일별 등락률 복리 지수 · 시작=100"
            : "저장된 일일 포지션 평가액 · 최대 31일"}
        </p>
      </div>

      {points.length > 1 ? (
        <div
          className="relative mt-5 aspect-[3.8/1] min-h-[220px] w-full"
          onPointerLeave={() => setActiveIndex(null)}
        >
          <svg
            aria-label={`${name} 평가액 이력`}
            className="h-full w-full overflow-visible"
            preserveAspectRatio="none"
            role="img"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          >
            {[0, 0.5, 1].map((fraction) => {
              const y = PLOT_TOP + (PLOT_BOTTOM - PLOT_TOP) * fraction;
              return (
                <line
                  key={fraction}
                  stroke="#e5e8e3"
                  strokeDasharray={fraction === 1 ? undefined : "2 7"}
                  x1={PLOT_LEFT}
                  x2={PLOT_RIGHT}
                  y1={y}
                  y2={y}
                />
              );
            })}

            <path
              d={`${geometry.areaPath} Z`}
              fill="#e7f0eb"
              opacity="0.72"
            />
            <path
              d={geometry.path}
              fill="none"
              stroke="#315f4e"
              strokeWidth="1.75"
              vectorEffect="non-scaling-stroke"
            />

            {activeGeometry ? (
              <g>
                <line
                  stroke="#5d8273"
                  strokeDasharray="2 5"
                  x1={activeGeometry.x}
                  x2={activeGeometry.x}
                  y1={PLOT_TOP}
                  y2={PLOT_BOTTOM}
                />
                <circle
                  cx={activeGeometry.x}
                  cy={activeGeometry.y}
                  fill="#f7f8f5"
                  r="5"
                  stroke="#315f4e"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            ) : null}

            {geometry.points.map((point, index) => {
              const previous = geometry.points[index - 1];
              const next = geometry.points[index + 1];
              const hitStart = previous ? (previous.x + point.x) / 2 : PLOT_LEFT;
              const hitEnd = next ? (point.x + next.x) / 2 : PLOT_RIGHT;

              return (
                <rect
                  key={points[index]?.date}
                  aria-label={`${formatDate(points[index]?.date ?? null)} ${formatChartValue(points[index] ?? null)}`}
                  className="outline-none"
                  fill="transparent"
                  height={PLOT_BOTTOM - PLOT_TOP}
                  onBlur={() => setActiveIndex(null)}
                  onFocus={() => setActiveIndex(index)}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    setActiveIndex(index);
                  }}
                  onPointerEnter={() => setActiveIndex(index)}
                  role="button"
                  style={{ outline: "none" }}
                  tabIndex={0}
                  width={Math.max(1, hitEnd - hitStart)}
                  x={hitStart}
                  y={PLOT_TOP}
                />
              );
            })}
          </svg>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between text-[11px] text-[#7a8078]">
            <span>{firstDate ? formatShortDate(firstDate) : "-"}</span>
            <span>{lastDate ? formatShortDate(lastDate) : "-"}</span>
          </div>

          {activePoint && activeGeometry ? (
            <div
              className="pointer-events-none absolute top-1 z-10 w-44 -translate-x-1/2 border border-[#d7dcd5] bg-[#fbfcf9] px-4 py-3 text-xs shadow-[0_12px_30px_rgba(35,43,37,0.10)]"
              style={{ left: `${clamp((activeGeometry.x / WIDTH) * 100, 10, 90)}%` }}
            >
              <p className="font-medium text-[#252925]">{formatDate(activePoint.date)}</p>
              <div className="mt-2 flex items-baseline justify-between gap-3">
                <span className="text-[#737971]">
                  {activePoint.basis === "market_value" ? "평가액" : "누적 지수"}
                </span>
                <span className="font-medium text-[#252925]">{formatChartValue(activePoint)}</span>
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-3">
                <span className="text-[#737971]">일일 변동</span>
                <span className="font-medium text-[#252925]">{formatPercent(activePoint.changePct, true)}</span>
              </div>
              <p className="mt-2 text-[10px] text-[#8a8f88]">
                {activePoint.basis === "market_value"
                  ? `${currency} 보유 평가액의 KRW 환산 근거`
                  : "저장된 일별 변동률을 연결한 비교 지수"}
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-5 grid min-h-40 place-items-center border-y border-[#e5e8e3] text-center">
          <div>
            <p className="text-sm font-medium text-[#4b514b]">차트를 그릴 이력이 부족합니다.</p>
            <p className="mt-1 text-xs text-[#7a8078]">일일 포지션 스냅샷이 2개 이상 쌓이면 표시됩니다.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function buildChartGeometry(points: readonly TodayHoldingHistoryPoint[]) {
  if (points.length === 0) {
    return { areaPath: "", path: "", points: [] as readonly { x: number; y: number }[] };
  }

  const values = points.map((point) => point.chartValue);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const spread = rawMax - rawMin || Math.max(Math.abs(rawMax) * 0.02, 1);
  const min = rawMin - spread * 0.08;
  const max = rawMax + spread * 0.08;
  const width = PLOT_RIGHT - PLOT_LEFT;
  const height = PLOT_BOTTOM - PLOT_TOP;
  const chartPoints = points.map((point, index) => ({
    x: PLOT_LEFT + (index / Math.max(points.length - 1, 1)) * width,
    y: PLOT_TOP + ((max - point.chartValue) / (max - min)) * height,
  }));
  const path = buildMonotoneCurvePath(chartPoints);

  return {
    areaPath: `${path} L${chartPoints.at(-1)?.x ?? PLOT_RIGHT},${PLOT_BOTTOM} L${chartPoints[0]?.x ?? PLOT_LEFT},${PLOT_BOTTOM}`,
    path,
    points: chartPoints,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatChartValue(point: TodayHoldingHistoryPoint | null) {
  if (!point) return "-";
  if (point.basis === "market_value") return formatKrw(point.marketValueKrw);
  return point.chartValue.toFixed(2);
}
