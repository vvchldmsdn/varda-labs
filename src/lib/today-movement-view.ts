import type { DashboardTodayMovement } from "@/lib/portfolio-dashboard";
import type { PortfolioDashboardHoldingHistory } from "@/lib/portfolio-dashboard-history";

export type TodayMovementAttribution = Readonly<{
  changeKrw: number | null;
  currentEvidenceKrw: number | null;
  fxImpactKrw: number | null;
  priceImpactKrw: number | null;
  tradeFlowKrw: number | null;
}>;

export type TodayHoldingHistoryPoint = Readonly<{
  basis: "market_value" | "normalized_return";
  chartValue: number;
  changePct: number | null;
  date: string;
  marketValueKrw: number | null;
}>;

export function buildTodayMovementAttribution(
  movement: Pick<
    DashboardTodayMovement,
    | "changeKrw"
    | "fxChangeKrw"
    | "previousTotalKrw"
    | "ready"
    | "tradeFlowKrw"
  >,
): TodayMovementAttribution {
  if (!movement.ready || movement.changeKrw === null) {
    return {
      changeKrw: null,
      currentEvidenceKrw: null,
      fxImpactKrw: null,
      priceImpactKrw: null,
      tradeFlowKrw: null,
    };
  }

  const fxImpactKrw = movement.fxChangeKrw ?? 0;

  return {
    changeKrw: movement.changeKrw,
    currentEvidenceKrw:
      movement.previousTotalKrw + movement.changeKrw + movement.tradeFlowKrw,
    fxImpactKrw,
    priceImpactKrw: movement.changeKrw - fxImpactKrw,
    tradeFlowKrw: movement.tradeFlowKrw,
  };
}

export function selectTodayHoldingHistory(
  history: PortfolioDashboardHoldingHistory,
  holdingId: string,
): readonly TodayHoldingHistoryPoint[] {
  const row = history.rows.find((candidate) => candidate.holdingId === holdingId);
  if (!row) return [];

  const marketValuePoints = row.cells
    .filter(
      (cell): cell is typeof cell & { marketValueKrw: number } =>
        cell.marketValueKrw !== null && Number.isFinite(cell.marketValueKrw),
    )
    .map((cell) => Object.freeze({
      basis: "market_value" as const,
      chartValue: cell.marketValueKrw,
      changePct: cell.changePct,
      date: cell.date,
      marketValueKrw: cell.marketValueKrw,
    }));
  if (marketValuePoints.length > 1) return marketValuePoints;

  let normalizedValue = 100;
  return row.cells
    .filter(
      (cell): cell is typeof cell & { changePct: number } =>
        cell.changePct !== null && Number.isFinite(cell.changePct),
    )
    .map((cell, index) => {
      if (index > 0) normalizedValue *= 1 + cell.changePct / 100;
      return Object.freeze({
        basis: "normalized_return" as const,
        chartValue: normalizedValue,
        changePct: cell.changePct,
        date: cell.date,
        marketValueKrw: cell.marketValueKrw,
      });
    });
}
