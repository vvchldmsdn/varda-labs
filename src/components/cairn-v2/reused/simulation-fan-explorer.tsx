"use client";
import { Button as CairnButton, Field as CairnField, Input as CairnInput } from "@/components/cairn-ui";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { AreaChart, ChartNoAxesCombined, ChevronLeft, ChevronRight, X } from "./icons";
import { buildMonotoneCurvePath } from "./svg-monotone-curve";
import { nearestSimulationBand, forEachSimulationFanPathPoint, nearestSimulationFanPath, nearestSimulationFanPathPoint, resolveResearchFanChartValueDomain, resolveSimulationFanPathSource, simulationFanPathCount, simulationFanPathIdentity, simulationReturnLabel, type ResearchFanChartData, type ResearchFanChartValueDomain, } from "./simulation-presentation";
import styles from "./simulation-fan.module.css";
import chartStyles from "./simulation-path-chart.module.css";
import { SimulationPathCanvas } from "./simulation-path-canvas";
export function SimulationFanExplorer({ execution, valueDomain, large = false, compact = false, preview = false, initialMode, }: {
    execution: ResearchFanChartData;
    valueDomain?: ResearchFanChartValueDomain;
    large?: boolean;
    compact?: boolean;
    /** Home-only graph surface. The full explorer remains unchanged. */
    preview?: boolean;
    /** A display preference only; no research or data fetch follows mode changes. */
    initialMode?: "band" | "paths";
}) {
    const executionName = execution.id.startsWith("owner-") && execution.name === "내 포트폴리오"
        ? "내 포트폴리오"
        : execution.name;
    const ref = useRef<HTMLDivElement>(null);
    const source = useMemo(() => resolveSimulationFanPathSource(execution), [execution]);
    const pathCount = simulationFanPathCount(source);
    const [width, setWidth] = useState(960);
    const [plotHeight, setPlotHeight] = useState(430);
    const [mode, setMode] = useState<"band" | "paths">(initialMode ?? (source.kind === "all" ? "paths" : "band"));
    const [activeStep, setActiveStep] = useState<number | null>(null);
    const [unit, setUnit] = useState<"index" | "return">("index");
    const [hoveredPath, setHoveredPath] = useState<number | null>(null);
    const [selectedPath, setSelectedPath] = useState<number | null>(null);
    const [selectedStep, setSelectedStep] = useState<number | null>(null);
    useEffect(() => {
        if (!ref.current)
            return;
        const observer = new ResizeObserver(([entry]) => {
            if (entry.contentRect.width > 0) {
                setWidth(entry.contentRect.width);
                setPlotHeight(Math.max(preview ? 90 : 150, entry.contentRect.height));
            }
        });
        observer.observe(ref.current);
        return () => observer.disconnect();
    }, [preview]);
    const height = preview ? Math.max(90,plotHeight) : compact ? (width < 600 ? 150 : 160) : large ? plotHeight : 280;
    const left = 52;
    const right = width - 16;
    const top = 20;
    const bottom = height - 35;
    const geometry = useMemo(() => {
        const ownDomain = resolveResearchFanChartValueDomain([execution]);
        // A supplied comparison domain may extend the view, but must not clip complete paths.
        const domain = valueDomain ? { min: Math.min(ownDomain.min, valueDomain.min), max: Math.max(ownDomain.max, valueDomain.max) } : ownDomain;
        const spread = Math.max(domain.max - domain.min, 1);
        const min = domain.min - spread * 0.09;
        const max = domain.max + spread * 0.09;
        const x = (step: number) => left +
            (step / Math.max(execution.assumptions.horizon, 1)) * (right - left);
        const y = (value: number) => bottom - ((value - min) / (max - min)) * (bottom - top);
        const line = (key: "p10" | "p50" | "p90") => buildMonotoneCurvePath(execution.bands.map((band) => ({
            x: x(band.stepIndex),
            y: y(band[key]),
        })));
        // Straight band edges preserve percentile ordering between observed steps.
        const halfArea = (upper: "p90" | "p50", lower: "p50" | "p10") => {
            const coordinates = [...execution.bands.map((band) => [x(band.stepIndex), y(band[upper])]), ...execution.bands.toReversed().map((band) => [x(band.stepIndex), y(band[lower])])];
            return coordinates.map(([px, py], index) => `${index ? "L" : "M"}${px},${py}`).join(" ") + " Z";
        };
        return {
            x,
            y,
            min,
            max,
            upperArea: halfArea("p90", "p50"),
            lowerArea: halfArea("p50", "p10"),
            median: line("p50"),
            lower: line("p10"),
            upper: line("p90"),
        };
    }, [execution, valueDomain, right, bottom]);
    const band = nearestSimulationBand(execution.bands, activeStep ?? execution.assumptions.horizon);
    const format = (value: number) => unit === "return" ? simulationReturnLabel(value) : value.toFixed(1);
    const pathSelection = hoveredPath ?? selectedPath;
    const focusedPath = mode === "paths" && pathSelection !== null && pathSelection < pathCount ? pathSelection : null;
    const pathPoint = focusedPath === null ? null : nearestSimulationFanPathPoint(source, focusedPath, activeStep ?? execution.assumptions.horizon);
    const displayedStep = pathPoint?.stepIndex ?? band?.stepIndex ?? execution.assumptions.horizon;
    const activeX = geometry.x(displayedStep);
    const focusedIdentity = focusedPath === null ? null : simulationFanPathIdentity(source, focusedPath);
    const selectedLine = useMemo(() => {
        if (focusedPath === null)
            return null;
        const points: string[] = [];
        forEachSimulationFanPathPoint(source, focusedPath, (step, value) => points.push(`${points.length ? "L" : "M"}${geometry.x(step)},${geometry.y(value)}`));
        return points.join(" ");
    }, [source, focusedPath, geometry]);
    const axisSteps = width < 480 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
    function inspect(event: PointerEvent<SVGSVGElement>) {
        const bounds = event.currentTarget.getBoundingClientRect();
        const px = ((event.clientX - bounds.left) / bounds.width) * width;
        const py = ((event.clientY - bounds.top) / bounds.height) * height;
        const step = Math.max(0, Math.min(execution.assumptions.horizon, ((px - left) / (right - left)) * execution.assumptions.horizon));
        setActiveStep(step);
        if (mode !== "paths")
            return null;
        const candidate = nearestSimulationFanPath(source, step, py, geometry.y);
        setHoveredPath(candidate);
        return candidate;
    }
    function leave() { setActiveStep(selectedPath === null ? null : selectedStep); setHoveredPath(null); }
    function inspectStep(step: number) { setActiveStep(step); if (selectedPath !== null)
        setSelectedStep(step); }
    function selectPath(path: number | null) {
        setSelectedStep(path === null ? null : Math.round(activeStep ?? execution.assumptions.horizon));
        setHoveredPath(null);
        setSelectedPath(path === null ? null : Math.max(0, Math.min(pathCount - 1, path)));
    }
    function inspectWithKeyboard(event: KeyboardEvent<SVGSVGElement>) {
        const step = Math.round(activeStep ?? execution.assumptions.horizon);
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            setHoveredPath(null);
            inspectStep(Math.max(0, Math.min(execution.assumptions.horizon, step + (event.key === "ArrowRight" ? 1 : -1))));
        }
        else if (mode === "paths" && pathCount && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
            event.preventDefault();
            selectPath(selectedPath === null ? 0 : selectedPath + (event.key === "ArrowDown" ? 1 : -1));
        }
        else if (event.key === "Escape") {
            leave();
            setSelectedPath(null);
            setSelectedStep(null);
            setActiveStep(null);
        }
    }
    return (<div className={styles.surface} data-preview={preview || undefined}>
    <figure className={`${large ? styles.stageFan : "min-w-0"}`} data-research-fan-chart={execution.id} data-fan-mode={mode} data-fan-path-coverage={source.kind}>
      {!preview && <div className={styles.fanControls} aria-label="그래프 표시 설정">
        <div className={styles.tabs} role="group" aria-label={"경로 표시"}>
          {([
            { key: "paths", label: source.kind === "all" ? "전체 경로" : "표본 경로", en: source.kind === "all" ? "All paths" : "Sample paths", icon: ChartNoAxesCombined },
            { key: "band", label: "분포 구간", en: "Distribution", icon: AreaChart },
        ] as const).map(({ key, label, icon: Icon }) => (<CairnButton variant="ghost" key={key} type="button" aria-pressed={mode === key} onClick={() => setMode(key)} className="flex items-center gap-2">
              <Icon size={14} aria-hidden="true"/>
              <>{label}</>
            </CairnButton>))}
        </div>
        <div className="cairn-tabs" role="group" aria-label={"차트 단위"}>
          {([
            { key: "return", label: "수익률" },
            { key: "index", label: "시작값 100" },
        ] as const).map(({ key, label }) => (<CairnButton variant="ghost" key={key} type="button" aria-pressed={unit === key} onClick={() => setUnit(key)} className={`${compact ? "min-h-9" : "min-h-10"} border-b focus-visible:outline-2 focus-visible:outline-[var(--brand)] ${unit === key ? "border-[var(--ink)] text-[var(--ink)]" : "border-transparent text-[var(--faint)]"}`}>
              <>{label}</>
            </CairnButton>))}
        </div>
      </div>}
      {band && !compact && !preview ? <div className={styles.fanReadout} data-fan-readout>
        <p><>{displayedStep === 0 ? "현재" : `${displayedStep}단계`}</><span>{pathPoint && focusedIdentity !== null && focusedIdentity !== undefined ? `${source.kind === "all" ? "경로" : "표본"} ${focusedIdentity + 1}${selectedPath === focusedPath ? " · 선택됨" : ""}` : "분포의 세 지점"}</span></p>
        {pathPoint ? <strong>{format(pathPoint.indexValue)}</strong> : <dl><div><dt>P10</dt><dd>{format(band.p10)}</dd></div><div><dt>P50</dt><dd>{format(band.p50)}</dd></div><div><dt>P90</dt><dd>{format(band.p90)}</dd></div></dl>}
      </div> : null}
      <div ref={ref} className={`${large ? styles.fanPlot : "w-full"} ${chartStyles.plot}`} style={large || preview ? undefined : { height }}>
        {execution.bands.length > 0 && mode === "paths" && pathCount > 0 ? <SimulationPathCanvas source={source} width={width} height={height} x={geometry.x} y={geometry.y}/> : null}
        {execution.bands.length ? (<svg viewBox={`0 0 ${width} ${height}`} className={chartStyles.overlay} role="img" tabIndex={0} onPointerMove={inspect} onPointerDown={inspect} onPointerUp={(event) => { const candidate = inspect(event); if (mode === "paths")
            selectPath(candidate === selectedPath ? null : candidate); }} onPointerLeave={leave} onPointerCancel={leave} onKeyDown={inspectWithKeyboard} aria-label={`${executionName} 연구 시뮬레이션 ${source.kind === "all" ? "전체" : "표본"} ${pathCount}개 경로와 P10 P50 P90 구간`}>
            <title>{`${executionName} 확률 분포`}</title>
            <desc>{"좌우 방향키로 시점을, 위아래 방향키로 경로를 선택합니다. Escape로 선택을 해제합니다."}</desc>
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                const value = geometry.min + (geometry.max - geometry.min) * ratio;
                return (<g key={ratio}>
                  <line x1={left} x2={right} y1={geometry.y(value)} y2={geometry.y(value)} stroke="var(--wash)" strokeDasharray="2 6"/>
                  <text x={left - 10} y={geometry.y(value) + 4} textAnchor="end" fill="var(--faint)" fontSize="10">
                    {format(value)}
                  </text>
                </g>);
            })}
            <line x1={left} x2={right} y1={geometry.y(100)} y2={geometry.y(100)} stroke="var(--faint)" strokeDasharray="4 5"/>
            <g key={`${execution.id}-${mode}`} className={styles.fanReveal}>
            {mode === "band" ? <>
              <path d={geometry.upperArea} fill="var(--accent)" opacity=".10"/>
              <path d={geometry.lowerArea} fill="var(--negative)" opacity=".08"/>
            </> : null}
            <path d={geometry.lower} fill="none" stroke="var(--faint)" strokeDasharray="4 5" strokeWidth="1"/>
            <path d={geometry.upper} fill="none" stroke="var(--faint)" strokeDasharray="4 5" strokeWidth="1"/>
            <path d={geometry.median} fill="none" stroke="var(--ink)" strokeWidth="1.4"/>
            {selectedLine ? <path d={selectedLine} fill="none" stroke="var(--paper)" strokeWidth="4" pointerEvents="none"/> : null}
            {selectedLine ? <path d={selectedLine} fill="none" stroke="var(--ink)" strokeWidth="2.2" pointerEvents="none" data-selected-simulation-path={focusedIdentity}/> : null}
            </g>
            {axisSteps.map((ratio) => (<text key={ratio} x={geometry.x(Math.round(execution.assumptions.horizon * ratio))} y={height - 10} fill="var(--faint)" fontSize="10" textAnchor={ratio === 0 ? "start" : ratio === 1 ? "end" : "middle"}>
                <>{ratio === 0
                ? "현재"
                : `${Math.round(execution.assumptions.horizon * ratio)}단계`}</>
              </text>))}
            {band ? (<g pointerEvents="none">
                <line x1={activeX} x2={activeX} y1={top} y2={bottom} stroke="var(--line)" strokeDasharray="3 4"/>
                {pathPoint ? <line x1={activeX - 5} x2={activeX + 5} y1={geometry.y(pathPoint.indexValue)} y2={geometry.y(pathPoint.indexValue)} stroke="var(--ink)" strokeWidth="2"/> : null}
              </g>) : null}
          </svg>) : (<div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
            <>{"표시할 확률 경로가 없습니다."}</>{" "}</div>)}
      </div>
      {mode === "paths" && pathCount > 0 && !compact && !preview ? <div className={chartStyles.pathControls} aria-label={"경로 선택"}>
        <CairnButton variant="ghost" type="button" disabled={selectedPath === 0} onClick={() => selectPath(selectedPath === null ? 0 : selectedPath - 1)} aria-label={"이전 경로"}><ChevronLeft size={14} aria-hidden="true"/></CairnButton>
        <CairnField><span>{"경로"}</span><CairnInput type="number" min={1} max={pathCount} step={1} value={selectedPath === null ? "" : selectedPath + 1} placeholder="—" aria-label={"경로 번호"} onChange={(event) => { const raw = event.currentTarget.value; const value = Number(raw); if (raw === "") selectPath(null); else if (Number.isFinite(value)) selectPath(Math.floor(value) - 1); }}/></CairnField>
        <CairnButton variant="ghost" type="button" disabled={selectedPath === pathCount - 1} onClick={() => selectPath(selectedPath === null ? 0 : selectedPath + 1)} aria-label={"다음 경로"}><ChevronRight size={14} aria-hidden="true"/></CairnButton>
        {selectedPath !== null ? <CairnButton variant="ghost" type="button" onClick={() => selectPath(null)} aria-label={"경로 선택 해제"}><X size={13} aria-hidden="true"/></CairnButton> : null}
        <span className={chartStyles.pathCount}>{`${source.kind === "all" ? "전체" : "표본"} ${pathCount.toLocaleString()}개`}</span>
      </div> : null}
      {!preview && <div className={styles.scrubberRow}>
        <CairnInput className={styles.scrubber} type="range" aria-label={`${executionName} 경로 시점`} min={0} max={execution.assumptions.horizon} value={Math.round(activeStep ?? execution.assumptions.horizon)} onInput={(event) => inspectStep(Number(event.currentTarget.value))} onChange={(event) => inspectStep(Number(event.target.value))} onFocus={(event) => setActiveStep(Number(event.currentTarget.value))} onBlur={() => { setActiveStep(selectedPath === null ? null : selectedStep); }} onKeyDown={(event) => {
            if (event.key === "Escape") {
                setActiveStep(null);
                event.currentTarget.blur();
            }
        }} aria-valuetext={band
            ? pathPoint ? `${pathPoint.stepIndex}단계, 경로 ${(focusedIdentity ?? 0) + 1}, ${format(pathPoint.indexValue)}` : `${band.stepIndex}단계, 중앙값 ${format(band.p50)}`
            : `${execution.assumptions.horizon}단계`}/>
        <span className="w-16 text-right text-[11px] tabular-nums text-[var(--muted)]">
          {displayedStep}<>{"단계"}</>{" "}</span>
      </div>}
      {compact || preview ? null : (<figcaption className={large ? "sr-only" : "flex flex-wrap items-center gap-x-5 gap-y-2 py-4 text-[11px] text-[var(--muted)]"}>
          <span className="flex items-center gap-2">
            <i className="h-0.5 w-5 bg-[var(--ink)]"/>
            <>{"중앙값 P50"}</>{" "}</span>
          <span className="flex items-center gap-2">
            <i className="h-2.5 w-5 rounded-sm bg-[var(--line)]"/>
            <>{"P10~P90 · 모형 내 80% 구간"}</>{" "}</span>
          <span>
            {`${source.kind === "all" ? "전체" : "표본"} ${pathCount.toLocaleString()}개 경로 · 연구 분포, 수익 보장 아님`}</span>
        </figcaption>)}
    </figure>
    </div>);
}
