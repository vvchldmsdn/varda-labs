import { convertToKrw, percentOrNull, sumComplete, toNumber } from "../portfolio-math.ts";

type SnapshotCostInput = Readonly<{
  quantity: string;
  averageCost: string | null;
  fractionalKrwValue: string | null;
  fractionalAvgCost: string | null;
  currency: string;
}>;

/** Acquisition cost is separate evidence from today's valuation. */
export function snapshotPositionCostBasisKrw(asset: SnapshotCostInput, usdKrw: number): number | null {
  const quantity = toNumber(asset.quantity);
  const averageCost = toNumber(asset.averageCost);
  const fractionalValue = asset.fractionalKrwValue === null ? 0 : toNumber(asset.fractionalKrwValue);
  const fractionalCost = asset.fractionalAvgCost === null
    ? fractionalValue === 0 ? 0 : null
    : toNumber(asset.fractionalAvgCost);
  if (quantity === null || quantity < 0 || fractionalValue === null || fractionalValue < 0 ||
      fractionalCost === null || fractionalCost < 0 || (fractionalValue > 0 && fractionalCost === 0) ||
      (quantity > 0 && (averageCost === null || averageCost <= 0))) return null;
  const wholeCost = quantity === 0 ? 0 : convertToKrw(quantity * (averageCost as number), asset.currency, usdKrw);
  if (wholeCost === null) return null;
  const total = wholeCost + fractionalCost;
  return Number.isFinite(total) ? total : null;
}

export function summarizeSnapshotCostEvidence(
  positions: readonly Readonly<{ costKrw: number | null; pnlKrw: number | null }>[],
  realizedCostBasisKrw: number | null,
  realizedPnlKrw: number | null,
) {
  const openCostKrw = sumComplete(positions, (position) => position.costKrw);
  const unrealizedPnlKrw = sumComplete(positions, (position) => position.pnlKrw);
  const totalCost = sumComplete([openCostKrw, realizedCostBasisKrw], value => value);
  const totalPnl = sumComplete([unrealizedPnlKrw, realizedPnlKrw], value => value);
  return { openCostKrw, unrealizedPnlKrw, totalCost, totalPnl, totalReturnPct: percentOrNull(totalPnl, totalCost) };
}
