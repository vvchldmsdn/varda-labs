"use client";
import { Field as CairnField, Input as CairnInput, Status as CairnStatus } from "@/components/cairn-ui";

import dynamic from "next/dynamic";
import { useId, useState, type PointerEvent, type KeyboardEvent } from "react";
import { displayReadMoney } from "@/lib/cairn-v2/read-contract";
import type { BetaCurrency } from "@/lib/cairn-v2/navigation";
import type { FixtureView } from "@/lib/cairn-v2/fixtures";
import styles from "./beta.module.css";
import { historySourceView } from "@/lib/cairn-v2/read-display";
import { CURRENT_VALUATION_SOURCE, historyWithCurrentValue } from "@/lib/cairn-v2/history-current";
import { useBetaPreferences } from "./beta-provider";
import { useMeasuredPlot } from "@/components/use-measured-plot";
import { alignedRanges, CompactImpactBasis, ImpactLegend, ImpactBars, useHomeImpact } from "./home-impact";

import { historyRows, historyAxis, historyComparison, readStateText } from "@/lib/cairn-v2/read-presentation";
import { percentOrNull } from "@/lib/portfolio-math";
export { historyRows } from "@/lib/cairn-v2/read-presentation";
const ReturnTimelineChart = dynamic(
  () => import("@/components/return-timeline-chart").then((module) => module.ReturnTimelineChart),
  {
    loading: () => (
      <CairnStatus as="div" className={styles.empty} role="status">
        수익률 차트를 여는 중
      </CairnStatus>
    ),
  },
);
export function HistoryChart({
  view: inputView,
  compact = false,
  interactive = false,
  currency = "KRW",
}: {
  view: FixtureView;
  compact?: boolean;
  interactive?: boolean;
  currency?: BetaCurrency;
}) {
  const { metric, period, historyDate, setHistoryDate } = useBetaPreferences();
  const impact = useHomeImpact();
  const [measured, setPlotElement] = useMeasuredPlot();
  const [inspecting, setInspecting] = useState(false);
  const canExplore = !compact || interactive;
  const historySource = historySourceView(inputView, undefined, historyDate);
  const view =
    metric === "value" ? historyWithCurrentValue(historySource.view) : historySource.view;
  const rows = historyRows(view, period);
  const gradientId = useId().replaceAll(":", "");
  const stateText = readStateText(view.domain?.historyState, "저장된 평가가 없습니다.");
  if (metric === "return" && inputView.domain?.recoveredReturn)
    return (
      <ReturnTimelineChart
        renderOverlay={impact ? plot => <ImpactBars chart={impact} plot={plot} /> : undefined}
        renderLegend={impact ? (date, value, window, inspecting) => compact ? <CompactImpactBasis chart={impact} window={window} /> : <ImpactLegend chart={impact} inspecting={inspecting ? date : undefined} window={window} returns view={view} currency={currency} label={inspecting ? "선택 수익률" : "마지막 수익률"} value={value} /> : undefined}
        stored={historyRows(view, "ALL").map((p) => ({
          date: p.date,
          returnPct: p.exampleReturnPct,
          segment: p.segment,
        }))}
        curve={inputView.domain.recoveredReturn}
        compact={compact}
        rangeDays={period === "ALL" ? undefined : period === "1M" ? 31 : period === "3M" ? 92 : 183}
        selectedDate={historyDate}
        onSelect={setHistoryDate}
      />
    );
  if (stateText)
    return (
      <CairnStatus as="div" className={styles.empty} role="status">
        {stateText}
      </CairnStatus>
    );
  if (!rows.length) return <div className={styles.empty}>저장된 평가가 없습니다.</div>;
  const values = rows.map((r) => (metric === "value" ? r.valueKrw : r.exampleReturnPct));
  const valid = values.filter((v): v is number => v !== null);
  const returnRows = rows.filter(
    (row) => row.exampleReturnPct !== null && Number.isFinite(row.exampleReturnPct),
  );
  const returnSummary = `수익률 확인 ${returnRows.length}/${rows.length}일 · 최근 ${returnRows.at(-1)?.date.slice(5).replace("-", ".") ?? "없음"} · KRW`;
  if (!valid.length)
    return (
      <div className={styles.empty}>
        {metric === "return" ? (
          <>
            {view.domain && <p>{returnSummary}</p>}
            <p>저장 수익률 확인 전 · 부분 범위 수익률은 보류</p>
            {view.domain && <p>평가액이 있어도 저장 수익률이 없으면 선을 그리지 않습니다.</p>}
          </>
        ) : (
          "조회 기간의 평가값을 확인할 수 없습니다."
        )}
      </div>
    );
  const ranges = impact && metric === "value" ? alignedRanges(impact.days, rows) : [];
  const intermediate = impact && (impact.visible.price || impact.visible.fx) ? ranges.map(r => r.via) : [];
  const min = Math.min(...valid, ...intermediate);
  const max = Math.max(...valid, ...intermediate);
  const extent = max - min || 1;
  const width = measured.width || (compact ? 485 : 864);
  const height = measured.height || (compact ? 220 : 410);
  const plot = { width, height, left: 8, right: width - 8, top: 16, bottom: height - 16 };
  const axis = historyAxis(rows);
  const points = values.map((value, i) =>
    value === null
      ? null
      : {
          x: plot.left + axis.fraction(rows[i].date) * (plot.right - plot.left),
          y: plot.bottom - ((value - min) / extent) * (plot.bottom - plot.top),
        },
  );
  const pointSegment = (i: number) =>
    metric === "value" ? (rows[i]?.valueSegment ?? rows[i]?.segment) : rows[i]?.segment;
  const segments: string[] = [];
  let segment = "";
  points.forEach((p, i) => {
    if (view.domain && i > 0 && pointSegment(i) !== pointSegment(i - 1) && segment) {
      segments.push(segment);
      segment = "";
    }
    if (p) segment += `${segment ? " L" : "M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    else if (segment) {
      segments.push(segment);
      segment = "";
    }
  });
  if (segment) segments.push(segment);
  const matchedIndex = rows.findIndex((r) => r.date === historyDate);
  const selectedIndex = matchedIndex >= 0 ? matchedIndex : rows.length - 1;
  const selectedRow = rows[selectedIndex];
  const selectedMoney = displayReadMoney(view, selectedRow.valueKrw, currency);
  const selectedValue = metric === "return"
    ? selectedRow.exampleReturnPct == null ? "—" : selectedRow.exampleReturnPct.toFixed(2) + "%"
    : selectedMoney === "—" ? "—" : selectedMoney + (currency === "KRW" ? "원" : " USD");
  const first = values[0], last = values.at(-1) ?? null;
  const periodRate = metric === "value"
    ? percentOrNull(historyComparison(rows, !!view.domain).value, first)
    : rows.length > 1 && first !== null && last !== null && pointSegment(0) === pointSegment(rows.length - 1)
      ? last - first : null;
  const latestMoney = displayReadMoney(view, last, currency);
  const latestValue = metric === "value"
    ? latestMoney === "—" ? "자료 없음" : latestMoney + (currency === "KRW" ? "원" : " USD")
    : last === null ? "자료 없음" : last.toFixed(2) + "%";
  const periodLabel = metric === "value"
    ? periodRate === null ? "최근 평가액" : "평가액 변동"
    : periodRate === null ? "최근 수익률" : "수익률 변화";
  const periodValue = periodRate === null ? latestValue :
    periodRate.toLocaleString("ko-KR", {signDisplay:"exceptZero", maximumFractionDigits:2}) + (metric === "return" ? "%p" : "%");
  const inspectedImpact = impact?.days.find(day => day.date === selectedRow.date);
  const selectedPoint = points[selectedIndex];
  const selectedX = plot.left + axis.fraction(rows[selectedIndex].date) * (plot.right - plot.left);
  const selectPointerDate = (event: PointerEvent<SVGSVGElement>) => {
    if (!canExplore) return;
    setInspecting(true);
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * plot.width;
    const fraction = Math.max(0, Math.min(1, (x - plot.left) / (plot.right - plot.left)));
    setHistoryDate(axis.nearest(axis.start + fraction * (axis.end - axis.start)));
  };
  const selectKeyboardDate = (event: KeyboardEvent<SVGSVGElement>) => {
    const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!delta && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    setInspecting(true);
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? rows.length - 1
          : Math.max(0, Math.min(rows.length - 1, selectedIndex + delta));
    setHistoryDate(rows[index].date);
  };
  return (
    <figure
      className={compact ? styles.compactChart : styles.historyChart}
      aria-label={`${metric === "value" ? "평가액" : view.domain ? "기존 저장 수익률" : "예시 수익률"} 추이 · ${view.domain ? "도메인 읽기" : "가상 데이터"}`}
    >
      {view.domain && metric === "return" && <p className={styles.muted}>{returnSummary}</p>}
      {historySource.options.length > 1 && metric === "return" && !compact && (
        <p className={styles.muted}>{historySource.label} 기준</p>
      )}
      {view.domain && metric === "return" && !compact && (
        <p className={styles.muted}>
          {returnRows.length < rows.length && (
            <>
              수익률 미확인 {rows.length - returnRows.length}일 · 평가액이 있어도 저장 수익률이
              없거나 부분 기록이면 선을 그리지 않습니다.{" "}
            </>
          )}
          날짜가 빠지거나 출처·포함 범위가 바뀐 구간은 선을 분리합니다.
        </p>
      )}
      {view.domain?.historyState === "partial" && (
        <p className={styles.muted}>부분 이력 포함 · 확인 소계 · 전체 비교 주의</p>
      )}
      <div ref={setPlotElement} className={styles.historyPlot} data-history-plot data-interactive={interactive || undefined}>
      {compact && interactive && inspecting && <output className={styles.compactReadout}>
        <span>{rows[selectedIndex].date}</span>
        <strong>{selectedValue}</strong>
        {inspectedImpact && <span>가격 {displayReadMoney(view, inspectedImpact.price, currency, true)} · 환율 {displayReadMoney(view, inspectedImpact.fx, currency, true)} {currency}</span>}
      </output>}
      <svg
        viewBox={`0 0 ${plot.width} ${plot.height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        tabIndex={canExplore ? 0 : undefined}
        aria-label={
          !canExplore
            ? view.domain
              ? view.domain.historyObservationPolicy && metric === "value"
                ? "확인된 관측점을 잇는 평가 추이, 누락 날짜의 평가를 생성하지 않습니다"
                : "기존 저장 추이, 서로 다른 근거와 누락 날짜는 연결하지 않습니다"
              : "개발용 fixture 추이, 누락된 날짜는 선을 연결하지 않습니다"
            : `히스토리 날짜 탐색 · ${rows[selectedIndex].date} · 좌우 방향키로 날짜 선택`
        }
        onPointerDown={
          !canExplore
            ? undefined
            : (event) => {
                selectPointerDate(event);
                event.currentTarget.setPointerCapture(event.pointerId);
              }
        }
        onPointerMove={
          !canExplore
            ? undefined
            : (event) => {
                if (event.pointerType === "mouse" || event.buttons) selectPointerDate(event);
              }
        }
        onKeyDown={canExplore ? selectKeyboardDate : undefined}
        onPointerLeave={() => setInspecting(false)}
        onBlur={() => setInspecting(false)}
        onClick={interactive ? event => event.stopPropagation() : undefined}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="var(--home-chart-line, #c64623)" stopOpacity={impact ? ".16" : ".10"} />
            <stop offset="1" stopColor="var(--home-chart-line, #c64623)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[plot.top, (plot.top + plot.bottom) / 2, plot.bottom].map(
          (y) => (
            <line
              key={y}
              x1={plot.left}
              x2={plot.right}
              y1={y}
              y2={y}
              stroke="var(--home-chart-grid, #dedfda)"
              strokeWidth=".7"
              strokeDasharray={compact ? undefined : "1 4"}
            />
          ),
        )}
        {segments.map((d, i) => (
          <g key={metric + period + i}>
            {metric === "value" && d.includes(" L") && (
              <path d={`${d} L${d.split(" L").at(-1)!.split(",")[0]},${plot.bottom} L${d.slice(1).split(",")[0]},${plot.bottom} Z`} fill={`url(#${gradientId})`} />
            )}
            <path
              d={d}
              data-history-line
              pathLength="1"
              stroke="var(--home-chart-line, #c64623)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
        {metric === "value" &&
          rows.at(-1)?.source === CURRENT_VALUATION_SOURCE &&
          points.length > 1 &&
          points.at(-2) &&
          points.at(-1) && (
            <path
              d={`M${points.at(-2)!.x},${points.at(-2)!.y} L${points.at(-1)!.x},${points.at(-1)!.y}`}
              fill="none"
              stroke="var(--home-chart-line, #c64623)"
              strokeWidth="1.4"
              strokeDasharray="3 4"
              vectorEffect="non-scaling-stroke"
            />
          )}
        {impact && <ImpactBars chart={impact} ranges={ranges} y={v => plot.bottom - (v-min)/extent * (plot.bottom-plot.top)} plot={{ start: rows[0].date, end: rows[rows.length - 1].date,
          top: plot.top, bottom: plot.bottom, x: date => plot.left + axis.fraction(date) * (plot.right - plot.left) }} />}
        {(!compact || (interactive && inspecting)) && (
          <line
            x1={selectedX}
            x2={selectedX}
            y1={plot.top}
            y2={plot.bottom}
            stroke="#a5a6a0"
            strokeWidth=".7"
            strokeDasharray="2 5"
          />
        )}
        {points.map((p, i) =>
          p &&
          i !== selectedIndex &&
          (!points[i - 1] || (view.domain && pointSegment(i - 1) !== pointSegment(i))) &&
          (!points[i + 1] || (view.domain && pointSegment(i + 1) !== pointSegment(i))) ? (
            <circle
              key={rows[i].date + i}
              data-observed-date={rows[i].date}
              cx={p.x}
              cy={p.y}
              r="2.5"
              fill="var(--home-chart-line, #c64623)"
            />
          ) : null,
        )}
        {selectedPoint && (
          <circle
            data-observed-date={rows[selectedIndex].date}
            cx={selectedPoint.x}
            cy={selectedPoint.y}
            r="3"
            fill="var(--home-chart-line, #c64623)"
          />
        )}
      </svg>
      </div>
      <figcaption className={`${styles.chartDates} ${styles.historyDates}`}>
        {axis.labels.map((date, i) => (
          <span
            key={date}
            style={{
              left: `${((plot.left + axis.fraction(date) * (plot.right - plot.left)) / plot.width) * 100}%`,
              transform:
                i === 0
                  ? "none"
                  : i === axis.labels.length - 1
                    ? "translateX(-100%)"
                    : "translateX(-50%)",
            }}
          >
            {date === rows.at(-1)?.date && rows.at(-1)?.source === CURRENT_VALUATION_SOURCE
              ? "현재"
              : date.slice(5).replace("-", ".")}
          </span>
        ))}
      </figcaption>
      {impact && compact && <CompactImpactBasis chart={impact} window={{ start: rows[0].date, end: rows[rows.length-1].date }} aligned={ranges.length > 0} />}
      {impact && !compact && <ImpactLegend chart={impact} window={{start:rows[0].date,end:rows[rows.length-1].date}} inspecting={inspecting ? selectedRow.date : undefined}
        returns={metric === "return"} view={view} currency={currency} aligned={ranges.length > 0}
        label={inspecting ? metric === "value" ? "선택 평가액" : "선택 수익률" : periodLabel}
        value={inspecting ? selectedValue : periodValue} />}
      {!compact && (
        <CairnField className={styles.dateSlider}>
          조회 날짜
          <CairnInput
            type="range"
            aria-label="히스토리 조회 날짜"
            min={axis.start}
            max={axis.end}
            step="any"
            aria-valuetext={rows[selectedIndex].date}
            value={axis.day(rows[selectedIndex].date)}
            onKeyDown={(e) => {
              const delta =
                e.key === "ArrowLeft" || e.key === "ArrowDown"
                  ? -1
                  : e.key === "ArrowRight" || e.key === "ArrowUp"
                    ? 1
                    : 0;
              if (delta || e.key === "Home" || e.key === "End") {
                e.preventDefault();
                setHistoryDate(
                  rows[
                    e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? rows.length - 1
                        : Math.max(0, Math.min(rows.length - 1, selectedIndex + delta))
                  ].date,
                );
              }
            }}
            onChange={(e) => setHistoryDate(axis.nearest(Number(e.target.value)))}
          />
        </CairnField>
      )}
    </figure>
  );
}

export function ScenarioChart({ view }: { view: FixtureView }) {
  if (!view.scenario.length) return <div className={styles.empty}>시나리오 예시 없음</div>;
  const coordinates = (spread: number, sign: number) =>
    view.scenario
      .map((r, i) => `${4 + (i / 15) * 368},${100 - r.middle * 3.7 + r.spread * spread * sign}`)
      .join(" ");
  return (
    <figure className={styles.scenarioChart}>
      <svg viewBox="0 0 376 132" role="img" aria-label="가상 시나리오 범위 · 실제 모델 결과 아님">
        <polygon
          points={`${coordinates(4, -1)} ${coordinates(4, 1).split(" ").reverse().join(" ")}`}
          fill="#eadbd3"
          fillOpacity=".66"
        />
        <polygon
          points={`${coordinates(1.8, -1)} ${coordinates(1.8, 1).split(" ").reverse().join(" ")}`}
          fill="#edcbbd"
          fillOpacity=".45"
        />
        <polyline
          points={coordinates(0, 1)}
          stroke="var(--home-chart-line, #c64623)"
          strokeWidth="1.4"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption className={styles.chartDates}>
        <span>현재</span>
        <span>6개월 후</span>
      </figcaption>
    </figure>
  );
}
