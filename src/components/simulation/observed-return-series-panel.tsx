import type { SimulationInputReadinessPageModel } from "@/lib/simulation-input-readiness";

import {
  formatAxisReturn,
  formatReturnRange,
  formatSignedReturn,
  formatSimulationDate,
} from "./simulation-view-formatters";

type InputReadiness = SimulationInputReadinessPageModel["inputs"][number];
type ObservedReturn = NonNullable<InputReadiness["observedReturns"]>[number];

export function ObservedReturnSeriesPanel({
  input,
  rows,
  chartScale,
  scaleMode,
}: {
  input: InputReadiness;
  rows: readonly ObservedReturn[];
  chartScale: number;
  scaleMode: "shared" | "individual";
}) {
  if (rows.length === 0) return null;

  const values = rows.map((row) => row.value);
  const maxReturn = Math.max(...values);
  const minReturn = Math.min(...values);
  const latestReturn = rows.at(-1)?.value ?? 0;
  const chartWidth = 720;
  const chartHeight = 240;
  const leftPadding = 64;
  const rightPadding = 20;
  const topPadding = 20;
  const bottomPadding = 20;
  const plotHeight = chartHeight - topPadding - bottomPadding;
  const drawableWidth = chartWidth - leftPadding - rightPadding;
  const ticks = [chartScale, 0, -chartScale];
  const points = rows
    .map((row, index) => {
      const x =
        leftPadding +
        (index / Math.max(rows.length - 1, 1)) * drawableWidth;
      const y =
        topPadding +
        ((chartScale - row.value) / (chartScale * 2)) * plotHeight;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <section
      data-observed-return-series={input.id}
      data-return-row-count={rows.length}
      aria-labelledby={`observed-returns-${input.id}`}
      className="border-t border-[#e1e5da] p-4"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3
            id={`observed-returns-${input.id}`}
            className="text-sm font-semibold"
          >
            {rows.length}개 관측 수익률
          </h3>
          <p className="mt-1 text-xs leading-5 text-[#687064]">
            저장된 조정종가와 기준일별 환율로 계산한 과거 KRW 단순수익률입니다.
          </p>
        </div>
        <div className="text-right text-xs leading-5 text-[#7a8175]">
          <p>예측·시뮬레이션 경로 아님</p>
          <p data-return-scale-mode={scaleMode}>
            {scaleMode === "shared" ? "두 입력 공통" : "개별"} 세로축 {" "}
            {formatReturnRange(chartScale)}
          </p>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[#e1e5da] bg-[#e1e5da] text-sm sm:grid-cols-4">
        <ReturnSummaryItem label="관측 행" value={`${rows.length}개`} />
        <ReturnSummaryItem
          label="최근 수익률"
          value={formatSignedReturn(latestReturn)}
        />
        <ReturnSummaryItem label="최고" value={formatSignedReturn(maxReturn)} />
        <ReturnSummaryItem label="최저" value={formatSignedReturn(minReturn)} />
      </dl>

      <div className="mt-4 overflow-x-auto rounded-md border border-[#e1e5da] bg-white">
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          role="img"
          aria-label={`${input.ticker}의 과거 ${rows.length}개 KRW 단순수익률 차트`}
          className="h-auto w-full min-w-[640px]"
        >
          <title>{`${input.ticker} 과거 KRW 단순수익률`}</title>
          {ticks.map((tick) => {
            const y =
              topPadding +
              ((chartScale - tick) / (chartScale * 2)) * plotHeight;
            return (
              <g key={tick}>
                <line
                  x1={leftPadding}
                  x2={chartWidth - rightPadding}
                  y1={y}
                  y2={y}
                  stroke={tick === 0 ? "#aeb8aa" : "#e1e5da"}
                  strokeWidth="1"
                />
                <text
                  x={leftPadding - 8}
                  y={y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fill="#687064"
                  fontSize="11"
                >
                  {formatAxisReturn(tick)}
                </text>
              </g>
            );
          })}
          <polyline
            points={points}
            fill="none"
            stroke="#1f4a3d"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="mt-2 flex justify-between text-xs text-[#7a8175]">
        <span>{formatSimulationDate(rows[0]?.serviceDate ?? null)}</span>
        <span>{formatSimulationDate(rows.at(-1)?.serviceDate ?? null)}</span>
      </div>

      <details
        data-observed-return-table
        className="mt-4 border-t border-[#e1e5da] pt-3"
      >
        <summary className="cursor-pointer text-sm font-semibold text-[#253029]">
          전체 {rows.length}개 수익률 표 보기
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left text-sm">
            <thead className="border-y border-[#d7ddcf] text-xs text-[#687064]">
              <tr>
                <th className="px-3 py-2 font-semibold">이전 기준일</th>
                <th className="px-3 py-2 font-semibold">기준일</th>
                <th className="px-3 py-2 text-right font-semibold">KRW 수익률</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.serviceDate} className="border-b border-[#e8ebe3]">
                  <td className="whitespace-nowrap px-3 py-2">
                    {formatSimulationDate(row.previousServiceDate)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium">
                    {formatSimulationDate(row.serviceDate)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {formatSignedReturn(row.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

export function resolveObservedReturnScale(input: InputReadiness) {
  const maxAbsoluteReturn = Math.max(
    ...(input.observedReturns ?? []).map((row) => Math.abs(row.value)),
    0,
  );
  return Math.max(maxAbsoluteReturn * 1.05, 0.0001);
}

export function resolveSharedObservedReturnScale(
  inputs: readonly InputReadiness[],
) {
  const readyInputs = inputs.filter(
    (input) => input.status === "matrix_ready" && input.observedReturns,
  );
  if (readyInputs.length < 2) return null;

  const maxAbsoluteReturn = Math.max(
    ...readyInputs.flatMap((input) =>
      (input.observedReturns ?? []).map((row) => Math.abs(row.value)),
    ),
    0,
  );
  return Math.max(maxAbsoluteReturn * 1.05, 0.0001);
}

function ReturnSummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#fbfcf7] px-3 py-2">
      <dt className="text-xs text-[#687064]">{label}</dt>
      <dd className="mt-1 font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
