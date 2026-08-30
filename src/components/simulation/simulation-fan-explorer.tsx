"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AreaChart, ChartNoAxesCombined } from "lucide-react";
import { buildMonotoneCurvePath } from "@/lib/svg-monotone-curve";
import {
  nearestSimulationBand,
  resolveResearchFanChartValueDomain,
  simulationReturnLabel,
  type ResearchFanChartData,
  type ResearchFanChartValueDomain,
} from "./simulation-presentation";
import styles from "./simulation-workspace.module.css";

export function SimulationFanExplorer({
  execution,
  valueDomain,
  large = false,
}: {
  execution: ResearchFanChartData;
  valueDomain?: ResearchFanChartValueDomain;
  large?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const [width, setWidth] = useState(960);
  const [mode, setMode] = useState<"band" | "paths">(large ? "paths" : "band");
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [unit, setUnit] = useState<"index" | "return">("return");

  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  const height = large ? (width < 600 ? 340 : 430) : 280;
  const left = 52;
  const right = width - 16;
  const top = 20;
  const bottom = height - 35;
  const geometry = useMemo(() => {
    const domain =
      valueDomain ?? resolveResearchFanChartValueDomain([execution]);
    const spread = Math.max(domain.max - domain.min, 1);
    const min = domain.min - spread * 0.09;
    const max = domain.max + spread * 0.09;
    const x = (step: number) =>
      left +
      (step / Math.max(execution.assumptions.horizon, 1)) * (right - left);
    const y = (value: number) =>
      bottom - ((value - min) / (max - min)) * (bottom - top);
    const line = (key: "p10" | "p50" | "p90") =>
      buildMonotoneCurvePath(
        execution.bands.map((band) => ({
          x: x(band.stepIndex),
          y: y(band[key]),
        })),
      );
    // Straight band edges preserve percentile ordering between observed steps.
    const areaPoints = [
      ...execution.bands.map((band) => [x(band.stepIndex), y(band.p90)]),
      ...[...execution.bands]
        .reverse()
        .map((band) => [x(band.stepIndex), y(band.p10)]),
    ];
    const area =
      areaPoints
        .map(([px, py], index) => `${index ? "L" : "M"}${px},${py}`)
        .join(" ") + " Z";
    const paths = execution.samplePaths.map((path) => ({
      id: path.pathIndex,
      d: path.points
        .map(
          (point, index) =>
            `${index ? "L" : "M"}${x(point.stepIndex)},${y(point.indexValue)}`,
        )
        .join(" "),
    }));
    return {
      x,
      y,
      min,
      max,
      area,
      paths,
      median: line("p50"),
      lower: line("p10"),
      upper: line("p90"),
    };
  }, [execution, valueDomain, right, bottom]);
  const band =
    activeStep === null
      ? null
      : nearestSimulationBand(execution.bands, activeStep);
  const format = (value: number) =>
    unit === "return" ? simulationReturnLabel(value) : value.toFixed(1);
  const activeX = band ? geometry.x(band.stepIndex) : 0;
  const tooltipLeft = Math.max(
    8,
    Math.min(width - 192, activeX + (activeX > width * 0.65 ? -196 : 16)),
  );
  const axisSteps = width < 480 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];

  return (
    <figure
      className="min-w-0"
      data-research-fan-chart={execution.id}
      data-fan-mode={mode}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs">
        <div
          className="flex gap-1 rounded-md bg-[#edf0eb] p-1"
          role="group"
          aria-label="경로 표시"
        >
          {(
            [
              { key: "band", label: "분포 구간", icon: AreaChart },
              { key: "paths", label: "표본 경로", icon: ChartNoAxesCombined },
            ] as const
          ).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              aria-pressed={mode === key}
              onClick={() => setMode(key)}
              className={`flex min-h-8 items-center gap-2 rounded px-3 focus-visible:outline-2 focus-visible:outline-[#438574] ${mode === key ? "bg-[#fafbf8] text-[#263e32] shadow-sm" : "text-[#737c72] hover:text-[#263e32]"}`}
            >
              <Icon size={14} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        <div
          className="flex items-center gap-3"
          role="group"
          aria-label="차트 단위"
        >
          {(
            [
              { key: "return", label: "수익률" },
              { key: "index", label: "시작값 100" },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              aria-pressed={unit === key}
              onClick={() => setUnit(key)}
              className={`min-h-8 border-b focus-visible:outline-2 focus-visible:outline-[#438574] ${unit === key ? "border-[#294b3b] text-[#294b3b]" : "border-transparent text-[#7b8279]"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div ref={ref} className="relative w-full" style={{ height }}>
        {execution.bands.length ? (
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="block h-full w-full"
            role="img"
            aria-label={`${execution.name} 연구 시뮬레이션 경로와 P10 P50 P90 구간`}
          >
            <title>{`${execution.name} 확률 분포`}</title>
            <defs>
              <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#64a48c" stopOpacity="0.24" />
                <stop offset="100%" stopColor="#64a48c" stopOpacity="0.04" />
              </linearGradient>
            </defs>
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
              const value =
                geometry.min + (geometry.max - geometry.min) * ratio;
              return (
                <g key={ratio}>
                  <line
                    x1={left}
                    x2={right}
                    y1={geometry.y(value)}
                    y2={geometry.y(value)}
                    stroke="#e0e5dd"
                    strokeDasharray="2 6"
                  />
                  <text
                    x={left - 10}
                    y={geometry.y(value) + 4}
                    textAnchor="end"
                    fill="#849082"
                    fontSize="10"
                  >
                    {format(value)}
                  </text>
                </g>
              );
            })}
            <line
              x1={left}
              x2={right}
              y1={geometry.y(100)}
              y2={geometry.y(100)}
              stroke="#9aa99d"
              strokeDasharray="4 5"
            />
            <path
              d={geometry.area}
              fill={`url(#${id}-fill)`}
              opacity={mode === "band" ? 1 : 0.4}
            />
            {mode === "paths"
              ? geometry.paths.map((path) => (
                  <path
                    key={path.id}
                    d={path.d}
                    fill="none"
                    stroke={path.id % 3 === 0 ? "#929d86" : "#4b927f"}
                    strokeWidth="1"
                    opacity="0.35"
                  />
                ))
              : null}
            <path
              d={geometry.lower}
              fill="none"
              stroke="#8ea48e"
              strokeDasharray="4 5"
              strokeWidth="1"
            />
            <path
              d={geometry.upper}
              fill="none"
              stroke="#8ea48e"
              strokeDasharray="4 5"
              strokeWidth="1"
            />
            <path
              d={geometry.median}
              fill="none"
              stroke="#2d7663"
              strokeWidth="2.5"
            />
            {axisSteps.map((ratio) => (
              <text
                key={ratio}
                x={geometry.x(
                  Math.round(execution.assumptions.horizon * ratio),
                )}
                y={height - 10}
                fill="#849082"
                fontSize="10"
                textAnchor={
                  ratio === 0 ? "start" : ratio === 1 ? "end" : "middle"
                }
              >
                {ratio === 0
                  ? "현재"
                  : `${Math.round(execution.assumptions.horizon * ratio)}단계`}
              </text>
            ))}
            {band ? (
              <g pointerEvents="none">
                <line
                  x1={activeX}
                  x2={activeX}
                  y1={top}
                  y2={bottom}
                  stroke="#7b9f8f"
                  strokeDasharray="3 4"
                />
                {(["p10", "p50", "p90"] as const).map((key) => (
                  <circle
                    key={key}
                    cx={activeX}
                    cy={geometry.y(band[key])}
                    r={key === "p50" ? 4 : 3}
                    fill="#fafbf8"
                    stroke="#2d7663"
                    strokeWidth="1.5"
                  />
                ))}
              </g>
            ) : null}
            <rect
              x={left}
              y={top}
              width={Math.max(right - left, 0)}
              height={bottom - top}
              fill="transparent"
              onPointerMove={(event) => {
                const rect =
                  event.currentTarget.ownerSVGElement!.getBoundingClientRect();
                setActiveStep(
                  Math.max(
                    0,
                    Math.min(
                      execution.assumptions.horizon,
                      ((((event.clientX - rect.left) / rect.width) * width -
                        left) /
                        (right - left)) *
                        execution.assumptions.horizon,
                    ),
                  ),
                );
              }}
              onPointerLeave={() => setActiveStep(null)}
              onPointerCancel={() => setActiveStep(null)}
            />
          </svg>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[#798475]">
            표시할 확률 경로가 없습니다.
          </div>
        )}
        {band ? (
          <div
            role="tooltip"
            className="pointer-events-none absolute top-5 w-[184px] rounded-md border border-[#d6dfd4] bg-[#fafcf9]/95 p-3 text-xs shadow-lg"
            style={{ left: tooltipLeft }}
          >
            <p className="mb-2 border-b border-[#e0e6dc] pb-2 font-medium">
              {band.stepIndex === 0 ? "현재" : `${band.stepIndex}단계`}
            </p>
            <dl className="space-y-2">
              {(
                [
                  ["P90", band.p90],
                  ["P50 · 중앙값", band.p50],
                  ["P10", band.p10],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-[#798475]">{label}</dt>
                  <dd className="font-medium tabular-nums">{format(value)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-4">
        <input
          className={styles.scrubber}
          type="range"
          aria-label={`${execution.name} 경로 시점`}
          min={0}
          max={execution.assumptions.horizon}
          value={band?.stepIndex ?? execution.assumptions.horizon}
          onChange={(event) => setActiveStep(Number(event.target.value))}
          onFocus={() => setActiveStep(execution.assumptions.horizon)}
          onBlur={() => setActiveStep(null)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setActiveStep(null);
              event.currentTarget.blur();
            }
          }}
          aria-valuetext={
            band
              ? `${band.stepIndex}단계, 중앙값 ${format(band.p50)}`
              : `${execution.assumptions.horizon}단계`
          }
        />
        <span className="w-16 text-right text-[11px] tabular-nums text-[#798475]">
          {band?.stepIndex ?? execution.assumptions.horizon}단계
        </span>
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-5 gap-y-2 py-4 text-[11px] text-[#798475]">
        <span className="flex items-center gap-2">
          <i className="h-0.5 w-5 bg-[#2d7663]" />
          중앙값 P50
        </span>
        <span className="flex items-center gap-2">
          <i className="h-2.5 w-5 rounded-sm bg-[#cddfd2]" />
          P10~P90 · 모형 내 80% 구간
        </span>
        <span>
          표본 경로 {execution.samplePaths.length}개 · 연구 분포, 수익 보장 아님
        </span>
      </figcaption>
    </figure>
  );
}
