type ComparisonPoint = Readonly<{
  stepIndex: number;
  indexValue: number;
}>;

type ComparisonSeries = Readonly<{
  id: string;
  label: string;
  color: string;
  points: readonly ComparisonPoint[];
}>;

export function SimulationPathComparisonChart({
  ariaLabel,
  series,
}: {
  ariaLabel: string;
  series: readonly ComparisonSeries[];
}) {
  const width = 720;
  const height = 260;
  const padding = Object.freeze({ top: 20, right: 18, bottom: 28, left: 52 });
  const values = series.flatMap((item) =>
    item.points.map((point) => point.indexValue),
  );
  const rawMinimum = Math.min(...values);
  const rawMaximum = Math.max(...values);
  const safeMinimum = Number.isFinite(rawMinimum) ? rawMinimum : 99;
  const safeMaximum = Number.isFinite(rawMaximum) ? rawMaximum : 101;
  const spread = Math.max(safeMaximum - safeMinimum, 1);
  const yMinimum = safeMinimum - spread * 0.08;
  const yMaximum = safeMaximum + spread * 0.08;
  const maximumStep = Math.max(
    1,
    ...series.flatMap((item) =>
      item.points.map((point) => point.stepIndex),
    ),
  );
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const yTicks = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    return Object.freeze({
      value: yMaximum - (yMaximum - yMinimum) * ratio,
      y: padding.top + plotHeight * ratio,
    });
  });

  return (
    <figure data-simulation-path-comparison-chart>
      <div className="flex flex-wrap gap-4 text-xs text-[#596158]">
        {series.map((item) => (
          <span className="inline-flex items-center gap-2" key={item.id}>
            <span
              aria-hidden="true"
              className="h-0.5 w-5"
              style={{ backgroundColor: item.color }}
            />
            {item.label}
          </span>
        ))}
      </div>
      <svg
        aria-label={ariaLabel}
        className="mt-3 block aspect-[18/7] w-full min-w-[560px]"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <title>{ariaLabel}</title>
        {yTicks.map((tick) => (
          <g key={tick.y}>
            <line
              stroke="#dde2d7"
              strokeWidth="1"
              x1={padding.left}
              x2={width - padding.right}
              y1={tick.y}
              y2={tick.y}
            />
            <text
              fill="#687064"
              fontSize="10"
              textAnchor="end"
              x={padding.left - 8}
              y={tick.y + 3}
            >
              {tick.value.toFixed(1)}
            </text>
          </g>
        ))}
        {series.map((item) => (
          <path
            d={toPath(item.points, {
              maximumStep,
              padding,
              plotHeight,
              plotWidth,
              yMaximum,
              yMinimum,
            })}
            fill="none"
            key={item.id}
            stroke={item.color}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.5"
          />
        ))}
        <text
          fill="#687064"
          fontSize="10"
          textAnchor="start"
          x={padding.left}
          y={height - 8}
        >
          검증 시작
        </text>
        <text
          fill="#687064"
          fontSize="10"
          textAnchor="end"
          x={width - padding.right}
          y={height - 8}
        >
          {maximumStep}개 관측 후
        </text>
      </svg>
    </figure>
  );
}

function toPath(
  points: readonly ComparisonPoint[],
  scale: {
    maximumStep: number;
    padding: Readonly<{
      top: number;
      right: number;
      bottom: number;
      left: number;
    }>;
    plotHeight: number;
    plotWidth: number;
    yMaximum: number;
    yMinimum: number;
  },
) {
  return points
    .map((point, index) => {
      const x =
        scale.padding.left +
        (point.stepIndex / scale.maximumStep) * scale.plotWidth;
      const y =
        scale.padding.top +
        ((scale.yMaximum - point.indexValue) /
          (scale.yMaximum - scale.yMinimum)) *
          scale.plotHeight;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}
