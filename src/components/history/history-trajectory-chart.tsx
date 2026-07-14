import type {
  HistoryTrajectoryModel,
  HistoryTrajectoryPoint,
  HistoryTrajectoryRowKind,
} from "@/lib/history-trajectory";

import {
  formatHistoryKrw,
  historyAccountLabel,
  historySourceLabel,
} from "./history-format";

const WIDTH = 1120;
const HEIGHT = 340;
const LEFT = 80;
const RIGHT = 28;
const TOP = 24;
const BOTTOM = 44;

export function HistoryTrajectoryChart({
  model,
}: {
  model: HistoryTrajectoryModel;
}) {
  return (
    <figure
      data-history-chart-lane={model.lane}
      data-history-chart-status={model.status}
      data-history-chart-points={model.pointCount}
      data-history-chart-segments={model.segmentCount}
      data-history-chart-sources={model.sourceCount}
      data-history-chart-derived-points={model.derivedPointCount}
      data-history-chart-excluded-points={model.excludedPointCount}
      data-history-chart-ambiguous-points={model.ambiguousPointCount}
      data-history-chart-gap-breaks={model.disconnectedGapCount}
      data-history-chart-policy={model.policy.version}
      className="mt-4"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-base font-semibold tracking-normal">
            {model.lane === "balance"
              ? "저장 잔액 궤적"
              : "포트폴리오 평가액 궤적"}
          </h3>
          <p className="mt-1 text-xs leading-5 text-[#687064]">
            {historyAccountLabel(model.account)} · 금액 추세만 표시 · 수익률,
            TWR, MDD, 성과 순위 아님
          </p>
        </div>
        <p className="text-xs text-[#687064]">
          {model.minDate && model.maxDate
            ? `${model.minDate} ~ ${model.maxDate}`
            : "표시할 저장점 없음"}
        </p>
      </div>

      {model.status === "ready" ? (
        <ReadyChart model={model} />
      ) : (
        <p className="mt-3 border-y border-[#e1e6dc] py-4 text-sm text-[#687064]">
          유효한 저장 금액점이 없어 차트를 표시하지 않습니다.
        </p>
      )}

      <figcaption className="mt-3 text-xs leading-5 text-[#687064]">
        선은 같은 출처·같은 행 구분의 달력상 연속 날짜만 연결합니다. 저장 행이
        없는 날짜는 보간하거나 평평한 값으로 채우지 않습니다. 제외된 값 {" "}
        {model.excludedPointCount}건 · 분리된 날짜 간격 {model.disconnectedGapCount}건
      </figcaption>
    </figure>
  );
}

function ReadyChart({ model }: { model: HistoryTrajectoryModel }) {
  const allPoints = model.segments.flatMap((segment) => segment.points);
  const timestamps = allPoints.map((point) => dateTimestamp(point.date));
  const minTimestamp = Math.min(...timestamps);
  const maxTimestamp = Math.max(...timestamps);
  const minValue = model.minValueKrw!;
  const maxValue = model.maxValueKrw!;
  const rawSpan = maxValue - minValue;
  const valuePadding =
    rawSpan > 0 ? rawSpan * 0.1 : Math.max(Math.abs(maxValue) * 0.05, 1);
  const axisMin = minValue - valuePadding;
  const axisMax = maxValue + valuePadding;
  const axisSpan = axisMax - axisMin;
  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const yTicks = Array.from(
    { length: 5 },
    (_, index) => axisMax - (axisSpan * index) / 4,
  );
  const uniqueDates = [...new Set(allPoints.map((point) => point.date))].sort();
  const xLabels = uniqueDateLabels(uniqueDates);
  const toX = (date: string) =>
    minTimestamp === maxTimestamp
      ? LEFT + plotWidth / 2
      : LEFT +
        ((dateTimestamp(date) - minTimestamp) /
          (maxTimestamp - minTimestamp)) *
          plotWidth;
  const toY = (value: number) =>
    TOP + ((axisMax - value) / axisSpan) * plotHeight;

  return (
    <>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-[#596158]">
        {model.evidenceGroups.map((group) => (
          <span
            className="inline-flex items-center gap-2"
            key={`${group.source}:${group.rowKind}`}
          >
            <span
              aria-hidden="true"
              className="inline-block h-1 w-7"
              style={{
                backgroundColor:
                  group.rowKind === "derived"
                    ? "transparent"
                    : strokeColor(group.rowKind),
                borderTop:
                  group.rowKind === "derived"
                    ? `2px dashed ${strokeColor(group.rowKind)}`
                    : undefined,
              }}
            />
            {historySourceLabel(group.source)} · {rowKindLabel(group.rowKind)} {" "}
            {group.pointCount}점/{group.segmentCount}구간
          </span>
        ))}
      </div>

      <div className="mt-3 overflow-x-auto border-y border-[#e1e6dc] bg-white py-2">
        <svg
          aria-label={`${historyAccountLabel(model.account)} ${model.lane === "balance" ? "저장 잔액" : "포트폴리오 평가액"} 궤적 차트`}
          className="h-auto w-full min-w-[760px]"
          role="img"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        >
          <title>
            {historyAccountLabel(model.account)} {" "}
            {model.lane === "balance" ? "저장 잔액" : "포트폴리오 평가액"} 궤적
          </title>
          {yTicks.map((tick, index) => {
            const y = TOP + (index / 4) * plotHeight;
            return (
              <g key={`${index}:${tick}`}>
                <line
                  x1={LEFT}
                  x2={WIDTH - RIGHT}
                  y1={y}
                  y2={y}
                  stroke="#e1e6dc"
                  strokeWidth="1"
                />
                <text
                  dominantBaseline="middle"
                  fill="#687064"
                  fontSize="12"
                  textAnchor="end"
                  x={LEFT - 10}
                  y={y}
                >
                  {formatCompactKrw(tick)}
                </text>
              </g>
            );
          })}

          {model.segments.map((segment) => {
            const color = strokeColor(segment.rowKind);
            const points = segment.points
              .map(
                (point) =>
                  `${toX(point.date).toFixed(2)},${toY(point.valueKrw).toFixed(2)}`,
              )
              .join(" ");
            return (
              <g key={segment.key}>
                {segment.points.length > 1 ? (
                  <polyline
                    fill="none"
                    points={points}
                    stroke={color}
                    strokeDasharray={
                      segment.rowKind === "derived" ? "7 5" : undefined
                    }
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.5"
                  />
                ) : null}
                {segment.points.map((point) => (
                  <circle
                    key={`${segment.key}:${point.date}`}
                    cx={toX(point.date)}
                    cy={toY(point.valueKrw)}
                    fill={
                      segment.rowKind === "derived" ? "#ffffff" : color
                    }
                    r="3.5"
                    stroke={color}
                    strokeWidth="2"
                  >
                    <title>{pointTitle(point)}</title>
                  </circle>
                ))}
              </g>
            );
          })}

          {xLabels.map((date) => (
            <text
              fill="#687064"
              fontSize="12"
              key={date}
              textAnchor={
                date === uniqueDates[0]
                  ? "start"
                  : date === uniqueDates.at(-1)
                    ? "end"
                    : "middle"
              }
              x={toX(date)}
              y={HEIGHT - 14}
            >
              {date.replaceAll("-", ".")}
            </text>
          ))}
        </svg>
      </div>
    </>
  );
}

function pointTitle(point: HistoryTrajectoryPoint) {
  return [
    point.date,
    formatHistoryKrw(point.valueKrw),
    historySourceLabel(point.source),
    rowKindLabel(point.rowKind),
  ].join(" · ");
}

function uniqueDateLabels(dates: readonly string[]) {
  if (dates.length <= 2) return dates;
  return [
    ...new Set([
      dates[0]!,
      dates[Math.floor(dates.length / 2)]!,
      dates.at(-1)!,
    ]),
  ];
}

function rowKindLabel(rowKind: HistoryTrajectoryRowKind) {
  return rowKind === "derived" ? "표시용 합산" : "저장값";
}

function strokeColor(rowKind: HistoryTrajectoryRowKind) {
  return rowKind === "derived" ? "#b66b35" : "#1e3a34";
}

function formatCompactKrw(value: number) {
  return `₩${new Intl.NumberFormat("ko-KR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)}`;
}

function dateTimestamp(date: string) {
  return Date.parse(`${date}T00:00:00.000Z`);
}
