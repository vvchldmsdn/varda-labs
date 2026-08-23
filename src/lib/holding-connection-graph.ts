import type {
  PortfolioDashboardHeatmapCell,
  PortfolioDashboardHoldingHistory,
} from "./portfolio-dashboard-history.ts";

export type HoldingConnectionNode = Readonly<{
  holdingId: string;
  name: string;
  currentWeight: number;
  x: number;
  y: number;
  radius: number;
}>;

export type HoldingConnectionEdge = Readonly<{
  key: string;
  leftIndex: number;
  rightIndex: number;
  correlation: number;
  observations: number;
}>;

export function buildHoldingConnectionGraph(
  history: PortfolioDashboardHoldingHistory,
) {
  const rows = [...history.rows]
    .filter((row) => row.cells.some((cell) => cell.changePct !== null))
    .toSorted((left, right) => right.currentWeight - left.currentWeight)
    .slice(0, 7);
  const maxWeight = Math.max(...rows.map((row) => row.currentWeight), 1);
  const nodes: HoldingConnectionNode[] = rows.map((row, index) => {
    const angle = -Math.PI / 2 + (index / rows.length) * Math.PI * 2;
    return {
      holdingId: row.holdingId,
      name: row.name,
      currentWeight: row.currentWeight,
      x: 450 + Math.cos(angle) * 330,
      y: 142 + Math.sin(angle) * 98,
      radius: 9 + Math.sqrt(Math.max(row.currentWeight, 0) / maxWeight) * 10,
    };
  });
  const edges: HoldingConnectionEdge[] = [];

  for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
      const relationship = pairwiseCorrelation(
        rows[leftIndex]?.cells ?? [],
        rows[rightIndex]?.cells ?? [],
      );
      if (!relationship || Math.abs(relationship.correlation) < 0.18) continue;
      edges.push({
        key: `${rows[leftIndex]?.holdingId}:${rows[rightIndex]?.holdingId}`,
        leftIndex,
        rightIndex,
        ...relationship,
      });
    }
  }

  return {
    nodes,
    edges: edges
      .toSorted(
        (left, right) => Math.abs(right.correlation) - Math.abs(left.correlation),
      )
      .slice(0, 12),
  };
}

function pairwiseCorrelation(
  left: readonly PortfolioDashboardHeatmapCell[],
  right: readonly PortfolioDashboardHeatmapCell[],
) {
  const rightByDate = new Map(right.map((cell) => [cell.date, cell.changePct]));
  const pairs = left.flatMap((cell) => {
    const rightValue = rightByDate.get(cell.date);
    return cell.changePct !== null && rightValue !== null && rightValue !== undefined
      ? [[cell.changePct, rightValue] as const]
      : [];
  });
  if (pairs.length < 6) return null;

  const leftMean = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length;
  const rightMean = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (const [leftValue, rightValue] of pairs) {
    const leftDelta = leftValue - leftMean;
    const rightDelta = rightValue - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  if (!Number.isFinite(denominator) || denominator <= 0) return null;

  return {
    correlation: Math.max(-1, Math.min(1, covariance / denominator)),
    observations: pairs.length,
  };
}
