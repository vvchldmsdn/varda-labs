"use client";

import {
  useId,
  useMemo,
  useState,
  type PointerEvent,
} from "react";

import type {
  InvestmentLabScenarioChart,
  InvestmentLabScenarioChartLine,
} from "@/lib/investment-lab-scenario-chart";
import type { InvestmentLabScenarioMatrixId } from "@/lib/investment-lab-scenario-matrix";
import { buildMonotoneCurvePath } from "@/lib/svg-monotone-curve";

const CHART_WIDTH = 1120;
const CHART_HEIGHT = 520;
const PLOT_LEFT = 74;
const PLOT_RIGHT = 36;
const PLOT_TOP = 54;
const PLOT_BOTTOM = 72;

const DEFAULT_SCENARIO_ORDER = [
  "approved_target_weight_monthly",
  "anchor_current_weight_monthly",
  "preperiod_min_volatility",
  "anchor_value_weight",
  "fixed_mix",
  "kodex200",
  "voo",
  "anchor_equal_weight_monthly",
  "anchor_basket",
  "zero_return",
] as const satisfies readonly InvestmentLabScenarioMatrixId[];

export type InvestmentLabTimeMachineScenarioSummary = Readonly<{
  id: InvestmentLabScenarioMatrixId;
  endDifferenceKrw: number | null;
  endValueKrw: number | null;
  returnEstimate: number | null;
  maximumDrawdown: number | null;
  annualizedVolatility: number | null;
}>;

export function InvestmentLabTimeMachine({
  chart,
  scenarioSummaries,
}: {
  chart: InvestmentLabScenarioChart;
  scenarioSummaries: readonly InvestmentLabTimeMachineScenarioSummary[];
}) {
  const rawId = useId();
  const patternId = `investment-lab-difference-${rawId.replaceAll(":", "")}`;
  const [requestedScenarioId, setRequestedScenarioId] =
    useState<InvestmentLabScenarioMatrixId>(() => defaultScenarioId(chart));
  const [requestedFocusIndex, setRequestedFocusIndex] = useState(
    Math.max(chart.lines[0]?.points.length - 1, 0),
  );
  const actualLine =
    chart.lines.find((line) => line.id === "actual") ?? chart.lines[0];
  const selectedLine =
    chart.lines.find((line) => line.id === requestedScenarioId) ??
    chart.lines.find((line) => line.id === defaultScenarioId(chart)) ??
    actualLine;
  const focusIndex = Math.min(
    requestedFocusIndex,
    Math.max((actualLine?.points.length ?? 1) - 1, 0),
  );
  const summaryById = useMemo(
    () => new Map(scenarioSummaries.map((summary) => [summary.id, summary])),
    [scenarioSummaries],
  );
  const geometry = useMemo(
    () => buildGeometry(chart),
    [chart],
  );

  if (!actualLine || !selectedLine || !geometry) return null;

  const actualGeometry = geometry.lines.get(actualLine.id)!;
  const selectedGeometry = geometry.lines.get(selectedLine.id)!;
  const actualPoint = actualLine.points[focusIndex];
  const selectedPoint = selectedLine.points[focusIndex];
  const focusX = geometry.x(focusIndex);
  const actualY = geometry.y(actualPoint.valueKrw);
  const selectedY = geometry.y(selectedPoint.valueKrw);
  const selectedSummary = summaryById.get(selectedLine.id);
  const differenceKrw = selectedPoint.valueKrw - actualPoint.valueKrw;
  const differencePct =
    actualPoint.valueKrw === 0
      ? null
      : differenceKrw / actualPoint.valueKrw;
  const selectableLines = chart.lines.filter((line) => line.id !== "actual");

  function updateFocus(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const viewBoxX =
      ((event.clientX - bounds.left) / bounds.width) * CHART_WIDTH;
    const ratio =
      (viewBoxX - PLOT_LEFT) /
      Math.max(CHART_WIDTH - PLOT_LEFT - PLOT_RIGHT, 1);
    const nextIndex = Math.round(
      clamp(ratio, 0, 1) * Math.max(actualLine.points.length - 1, 0),
    );
    setRequestedFocusIndex(nextIndex);
  }

  return (
    <section
      aria-labelledby="investment-lab-time-machine-title"
      className="border-b border-[#dde1db]"
    >
      <div className="grid gap-8 border-b border-[#dde1db] py-9 lg:grid-cols-[minmax(0,0.9fr)_minmax(560px,1.25fr)] lg:items-end">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[11px] font-medium text-[#777d75]">
              COUNTERFACTUAL LAB
            </p>
            <span className="border border-[#dce0da] bg-[#f1f3ef] px-2 py-1 text-[10px] font-medium text-[#626961]">
              과거 재구성
            </span>
          </div>
          <h1
            className="mt-3 text-3xl font-semibold tracking-normal"
            id="investment-lab-time-machine-title"
          >
            포트폴리오 타임머신
          </h1>
          <p className="mt-1 text-sm text-[#697069]">
            {selectedLine.label} · {formatDate(actualPoint.serviceDate)}
          </p>
          <p
            className={`mt-6 text-[clamp(2.8rem,5.2vw,5.8rem)] font-normal leading-none tracking-normal tabular-nums ${moneyTone(differenceKrw)}`}
          >
            {formatSignedKrw(differenceKrw)}
          </p>
          <p className="mt-4 max-w-xl text-xs leading-6 text-[#7a8078]">
            {differenceLabel(differenceKrw)} · 실제와 같은 시작 자산, 관측일,
            현금흐름을 사용한 과거 비교입니다.
          </p>
        </div>

        <dl className="grid grid-cols-2 border-y border-[#dde1db] xl:grid-cols-4">
          <HeroMetric
            detail="저장된 실제 경로"
            label="실제 평가액"
            value={formatKrw(actualPoint.valueKrw)}
          />
          <HeroMetric
            detail={selectedLine.label}
            label="가상 평가액"
            value={formatKrw(selectedPoint.valueKrw)}
          />
          <HeroMetric
            detail={formatSignedPercent(differencePct)}
            label="실제 대비"
            value={formatSignedKrw(differenceKrw)}
            valueClass={moneyTone(differenceKrw)}
          />
          <HeroMetric
            detail={
              selectedSummary?.annualizedVolatility === null ||
              selectedSummary?.annualizedVolatility === undefined
                ? "변동성 근거 부족"
                : `변동성 ${formatPercent(selectedSummary.annualizedVolatility)}`
            }
            label="최대 낙폭"
            value={formatPercent(selectedSummary?.maximumDrawdown ?? null, true)}
          />
        </dl>
      </div>

      <div className="border-b border-[#dde1db] py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-[#777d75]">세계선 선택</p>
            <div
              aria-label="대안 세계선"
              className="mt-2 flex gap-6 overflow-x-auto pb-1"
              role="group"
            >
              {selectableLines.map((line) => {
                const active = line.id === selectedLine.id;
                const summary = summaryById.get(line.id);
                return (
                  <button
                    key={line.id}
                    aria-pressed={active}
                    className={`min-w-max border-b-2 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#347e62] ${
                      active
                        ? "border-[#20231f] text-[#20231f]"
                        : "border-transparent text-[#777d75] hover:text-[#20231f]"
                    }`}
                    onClick={() => setRequestedScenarioId(line.id)}
                    type="button"
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: line.color }}
                      />
                      {line.label}
                    </span>
                    <span
                      className={`mt-1 block text-[11px] tabular-nums ${moneyTone(summary?.endDifferenceKrw ?? null)}`}
                    >
                      종료 시점 {formatSignedKrw(summary?.endDifferenceKrw ?? null)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-x-5 gap-y-2 text-xs text-[#5f665e]">
            <Legend color={actualLine.color} label="실제 포트폴리오" />
            <Legend color={selectedLine.color} label={selectedLine.label} />
            <span className="inline-flex items-center gap-2">
              <span className="h-3 w-5 bg-[#e9eee9]" />
              두 경로의 간격
            </span>
          </div>
        </div>
      </div>

      <div className="min-w-0 py-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-medium text-[#777d75]">
              VALUE PATHS
            </p>
            <h2 className="mt-1 text-xl font-semibold">
              실제와 {selectedLine.label}
            </h2>
          </div>
          <p className="text-xs text-[#777d75]">
            동일 축 · 누락값 보간 없음 · 마우스로 날짜 탐색
          </p>
        </div>

        <div className="mt-5 overflow-x-auto">
            <svg
              aria-label="실제 포트폴리오와 선택한 대안 세계선 평가액 비교"
              className="block h-auto min-w-[820px] w-full touch-none"
              onPointerLeave={() =>
                setRequestedFocusIndex(actualLine.points.length - 1)
              }
              onPointerMove={updateFocus}
              role="img"
              viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            >
              <defs>
                <pattern
                  height="8"
                  id={patternId}
                  patternUnits="userSpaceOnUse"
                  width="8"
                >
                  <path d="M0 8L8 0" stroke="#ccd4cc" strokeWidth="1" />
                </pattern>
              </defs>

              {geometry.ticks.map((tick) => (
                <g key={tick.value}>
                  <line
                    stroke="#dfe3de"
                    strokeDasharray="2 7"
                    strokeWidth="1"
                    x1={PLOT_LEFT}
                    x2={CHART_WIDTH - PLOT_RIGHT}
                    y1={tick.y}
                    y2={tick.y}
                  />
                  <text
                    fill="#7b817a"
                    fontSize="12"
                    textAnchor="end"
                    x={PLOT_LEFT - 12}
                    y={tick.y + 4}
                  >
                    {compactKrw(tick.value)}
                  </text>
                </g>
              ))}

              {selectedLine.id === actualLine.id
                ? null
                : actualLine.points.map((point, index) => {
                    const nextActualY = geometry.y(point.valueKrw);
                    const nextScenarioY = geometry.y(
                      selectedLine.points[index].valueKrw,
                    );
                    return (
                      <rect
                        key={point.serviceDate}
                        fill={
                          selectedLine.points[index].valueKrw >= point.valueKrw
                            ? selectedLine.color
                            : `url(#${patternId})`
                        }
                        height={Math.max(Math.abs(nextScenarioY - nextActualY), 1)}
                        opacity={
                          selectedLine.points[index].valueKrw >= point.valueKrw
                            ? 0.08
                            : 0.75
                        }
                        width={geometry.differenceBarWidth}
                        x={geometry.x(index) - geometry.differenceBarWidth / 2}
                        y={Math.min(nextActualY, nextScenarioY)}
                      />
                    );
                  })}

              <path
                d={actualGeometry.path}
                fill="none"
                stroke={actualLine.color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="4"
              />
              {selectedLine.id === actualLine.id ? null : (
                <path
                  d={selectedGeometry.path}
                  fill="none"
                  stroke={selectedLine.color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="4"
                />
              )}

              <line
                stroke="#737a72"
                strokeDasharray="3 6"
                strokeWidth="1"
                x1={focusX}
                x2={focusX}
                y1={PLOT_TOP - 8}
                y2={CHART_HEIGHT - PLOT_BOTTOM + 12}
              />
              <circle
                cx={focusX}
                cy={actualY}
                fill="#f8f9f6"
                r="6"
                stroke={actualLine.color}
                strokeWidth="3"
              />
              {selectedLine.id === actualLine.id ? null : (
                <circle
                  cx={focusX}
                  cy={selectedY}
                  fill="#f8f9f6"
                  r="6"
                  stroke={selectedLine.color}
                  strokeWidth="3"
                />
              )}

              <Tooltip
                actualValueKrw={actualPoint.valueKrw}
                differenceKrw={differenceKrw}
                scenarioColor={selectedLine.color}
                scenarioValueKrw={selectedPoint.valueKrw}
                serviceDate={actualPoint.serviceDate}
                x={focusX > CHART_WIDTH * 0.7 ? focusX - 258 : focusX + 16}
                y={PLOT_TOP + 8}
              />

              {geometry.dateTicks.map((tick) => (
                <text
                  key={tick.index}
                  fill="#777d75"
                  fontSize="12"
                  textAnchor={tick.anchor}
                  x={tick.x}
                  y={CHART_HEIGHT - 24}
                >
                  {shortDate(actualLine.points[tick.index].serviceDate)}
                </text>
              ))}
            </svg>
        </div>

        <label className="mt-1 block text-[11px] font-medium text-[#777d75]">
          날짜 탐색
          <input
            aria-label="비교 날짜 탐색"
            className="portfolio-history-range mt-2 w-full"
            max={Math.max(actualLine.points.length - 1, 0)}
            min={0}
            onChange={(event) =>
              setRequestedFocusIndex(Number(event.currentTarget.value))
            }
            step={1}
            type="range"
            value={focusIndex}
          />
        </label>
      </div>

      <dl className="grid border-t border-[#dce1da] sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          detail={`${formatDate(chart.period!.startServiceDate)} ~ ${formatDate(chart.period!.endServiceDate)}`}
          label="비교 구간"
          value={`${chart.period!.comparisonDateCount}개 관측일`}
        />
        <Metric
          detail={formatDate(actualPoint.serviceDate)}
          label="선택 관측일"
          value={shortDate(actualPoint.serviceDate)}
        />
        <Metric
          detail="현금흐름 조정 추정"
          label="구간 수익률"
          value={formatSignedPercent(selectedSummary?.returnEstimate ?? null)}
          valueClass={moneyTone(selectedSummary?.returnEstimate ?? null)}
        />
        <Metric
          detail="같은 관측일 수익률의 연환산"
          label="연환산 변동성"
          value={formatPercent(selectedSummary?.annualizedVolatility ?? null)}
        />
      </dl>
    </section>
  );
}

function buildGeometry(chart: InvestmentLabScenarioChart) {
  const axis = chart.lines[0]?.points ?? [];
  if (axis.length < 2) return null;
  const values = chart.lines.flatMap((line) =>
    line.points.map((point) => point.valueKrw),
  );
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const rawRange = Math.max(maximum - minimum, 1);
  const domainMin = Math.max(0, minimum - rawRange * 0.12);
  const domainMax = maximum + rawRange * 0.12;
  const x = (index: number) =>
    PLOT_LEFT +
    (index / Math.max(axis.length - 1, 1)) *
      (CHART_WIDTH - PLOT_LEFT - PLOT_RIGHT);
  const y = (value: number) =>
    PLOT_TOP +
    ((domainMax - value) / Math.max(domainMax - domainMin, 1)) *
      (CHART_HEIGHT - PLOT_TOP - PLOT_BOTTOM);
  const lines = new Map(
    chart.lines.map((line) => [
      line.id,
      {
        path: linePath(line, x, y),
      },
    ]),
  );
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    const value = domainMax - ratio * (domainMax - domainMin);
    return { value, y: y(value) };
  });
  const dateIndexes = Array.from(
    new Set(
      [0, 0.25, 0.5, 0.75, 1].map((ratio) =>
        Math.round(ratio * (axis.length - 1)),
      ),
    ),
  );
  const dateTicks = dateIndexes.map((index, tickIndex) => ({
    index,
    x: x(index),
    anchor:
      tickIndex === 0
        ? ("start" as const)
        : tickIndex === dateIndexes.length - 1
          ? ("end" as const)
          : ("middle" as const),
  }));
  return {
    dateTicks,
    differenceBarWidth: Math.max(
      3,
      ((CHART_WIDTH - PLOT_LEFT - PLOT_RIGHT) /
        Math.max(axis.length - 1, 1)) *
        0.55,
    ),
    lines,
    ticks,
    x,
    y,
  };
}

function linePath(
  line: InvestmentLabScenarioChartLine,
  x: (index: number) => number,
  y: (value: number) => number,
) {
  return buildMonotoneCurvePath(
    line.points.map((point, index) => ({
      x: x(index),
      y: y(point.valueKrw),
    })),
  );
}

function Tooltip({
  actualValueKrw,
  differenceKrw,
  scenarioColor,
  scenarioValueKrw,
  serviceDate,
  x,
  y,
}: {
  actualValueKrw: number;
  differenceKrw: number;
  scenarioColor: string;
  scenarioValueKrw: number;
  serviceDate: string;
  x: number;
  y: number;
}) {
  return (
    <g pointerEvents="none" transform={`translate(${x} ${y})`}>
      <rect
        fill="#fbfcf9"
        height="126"
        rx="4"
        stroke="#cfd5ce"
        width="238"
      />
      <text fill="#222622" fontSize="13" fontWeight="600" x="14" y="24">
        {formatDate(serviceDate)}
      </text>
      <line stroke="#e0e4df" x1="14" x2="224" y1="34" y2="34" />
      <text fill="#6d746c" fontSize="12" x="14" y="57">
        실제
      </text>
      <text
        fill="#252925"
        fontSize="13"
        fontWeight="600"
        textAnchor="end"
        x="224"
        y="57"
      >
        {formatKrw(actualValueKrw)}
      </text>
      <text fill="#6d746c" fontSize="12" x="14" y="82">
        대안
      </text>
      <text
        fill={scenarioColor}
        fontSize="13"
        fontWeight="600"
        textAnchor="end"
        x="224"
        y="82"
      >
        {formatKrw(scenarioValueKrw)}
      </text>
      <text fill="#6d746c" fontSize="12" x="14" y="107">
        차이
      </text>
      <text
        fill={differenceKrw >= 0 ? "#27735c" : "#c8524b"}
        fontSize="13"
        fontWeight="600"
        textAnchor="end"
        x="224"
        y="107"
      >
        {formatSignedKrw(differenceKrw)}
      </text>
    </g>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className="h-[3px] w-7 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

function Metric({
  detail,
  label,
  value,
  valueClass = "text-[#20231f]",
}: {
  detail: string;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="min-w-0 border-b border-[#dce1da] px-5 py-5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 lg:px-7">
      <dt className="text-[11px] text-[#777d75]">{label}</dt>
      <dd className={`mt-2 truncate text-xl font-medium tabular-nums ${valueClass}`}>
        {value}
      </dd>
      <p className="mt-1 truncate text-xs text-[#777d75]">{detail}</p>
    </div>
  );
}

function HeroMetric({
  detail,
  label,
  value,
  valueClass = "text-[#20231f]",
}: {
  detail: string;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="min-w-0 border-b border-r border-[#dde1db] px-3 py-4 even:border-r-0 first:pl-0 sm:px-4 xl:border-b-0 xl:even:border-r xl:last:border-r-0">
      <dt className="text-[11px] text-[#747a72]">{label}</dt>
      <dd className={`mt-2 truncate text-base font-semibold tabular-nums ${valueClass}`}>
        {value}
      </dd>
      <dd className="mt-2 truncate text-[11px] text-[#858a83]">{detail}</dd>
    </div>
  );
}

function defaultScenarioId(chart: InvestmentLabScenarioChart) {
  for (const id of DEFAULT_SCENARIO_ORDER) {
    if (chart.lines.some((line) => line.id === id)) return id;
  }
  return chart.lines.find((line) => line.id !== "actual")?.id ?? "actual";
}

function compactKrw(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억`;
  if (absolute >= 10_000) return `${Math.round(value / 10_000)}만`;
  return Math.round(value).toLocaleString("ko-KR");
}

function formatKrw(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}

function formatSignedKrw(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  if (Math.abs(value) < 0.5) return "₩0";
  return `${value > 0 ? "+" : "-"}₩${Math.abs(Math.round(value)).toLocaleString("ko-KR")}`;
}

function formatPercent(value: number | null, negative = false) {
  if (value === null || !Number.isFinite(value)) return "-";
  const formatted = `${(Math.abs(value) * 100).toFixed(2)}%`;
  return negative && value > 0 ? `-${formatted}` : formatted;
}

function formatSignedPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  if (Math.abs(value) < 0.00005) return "0.00%";
  return `${value > 0 ? "+" : "-"}${(Math.abs(value) * 100).toFixed(2)}%`;
}

function formatDate(value: string) {
  return value.replaceAll("-", ".");
}

function shortDate(value: string) {
  return value.slice(5).replace("-", ".");
}

function moneyTone(value: number | null) {
  if (value === null || Math.abs(value) < 0.5) return "text-[#4f5650]";
  return value > 0 ? "text-[#27735c]" : "text-[#c8524b]";
}

function differenceLabel(value: number) {
  if (Math.abs(value) < 0.5) return "실제 포트폴리오와 같은 위치";
  return value > 0
    ? "실제 포트폴리오보다 높은 위치"
    : "실제 포트폴리오보다 낮은 위치";
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}
