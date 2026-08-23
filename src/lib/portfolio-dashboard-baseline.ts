const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const PORTFOLIO_DASHBOARD_BASELINE_MAX_AGE_DAYS = 1;

export function portfolioDashboardBaselineWindowStart(
  expectedSnapshotDate: string,
) {
  return shiftIsoDate(
    expectedSnapshotDate,
    -PORTFOLIO_DASHBOARD_BASELINE_MAX_AGE_DAYS,
  );
}

export function selectLatestPortfolioDashboardBaselineRows<
  TRow extends Readonly<{ snapshotDate: string }>,
>(rows: readonly TRow[], expectedSnapshotDate: string) {
  const windowStart = portfolioDashboardBaselineWindowStart(expectedSnapshotDate);
  const eligibleRows = rows.filter(
    (row) =>
      row.snapshotDate >= windowStart &&
      row.snapshotDate <= expectedSnapshotDate,
  );
  const snapshotDate = eligibleRows.reduce<string | null>(
    (latest, row) =>
      latest === null || row.snapshotDate > latest ? row.snapshotDate : latest,
    null,
  );

  return {
    snapshotDate,
    rows:
      snapshotDate === null
        ? []
        : eligibleRows.filter((row) => row.snapshotDate === snapshotDate),
  } as const;
}

function shiftIsoDate(value: string, dayDelta: number) {
  if (!ISO_DATE_PATTERN.test(value)) {
    throw new TypeError(`Invalid ISO date: ${value}`);
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== value) {
    throw new TypeError(`Invalid ISO date: ${value}`);
  }

  date.setUTCDate(date.getUTCDate() + dayDelta);
  return date.toISOString().slice(0, 10);
}
