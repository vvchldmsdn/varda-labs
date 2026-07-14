import type { SimulationInputReadinessPageModel } from "@/lib/simulation-input-readiness";

import {
  formatIndexValue,
  formatSignedReturn,
  formatSimulationDate,
} from "./simulation-view-formatters";

type ObservedReturnComparison =
  SimulationInputReadinessPageModel["observedReturnComparison"];

export function ObservedReturnComparisonPanel({
  comparison,
}: {
  comparison: ObservedReturnComparison;
}) {
  if (comparison.status === "unavailable") {
    return (
      <section
        data-observed-return-comparison="unavailable"
        data-comparison-axis-status="unavailable"
        aria-labelledby="observed-return-comparison-title"
        className="mt-5 rounded-lg border border-[#d7ddcf] bg-[#fbfcf7] p-4"
      >
        <h2
          id="observed-return-comparison-title"
          className="text-lg font-semibold tracking-normal"
        >
          90개 관측구간 누적지수 비교
        </h2>
        <p className="mt-2 text-sm text-[#6b5227]">
          {formatUnavailableReason(comparison.reason)}
        </p>
        <p className="mt-1 text-xs leading-5 text-[#687064]">
          두 입력이 같은 91개 날짜축으로 모두 준비될 때만 표시합니다. 날짜 자동
          대체나 부분 비교는 하지 않습니다.
        </p>
      </section>
    );
  }

  const chartWidth = 1120;
  const chartHeight = 340;
  const leftPadding = 72;
  const rightPadding = 28;
  const topPadding = 24;
  const bottomPadding = 44;
  const plotWidth = chartWidth - leftPadding - rightPadding;
  const plotHeight = chartHeight - topPadding - bottomPadding;
  const allValues = comparison.series.flatMap((series) =>
    series.points.map((point) => point.value),
  );
  const rawMin = Math.min(...allValues, 100);
  const rawMax = Math.max(...allValues, 100);
  const rawSpan = Math.max(rawMax - rawMin, 1);
  const axisMin = rawMin - rawSpan * 0.08;
  const axisMax = rawMax + rawSpan * 0.08;
  const axisSpan = axisMax - axisMin;
  const yTicks = Array.from(
    { length: 5 },
    (_, index) => axisMax - (axisSpan * index) / 4,
  );
  const pointCount = comparison.pointCount;
  const seriesColors = ["#1f4a3d", "#c25c4b"] as const;
  const anchorPoints = comparison.series[0]!.points;
  const middlePointIndex = Math.floor((pointCount - 1) / 2);
  const xLabels = [0, middlePointIndex, pointCount - 1].map((index) => ({
    index,
    serviceDate: anchorPoints[index]?.serviceDate ?? "",
  }));

  const toX = (index: number) =>
    leftPadding + (index / Math.max(pointCount - 1, 1)) * plotWidth;
  const toY = (value: number) =>
    topPadding + ((axisMax - value) / axisSpan) * plotHeight;

  return (
    <section
      data-observed-return-comparison="ready"
      data-comparison-axis-status="aligned"
      data-comparison-point-count={comparison.pointCount}
      data-comparison-series-count={comparison.series.length}
      aria-labelledby="observed-return-comparison-title"
      className="mt-5 rounded-lg border border-[#d7ddcf] bg-[#fbfcf7] p-4"
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2
            id="observed-return-comparison-title"
            className="text-lg font-semibold tracking-normal"
          >
            90개 관측구간 누적지수 비교
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[#596158]">
            두 독립 연구 입력의 과거 KRW 수익률을 각각 시작 100으로 누적했습니다.
            휴장일에는 아래 정렬 근거의 허용 범위 안에서 직전 저장값이 적용될 수
            있습니다. 포트폴리오 조합·예측·시뮬레이션 경로가 아닙니다.
          </p>
        </div>
        <p className="text-xs text-[#687064]">
          공통 날짜축 {formatSimulationDate(comparison.baselineServiceDate)} ~ {" "}
          {formatSimulationDate(comparison.endServiceDate)}
        </p>
      </div>

      <dl className="mt-4 grid gap-px overflow-hidden rounded-md border border-[#e1e5da] bg-[#e1e5da] sm:grid-cols-2">
        {comparison.series.map((series, index) => (
          <div key={series.id} className="bg-white px-4 py-3">
            <dt className="flex items-center gap-2 text-sm font-semibold">
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: seriesColors[index] }}
              />
              {series.ticker} · {series.name}
            </dt>
            <dd className="mt-2 flex items-baseline justify-between gap-3 tabular-nums">
              <span className="text-lg font-semibold">
                {formatIndexValue(series.finalIndexValue)}
              </span>
              <span className="text-sm text-[#596158]">
                누적 {formatSignedReturn(series.totalReturn)}
              </span>
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 overflow-x-auto rounded-md border border-[#e1e5da] bg-white">
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          role="img"
          aria-label="KODEX 200과 VOO의 과거 KRW 누적 관측지수 공통축 비교 차트"
          className="h-auto w-full min-w-[760px]"
        >
          <title>KODEX 200과 VOO의 과거 KRW 누적 관측지수 비교</title>
          {yTicks.map((tick) => {
            const y = toY(tick);
            return (
              <g key={tick}>
                <line
                  x1={leftPadding}
                  x2={chartWidth - rightPadding}
                  y1={y}
                  y2={y}
                  stroke="#e1e5da"
                  strokeWidth="1"
                />
                <text
                  x={leftPadding - 10}
                  y={y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fill="#687064"
                  fontSize="12"
                >
                  {formatIndexValue(tick)}
                </text>
              </g>
            );
          })}
          <line
            x1={leftPadding}
            x2={chartWidth - rightPadding}
            y1={toY(100)}
            y2={toY(100)}
            stroke="#9da99b"
            strokeDasharray="5 5"
            strokeWidth="1"
          />
          {comparison.series.map((series, seriesIndex) => (
            <polyline
              key={series.id}
              points={series.points
                .map(
                  (point, pointIndex) =>
                    `${toX(pointIndex).toFixed(2)},${toY(point.value).toFixed(2)}`,
                )
                .join(" ")}
              fill="none"
              stroke={seriesColors[seriesIndex]}
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {xLabels.map((label) => (
            <text
              key={`${label.index}-${label.serviceDate}`}
              x={toX(label.index)}
              y={chartHeight - 14}
              textAnchor={
                label.index === 0
                  ? "start"
                  : label.index === pointCount - 1
                    ? "end"
                    : "middle"
              }
              fill="#687064"
              fontSize="12"
            >
              {formatSimulationDate(label.serviceDate)}
            </text>
          ))}
        </svg>
      </div>

      <details className="mt-4 border-t border-[#e1e5da] pt-3">
        <summary className="cursor-pointer text-sm font-semibold text-[#253029]">
          전체 {comparison.pointCount}개 누적지수 표 보기
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-left text-sm">
            <thead className="border-y border-[#d7ddcf] text-xs text-[#687064]">
              <tr>
                <th className="px-3 py-2 font-semibold">기준일</th>
                {comparison.series.map((series) => (
                  <th
                    key={series.id}
                    className="px-3 py-2 text-right font-semibold"
                  >
                    {series.ticker} 지수
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {anchorPoints.map((point, pointIndex) => (
                <tr key={point.serviceDate} className="border-b border-[#e8ebe3]">
                  <td className="whitespace-nowrap px-3 py-2 font-medium">
                    {formatSimulationDate(point.serviceDate)}
                  </td>
                  {comparison.series.map((series) => (
                    <td
                      key={series.id}
                      className="whitespace-nowrap px-3 py-2 text-right tabular-nums"
                    >
                      {formatIndexValue(series.points[pointIndex]!.value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function formatUnavailableReason(
  reason: Extract<ObservedReturnComparison, { status: "unavailable" }>["reason"],
) {
  switch (reason) {
    case "input_unavailable":
      return "두 연구 입력이 모두 준비되지 않아 비교하지 않습니다.";
    case "axis_mismatch":
      return "두 연구 입력의 관측 날짜축이 일치하지 않아 비교하지 않습니다.";
    case "invalid_return_count":
      return "정확히 90개 수익률과 91개 관측점이 확인되지 않아 비교하지 않습니다.";
    case "invalid_return_series":
      return "완전하고 유효한 누적 관측지수를 만들 수 없어 비교하지 않습니다.";
    case "invalid_input_set":
      return "비교할 독립 연구 입력 구성이 올바르지 않습니다.";
  }
}
