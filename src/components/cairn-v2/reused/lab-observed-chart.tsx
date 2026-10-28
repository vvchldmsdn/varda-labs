// Limited display extraction: investment-lab-observed-history.tsx at baseline 7ef25af; no query/navigation.
import type {InvestmentLabObservedHistorySegment} from "@/lib/investment-lab-observed-history-segments";
const WIDTH=1000,HEIGHT=300,PADDING_X=48,PADDING_Y=28;
export function ObservedHistoryChart({
  segments,
}: {
  segments: readonly InvestmentLabObservedHistorySegment[];
}) {
  const rows = segments.flatMap((segment) => segment.rows);
  const timestamps = rows.map((row) => Date.parse(`${row.serviceDate}T00:00:00Z`));
  const values = rows.map((row) => row.totalMarketValueKrw);
  const minTimestamp = Math.min(...timestamps);
  const maxTimestamp = Math.max(...timestamps);
  const timestampRange = Math.max(maxTimestamp - minTimestamp, 1);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valueRange = Math.max(maxValue - minValue, 1);
  const paddedMin = minValue - valueRange * 0.08;
  const paddedMax = maxValue + valueRange * 0.08;
  const x = (serviceDate: string) =>
    PADDING_X +
    ((Date.parse(`${serviceDate}T00:00:00Z`) - minTimestamp) / timestampRange) *
      (WIDTH - PADDING_X * 2);
  const y = (value: number) =>
    PADDING_Y +
    ((paddedMax - value) / (paddedMax - paddedMin)) *
      (HEIGHT - PADDING_Y * 2);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-sm text-[#5f665d]">
        <Legend color="#8a6b3d" label="이전 서비스 관측" />
        <Legend color="#1e3a34" label="현재 저장기 관측" />
        <span>점 하나가 실제 저장 관측일입니다.</span>
      </div>
      <svg
        aria-labelledby="observed-history-title observed-history-description"
        className="block h-auto w-full"
        role="img"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        <title id="observed-history-title">저장 출처별 실제 평가액 관측 경로</title>
        <desc id="observed-history-description">
          레거시 관측과 현재 저장기 관측을 서로 연결하지 않고 표시한 그래프
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
        {segments.map((segment, index) => {
          const color = segmentColor(segment.role);
          const points = segment.rows
            .map(
              (row) =>
                `${x(row.serviceDate)},${y(row.totalMarketValueKrw)}`,
            )
            .join(" ");
          return (
            <g key={`${segment.role}:${segment.startServiceDate}:${index}`}>
              {segment.rows.length > 1 ? (
                <polyline
                  fill="none"
                  points={points}
                  stroke={color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="4"
                />
              ) : null}
              {segment.rows.map((row) => (
                <circle
                  key={row.serviceDate}
                  cx={x(row.serviceDate)}
                  cy={y(row.totalMarketValueKrw)}
                  fill="#fbfcf7"
                  r="4"
                  stroke={color}
                  strokeWidth="3"
                />
              ))}
            </g>
          );
        })}
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

function segmentColor(role: InvestmentLabObservedHistorySegment["role"]) {
  return role === "legacy_display" ? "#8a6b3d" : "#1e3a34";
}

function formatDate(value?: string) {
  return value ? value.replaceAll("-", ".") : "-";
}
