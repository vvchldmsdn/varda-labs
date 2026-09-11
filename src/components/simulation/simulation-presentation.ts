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
  /** All normalized NAV paths, laid out path-major with horizon + 1 points each. */
  displayPaths?: Readonly<{
    pathCount: number;
    horizon: number;
    values: readonly number[];
  }> | null;
}>;

export type SimulationFanPathSource =
  | Readonly<{ kind: "all"; paths: NonNullable<ResearchFanChartData["displayPaths"]> }>
  | Readonly<{ kind: "sample"; paths: ResearchFanChartData["samplePaths"] }>;

export function resolveSimulationFanPathSource(execution: ResearchFanChartData): SimulationFanPathSource {
  const paths = execution.displayPaths;
  if (paths && Number.isSafeInteger(paths.pathCount) && paths.pathCount > 0 &&
      Number.isSafeInteger(paths.horizon) && paths.horizon === execution.assumptions.horizon && paths.horizon >= 0 &&
      paths.values.length === paths.pathCount * (paths.horizon + 1) &&
      paths.values.every((value) => Number.isFinite(value) && value >= 0)) {
    return { kind: "all", paths };
  }
  return { kind: "sample", paths: execution.samplePaths };
}

export function simulationFanPathCount(source: SimulationFanPathSource) {
  return source.kind === "all" ? source.paths.pathCount : source.paths.length;
}

export function simulationFanPathIdentity(source: SimulationFanPathSource, path: number) {
  return source.kind === "all" ? path : source.paths[path]?.pathIndex;
}

/** Only the selected path is expanded into objects; drawing all paths stays allocation-free. */
export function forEachSimulationFanPathPoint(
  source: SimulationFanPathSource,
  path: number,
  visit: (step: number, value: number) => void,
) {
  if (source.kind === "all") {
    const stride = source.paths.horizon + 1;
    const offset = path * stride;
    for (let step = 0; step < stride; step += 1) visit(step, source.paths.values[offset + step]);
  } else {
    for (const point of source.paths[path]?.points ?? []) visit(point.stepIndex, point.indexValue);
  }
}

export function nearestSimulationFanPathPoint(source: SimulationFanPathSource, path: number, step: number) {
  if (path < 0 || path >= simulationFanPathCount(source)) return null;
  if (source.kind === "all") {
    const stepIndex = Math.max(0, Math.min(source.paths.horizon, Math.round(step)));
    return { stepIndex, indexValue: source.paths.values[path * (source.paths.horizon + 1) + stepIndex] };
  }
  const points = source.paths[path].points;
  if (!points.length) return null;
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].stepIndex < step) low = middle + 1;
    else high = middle;
  }
  return low > 0 && step - points[low - 1].stepIndex <= points[low].stepIndex - step ? points[low - 1] : points[low];
}

/** O(path count) for complete paths, without rebuilding their drawing geometry on hover. */
export function nearestSimulationFanPath(
  source: SimulationFanPathSource,
  step: number,
  pointerY: number,
  y: (value: number) => number,
  maxDistance = 24,
) {
  let nearest: number | null = null;
  let distance = maxDistance;
  for (let path = 0; path < simulationFanPathCount(source); path += 1) {
    const point = nearestSimulationFanPathPoint(source, path, step);
    if (!point) continue;
    const candidateDistance = Math.abs(y(point.indexValue) - pointerY);
    if (candidateDistance < distance) {
      nearest = path;
      distance = candidateDistance;
    }
  }
  return nearest;
}

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
    const source = resolveSimulationFanPathSource(execution);
    if (source.kind === "all") {
      for (const value of source.paths.values) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
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
