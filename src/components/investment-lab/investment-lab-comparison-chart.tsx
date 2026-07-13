type InvestmentLabComparisonChartRow = Readonly<{
  serviceDate: string;
  actualMarketValueKrw: number;
  scenarioMarketValueKrw: number;
  hasPendingExecution: boolean;
}>;

const WIDTH = 1000;
const HEIGHT = 340;
const PADDING_X = 48;
const PADDING_Y = 34;

export function InvestmentLabComparisonChart({
  chartId,
  description,
  rows,
  scenarioLabel,
  title,
}: {
  chartId: string;
  description: string;
  rows: readonly InvestmentLabComparisonChartRow[];
  scenarioLabel: string;
  title: string;
}) {
  const values = rows.flatMap((row) => [
    row.actualMarketValueKrw,
    row.scenarioMarketValueKrw,
  ]);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = Math.max(maxValue - minValue, 1);
  const paddedMin = minValue - range * 0.08;
  const paddedMax = maxValue + range * 0.08;
  const x = (index: number) =>
    PADDING_X +
    (index / Math.max(rows.length - 1, 1)) * (WIDTH - PADDING_X * 2);
  const y = (value: number) =>
    PADDING_Y +
    ((paddedMax - value) / (paddedMax - paddedMin)) *
      (HEIGHT - PADDING_Y * 2);
  const actualPoints = rows
    .map((row, index) => `${x(index)},${y(row.actualMarketValueKrw)}`)
    .join(" ");
  const scenarioPoints = rows
    .map((row, index) => `${x(index)},${y(row.scenarioMarketValueKrw)}`)
    .join(" ");

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-sm text-[#5f665d]">
        <Legend color="#1e3a34" label="실제 포트폴리오" />
        <Legend color="#e05b49" label={scenarioLabel} />
        <span>원 표시는 지연 체결 비교일</span>
      </div>
      <svg
        aria-labelledby={`${chartId}-title ${chartId}-description`}
        className="block h-auto w-full"
        role="img"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        <title id={`${chartId}-title`}>{title}</title>
        <desc id={`${chartId}-description`}>{description}</desc>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const lineY = PADDING_Y + ratio * (HEIGHT - PADDING_Y * 2);
          return (
            <line
              key={ratio}
              x1={PADDING_X}
              x2={WIDTH - PADDING_X}
              y1={lineY}
              y2={lineY}
              stroke="#dfe3d8"
              strokeDasharray="4 6"
              strokeWidth="1"
            />
          );
        })}
        <polyline
          fill="none"
          points={actualPoints}
          stroke="#1e3a34"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="4"
        />
        <polyline
          fill="none"
          points={scenarioPoints}
          stroke="#e05b49"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="4"
        />
        {rows.map((row, index) =>
          row.hasPendingExecution ? (
            <circle
              key={row.serviceDate}
              cx={x(index)}
              cy={y(row.scenarioMarketValueKrw)}
              fill="#fbfcf7"
              r="7"
              stroke="#e05b49"
              strokeWidth="3"
            />
          ) : null,
        )}
      </svg>
      <div className="mt-1 flex justify-between text-xs text-[#72786e]">
        <span>{formatDate(rows[0]?.serviceDate)}</span>
        <span>{formatDate(rows.at(-1)?.serviceDate)}</span>
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
