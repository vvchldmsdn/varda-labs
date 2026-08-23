type MovementHolding = {
  dailyChangeKrw: number | null;
};

export function selectLargestMovementContributor<T extends MovementHolding>(
  holdings: readonly T[],
) {
  return (
    holdings
      .filter(
        (holding) =>
          holding.dailyChangeKrw !== null && holding.dailyChangeKrw !== 0,
      )
      .toSorted(
        (left, right) =>
          Math.abs(right.dailyChangeKrw ?? 0) -
          Math.abs(left.dailyChangeKrw ?? 0),
      )[0] ?? null
  );
}
