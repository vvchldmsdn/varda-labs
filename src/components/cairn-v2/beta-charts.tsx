"use client";
import { Field as CairnField, Input as CairnInput, Status as CairnStatus } from "@/components/cairn-ui";

import dynamic from "next/dynamic";
import { useId, type PointerEvent, type KeyboardEvent } from "react";
import type { FixtureView } from "@/lib/cairn-v2/fixtures";
import styles from "./beta.module.css";
import { historySourceView } from "@/lib/cairn-v2/read-display";
import { CURRENT_VALUATION_SOURCE, historyWithCurrentValue } from "@/lib/cairn-v2/history-current";
import { useBetaPreferences } from "./beta-provider";

import { historyRows, historyAxis, readStateText } from "@/lib/cairn-v2/read-presentation";
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
}: {
  view: FixtureView;
  compact?: boolean;
}) {
  const { metric, period, historyDate, setHistoryDate } = useBetaPreferences();
  const historySource = historySourceView(inputView, undefined, historyDate);
  const view =
    metric === "value" ? historyWithCurrentValue(historySource.view) : historySource.view;
  const rows = historyRows(view, period);
  const gradientId = useId().replaceAll(":", "");
  const stateText = readStateText(view.domain?.historyState, "저장된 평가가 없습니다.");
  if (metric === "return" && inputView.domain?.recoveredReturn)
    return (
      <ReturnTimelineChart
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
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const extent = max - min || 1;
  const plot = compact
    ? { width: 485, height: 288, left: 4, right: 481, top: 102, bottom: 274 }
    : { width: 864, height: 410, left: 12, right: 852, top: 22, bottom: 382 };
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
  const selectedPoint = points[selectedIndex];
  const selectedX = plot.left + axis.fraction(rows[selectedIndex].date) * (plot.right - plot.left);
  const selectPointerDate = (event: PointerEvent<SVGSVGElement>) => {
    if (compact) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * plot.width;
    const fraction = Math.max(0, Math.min(1, (x - plot.left) / (plot.right - plot.left)));
    setHistoryDate(axis.nearest(axis.start + fraction * (axis.end - axis.start)));
  };
  const selectKeyboardDate = (event: KeyboardEvent<SVGSVGElement>) => {
    const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!delta && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
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
      {historySource.options.length > 1 && !(compact && metric === "return") && (
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
      <svg
        viewBox={`0 0 ${plot.width} ${plot.height}`}
        preserveAspectRatio={compact ? "xMidYMid meet" : "none"}
        role="img"
        tabIndex={compact ? undefined : 0}
        aria-label={
          compact
            ? view.domain
              ? view.domain.historyObservationPolicy && metric === "value"
                ? "확인된 관측점을 잇는 평가 추이, 누락 날짜의 평가를 생성하지 않습니다"
                : "기존 저장 추이, 서로 다른 근거와 누락 날짜는 연결하지 않습니다"
              : "개발용 fixture 추이, 누락된 날짜는 선을 연결하지 않습니다"
            : `히스토리 날짜 탐색 · ${rows[selectedIndex].date} · 좌우 방향키로 날짜 선택`
        }
        onPointerDown={
          compact
            ? undefined
            : (event) => {
                selectPointerDate(event);
                event.currentTarget.setPointerCapture(event.pointerId);
              }
        }
        onPointerMove={
          compact
            ? undefined
            : (event) => {
                if (event.pointerType === "mouse" || event.buttons) selectPointerDate(event);
              }
        }
        onKeyDown={compact ? undefined : selectKeyboardDate}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#c64623" stopOpacity=".07" />
            <stop offset="1" stopColor="#c64623" stopOpacity="0" />
          </linearGradient>
        </defs>
        {(compact ? [89, 183, 277] : [plot.top, (plot.top + plot.bottom) / 2, plot.bottom]).map(
          (y) => (
            <line
              key={y}
              x1={plot.left}
              x2={plot.right}
              y1={y}
              y2={y}
              stroke="#dedfda"
              strokeWidth=".7"
              strokeDasharray={compact ? undefined : "1 4"}
            />
          ),
        )}
        {segments.map((d, i) => (
          <g key={i}>
            {compact && !view.domain && view.history.every((p) => p.valueKrw !== null) && (
              <path d={`${d} L481,282 L4,282 Z`} fill={`url(#${gradientId})`} />
            )}
            <path
              d={d}
              stroke={compact ? "#c64623" : "#20211f"}
              strokeWidth="1.4"
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
              stroke="#c64623"
              strokeWidth="1.4"
              strokeDasharray="3 4"
              vectorEffect="non-scaling-stroke"
            />
          )}
        {!compact && (
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
              fill="#c64623"
            />
          ) : null,
        )}
        {selectedPoint && (
          <circle
            data-observed-date={rows[selectedIndex].date}
            cx={selectedPoint.x}
            cy={selectedPoint.y}
            r="3"
            fill="#c64623"
          />
        )}
      </svg>
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
          stroke="#c64623"
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
