export type SvgCurvePoint = Readonly<{
  x: number;
  y: number;
}>;

export function buildMonotoneCurvePath(points: readonly SvgCurvePoint[]) {
  if (points.length === 0) return "";
  if (points.length < 3 || !hasStrictlyIncreasingFiniteCoordinates(points)) {
    return linearPath(points);
  }

  const segmentSlopes = points.slice(1).map((point, index) => {
    const previous = points[index]!;
    return (point.y - previous.y) / (point.x - previous.x);
  });
  const tangents = points.map((_, index) => {
    if (index === 0) return segmentSlopes[0]!;
    if (index === points.length - 1) return segmentSlopes.at(-1)!;
    const previous = segmentSlopes[index - 1]!;
    const next = segmentSlopes[index]!;
    if (previous === 0 || next === 0 || Math.sign(previous) !== Math.sign(next)) return 0;
    return (2 * previous * next) / (previous + next);
  });

  for (let index = 0; index < segmentSlopes.length; index += 1) {
    const slope = segmentSlopes[index]!;
    if (slope === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }
    const leftRatio = tangents[index]! / slope;
    const rightRatio = tangents[index + 1]! / slope;
    const magnitude = leftRatio * leftRatio + rightRatio * rightRatio;
    if (magnitude <= 9) continue;
    const scale = 3 / Math.sqrt(magnitude);
    tangents[index] = scale * leftRatio * slope;
    tangents[index + 1] = scale * rightRatio * slope;
  }

  const commands = [`M${coordinate(points[0]!)}`];
  for (let index = 0; index < points.length - 1; index += 1) {
    const left = points[index]!;
    const right = points[index + 1]!;
    const width = right.x - left.x;
    commands.push(
      `C${coordinate({ x: left.x + width / 3, y: left.y + tangents[index]! * width / 3 })}` +
        ` ${coordinate({ x: right.x - width / 3, y: right.y - tangents[index + 1]! * width / 3 })}` +
        ` ${coordinate(right)}`,
    );
  }
  return commands.join(" ");
}

function hasStrictlyIncreasingFiniteCoordinates(points: readonly SvgCurvePoint[]) {
  return points.every((point, index) =>
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    (index === 0 || point.x > points[index - 1]!.x),
  );
}

function linearPath(points: readonly SvgCurvePoint[]) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${coordinate(point)}`)
    .join(" ");
}

function coordinate(point: SvgCurvePoint) {
  return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
}
