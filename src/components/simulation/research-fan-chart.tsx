type ResearchFanChartData = Readonly<{
  id: string;
  name: string;
  assumptions: Readonly<{ horizon: number }>;
  bands: readonly Readonly<{
    stepIndex: number;
    p10: number;
    p50: number;
    p90: number;
  }>[];
  samplePaths: readonly Readonly<{
    pathIndex: number;
    points: readonly Readonly<{
      stepIndex: number;
      indexValue: number;
    }>[];
  }>[];
}>;

export type ResearchFanChartValueDomain = Readonly<{
  min: number;
  max: number;
}>;

export function resolveResearchFanChartValueDomain(
  executions: readonly ResearchFanChartData[],
): ResearchFanChartValueDomain {
  const values = executions.flatMap(collectValues);
  return Object.freeze({
    min: Math.min(...values),
    max: Math.max(...values),
  });
}

export function ResearchFanChart({
  execution,
  valueDomain,
}: {
  execution: ResearchFanChartData;
  valueDomain?: ResearchFanChartValueDomain;
}) {
  const width = 760;
  const height = 280;
  const padding = 28;
  const values = collectValues(execution);
  const rawMin = valueDomain?.min ?? Math.min(...values);
  const rawMax = valueDomain?.max ?? Math.max(...values);
  const spread = Math.max(rawMax - rawMin, 1);
  const min = rawMin - spread * 0.08;
  const max = rawMax + spread * 0.08;
  const x = (stepIndex: number) =>
    padding +
    (stepIndex / execution.assumptions.horizon) * (width - padding * 2);
  const y = (value: number) =>
    height - padding - ((value - min) / (max - min)) * (height - padding * 2);
  const bandArea = [
    ...execution.bands.map((band) => [x(band.stepIndex), y(band.p90)] as const),
    ...[...execution.bands]
      .reverse()
      .map((band) => [x(band.stepIndex), y(band.p10)] as const),
  ];

  return (
    <figure className="px-3 py-4" data-research-fan-chart={execution.id}>
      <svg
        aria-label={`${execution.name} 연구 시뮬레이션 경로와 P10 P50 P90 구간`}
        className="h-auto w-full"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <line
          stroke="#d5dacf"
          strokeDasharray="4 5"
          x1={padding}
          x2={width - padding}
          y1={y(100)}
          y2={y(100)}
        />
        <path d={closedPath(bandArea)} fill="#dce8de" opacity="0.9" />
        {execution.samplePaths.map((path) => (
          <path
            d={linePath(
              path.points.map((point) => [
                x(point.stepIndex),
                y(point.indexValue),
              ]),
            )}
            fill="none"
            key={path.pathIndex}
            opacity="0.22"
            stroke="#78867a"
            strokeWidth="1"
          />
        ))}
        <path
          d={linePath(
            execution.bands.map((band) => [x(band.stepIndex), y(band.p10)]),
          )}
          fill="none"
          stroke="#8ca295"
          strokeDasharray="5 4"
          strokeWidth="1.5"
        />
        <path
          d={linePath(
            execution.bands.map((band) => [x(band.stepIndex), y(band.p90)]),
          )}
          fill="none"
          stroke="#8ca295"
          strokeDasharray="5 4"
          strokeWidth="1.5"
        />
        <path
          d={linePath(
            execution.bands.map((band) => [x(band.stepIndex), y(band.p50)]),
          )}
          fill="none"
          stroke="#173f38"
          strokeWidth="2.5"
        />
        <text fill="#687064" fontSize="11" x={padding} y={height - 6}>
          시작
        </text>
        <text
          fill="#687064"
          fontSize="11"
          textAnchor="end"
          x={width - padding}
          y={height - 6}
        >
          {execution.assumptions.horizon}단계
        </text>
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-[#687064]">
        <span>진한 선: 중앙값(P50)</span>
        <span>연한 구간: P10~P90</span>
        <span>가는 선: 대표 경로 {execution.samplePaths.length}개</span>
      </figcaption>
    </figure>
  );
}

function collectValues(execution: ResearchFanChartData) {
  return [
    ...execution.bands.flatMap((band) => [band.p10, band.p50, band.p90]),
    ...execution.samplePaths.flatMap((path) =>
      path.points.map((point) => point.indexValue),
    ),
  ];
}

function linePath(points: readonly (readonly [number, number])[]) {
  return points
    .map(
      ([x, y], index) =>
        `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`,
    )
    .join(" ");
}

function closedPath(points: readonly (readonly [number, number])[]) {
  return `${linePath(points)} Z`;
}
