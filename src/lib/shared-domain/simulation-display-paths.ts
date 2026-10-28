/** Chart-only NAV indices. Calculation buffers and their full precision stay server-side. */
export type SimulationDisplayPaths = Readonly<{
  pathCount: number;
  horizon: number;
  /** Path-major order; every path includes step zero. */
  values: readonly number[];
}>;

export function buildSimulationDisplayPaths(input: {
  pathCount: number;
  horizon: number;
  navAt: (pathIndex: number, stepIndex: number) => number;
}): SimulationDisplayPaths {
  const values = new Array<number>(input.pathCount * (input.horizon + 1));
  for (let pathIndex = 0; pathIndex < input.pathCount; pathIndex += 1) {
    for (let stepIndex = 0; stepIndex <= input.horizon; stepIndex += 1) {
      values[pathIndex * (input.horizon + 1) + stepIndex] =
        Number((100 * input.navAt(pathIndex, stepIndex)).toPrecision(7));
    }
  }
  return Object.freeze({ pathCount: input.pathCount, horizon: input.horizon, values: Object.freeze(values) });
}
