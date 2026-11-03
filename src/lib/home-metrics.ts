import { resolveKrwFxRate } from "./portfolio-math.ts";

type MovementHolding = {
  dailyChangeKrw: number | null;
};

/** The legacy projection uses 0 for an unknown quote. Never present that fallback as a valuation. */
export function availableHoldingValueKrw(
  holding: { currentPrice: number; currency: string; valueKrw: number },
  usdKrwRate: number,
): number | null {
  const hasPrice = Number.isFinite(holding.currentPrice) && holding.currentPrice > 0;
  const hasFx = resolveKrwFxRate(holding.currency, usdKrwRate).ok;
  return hasPrice && hasFx && Number.isFinite(holding.valueKrw) ? holding.valueKrw : null;
}

export function selectLargestMovementContributor<T extends MovementHolding>(
  holdings: readonly T[],
) {
  return (
    holdings
      .filter(
        (holding) =>
          holding.dailyChangeKrw !== null &&
          Math.round(holding.dailyChangeKrw) !== 0,
      )
      .toSorted(
        (left, right) =>
          Math.abs(right.dailyChangeKrw ?? 0) -
          Math.abs(left.dailyChangeKrw ?? 0),
      )[0] ?? null
  );
}
