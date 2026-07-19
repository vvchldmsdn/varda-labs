import type { InvestmentLabAnchorBasketScenario } from "@/lib/investment-lab-anchor-basket-scenario";
import type { InvestmentLabCounterfactualReadModel } from "@/lib/investment-lab-counterfactual-read-model";
import {
  buildInvestmentLabScenarioChart,
  type InvestmentLabScenarioChartLine,
} from "@/lib/investment-lab-scenario-chart";

const WIDTH = 1100;
const HEIGHT = 420;
const PADDING_LEFT = 86;
const PADDING_RIGHT = 28;
const PADDING_Y = 34;

export function InvestmentLabScenarioChartView({
  anchorBasketScenario,
  model,
}: {
  anchorBasketScenario: InvestmentLabAnchorBasketScenario;
  model: InvestmentLabCounterfactualReadModel;
}) {
  const chart = buildInvestmentLabScenarioChart({
    model,
    anchorBasketScenario,
  });
  if (!chart.period || chart.lines.length === 0) return null;

  const values = chart.lines.flatMap((line) =>
    line.points.map((point) => point.valueKrw),
  );
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = Math.max(maxValue - minValue, 1);
  const paddedMin = Math.max(0, minValue - range * 0.08);
  const paddedMax = maxValue + range * 0.08;
  const axis = chart.lines[0].points.map((point) => point.serviceDate);
  const x = (index: number) =>
    PADDING_LEFT +
    (index / Math.max(axis.length - 1, 1)) *
      (WIDTH - PADDING_LEFT - PADDING_RIGHT);
  const y = (value: number) =>
    PADDING_Y +
    ((paddedMax - value) / Math.max(paddedMax - paddedMin, 1)) *
      (HEIGHT - PADDING_Y * 2);

  return (
    <section
      className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4"
      data-scenario-chart-lines={chart.lines.length}
      data-scenario-chart-status={chart.status}
      data-scenario-chart-unavailable={chart.unavailableScenarioIds.length}
      data-section="investment-lab-scenario-chart"
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold">시나리오 평가액 경로</h2>
          <p className="mt-1 text-sm leading-6 text-[#687064]">
            같은 관측일 축에서 계산된 경로만 함께 표시합니다. 결손 경로는
            보간하지 않고 선 하나만 제외합니다.
          </p>
        </div>
        <p className="text-xs leading-5 text-[#73786c]">
          {formatDate(chart.period.startServiceDate)} ~{" "}
          {formatDate(chart.period.endServiceDate)} ·{" "}
          {chart.period.comparisonDateCount}개 평가일
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[#525a51]">
        {chart.lines.map((line) => (
          <Legend key={line.id} line={line} />
        ))}
      </div>

      <div className="mt-3 overflow-x-auto">
        <svg
          aria-labelledby="investment-lab-scenario-chart-title investment-lab-scenario-chart-description"
          className="block h-auto min-w-[760px] w-full"
          role="img"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        >
          <title id="investment-lab-scenario-chart-title">
            실제 포트폴리오와 준비된 연구 시나리오 평가액 비교
          </title>
          <desc id="investment-lab-scenario-chart-description">
            동일한 관측일에 계산할 수 있는 실제, 현금, KODEX 200, VOO,
            고정혼합, 기준일 바스켓 경로만 표시합니다.
          </desc>
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const lineY = PADDING_Y + ratio * (HEIGHT - PADDING_Y * 2);
            const value = paddedMax - ratio * (paddedMax - paddedMin);
            return (
              <g key={ratio}>
                <line
                  x1={PADDING_LEFT}
                  x2={WIDTH - PADDING_RIGHT}
                  y1={lineY}
                  y2={lineY}
                  stroke="#dfe3d8"
                  strokeDasharray="4 6"
                  strokeWidth="1"
                />
                <text
                  fill="#737a70"
                  fontSize="13"
                  textAnchor="end"
                  x={PADDING_LEFT - 12}
                  y={lineY + 4}
                >
                  {compactKrw(value)}
                </text>
              </g>
            );
          })}
          {chart.lines.map((line) => (
            <g key={line.id}>
              <polyline
                fill="none"
                points={line.points
                  .map((point, index) => `${x(index)},${y(point.valueKrw)}`)
                  .join(" ")}
                stroke={line.color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={line.id === "actual" ? 4 : 3}
              />
              {line.points.map((point, index) =>
                point.hasPendingExecution ? (
                  <circle
                    key={`${line.id}:${point.serviceDate}`}
                    cx={x(index)}
                    cy={y(point.valueKrw)}
                    fill="#fbfcf7"
                    r="5"
                    stroke={line.color}
                    strokeWidth="2"
                  />
                ) : null,
              )}
            </g>
          ))}
        </svg>
      </div>

      <div className="mt-1 flex justify-between text-xs text-[#72786e]">
        <span>{formatDate(axis[0])}</span>
        <span>{formatDate(axis.at(-1))}</span>
      </div>
      {chart.unavailableScenarioIds.length > 0 ? (
        <p className="mt-3 rounded-md border border-[#eadfbe] bg-[#fff9e8] px-3 py-2 text-sm text-[#725f2d]">
          계산 근거가 부족한 {chart.unavailableScenarioIds.length}개 경로는
          그리지 않았습니다. 아래 비교표에서 경로별 사유를 확인할 수
          있습니다.
        </p>
      ) : null}
    </section>
  );
}

function Legend({ line }: { line: InvestmentLabScenarioChartLine }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className="h-1 w-7 rounded-full"
        style={{ backgroundColor: line.color }}
      />
      {line.label}
    </span>
  );
}

function compactKrw(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억`;
  if (absolute >= 10_000) return `${Math.round(value / 10_000)}만`;
  return Math.round(value).toLocaleString("ko-KR");
}

function formatDate(value?: string) {
  return value ? value.replaceAll("-", ".") : "-";
}
