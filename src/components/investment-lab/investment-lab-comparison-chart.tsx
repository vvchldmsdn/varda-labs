import { nearestLabDateIndex } from "./investment-lab-chart-presentation";
import { LabText } from "./lab-text";
import { LocalizedSvgText } from "@/components/i18n/localized-text";
import { labEnglish } from "./lab-copy";
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
  inspect,
  palette = { actual: "var(--ink)", scenario: "var(--negative)", axis: "var(--line)", surface: "var(--surface)" },
}: {
  chartId: string;
  description: string;
  rows: readonly InvestmentLabComparisonChartRow[];
  scenarioLabel: string;
  title: string;
  inspect?: { width: number; height: number; selected: number; select: (index: number) => void; axis: (value: number) => string };
  palette?: { actual: string; scenario: string; axis: string; surface: string };
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
  const width = inspect?.width ?? WIDTH, height = inspect?.height ?? HEIGHT;
  const left = inspect ? 51 : PADDING_X, right = inspect ? 7 : PADDING_X;
  const top = inspect ? 12 : PADDING_Y;
  const dates = inspect ? rows.map(row => row.serviceDate) : [];
  const timestamp = (date: string) => Date.parse(date + "T00:00:00Z");
  const start = dates.length ? timestamp(dates[0]) : 0;
  const duration = dates.length > 1 ? timestamp(dates[dates.length - 1]) - start : 0;
  const x = (index: number) => {
    const fraction = duration ? (timestamp(dates[index]) - start) / duration : index / Math.max(rows.length - 1, 1);
    return left + fraction * (width - left - right);
  };
  function selectAt(svg: SVGSVGElement, clientX: number) {
    if (!inspect || !rows.length) return;
    const bounds = svg.getBoundingClientRect();
    const fraction = ((clientX - bounds.left) * width / bounds.width - left) / (width - left - right);
    inspect.select(nearestLabDateIndex(dates, start + Math.max(0, Math.min(1, fraction)) * duration));
  }
  const y = (value: number) =>
    top +
    ((paddedMax - value) / (paddedMax - paddedMin)) *
      (height - top * 2);
  const actualPoints = rows
    .map((row, index) => `${x(index)},${y(row.actualMarketValueKrw)}`)
    .join(" ");
  const scenarioPoints = rows
    .map((row, index) => `${x(index)},${y(row.scenarioMarketValueKrw)}`)
    .join(" ");

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-sm text-[var(--muted)]">
        <Legend color={palette.actual} label="실제 포트폴리오" />
        <Legend color={palette.scenario} label={scenarioLabel} />
        {(!inspect || rows.some(row => row.hasPendingExecution)) && <span><LabText value="원 표시는 지연 체결 비교일" /></span>}
      </div>
      <svg
        aria-labelledby={`${chartId}-title ${chartId}-description`}
        className="block h-auto w-full"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
        onPointerMove={inspect ? event => selectAt(event.currentTarget, event.clientX) : undefined}
        onPointerDown={inspect ? event => selectAt(event.currentTarget, event.clientX) : undefined}
      >
        <LocalizedSvgText as="title" id={`${chartId}-title`} ko={title} en={labEnglish(title)} />
        <LocalizedSvgText as="desc" id={`${chartId}-description`} ko={description} en={labEnglish(description)} />
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const lineY = top + ratio * (height - top * 2);
          return (
            <line
              key={ratio}
              x1={left}
              x2={width - right}
              y1={lineY}
              y2={lineY}
              stroke={palette.axis}
              strokeDasharray="4 6"
              strokeWidth="1"
            />
          );
        })}
        {inspect && [maxValue, ...(minValue === maxValue ? [] : [minValue])].map(value => (
          <text key={value} x={left - 5} y={y(value)} textAnchor="end" dominantBaseline="middle" fontSize="10" fill="currentColor">
            {inspect.axis(value)}
          </text>
        ))}
        {inspect && <line x1={x(inspect.selected)} x2={x(inspect.selected)} y1={top} y2={height-top}
          stroke={palette.axis} strokeDasharray="3 3" />}
        <polyline
          fill="none"
          points={actualPoints}
          stroke={palette.actual}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={inspect ? 2 : 4}
        />
        <polyline
          fill="none"
          points={scenarioPoints}
          stroke={palette.scenario}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={inspect ? 2 : 4}
        />
        {rows.map((row, index) =>
          row.hasPendingExecution ? (
            <circle
              key={row.serviceDate}
              cx={x(index)}
              cy={y(row.scenarioMarketValueKrw)}
              fill={palette.surface}
              r="7"
              stroke={palette.scenario}
              strokeWidth="3"
            />
          ) : null,
        )}
        {inspect && rows[inspect.selected] && <g>
          <circle cx={x(inspect.selected)} cy={y(rows[inspect.selected].actualMarketValueKrw)}
            r="3" fill={palette.actual} stroke={palette.surface} />
          <circle cx={x(inspect.selected)} cy={y(rows[inspect.selected].scenarioMarketValueKrw)}
            r="3" fill={palette.scenario} stroke={palette.surface} />
        </g>}
      </svg>
      <div className="mt-1 flex justify-between text-xs text-[var(--muted)]">
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
      <LabText value={label} />
    </span>
  );
}

function formatDate(value?: string) {
  return value ? value.replaceAll("-", ".") : "-";
}
