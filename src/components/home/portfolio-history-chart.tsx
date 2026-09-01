"use client";

import { useMemo, useState, type KeyboardEvent } from "react";

import {
  formatDate,
  formatKrw,
  formatPercent,
  formatShortDate,
} from "@/components/home/portfolio-format";
import { buildMonotoneCurvePath } from "@/lib/svg-monotone-curve";

type HistoryPoint = Readonly<{
  date: string;
  totalMarketValue: number;
  totalPnl: number | null;
  totalReturnPct: number | null;
}>;

type HistoryEvent = Readonly<{
  id: string;
  eventDate: string;
  eventType: string;
  accountLabel: string;
  assetName: string;
  ticker: string | null;
  amountKrw: number | null;
  quantityDelta: number | null;
}>;

type RangeKey = "1M" | "3M" | "6M" | "ALL";

const RANGE_DAYS: Record<Exclude<RangeKey, "ALL">, number> = {
  "1M": 31,
  "3M": 92,
  "6M": 183,
};

const WIDTH = 900;
const HEIGHT = 310;
const PLOT_TOP = 24;
const PLOT_BOTTOM = 258;
const PLOT_LEFT = 14;
const PLOT_RIGHT = 882;

export function PortfolioHistoryChart({
  events,
  points,
}: {
  events: readonly HistoryEvent[];
  points: readonly HistoryPoint[];
}) {
  const [range, setRange] = useState<RangeKey>("ALL");
  const visiblePoints = useMemo(() => pointsForRange(points, range), [points, range]);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [activeEventKey, setActiveEventKey] = useState<string | null>(null);
  const [mobileIndex, setMobileIndex] = useState(Math.max(points.length - 1, 0));
  const geometry = useMemo(() => buildGeometry(visiblePoints), [visiblePoints]);
  const mobileActiveIndex = Math.min(
    mobileIndex,
    Math.max(visiblePoints.length - 1, 0),
  );
  const activePoint = hoveredIndex === null ? null : visiblePoints[hoveredIndex] ?? null;
  const activeGeometry = hoveredIndex === null ? null : geometry.points[hoveredIndex] ?? null;
  const mobilePoint = visiblePoints[mobileActiveIndex] ?? null;
  const visibleEvents = groupedVisibleEvents(events, visiblePoints);
  const activeEvent = visibleEvents.find((event) => event.key === activeEventKey) ?? null;
  const activeEventGeometry = activeEvent
    ? geometry.points[activeEvent.pointIndex] ?? null
    : null;

  return (
    <section aria-labelledby="portfolio-history-title" className="min-w-0">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium text-[var(--muted)]">VALUE HISTORY</p>
          <h2 id="portfolio-history-title" className="mt-1 text-base font-semibold">
            포트폴리오 흐름
          </h2>
        </div>
        <div className="flex items-center gap-5" aria-label="조회 기간">
          {(["1M", "3M", "6M", "ALL"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={range === item}
              className={`min-h-10 border-b px-1 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand)] ${
                range === item
                  ? "border-[var(--ink)] text-[var(--ink)]"
                  : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"
              }`}
              onClick={() => {
                setRange(item);
                setHoveredIndex(null);
                setActiveEventKey(null);
                setMobileIndex(Math.max(pointsForRange(points, item).length - 1, 0));
              }}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      {visiblePoints.length > 1 ? (
        <>
          <div
            className="varda-home-chart relative w-full"
            onPointerLeave={() => {
              setHoveredIndex(null);
              setActiveEventKey(null);
            }}
          >
            <svg
              role="img"
              aria-label="기간별 포트폴리오 평가액 추이"
              className="h-full w-full overflow-visible"
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              preserveAspectRatio="none"
            >
              <line
                x1={PLOT_LEFT}
                x2={PLOT_RIGHT}
                y1={PLOT_BOTTOM}
                y2={PLOT_BOTTOM}
                stroke="var(--line)"
              />
              {[0.33, 0.66].map((fraction) => (
                <line
                  key={fraction}
                  x1={PLOT_LEFT}
                  x2={PLOT_RIGHT}
                  y1={PLOT_TOP + (PLOT_BOTTOM - PLOT_TOP) * fraction}
                  y2={PLOT_TOP + (PLOT_BOTTOM - PLOT_TOP) * fraction}
                  stroke="var(--wash)"
                  strokeDasharray="2 7"
                />
              ))}
              <path
                d={geometry.path}
                fill="none"
                stroke="var(--brand)"
                strokeWidth="1.8"
                vectorEffect="non-scaling-stroke"
              />
              {activePoint && activeGeometry ? (
                <g>
                  <line
                    x1={activeGeometry.x}
                    x2={activeGeometry.x}
                    y1={PLOT_TOP}
                    y2={PLOT_BOTTOM}
                    stroke="var(--brand)"
                    strokeDasharray="2 5"
                  />
                  <circle
                    cx={activeGeometry.x}
                    cy={activeGeometry.y}
                    r="5"
                    fill="var(--surface)"
                    stroke="var(--brand)"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              ) : null}
              {geometry.points.map((point, index) => {
                const previousPoint = geometry.points[index - 1];
                const nextPoint = geometry.points[index + 1];
                const hitStart = previousPoint
                  ? (previousPoint.x + point.x) / 2
                  : PLOT_LEFT;
                const hitEnd = nextPoint
                  ? (point.x + nextPoint.x) / 2
                  : PLOT_RIGHT;

                return (
                  <rect
                    key={`hit:${visiblePoints[index]?.date}`}
                    role="button"
                    tabIndex={
                      hoveredIndex === index ||
                      (hoveredIndex === null && index === visiblePoints.length - 1)
                        ? 0
                        : -1
                    }
                    data-history-point-index={index}
                    aria-label={`${formatDate(visiblePoints[index]?.date ?? null)} ${formatKrw(visiblePoints[index]?.totalMarketValue ?? null)}`}
                    x={hitStart}
                    y={PLOT_TOP}
                    width={Math.max(1, hitEnd - hitStart)}
                    height={PLOT_BOTTOM - PLOT_TOP}
                    fill="transparent"
                    className="outline-none"
                    style={{ outline: "none" }}
                    onBlur={() => setHoveredIndex(null)}
                    onFocus={() => setHoveredIndex(index)}
                    onKeyDown={(event) =>
                      moveHistoryPointFocus(event, index, visiblePoints.length)
                    }
                    onPointerDown={(event) => event.preventDefault()}
                    onPointerEnter={() => setHoveredIndex(index)}
                  />
                );
              })}
              {visibleEvents.map((event) => {
                const point = geometry.points[event.pointIndex];
                if (!point) return null;
                const active = event.key === activeEventKey;
                return (
                  <g
                    key={event.key}
                    role="button"
                    tabIndex={0}
                    aria-label={eventAriaLabel(event)}
                    className="cursor-help outline-none"
                    onBlur={() => setActiveEventKey(null)}
                    onFocus={() => {
                      setHoveredIndex(null);
                      setActiveEventKey(event.key);
                    }}
                    onPointerEnter={() => {
                      setHoveredIndex(null);
                      setActiveEventKey(event.key);
                    }}
                    onPointerLeave={() => setActiveEventKey(null)}
                  >
                    <circle
                      cx={point.x}
                      cy={PLOT_BOTTOM - 2}
                      fill="transparent"
                      r="11"
                    />
                    <line
                      x1={point.x}
                      x2={point.x}
                      y1={Math.min(point.y + 12, PLOT_BOTTOM - 12)}
                      y2={PLOT_BOTTOM - 7}
                      stroke="var(--faint)"
                      strokeDasharray="2 5"
                    />
                    <circle
                      cx={point.x}
                      cy={PLOT_BOTTOM - 2}
                      fill={active ? "var(--brand)" : "var(--faint)"}
                      r={active ? 5 : 3.5}
                      stroke="var(--paper)"
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                );
              })}
              {geometry.labelIndexes.map((index) => {
                const point = geometry.points[index];
                const value = visiblePoints[index];
                if (!point || !value) return null;
                return (
                  <text
                    key={`label:${value.date}`}
                    x={point.x}
                    y={HEIGHT - 4}
                    textAnchor={index === 0 ? "start" : index === visiblePoints.length - 1 ? "end" : "middle"}
                    fill="var(--muted)"
                    fontSize="10"
                  >
                    {formatShortDate(value.date)}
                  </text>
                );
              })}
            </svg>

            {activePoint && activeGeometry ? (
              <div
                className="pointer-events-none absolute hidden w-52 rounded-[6px] border border-[var(--line)] bg-[rgba(250,252,249,0.96)] p-3.5 text-xs shadow-[0_14px_36px_rgba(26,34,29,0.12)] backdrop-blur-sm md:block"
                style={{
                  left: `${Math.min(76, Math.max(5, (activeGeometry.x / WIDTH) * 100 + 2))}%`,
                  top: `${Math.min(55, Math.max(3, (activeGeometry.y / HEIGHT) * 100 - 4))}%`,
                }}
              >
                <p className="border-b border-[var(--wash)] pb-2 font-semibold text-[var(--ink)]">
                  {formatDate(activePoint.date)}
                </p>
                <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[var(--muted)]">
                  <dt>평가액</dt>
                  <dd className="text-right font-medium text-[var(--ink)]">
                    {formatKrw(activePoint.totalMarketValue)}
                  </dd>
                  <dt>누적 손익</dt>
                  <dd className="text-right font-medium text-[var(--ink)]">
                    {formatKrw(activePoint.totalPnl)}
                  </dd>
                  <dt>수익률</dt>
                  <dd className="text-right font-medium text-[var(--ink)]">
                    {formatPercent(activePoint.totalReturnPct, true)}
                  </dd>
                </dl>
              </div>
            ) : null}

            {activeEvent && activeEventGeometry ? (
              <div
                className="pointer-events-none absolute hidden w-64 rounded-[7px] border border-[var(--line)] bg-[rgba(250,252,249,0.98)] p-3.5 text-xs shadow-[0_14px_36px_rgba(26,34,29,0.12)] backdrop-blur-sm md:block"
                style={{
                  bottom: "9%",
                  left: `${Math.min(74, Math.max(3, (activeEventGeometry.x / WIDTH) * 100 + 1.5))}%`,
                }}
              >
                <p className="border-b border-[var(--wash)] pb-2 font-semibold text-[var(--ink)]">
                  {formatDate(activeEvent.eventDate)} · {activeEvent.events.length}건
                </p>
                <div className="mt-2.5 space-y-2.5">
                  {activeEvent.events.slice(0, 3).map((event) => (
                    <div key={event.id}>
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-medium text-[var(--ink)]">{eventTypeLabel(event.eventType)}</p>
                        <p className="text-right font-medium tabular-nums text-[var(--ink)]">
                          {eventAmountLabel(event)}
                        </p>
                      </div>
                      <p className="mt-0.5 truncate text-[var(--muted)]">
                        {event.assetName} · {event.accountLabel}
                      </p>
                    </div>
                  ))}
                  {activeEvent.events.length > 3 ? (
                    <p className="text-[var(--muted)]">그 외 {activeEvent.events.length - 3}건</p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <input
            aria-label="포트폴리오 이력 날짜 선택"
            className="portfolio-history-range mt-2 w-full md:hidden"
            max={Math.max(visiblePoints.length - 1, 0)}
            min="0"
            onChange={(event) => setMobileIndex(Number(event.target.value))}
            type="range"
            value={mobileActiveIndex}
          />

          {mobilePoint ? (
            <div className="mt-3 flex items-center justify-between gap-4 text-xs text-[var(--muted)] md:hidden">
              <span>{formatDate(mobilePoint.date)}</span>
              <span className="font-medium text-[var(--ink)]">
                {formatKrw(mobilePoint.totalMarketValue)}
              </span>
            </div>
          ) : null}

          <details className="mt-6 border-y border-[var(--wash)] py-3 text-xs">
            <summary className="min-h-10 cursor-pointer py-2 font-medium text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand)]">
              그래프 데이터 표로 보기
            </summary>
            <div className="max-h-80 overflow-auto pb-2 pt-3">
              <table className="w-full min-w-[34rem] border-collapse text-left tabular-nums">
                <caption className="sr-only">
                  선택 기간의 포트폴리오 평가액, 누적 손익, 수익률
                </caption>
                <thead className="sticky top-0 bg-[var(--paper)] text-[var(--muted)]">
                  <tr className="border-b border-[var(--line)]">
                    <th className="px-2 py-2 font-medium" scope="col">날짜</th>
                    <th className="px-2 py-2 text-right font-medium" scope="col">평가액</th>
                    <th className="px-2 py-2 text-right font-medium" scope="col">누적 손익</th>
                    <th className="px-2 py-2 text-right font-medium" scope="col">수익률</th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePoints.map((point) => (
                    <tr className="border-b border-[var(--wash)]" key={point.date}>
                      <th className="px-2 py-2 font-medium text-[var(--ink)]" scope="row">
                        {formatDate(point.date)}
                      </th>
                      <td className="px-2 py-2 text-right">{formatKrw(point.totalMarketValue)}</td>
                      <td className="px-2 py-2 text-right">{formatKrw(point.totalPnl)}</td>
                      <td className="px-2 py-2 text-right">
                        {formatPercent(point.totalReturnPct, true)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <div className="grid min-h-[280px] place-items-center border-y border-[var(--wash)] text-center">
          <div>
            <p className="text-sm font-medium text-[var(--ink)]">표시할 이력이 아직 충분하지 않습니다.</p>
            <p className="mt-2 text-xs text-[var(--muted)]">수집된 값은 숨기지 않고 다음 기준일과 함께 이어집니다.</p>
          </div>
        </div>
      )}
    </section>
  );
}

function moveHistoryPointFocus(
  event: KeyboardEvent<SVGRectElement>,
  currentIndex: number,
  pointCount: number,
) {
  let targetIndex: number | null = null;
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    targetIndex = Math.max(0, currentIndex - 1);
  } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    targetIndex = Math.min(pointCount - 1, currentIndex + 1);
  } else if (event.key === "Home") {
    targetIndex = 0;
  } else if (event.key === "End") {
    targetIndex = pointCount - 1;
  }
  if (targetIndex === null || targetIndex === currentIndex) return;

  event.preventDefault();
  event.currentTarget.ownerSVGElement
    ?.querySelector<SVGRectElement>(
      `[data-history-point-index="${targetIndex}"]`,
    )
    ?.focus();
}

function pointsForRange(points: readonly HistoryPoint[], range: RangeKey) {
  if (range === "ALL" || points.length === 0) return [...points];
  const latestDate = Date.parse(points.at(-1)?.date ?? "");
  const threshold = latestDate - RANGE_DAYS[range] * 24 * 60 * 60 * 1000;
  const filtered = points.filter((point) => Date.parse(point.date) >= threshold);
  return filtered.length > 1 ? filtered : [...points].slice(-2);
}

function buildGeometry(points: readonly HistoryPoint[]) {
  if (points.length === 0) {
    return { path: "", points: [], labelIndexes: [], barWidth: 2 };
  }
  const values = points.map((point) => point.totalMarketValue);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const spread = Math.max(maxValue - minValue, Math.abs(maxValue) * 0.035, 1);
  const lower = minValue - spread * 0.12;
  const upper = maxValue + spread * 0.12;
  const xStep = points.length > 1 ? (PLOT_RIGHT - PLOT_LEFT) / (points.length - 1) : 0;
  const chartPoints = points.map((point, index) => ({
    x: PLOT_LEFT + index * xStep,
    y: PLOT_BOTTOM - ((point.totalMarketValue - lower) / (upper - lower)) * (PLOT_BOTTOM - PLOT_TOP),
  }));
  const labelStep = Math.max(1, Math.ceil(points.length / 6));
  const labelIndexes = chartPoints
    .map((_, index) => index)
    .filter((index) => index === 0 || index === points.length - 1 || index % labelStep === 0);

  return {
    path: buildMonotoneCurvePath(chartPoints),
    points: chartPoints,
    labelIndexes,
    barWidth: Math.max(1.2, Math.min(4, xStep * 0.32)),
  };
}

function groupedVisibleEvents(events: readonly HistoryEvent[], points: readonly HistoryPoint[]) {
  const start = points[0]?.date;
  const end = points.at(-1)?.date;
  if (!start || !end) return [];
  const grouped = new Map<
    number,
    { eventDate: string; events: HistoryEvent[]; pointIndex: number }
  >();

  for (const event of events
    .filter((event) => event.eventDate >= start && event.eventDate <= end)
    .toSorted((left, right) => left.eventDate.localeCompare(right.eventDate))) {
    const pointIndex = closestPointIndex(points, event.eventDate);
    const current = grouped.get(pointIndex);
    if (current) {
      current.events.push(event);
      current.eventDate = event.eventDate;
      continue;
    }
    grouped.set(pointIndex, {
      eventDate: event.eventDate,
      events: [event],
      pointIndex,
    });
  }

  return [...grouped.values()]
    .toSorted((left, right) => left.pointIndex - right.pointIndex)
    .map((event) => ({
      ...event,
      key: `${event.pointIndex}:${event.events.map((row) => row.id).join(":")}`,
    }));
}

function closestPointIndex(points: readonly HistoryPoint[], date: string) {
  const target = Date.parse(date);
  let selected = 0;
  let distance = Number.POSITIVE_INFINITY;
  points.forEach((point, index) => {
    const nextDistance = Math.abs(Date.parse(point.date) - target);
    if (nextDistance < distance) {
      selected = index;
      distance = nextDistance;
    }
  });
  return selected;
}

function eventTypeLabel(value: string) {
  if (value === "buy") return "추가 투입";
  if (value === "sell") return "매도";
  if (value === "rebalance") return "리밸런싱";
  if (value === "dividend") return "배당";
  if (value === "deposit") return "입금";
  if (value === "withdrawal") return "출금";
  if (value === "asset_added") return "종목 추가";
  if (value === "asset_removed") return "종목 정리";
  if (value === "quantity_adjusted") return "수량 조정";
  if (value === "manual_price_update") return "가격 수정";
  return "기타 기록";
}

function eventAmountLabel(event: HistoryEvent) {
  if (event.amountKrw !== null) return formatKrw(event.amountKrw);
  if (event.quantityDelta !== null) {
    const prefix = event.quantityDelta > 0 ? "+" : "";
    return `${prefix}${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 }).format(event.quantityDelta)}좌`;
  }
  return "상세 금액 없음";
}

function eventAriaLabel(event: ReturnType<typeof groupedVisibleEvents>[number]) {
  const kinds = [...new Set(event.events.map((row) => eventTypeLabel(row.eventType)))].join(", ");
  return `${formatDate(event.eventDate)} ${kinds} ${event.events.length}건`;
}
