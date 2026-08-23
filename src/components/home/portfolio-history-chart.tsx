"use client";

import { useMemo, useState } from "react";

import {
  formatDate,
  formatKrw,
  formatPercent,
  formatShortDate,
} from "@/components/home/portfolio-format";

type HistoryPoint = Readonly<{
  date: string;
  totalMarketValue: number;
  totalPnl: number | null;
  totalReturnPct: number | null;
}>;

type HistoryEvent = Readonly<{
  eventDate: string;
  eventType: string;
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
  const [mobileIndex, setMobileIndex] = useState(Math.max(points.length - 1, 0));
  const geometry = useMemo(() => buildGeometry(visiblePoints), [visiblePoints]);
  const mobileActiveIndex = Math.min(
    mobileIndex,
    Math.max(visiblePoints.length - 1, 0),
  );
  const activePoint = hoveredIndex === null ? null : visiblePoints[hoveredIndex] ?? null;
  const activeGeometry = hoveredIndex === null ? null : geometry.points[hoveredIndex] ?? null;
  const mobilePoint = visiblePoints[mobileActiveIndex] ?? null;
  const visibleEvents = layoutVisibleEvents(
    recentVisibleEvents(events, visiblePoints),
    geometry.points,
  );

  return (
    <section aria-labelledby="portfolio-history-title" className="min-w-0">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium text-[#7b8079]">VALUE HISTORY</p>
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
              className={`border-b py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#347e62] ${
                range === item
                  ? "border-[#20231f] text-[#20231f]"
                  : "border-transparent text-[#777c74] hover:text-[#20231f]"
              }`}
              onClick={() => {
                setRange(item);
                setHoveredIndex(null);
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
            className="relative aspect-[2.65/1] min-h-[250px] w-full"
            onPointerLeave={() => setHoveredIndex(null)}
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
                stroke="#d9ddd7"
              />
              {[0.25, 0.5, 0.75].map((fraction) => (
                <line
                  key={fraction}
                  x1={PLOT_LEFT}
                  x2={PLOT_RIGHT}
                  y1={PLOT_TOP + (PLOT_BOTTOM - PLOT_TOP) * fraction}
                  y2={PLOT_TOP + (PLOT_BOTTOM - PLOT_TOP) * fraction}
                  stroke="#e7eae5"
                  strokeDasharray="2 7"
                />
              ))}
              {geometry.points.map((point, index) => (
                <rect
                  key={`bar:${visiblePoints[index]?.date}`}
                  x={point.x - Math.max(1, geometry.barWidth / 2)}
                  y={point.y + 8}
                  width={geometry.barWidth}
                  height={Math.max(0, PLOT_BOTTOM - point.y - 8)}
                  fill="#e8ebe7"
                  opacity="0.58"
                />
              ))}
              <path
                d={geometry.path}
                fill="none"
                stroke="#29332e"
                strokeWidth="1.75"
                vectorEffect="non-scaling-stroke"
              />
              {visibleEvents.map((event) => {
                const point = geometry.points[event.pointIndex];
                if (!point) return null;
                return (
                  <g key={event.key}>
                    <line
                      x1={point.x}
                      x2={point.x}
                      y1={point.y + 9}
                      y2={PLOT_BOTTOM + 5}
                      stroke="#b8bdb6"
                      strokeDasharray="2 4"
                    />
                    <circle cx={point.x} cy={point.y} r="4" fill="#20231f" />
                    <text
                      x={point.x}
                      y={PLOT_BOTTOM + 24 + event.labelRow * 13}
                      textAnchor="middle"
                      fill="#656b63"
                      fontSize="9"
                    >
                      {event.label}
                    </text>
                  </g>
                );
              })}
              {activePoint && activeGeometry ? (
                <g>
                  <line
                    x1={activeGeometry.x}
                    x2={activeGeometry.x}
                    y1={PLOT_TOP}
                    y2={PLOT_BOTTOM}
                    stroke="#4f7969"
                    strokeDasharray="2 5"
                  />
                  <circle
                    cx={activeGeometry.x}
                    cy={activeGeometry.y}
                    r="5"
                    fill="#f8faf7"
                    stroke="#315f4e"
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
                    tabIndex={0}
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
                    onPointerDown={(event) => event.preventDefault()}
                    onPointerEnter={() => setHoveredIndex(index)}
                  />
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
                    fill="#7b8079"
                    fontSize="10"
                  >
                    {formatShortDate(value.date)}
                  </text>
                );
              })}
            </svg>

            {activePoint && activeGeometry ? (
              <div
                className="pointer-events-none absolute hidden w-52 rounded-[6px] border border-[#d7ddd7] bg-[rgba(250,252,249,0.96)] p-3.5 text-xs shadow-[0_14px_36px_rgba(26,34,29,0.12)] backdrop-blur-sm md:block"
                style={{
                  left: `${Math.min(76, Math.max(5, (activeGeometry.x / WIDTH) * 100 + 2))}%`,
                  top: `${Math.min(55, Math.max(3, (activeGeometry.y / HEIGHT) * 100 - 4))}%`,
                }}
              >
                <p className="border-b border-[#e4e8e3] pb-2 font-semibold text-[#20231f]">
                  {formatDate(activePoint.date)}
                </p>
                <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[#656b63]">
                  <dt>평가액</dt>
                  <dd className="text-right font-medium text-[#20231f]">
                    {formatKrw(activePoint.totalMarketValue)}
                  </dd>
                  <dt>누적 손익</dt>
                  <dd className="text-right font-medium text-[#20231f]">
                    {formatKrw(activePoint.totalPnl)}
                  </dd>
                  <dt>수익률</dt>
                  <dd className="text-right font-medium text-[#20231f]">
                    {formatPercent(activePoint.totalReturnPct, true)}
                  </dd>
                </dl>
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
            <div className="mt-3 flex items-center justify-between gap-4 text-xs text-[#6e746c] md:hidden">
              <span>{formatDate(mobilePoint.date)}</span>
              <span className="font-medium text-[#20231f]">
                {formatKrw(mobilePoint.totalMarketValue)}
              </span>
            </div>
          ) : null}
        </>
      ) : (
        <div className="grid min-h-[280px] place-items-center border-y border-[#e2e5df] text-center">
          <div>
            <p className="text-sm font-medium text-[#343833]">표시할 이력이 아직 충분하지 않습니다.</p>
            <p className="mt-2 text-xs text-[#7b8079]">수집된 값은 숨기지 않고 다음 기준일과 함께 이어집니다.</p>
          </div>
        </div>
      )}
    </section>
  );
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
    path: chartPoints.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" "),
    points: chartPoints,
    labelIndexes,
    barWidth: Math.max(1.2, Math.min(4, xStep * 0.32)),
  };
}

function recentVisibleEvents(events: readonly HistoryEvent[], points: readonly HistoryPoint[]) {
  const start = points[0]?.date;
  const end = points.at(-1)?.date;
  if (!start || !end) return [];
  const grouped = new Map<
    number,
    { eventDate: string; eventTypes: string[]; pointIndex: number }
  >();

  for (const event of events
    .filter((event) => event.eventDate >= start && event.eventDate <= end)
    .toSorted((left, right) => left.eventDate.localeCompare(right.eventDate))) {
    const pointIndex = closestPointIndex(points, event.eventDate);
    const current = grouped.get(pointIndex);
    if (current) {
      if (!current.eventTypes.includes(event.eventType)) {
        current.eventTypes.push(event.eventType);
      }
      current.eventDate = event.eventDate;
      continue;
    }
    grouped.set(pointIndex, {
      eventDate: event.eventDate,
      eventTypes: [event.eventType],
      pointIndex,
    });
  }

  return [...grouped.values()]
    .toSorted((left, right) => left.pointIndex - right.pointIndex)
    .slice(-3)
    .map((event) => ({
      ...event,
      key: `${event.pointIndex}:${event.eventTypes.join(":")}`,
      label:
        event.eventTypes.length > 1
          ? `${eventTypeLabel(event.eventTypes[0] ?? "")} 외 ${event.eventTypes.length - 1}`
          : eventTypeLabel(event.eventTypes[0] ?? ""),
    }));
}

function layoutVisibleEvents(
  events: ReturnType<typeof recentVisibleEvents>,
  points: readonly { x: number; y: number }[],
) {
  let previousX: number | null = null;
  let previousRow = 0;

  return events.map((event) => {
    const x = points[event.pointIndex]?.x ?? 0;
    const isClose = previousX !== null && x - previousX < 130;
    const labelRow = isClose ? (previousRow === 0 ? 1 : 0) : 0;
    previousX = x;
    previousRow = labelRow;
    return { ...event, labelRow };
  });
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
