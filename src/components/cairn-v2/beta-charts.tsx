"use client";
import { Field as CairnField, Input as CairnInput, Status as CairnStatus } from "@/components/cairn-ui";

import dynamic from "next/dynamic";
import { useId, useState, type PointerEvent, type KeyboardEvent } from "react";
import { useI18n } from "@/components/i18n/locale-provider";
import { displayReadMoney } from "@/lib/cairn-v2/read-contract";
import { formatLiveValuationTime, valuationDateForCutoff } from "@/lib/cairn-v2/history-date";
import { currentKstDate } from "@/lib/current-kst-date";
import type { BetaCurrency } from "@/lib/cairn-v2/navigation";
import type { FixtureView } from "@/lib/cairn-v2/fixtures";
import styles from "./beta.module.css";
import { historySourceView } from "@/lib/cairn-v2/read-display";
import { reviewedSource, withinReviewedValuationDates } from "@/lib/cairn-v2/reviewed-history-series";
import { CURRENT_VALUATION_SOURCE, historyWithCurrentValue } from "@/lib/cairn-v2/history-current";
import { useBetaPreferences } from "./beta-provider";
import { useMeasuredPlot } from "@/components/use-measured-plot";
import { alignedRanges, CompactImpactBasis, ImpactLegend, ImpactBars, useHomeImpact } from "./home-impact";
import { HomeHistoryTooltip } from "./home-history-tooltip";
import { PerformanceCaption, PerformanceStatus, usePeriodPerformance } from "./home-performance";

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
  savedOnly = false,
}: {
  view: FixtureView;
  compact?: boolean;
  interactive?: boolean;
  currency?: BetaCurrency;
  savedOnly?: boolean;
}) {
  const { metric, period, historyDate, setHistoryDate } = useBetaPreferences();
  const i18n = useI18n();
  const homeImpact = useHomeImpact();
  const performanceRead = usePeriodPerformance();
  const performance = metric === "return" && !savedOnly ? performanceRead : null;
  const review = inputView.domain?.historyViewSource === "observed" ? inputView.domain.accountHistoryReview : null;
  const impact = performance || !homeImpact ? null : homeImpact;
  const data = performance?.data;
  const [measured, setPlotElement] = useMeasuredPlot();
  const [inspecting, setInspecting] = useState(false);
  const canExplore = !compact || interactive;
  const historySource = historySourceView(inputView, undefined, historyDate);
  const view =
    metric === "value" ? historyWithCurrentValue(historySource.view) : historySource.view;
  const rows: FixtureView["history"] = data ? data.points.map(point => ({
    date: point.date, valueKrw: null, exampleReturnPct: point.returnPct, segment: point.accountReview ? reviewedSource + ":" + point.segment : point.segment ?? undefined,
  })) : historyRows(view, period);
  const gradientId = useId().replaceAll(":", "");
  const stateText = readStateText(view.domain?.historyState, "저장된 평가가 없습니다.");
  if (performance && !data) return <PerformanceStatus />;
  if (data && !data.points.some(point => point.returnPct !== null && point.segment !== point.date))
    return <PerformanceCaption data={data} empty />;
  if (!data && metric === "return" && inputView.domain?.recoveredReturn)
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
  if (stateText && !data)
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
  const liveIndex = data?.points.findIndex(point => point.liveAsOf && point.returnPct !== null) ?? -1;
  const livePoint = points[liveIndex];
  const currentLinkIndex = metric === "value" && rows.at(-1)?.source === CURRENT_VALUATION_SOURCE && rows.at(-2)?.source !== reviewedSource
    ? rows.length - 1
    : liveIndex > 0 && pointSegment(liveIndex) === pointSegment(liveIndex - 1) &&
      axis.day(rows[liveIndex].date) - axis.day(rows[liveIndex - 1].date) === 1 ? liveIndex : -1;
  const currentStart = points[currentLinkIndex - 1];
  const currentEnd = points[currentLinkIndex];
  const segments: string[] = [];
  let segment = "";
  points.forEach((p, i) => {
    if (view.domain && i > 0 && pointSegment(i) !== pointSegment(i - 1) && segment) {
      segments.push(segment);
      segment = "";
    }
    if (p && i !== liveIndex) segment += `${segment ? " L" : "M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    else if (segment) {
      segments.push(segment);
      segment = "";
    }
  });
  if (segment) segments.push(segment);
  const matchedIndex = rows.findIndex((r) => r.date === historyDate);
  const lastVerified = data?.points.findLastIndex(point => point.returnPct !== null && point.segment !== point.date) ?? -1;
  const latestIndex = lastVerified >= 0 ? lastVerified : rows.length - 1;
  const selectedIndex = matchedIndex >= 0 ? matchedIndex : latestIndex;
  const selectedRow = rows[selectedIndex];
  const selectedMoney = metric === "value" ? displayReadMoney(view, selectedRow.valueKrw, currency) : "—";
  const selectedValue = metric === "return"
    ? selectedRow.exampleReturnPct == null ? "—" : (data?.points[selectedIndex].estimatedFx ? "≈ " : "") + selectedRow.exampleReturnPct.toFixed(2) + "%"
    : selectedMoney === "—" ? "—" : selectedMoney + (currency === "KRW" ? "원" : " USD");
  const first = values[0], last = values[latestIndex] ?? null;
  const selectedLiveAsOf = selectedRow.liveAsOf ?? data?.points[selectedIndex].liveAsOf;
  const selectedDate = selectedRow.liveAsOf ? currentKstDate(new Date(selectedRow.liveAsOf)) : selectedRow.date;
  const selectedDateLabel = selectedLiveAsOf
    ? `${selectedDate} · ${metric === "value" ? i18n.t("현재 평가액", "Current valuation") : i18n.t("잠정 수익률", "Provisional return")} ${selectedValue} · ${formatLiveValuationTime(selectedLiveAsOf)}`
    : selectedRow.date;
  const periodRate = metric === "value"
    ? percentOrNull(historyComparison(rows, !!view.domain).value, first)
    : rows.length > 1 && first !== null && last !== null && pointSegment(0) === pointSegment(rows.length - 1)
      ? last - first : null;
  const latestMoney = metric === "value" ? displayReadMoney(view, last, currency) : "—";
  const latestValue = metric === "value"
    ? latestMoney === "—" ? "자료 없음" : latestMoney + (currency === "KRW" ? "원" : " USD")
    : last === null ? "자료 없음" : (data?.points[latestIndex].estimatedFx ? "≈ " : "") + last.toFixed(2) + "%";
  const periodLabel = data ? "최근 확인 구간 수익률" : metric === "value"
    ? periodRate === null ? "최근 평가액" : "평가액 변동"
    : periodRate === null ? "최근 수익률" : "수익률 변화";
  const periodValue = data || periodRate === null ? latestValue :
    periodRate.toLocaleString("ko-KR", {signDisplay:"exceptZero", maximumFractionDigits:2}) + (metric === "return" ? "%p" : "%");
  const inspectedImpact = impact?.days.find(day => day.date === selectedRow.date);
  const selectedPoint = points[selectedIndex];
  const selectedX = plot.left + axis.fraction(rows[selectedIndex].date) * (plot.right - plot.left);
  const showTooltip = compact && interactive && inspecting;
  const tooltipId = `history-tip-${gradientId}`;
  const tooltipPoints = showTooltip ? points.flatMap((point, index) => {
    const sourceBreak = view.domain && index > 0 && pointSegment(index) !== pointSegment(index - 1);
    const dottedLink = index === rows.length - 1 && metric === "value" &&
      rows[index].source === CURRENT_VALUATION_SOURCE && rows[index - 1]?.source !== reviewedSource;
    return sourceBreak && !dottedLink ? [null, point] : [point];
  }) : [];
  const selectPointerDate = (event: PointerEvent<SVGSVGElement>) => {
    if (!canExplore) return;
    setInspecting(true);
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * plot.width;
    const fraction = Math.max(0, Math.min(1, (x - plot.left) / (plot.right - plot.left)));
    setHistoryDate(axis.nearest(axis.start + fraction * (axis.end - axis.start)));
  };
  const selectKeyboardDate = (event: KeyboardEvent<SVGSVGElement>) => {
    if (showTooltip && event.key === "Escape") {
      event.stopPropagation();
      setInspecting(false);
      return;
    }
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
      aria-label={data ? "누적 수익률 추이 · 원화" : `${metric === "value" ? "평가액" : view.domain ? "기존 저장 수익률" : "예시 수익률"} 추이 · ${view.domain ? "도메인 읽기" : "가상 데이터"}`}
    >
      {!compact && review && rows.some(row => withinReviewedValuationDates(review, row.date)) && <p className={styles.muted}>{i18n.t(
        `${valuationDateForCutoff(review.startDate)} – ${valuationDateForCutoff(review.endDate)} 사용자 확인 복원 · 현금·${review.excludedLabels.join("·")} 제외${review.usesEstimates ? " · 추정 포함" : ""}`,
        `${valuationDateForCutoff(review.startDate)} – ${valuationDateForCutoff(review.endDate)} reconstructed · excludes cash and ${review.excludedLabels.join(", ")}${review.usesEstimates ? " · includes estimates" : ""}`)}</p>}
      {inputView.domain?.reviewUnavailable && <p className={styles.muted}>{i18n.t("복원 이력을 읽지 못해 기존 기록을 표시해요.", "Showing saved records because reconstructed history is unavailable.")}</p>}
      {data && compact && <PerformanceCaption data={data} />}
      {!data && view.domain && metric === "return" && <p className={styles.muted}>{returnSummary}</p>}
      {!data && historySource.options.length > 1 && metric === "return" && !compact && (
        <p className={styles.muted}>{historySource.label} 기준</p>
      )}
      {!data && view.domain && metric === "return" && !compact && (
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
      {!data && view.domain?.historyState === "partial" && (
        <p className={styles.muted}>부분 이력 포함 · 확인 소계 · 전체 비교 주의</p>
      )}
      <div ref={setPlotElement} className={styles.historyPlot} data-history-plot data-interactive={interactive || undefined}>
      {showTooltip && <HomeHistoryTooltip id={tooltipId}
        date={selectedRow.liveAsOf ? formatLiveValuationTime(selectedRow.liveAsOf) : selectedRow.date} returns={metric === "return"} value={selectedValue} reviewed={selectedRow.source === reviewedSource || data?.points[selectedIndex]?.accountReview}
        impact={inspectedImpact} performance={data?.points[selectedIndex]} plot={plot} points={tooltipPoints}
        anchor={{x: selectedX, y: selectedPoint?.y ?? height / 2}} />}
      <svg
        viewBox={`0 0 ${plot.width} ${plot.height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-describedby={showTooltip ? tooltipId : undefined}
        tabIndex={canExplore ? 0 : undefined}
        aria-label={
          !canExplore
            ? view.domain
              ? view.domain.historyObservationPolicy && metric === "value"
                ? "확인된 관측점을 잇는 평가 추이, 누락 날짜의 평가를 생성하지 않습니다"
                : "기존 저장 추이, 서로 다른 근거와 누락 날짜는 연결하지 않습니다"
              : "개발용 fixture 추이, 누락된 날짜는 선을 연결하지 않습니다"
            : `히스토리 날짜 탐색 · ${selectedDateLabel} · 좌우 방향키로 날짜 선택`
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
        onFocus={interactive ? () => setInspecting(true) : undefined}
        onPointerLeave={event => { if (event.pointerType !== "touch") setInspecting(false); }}
        onPointerCancel={() => setInspecting(false)}
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
        {currentStart && currentEnd && (
            <path
              d={`M${currentStart.x},${currentStart.y} L${currentEnd.x},${currentEnd.y}`}
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
          i !== liveIndex &&
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
        {livePoint && <circle data-observed-date={rows[liveIndex].date} data-live-as-of={data?.points[liveIndex].liveAsOf}
          cx={livePoint.x} cy={livePoint.y} r={showTooltip && selectedIndex === liveIndex ? 5 : 4}
          stroke="var(--home-chart-line, #c64623)" strokeWidth="2" fill="var(--cairn-v2-paper)" />}
        {selectedPoint && selectedIndex !== liveIndex && (
          <circle
            data-observed-date={rows[selectedIndex].date}
            cx={selectedPoint.x}
            cy={selectedPoint.y}
            r={showTooltip ? 4.2 : 3}
            stroke={showTooltip ? "var(--cairn-v2-paper)" : undefined}
            strokeWidth={showTooltip ? 1.6 : undefined}
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
            aria-valuetext={selectedDateLabel}
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
