"use client";

import { SimulationText, useSimulationText } from "@/components/simulation/simulation-text";


import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from "react";
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
  compact = false,
}: {
  execution: ResearchFanChartData;
  valueDomain?: ResearchFanChartValueDomain;
  large?: boolean;
  compact?: boolean;
}) {
  const pt = useSimulationText();
  const executionName = execution.id.startsWith("owner-") && execution.name === "내 포트폴리오"
    ? pt("내 포트폴리오", "My portfolio")
    : pt(execution.name);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const [width, setWidth] = useState(960);
  const [plotHeight, setPlotHeight] = useState(430);
  const [mode, setMode] = useState<"band" | "paths">("band");
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [unit, setUnit] = useState<"index" | "return">("return");
  const [hoveredPath, setHoveredPath] = useState<number | null>(null);
  const [selectedPath, setSelectedPath] = useState<number | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) { setWidth(entry.contentRect.width); setPlotHeight(Math.max(150, entry.contentRect.height)); }
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  const height = compact ? (width < 600 ? 150 : 160) : large ? plotHeight : 280;
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
    const halfArea = (upper: "p90" | "p50", lower: "p50" | "p10") => {
      const coordinates = [...execution.bands.map((band) => [x(band.stepIndex), y(band[upper])]), ...execution.bands.toReversed().map((band) => [x(band.stepIndex), y(band[lower])])];
      return coordinates.map(([px, py], index) => `${index ? "L" : "M"}${px},${py}`).join(" ") + " Z";
    };
    const paths = execution.samplePaths.map((path) => ({
      id: path.pathIndex,
      points: path.points.map((point) => ({ x: x(point.stepIndex), y: y(point.indexValue), step: point.stepIndex, value: point.indexValue })),
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
      upperArea: halfArea("p90", "p50"),
      lowerArea: halfArea("p50", "p10"),
      paths,
      median: line("p50"),
      lower: line("p10"),
      upper: line("p90"),
    };
  }, [execution, valueDomain, right, bottom]);
  const band = nearestSimulationBand(execution.bands, activeStep ?? execution.assumptions.horizon);
  const format = (value: number) =>
    unit === "return" ? simulationReturnLabel(value) : value.toFixed(1);
  const activeX = band ? geometry.x(band.stepIndex) : 0;
  const focusedPath = hoveredPath ?? selectedPath;
  const inspectedPath = mode === "paths" ? geometry.paths.find((path) => path.id === focusedPath) : null;
  const pathPoint = inspectedPath?.points.reduce<(typeof inspectedPath.points)[number] | undefined>((nearest, point) => !nearest || Math.abs(point.step - (band?.stepIndex ?? 0)) < Math.abs(nearest.step - (band?.stepIndex ?? 0)) ? point : nearest, undefined);
  const axisSteps = width < 480 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];

  function inspect(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - bounds.left) / bounds.width) * width;
    const py = ((event.clientY - bounds.top) / bounds.height) * height;
    const step = Math.max(0, Math.min(execution.assumptions.horizon, ((px - left) / (right - left)) * execution.assumptions.horizon));
    setActiveStep(step);
    if (mode !== "paths") return;
    let candidate: number | null = null;
    let distance = 24;
    for (const path of geometry.paths) {
      const point = path.points.reduce<(typeof path.points)[number] | undefined>((nearest, current) => !nearest || Math.abs(current.step - step) < Math.abs(nearest.step - step) ? current : nearest, undefined);
      if (point && Math.abs(point.y - py) < distance) { candidate = path.id; distance = Math.abs(point.y - py); }
    }
    setHoveredPath(candidate);
  }

  function leave() { setActiveStep(null); setHoveredPath(null); }

  return (
    <figure
      className={large ? styles.stageFan : "min-w-0"}
      data-research-fan-chart={execution.id}
      data-fan-mode={mode}
    >
      <div
        className={`${styles.fanControls} flex flex-wrap items-center justify-between gap-3 text-xs ${compact ? "py-1.5" : "py-3"}`}
      >
        <div
          className="flex gap-1"
          role="group"
          aria-label={pt("경로 표시")}
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
              className={`flex items-center gap-2 rounded-full px-4 focus-visible:outline-2 focus-visible:outline-[var(--brand)] ${compact ? "min-h-9" : "min-h-10"} ${mode === key ? "bg-[var(--ink)] text-[var(--paper)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}
            >
              <Icon size={14} aria-hidden="true" />
              <SimulationText ko={label} />
            </button>
          ))}
        </div>
        <div
          className="flex items-center gap-3"
          role="group"
          aria-label={pt("차트 단위")}
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
              className={`${compact ? "min-h-9" : "min-h-10"} border-b focus-visible:outline-2 focus-visible:outline-[var(--brand)] ${unit === key ? "border-[var(--ink)] text-[var(--ink)]" : "border-transparent text-[var(--faint)]"}`}
            >
              <SimulationText ko={label} />
            </button>
          ))}
        </div>
      </div>
      {band && !compact ? <div className={styles.fanReadout} data-fan-readout>
        <p><SimulationText ko={band.stepIndex === 0 ? "현재" : `${band.stepIndex}단계`} /><span><SimulationText ko={pathPoint && focusedPath !== null ? `표본 ${focusedPath + 1}${selectedPath === focusedPath ? " · 선택됨" : ""}` : "분포의 세 지점"} /></span></p>
        {pathPoint ? <strong>{format(pathPoint.value)}</strong> : <dl><div><dt>P10</dt><dd>{format(band.p10)}</dd></div><div><dt>P50</dt><dd>{format(band.p50)}</dd></div><div><dt>P90</dt><dd>{format(band.p90)}</dd></div></dl>}
      </div> : null}
      <div ref={ref} className={large ? styles.fanPlot : "relative w-full"} style={large ? undefined : { height }}>
        {execution.bands.length ? (
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="block h-full w-full touch-pan-y"
            role="img"
            onPointerMove={inspect}
            onPointerDown={inspect}
            onPointerLeave={leave}
            onPointerCancel={leave}
            onClick={() => { if (mode === "paths") setSelectedPath(hoveredPath === selectedPath ? null : hoveredPath); }}
            aria-label={pt(`${executionName} 연구 시뮬레이션 경로와 P10 P50 P90 구간`)}
          >
            <title>{pt(`${executionName} 확률 분포`)}</title>
            <defs>
              <pattern id={`${id}-dots`} width="8" height="8" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="var(--accent)" opacity=".48" /></pattern>
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
                    stroke="var(--wash)"
                    strokeDasharray="2 6"
                  />
                  <text
                    x={left - 10}
                    y={geometry.y(value) + 4}
                    textAnchor="end"
                    fill="var(--faint)"
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
              stroke="var(--faint)"
              strokeDasharray="4 5"
            />
            <g key={`${execution.id}-${mode}`} className={styles.fanReveal}>
            <path d={geometry.upperArea} fill="var(--accent)" opacity={mode === "band" ? ".09" : ".025"} />
            <path d={geometry.lowerArea} fill="var(--negative)" opacity={mode === "band" ? ".07" : ".025"} />
            <path d={geometry.area} fill={`url(#${id}-dots)`} opacity={mode === "band" ? 1 : .18} />
            {mode === "paths"
              ? geometry.paths.map((path) => (
                  <g key={path.id} className={styles.samplePath} opacity={focusedPath === null ? .65 : focusedPath === path.id ? 1 : .16}>
                    <path d={path.d} fill="none" stroke={focusedPath === path.id ? "var(--ink)" : "var(--faint)"} strokeWidth={focusedPath === path.id ? 1.8 : .6} opacity={focusedPath === path.id ? 1 : .45} />
                    {path.points.filter((_, index) => index % Math.max(1, Math.ceil(path.points.length / 28)) === 0 || index === path.points.length - 1).map((point) => <circle key={point.step} cx={point.x} cy={point.y} r={focusedPath === path.id ? 2.5 : 1.8} fill={focusedPath === path.id ? "var(--accent)" : "var(--ink)"} />)}
                  </g>
                ))
              : null}
            <path
              d={geometry.lower}
              fill="none"
              stroke="var(--faint)"
              strokeDasharray="4 5"
              strokeWidth="1"
            />
            <path
              d={geometry.upper}
              fill="none"
              stroke="var(--faint)"
              strokeDasharray="4 5"
              strokeWidth="1"
            />
            <path
              d={geometry.median}
              fill="none"
              stroke="var(--ink)"
              strokeWidth="2.8"
            />
            </g>
            {axisSteps.map((ratio) => (
              <text
                key={ratio}
                x={geometry.x(
                  Math.round(execution.assumptions.horizon * ratio),
                )}
                y={height - 10}
                fill="var(--faint)"
                fontSize="10"
                textAnchor={
                  ratio === 0 ? "start" : ratio === 1 ? "end" : "middle"
                }
              >
                <SimulationText ko={ratio === 0
                  ? "현재"
                  : `${Math.round(execution.assumptions.horizon * ratio)}단계`} />
              </text>
            ))}
            {band ? (
              <g pointerEvents="none">
                <line
                  x1={activeX}
                  x2={activeX}
                  y1={top}
                  y2={bottom}
                  stroke="var(--line)"
                  strokeDasharray="3 4"
                />
                {(["p10", "p50", "p90"] as const).map((key) => (
                  <circle
                    key={key}
                    cx={activeX}
                    cy={geometry.y(band[key])}
                    r={key === "p50" ? 5 : 3}
                    fill={key === "p50" ? "var(--accent)" : "var(--paper)"}
                    stroke={key === "p50" ? "var(--paper)" : "var(--faint)"}
                    strokeWidth="1.5"
                  />
                ))}
                {pathPoint ? <circle cx={pathPoint.x} cy={pathPoint.y} r="6" fill="var(--accent)" stroke="var(--paper)" strokeWidth="2" /> : null}
              </g>
            ) : null}
          </svg>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
            <SimulationText ko={"표시할 확률 경로가 없습니다."} />{" "}</div>
        )}
      </div>
      {mode === "paths" && !compact ? <div className={styles.pathChoices} aria-label={pt("표본 경로 선택")}>
        <span><SimulationText ko={"표본"} /></span>{geometry.paths.map((path) => <button key={path.id} type="button" aria-label={pt(`표본 경로 ${path.id + 1} 선택`)} aria-pressed={selectedPath === path.id} onClick={() => setSelectedPath(selectedPath === path.id ? null : path.id)}>{String(path.id + 1).padStart(2, "0")}</button>)}
      </div> : null}
      <div className="mt-2 flex items-center gap-4">
        <input
          className={styles.scrubber}
          type="range"
          aria-label={pt(`${executionName} 경로 시점`)}
          min={0}
          max={execution.assumptions.horizon}
          value={Math.round(activeStep ?? execution.assumptions.horizon)}
          onInput={(event) => setActiveStep(Number(event.currentTarget.value))}
          onChange={(event) => setActiveStep(Number(event.target.value))}
          onFocus={(event) => setActiveStep(Number(event.currentTarget.value))}
          onBlur={() => setActiveStep(null)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setActiveStep(null);
              event.currentTarget.blur();
            }
          }}
          aria-valuetext={pt(band
              ? `${band.stepIndex}단계, 중앙값 ${format(band.p50)}`
              : `${execution.assumptions.horizon}단계`)}
        />
        <span className="w-16 text-right text-[11px] tabular-nums text-[var(--muted)]">
          {band?.stepIndex ?? execution.assumptions.horizon}<SimulationText ko={"단계"} />{" "}</span>
      </div>
      {compact ? null : (
        <figcaption className="flex flex-wrap items-center gap-x-5 gap-y-2 py-4 text-[11px] text-[var(--muted)]">
          <span className="flex items-center gap-2">
            <i className="h-0.5 w-5 bg-[var(--ink)]" />
            <SimulationText ko={"중앙값 P50"} />{" "}</span>
          <span className="flex items-center gap-2">
            <i className="h-2.5 w-5 rounded-sm bg-[var(--line)]" />
            <SimulationText ko={"P10~P90 · 모형 내 80% 구간"} />{" "}</span>
          <span>
            <SimulationText ko={"표본 경로"} />{" "}{execution.samplePaths.length}<SimulationText ko={"개 · 연구 분포, 수익 보장 아님"} />{" "}</span>
        </figcaption>
      )}
    </figure>
  );
}
