import type { InvestmentLabFixedMixComparisonEntry } from "@/lib/investment-lab-fixed-mix-comparison";

const WIDTH = 1000;
const HEIGHT = 360;
const PADDING_X = 48;
const PADDING_Y = 36;
const SERIES_COLORS = ["#cb5948", "#527f72", "#b28a3e"] as const;

export function InvestmentLabFixedMixComparisonChart({
  scenarios,
}: {
  scenarios: readonly InvestmentLabFixedMixComparisonEntry[];
}) {
  const ready = scenarios.filter(
    (entry) => entry.scenario.status === "ready",
  );
  if (ready.length === 0) return null;

  const actualRows = ready[0].scenario.rows;
  const values = [
    ...actualRows.map((row) => row.actualMarketValueKrw),
    ...ready.flatMap((entry) =>
      entry.scenario.rows.map((row) => row.scenarioMarketValueKrw),
    ),
  ];
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = Math.max(maxValue - minValue, 1);
  const paddedMin = minValue - range * 0.08;
  const paddedMax = maxValue + range * 0.08;
  const x = (index: number) =>
    PADDING_X +
    (index / Math.max(actualRows.length - 1, 1)) *
      (WIDTH - PADDING_X * 2);
  const y = (value: number) =>
    PADDING_Y +
    ((paddedMax - value) / (paddedMax - paddedMin)) *
      (HEIGHT - PADDING_Y * 2);
  const points = (values: readonly number[]) =>
    values.map((value, index) => `${x(index)},${y(value)}`).join(" ");

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-sm text-[#5f665d]">
        <Legend color="#1e3a34" label="실제 포트폴리오" />
        {ready.map((entry, index) => (
          <Legend
            color={SERIES_COLORS[index]}
            key={entry.id}
            label={`${entry.kodexWeightPct}:${entry.vooWeightPct}`}
          />
        ))}
      </div>
      <svg
        aria-labelledby="investment-lab-standard-mix-title investment-lab-standard-mix-description"
        className="block h-auto w-full"
        role="img"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        <title id="investment-lab-standard-mix-title">
          실제 포트폴리오와 세 가지 고정비중 경로 비교
        </title>
        <desc id="investment-lab-standard-mix-description">
          같은 관측 날짜와 외부 현금흐름을 사용한 KODEX 200 및 VOO 고정비중
          연구 경로입니다.
        </desc>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const lineY = PADDING_Y + ratio * (HEIGHT - PADDING_Y * 2);
          return (
            <line
              key={ratio}
              stroke="#dfe3d8"
              strokeDasharray="4 6"
              strokeWidth="1"
              x1={PADDING_X}
              x2={WIDTH - PADDING_X}
              y1={lineY}
              y2={lineY}
            />
          );
        })}
        <polyline
          fill="none"
          points={points(actualRows.map((row) => row.actualMarketValueKrw))}
          stroke="#1e3a34"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="4"
        />
        {ready.map((entry, index) => (
          <polyline
            fill="none"
            key={entry.id}
            points={points(
              entry.scenario.rows.map((row) => row.scenarioMarketValueKrw),
            )}
            stroke={SERIES_COLORS[index]}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="3"
          />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-xs text-[#72786e]">
        <span>{formatDate(actualRows[0]?.serviceDate)}</span>
        <span>{formatDate(actualRows.at(-1)?.serviceDate)}</span>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className="h-1 w-7 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

function formatDate(value?: string) {
  return value ? value.replaceAll("-", ".") : "-";
}
