"use client";

import { useMemo, useState } from "react";

import {
  formatHistoryKrw,
  formatHistoryNumber,
  formatHistoryPercent,
  historySourceLabel,
} from "@/components/history/history-format";
import type {
  HistoryOverviewEvent,
  HistoryOverviewModel,
  HistoryOverviewPoint,
} from "@/lib/history-overview";
import { buildMonotoneCurvePath } from "@/lib/svg-monotone-curve";

type RangeKey = "1M" | "3M" | "6M" | "ALL";

const CHART_WIDTH = 960;
const CHART_HEIGHT = 330;
const PLOT_TOP = 24;
const PLOT_BOTTOM = 278;
const PLOT_LEFT = 8;
const PLOT_RIGHT = 952;

export function HistoryTimeExplorer({
  model,
}: {
  model: HistoryOverviewModel;
}) {
  const [range, setRange] = useState<RangeKey>("ALL");
  const visiblePoints = useMemo(
    () => pointsForRange(model.points, range),
    [model.points, range],
  );
  const [selectedDate, setSelectedDate] = useState(
    model.points.at(-1)?.date ?? null,
  );
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const geometry = useMemo(() => buildGeometry(visiblePoints), [visiblePoints]);
  const selectedPoint =
    visiblePoints.find((point) => point.date === selectedDate) ??
    visiblePoints.at(-1) ??
    null;
  const hoveredPoint =
    visiblePoints.find((point) => point.date === hoveredDate) ?? null;
  const hoveredGeometry = hoveredPoint
    ? geometry.points[visiblePoints.indexOf(hoveredPoint)] ?? null
    : null;

  if (model.status === "no_data") {
    return (
      <section className="border-y border-[#dde1db] py-16 text-center">
        <p className="text-xs font-medium text-[#777d75]">TIME EXPLORER</p>
        <h2 className="mt-3 text-2xl font-semibold">아직 탐색할 기록이 없습니다.</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[#6d736b]">
          평가액을 임의로 보간하지 않습니다. 일일 포트폴리오 스냅샷이
          저장되면 같은 화면에서 날짜별 흐름과 이벤트를 함께 볼 수 있습니다.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="history-time-explorer-title">
      <div className="flex flex-col gap-4 border-t border-[#dde1db] pt-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-medium text-[#777d75]">TIME EXPLORER</p>
          <h2
            id="history-time-explorer-title"
            className="mt-1 text-xl font-semibold tracking-normal"
          >
            자산의 시간
          </h2>
          <p className="mt-2 text-sm text-[#697069]">
            날짜를 선택하면 그날의 저장 평가액과 이벤트 근거가 함께 바뀝니다.
          </p>
        </div>
        <div className="flex items-center gap-5" aria-label="조회 기간">
          {(["1M", "3M", "6M", "ALL"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={range === item}
              className={`border-b py-1 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#347e62] ${
                range === item
                  ? "border-[#20231f] text-[#20231f]"
                  : "border-transparent text-[#777d75] hover:text-[#20231f]"
              }`}
              onClick={() => {
                const nextPoints = pointsForRange(model.points, item);
                setRange(item);
                setSelectedDate(nextPoints.at(-1)?.date ?? null);
                setHoveredDate(null);
              }}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-7 grid border-y border-[#dde1db] xl:grid-cols-[minmax(0,2.15fr)_minmax(310px,0.85fr)]">
        <div className="min-w-0 py-6 xl:pr-8">
          <div
            className="relative aspect-[2.85/1] min-h-[270px] w-full"
            onPointerLeave={() => setHoveredDate(null)}
          >
            <svg
              role="img"
              aria-label="저장된 날짜별 포트폴리오 평가액 흐름"
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
              <line
                x1={PLOT_LEFT}
                x2={PLOT_RIGHT}
                y1={PLOT_BOTTOM}
                y2={PLOT_BOTTOM}
                stroke="#d9ddd7"
              />
              {geometry.points.map((point, index) => (
                <rect
                  key={`bar:${visiblePoints[index]?.date}`}
                  x={point.x - Math.max(1, geometry.barWidth / 2)}
                  y={point.y + 8}
                  width={geometry.barWidth}
                  height={Math.max(0, PLOT_BOTTOM - point.y - 8)}
                  fill="#e9ece8"
                  opacity="0.62"
                />
              ))}
              <path
                d={geometry.path}
                fill="none"
                stroke="#25302a"
                strokeWidth="1.75"
                vectorEffect="non-scaling-stroke"
              />
              {geometry.points.map((point, index) => {
                const value = visiblePoints[index];
                const previous = geometry.points[index - 1];
                const next = geometry.points[index + 1];
                if (!value) return null;
                const hitStart = previous
                  ? (previous.x + point.x) / 2
                  : PLOT_LEFT;
                const hitEnd = next ? (point.x + next.x) / 2 : PLOT_RIGHT;
                const active = value.date === selectedPoint?.date;

                return (
                  <g key={`point:${value.date}`}>
                    {active ? (
                      <>
                        <line
                          x1={point.x}
                          x2={point.x}
                          y1={PLOT_TOP}
                          y2={PLOT_BOTTOM}
                          stroke="#6d8f82"
                          strokeDasharray="2 6"
                        />
                        <circle
                          cx={point.x}
                          cy={point.y}
                          r="5"
                          fill="#f8faf7"
                          stroke="#347e62"
                          strokeWidth="2"
                          vectorEffect="non-scaling-stroke"
                        />
                      </>
                    ) : null}
                    <rect
                      role="button"
                      tabIndex={0}
                      aria-label={`${formatDate(value.date)} 평가액 ${formatHistoryKrw(value.valueKrw)}`}
                      x={hitStart}
                      y={PLOT_TOP}
                      width={Math.max(1, hitEnd - hitStart)}
                      height={PLOT_BOTTOM - PLOT_TOP}
                      fill="transparent"
                      className="cursor-crosshair outline-none"
                      onClick={() => setSelectedDate(value.date)}
                      onFocus={() => setHoveredDate(value.date)}
                      onBlur={() => setHoveredDate(null)}
                      onPointerDown={(event) => event.preventDefault()}
                      onPointerEnter={() => setHoveredDate(value.date)}
                    />
                  </g>
                );
              })}
            </svg>

            {hoveredPoint && hoveredGeometry ? (
              <ChartTooltip point={hoveredPoint} geometry={hoveredGeometry} />
            ) : null}
          </div>

          <ChartDateLabels points={visiblePoints} />
        </div>

        <SelectedDayPanel point={selectedPoint} />
      </div>

      <HistoryCalendar
        points={visiblePoints}
        selectedDate={selectedPoint?.date ?? null}
        onSelect={setSelectedDate}
      />

      {model.riskPointCount > 0 ? (
        <StoredRiskHistory points={visiblePoints} />
      ) : null}
    </section>
  );
}

function SelectedDayPanel({ point }: { point: HistoryOverviewPoint | null }) {
  if (!point) return null;
  return (
    <aside className="border-t border-[#dde1db] py-6 xl:border-t-0 xl:border-l xl:pl-8">
      <p className="text-[11px] font-medium text-[#777d75]">SELECTED DATE</p>
      <p className="mt-2 text-sm text-[#6d736b]">{formatDate(point.date)}</p>
      <p className="mt-2 text-3xl font-semibold tracking-normal tabular-nums">
        {formatHistoryKrw(point.valueKrw)}
      </p>
      <dl className="mt-7 divide-y divide-[#e1e4df] text-sm">
        <MetricRow
          label="이전 저장점 대비"
          value={formatSignedKrw(point.movementKrw)}
          tone={tone(point.movementKrw)}
          detail={
            point.gapDays === null
              ? "첫 저장점"
              : `${point.gapDays}일 간격 · ${formatSignedPercent(point.movementPct)}`
          }
        />
        <MetricRow
          label="저장 손익"
          value={formatSignedKrw(point.totalPnlKrw)}
          tone={tone(point.totalPnlKrw)}
          detail={formatSignedPercent(point.totalReturnPct)}
        />
        <MetricRow
          label="고점 대비"
          value={formatSignedKrw(point.drawdownKrw)}
          tone={tone(point.drawdownKrw)}
          detail={formatSignedPercent(point.drawdownPct)}
        />
        <MetricRow
          label="현금"
          value={formatHistoryKrw(point.cashValueKrw)}
          detail={historySourceLabel(point.source)}
        />
      </dl>

      <div className="mt-7 border-t border-[#dde1db] pt-5">
        <p className="text-xs font-semibold">같은 날짜의 활동</p>
        {point.events.length > 0 ? (
          <ul className="mt-3 space-y-3">
            {point.events.slice(0, 4).map((event, index) => (
              <li
                key={`${event.eventDate}:${event.eventType}:${event.assetName}:${index}`}
                className="grid grid-cols-[auto_1fr] gap-3 text-sm"
              >
                <span className="mt-1 h-2 w-2 rounded-full bg-[#5b917c]" />
                <div className="min-w-0">
                  <p className="font-medium">
                    {eventTypeLabel(event)} · {event.assetName}
                  </p>
                  <p className="mt-1 text-xs text-[#72786f]">
                    {[event.accountName, formatOptionalKrw(event.amountKrw)]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm leading-6 text-[#777d75]">
            이 날짜에 연결된 저장 이벤트가 없습니다.
          </p>
        )}
        <p className="mt-4 text-xs leading-5 text-[#858a83]">
          같은 날짜에 저장된 활동이며 평가액 변화의 원인으로 단정하지 않습니다.
        </p>
      </div>
    </aside>
  );
}

function HistoryCalendar({
  points,
  selectedDate,
  onSelect,
}: {
  points: readonly HistoryOverviewPoint[];
  selectedDate: string | null;
  onSelect: (date: string) => void;
}) {
  const layout = useMemo(() => calendarLayout(points), [points]);
  if (layout.cells.length === 0) return null;

  return (
    <div className="border-b border-[#dde1db] py-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-medium text-[#777d75]">VALUE RHYTHM</p>
          <h3 className="mt-1 text-base font-semibold">기록 리듬</h3>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-[#7a8078]">
          <span>하락</span>
          <span className="h-3 w-7 rounded-[3px] bg-[#d96864]" />
          <span className="h-3 w-7 rounded-[3px] bg-[#e8ebe7]" />
          <span className="h-3 w-7 rounded-[3px] bg-[#4d9a79]" />
          <span>상승</span>
        </div>
      </div>
      <div className="mt-5 overflow-x-auto pb-2">
        <div
          className="grid gap-[3px]"
          style={{
            gridTemplateColumns: `repeat(${layout.weekCount}, 17px)`,
            gridTemplateRows: "repeat(7, 17px)",
            minWidth: `${layout.weekCount * 20}px`,
          }}
        >
          {layout.cells.map((cell) => (
            <button
              key={cell.point.date}
              type="button"
              title={`${formatDate(cell.point.date)} · ${formatSignedKrw(cell.point.movementKrw)}`}
              aria-label={`${formatDate(cell.point.date)} 이전 저장점 대비 ${formatSignedKrw(cell.point.movementKrw)}`}
              aria-pressed={cell.point.date === selectedDate}
              className={`h-[17px] w-[17px] rounded-[4px] border transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#347e62] ${
                cell.point.date === selectedDate
                  ? "border-[#20231f]"
                  : "border-transparent"
              }`}
              style={{
                gridColumnStart: cell.week + 1,
                gridRowStart: cell.weekday + 1,
                backgroundColor: movementColor(cell.point, layout.maxMovement),
              }}
              onClick={() => onSelect(cell.point.date)}
            />
          ))}
        </div>
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-[#858a83]">
        <span>{formatDate(points[0]?.date ?? null)}</span>
        <span>빈 날짜는 보간하지 않음</span>
        <span>{formatDate(points.at(-1)?.date ?? null)}</span>
      </div>
    </div>
  );
}

function StoredRiskHistory({ points }: { points: readonly HistoryOverviewPoint[] }) {
  const riskPoints = points.filter((point) => point.risk !== null);
  const latest = riskPoints.at(-1)?.risk ?? null;
  if (!latest) return null;

  return (
    <section className="border-b border-[#dde1db] py-7">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-medium text-[#777d75]">STORED RISK</p>
          <h3 className="mt-1 text-base font-semibold">저장된 위험 기록</h3>
        </div>
        <p className="text-xs text-[#777d75]">저장값이 있는 {riskPoints.length}개 날짜</p>
      </div>
      <dl className="mt-5 grid border-t border-[#e1e4df] sm:grid-cols-2 lg:grid-cols-4">
        <RiskMetric
          label="유효 분산 수"
          value={formatHistoryNumber(latest.enb)}
          detail="실제로 분산 효과를 내는 종목 수"
        />
        <RiskMetric
          label="평균 상관계수"
          value={formatHistoryNumber(latest.avgCorrelation)}
          detail="종목들이 함께 움직인 정도"
        />
        <RiskMetric
          label="포트 변동성"
          value={formatHistoryPercent(latest.portfolioVolatility)}
          detail="저장된 위험 계산 결과"
        />
        <RiskMetric
          label="시장 국면"
          value={latest.regimeLabel ?? "기록 없음"}
          detail={
            latest.regimeScore === null
              ? "점수 기록 없음"
              : `저장 점수 ${formatHistoryNumber(latest.regimeScore)}`
          }
        />
      </dl>
    </section>
  );
}

function ChartTooltip({
  point,
  geometry,
}: {
  point: HistoryOverviewPoint;
  geometry: { x: number; y: number };
}) {
  const left = Math.min(78, Math.max(2, (geometry.x / CHART_WIDTH) * 100));
  const top = Math.min(68, Math.max(3, (geometry.y / CHART_HEIGHT) * 100));
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-48 border border-[#d8ddd7] bg-[#fbfcf9]/95 px-4 py-3 text-xs shadow-[0_12px_34px_rgba(36,43,38,0.12)] backdrop-blur-sm"
      style={{ left: `${left}%`, top: `${top}%` }}
    >
      <p className="font-semibold">{formatDate(point.date)}</p>
      <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 text-[#686f67]">
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
  const indexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  return (
    <div className="mt-1 flex justify-between text-[11px] text-[#858a83]">
      {indexes.map((index) => (
        <span key={points[index]!.date}>{shortDate(points[index]!.date)}</span>
      ))}
    </div>
  );
}

function MetricRow({
  label,
  value,
  detail,
  tone: toneClass = "text-[#20231f]",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-4 py-3">
      <dt className="text-[#70766e]">{label}</dt>
      <dd className={`text-right font-semibold tabular-nums ${toneClass}`}>{value}</dd>
      <dd className="col-span-2 mt-1 text-xs text-[#858a83]">{detail}</dd>
    </div>
  );
}

function RiskMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="border-b border-[#e1e4df] py-4 sm:px-5 sm:first:pl-0 lg:border-b-0 lg:border-r lg:last:border-r-0">
      <dt className="text-xs text-[#747a72]">{label}</dt>
      <dd className="mt-2 text-xl font-semibold tabular-nums">{value}</dd>
      <dd className="mt-2 text-xs leading-5 text-[#858a83]">{detail}</dd>
    </div>
  );
}

function buildGeometry(points: readonly HistoryOverviewPoint[]) {
  if (points.length === 0) return { points: [], path: "", barWidth: 1 };
  const values = points.map((point) => point.valueKrw);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max((max - min) * 0.16, Math.abs(max) * 0.015, 1);
  const yMin = min - padding;
  const yMax = max + padding;
  const xStep =
    points.length > 1 ? (PLOT_RIGHT - PLOT_LEFT) / (points.length - 1) : 0;
  const chartPoints = points.map((point, index) => ({
    x: points.length === 1 ? (PLOT_LEFT + PLOT_RIGHT) / 2 : PLOT_LEFT + xStep * index,
    y:
      PLOT_BOTTOM -
      ((point.valueKrw - yMin) / Math.max(yMax - yMin, 1)) *
        (PLOT_BOTTOM - PLOT_TOP),
  }));
  return {
    points: chartPoints,
    path: buildMonotoneCurvePath(chartPoints),
    barWidth: Math.max(2, Math.min(8, xStep * 0.42 || 5)),
  };
}

function pointsForRange(
  points: readonly HistoryOverviewPoint[],
  range: RangeKey,
) {
  if (range === "ALL" || points.length === 0) return points;
  const days = range === "1M" ? 31 : range === "3M" ? 92 : 183;
  const latest = Date.parse(`${points.at(-1)!.date}T00:00:00Z`);
  const cutoff = latest - days * 86_400_000;
  return points.filter(
    (point) => Date.parse(`${point.date}T00:00:00Z`) >= cutoff,
  );
}

function calendarLayout(points: readonly HistoryOverviewPoint[]) {
  if (points.length === 0) return { cells: [], weekCount: 0, maxMovement: 1 };
  const firstDate = Date.parse(`${points[0]!.date}T00:00:00Z`);
  const firstMondayOffset = (new Date(firstDate).getUTCDay() + 6) % 7;
  const calendarStart = firstDate - firstMondayOffset * 86_400_000;
  const cells = points.map((point) => {
    const timestamp = Date.parse(`${point.date}T00:00:00Z`);
    const dayOffset = Math.round((timestamp - calendarStart) / 86_400_000);
    return {
      point,
      week: Math.floor(dayOffset / 7),
      weekday: dayOffset % 7,
    };
  });
  const maxMovement = Math.max(
    0.0001,
    ...points.map((point) => Math.abs(point.movementPct ?? 0)),
  );
  return {
    cells,
    weekCount: Math.max(...cells.map((cell) => cell.week)) + 1,
    maxMovement,
  };
}

function movementColor(point: HistoryOverviewPoint, maxMovement: number) {
  if (point.movementKrw === null || point.movementKrw === 0) return "#e8ebe7";
  const intensity = Math.min(1, Math.abs(point.movementPct ?? 0) / maxMovement);
  if (point.movementKrw > 0) {
    if (intensity > 0.66) return "#4d9a79";
    if (intensity > 0.33) return "#89bda8";
    return "#c5ddd3";
  }
  if (intensity > 0.66) return "#d96864";
  if (intensity > 0.33) return "#eaa39e";
  return "#f0cbc8";
}

function eventTypeLabel(event: HistoryOverviewEvent) {
  if (event.eventType === "buy") return "매수";
  if (event.eventType === "sell") return "매도";
  if (event.eventType === "asset_added") return "자산 추가";
  if (event.eventType === "asset_removed") return "자산 제외";
  return event.eventType;
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

function formatOptionalKrw(value: number | null) {
  return value === null ? null : formatSignedKrw(value);
}

function formatSignedPercent(value: number | null) {
  if (value === null) return "기록 없음";
  const formatted = formatHistoryPercent(Math.abs(value));
  if (value === 0) return formatted;
  return `${value > 0 ? "+" : "-"}${formatted}`;
}

function formatDate(value: string | null) {
  if (!value) return "날짜 없음";
  return value.replaceAll("-", ".");
}

function shortDate(value: string) {
  return value.slice(5).replace("-", ".");
}
