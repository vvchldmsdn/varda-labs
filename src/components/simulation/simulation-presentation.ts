export type ResearchFanChartData = Readonly<{
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
    points: readonly Readonly<{ stepIndex: number; indexValue: number }>[];
  }>[];
}>;

export type ResearchFanChartValueDomain = Readonly<{
  min: number;
  max: number;
}>;

export function resolveResearchFanChartValueDomain(
  executions: readonly ResearchFanChartData[],
): ResearchFanChartValueDomain {
  let min = 100;
  let max = 100;
  for (const execution of executions) {
    for (const band of execution.bands) {
      for (const value of [band.p10, band.p50, band.p90]) {
        if (Number.isFinite(value)) {
          min = Math.min(min, value);
          max = Math.max(max, value);
        }
      }
    }
    for (const path of execution.samplePaths) {
      for (const point of path.points) {
        if (Number.isFinite(point.indexValue)) {
          min = Math.min(min, point.indexValue);
          max = Math.max(max, point.indexValue);
        }
      }
    }
  }
  return { min, max };
}

export function nearestSimulationBand(
  bands: ResearchFanChartData["bands"],
  step: number,
) {
  if (!bands.length) return null;
  let low = 0;
  let high = bands.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (bands[middle].stepIndex < step) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return bands[0];
  return step - bands[low - 1].stepIndex <= bands[low].stepIndex - step
    ? bands[low - 1]
    : bands[low];
}

export function simulationReturnLabel(indexValue: number) {
  const value = indexValue - 100;
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}
