export const BASIS_POINT_TOTAL = 10_000;

export function allocateBasisPointsByValue(
  rows: readonly Readonly<{
    key: string;
    value: number;
  }>[],
  totalBasisPoints = BASIS_POINT_TOTAL,
) {
  if (
    rows.length === 0 ||
    !Number.isSafeInteger(totalBasisPoints) ||
    totalBasisPoints <= 0
  ) {
    return null;
  }

  const keys = new Set<string>();
  let totalValue = 0;
  for (const row of rows) {
    if (
      !row.key ||
      keys.has(row.key) ||
      !Number.isFinite(row.value) ||
      row.value < 0
    ) {
      return null;
    }
    keys.add(row.key);
    totalValue += row.value;
  }
  if (!Number.isFinite(totalValue) || totalValue <= 0) return null;

  const allocations = rows.map((row) => {
    const ideal = (row.value / totalValue) * totalBasisPoints;
    const weightBps = Math.floor(ideal);
    return {
      key: row.key,
      remainder: ideal - weightBps,
      weightBps,
    };
  });
  const remaining =
    totalBasisPoints -
    allocations.reduce((sum, row) => sum + row.weightBps, 0);
  if (
    !Number.isSafeInteger(remaining) ||
    remaining < 0 ||
    remaining > allocations.length
  ) {
    return null;
  }

  allocations.sort(
    (left, right) =>
      right.remainder - left.remainder || left.key.localeCompare(right.key),
  );
  for (let index = 0; index < remaining; index += 1) {
    allocations[index].weightBps += 1;
  }

  return new Map(
    allocations.map((row) => [row.key, row.weightBps] as const),
  );
}
