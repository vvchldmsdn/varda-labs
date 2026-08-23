const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const PORTFOLIO_DASHBOARD_BASELINE_FALLBACK_DAYS = 1;

export type PortfolioDashboardBaselineWindow = {
  serviceDate: string;
  expectedReferenceDate: string;
  fallbackReferenceDate: string;
  storageWindowStart: string;
  storageWindowEnd: string;
};

export function resolvePortfolioDashboardBaselineWindow(
  serviceDate: string,
): PortfolioDashboardBaselineWindow {
  const expectedReferenceDate = shiftIsoDate(serviceDate, -1);

  return {
    serviceDate,
    expectedReferenceDate,
    fallbackReferenceDate: shiftIsoDate(
      expectedReferenceDate,
      -PORTFOLIO_DASHBOARD_BASELINE_FALLBACK_DAYS,
    ),
    // Snapshot rows are currently keyed by the 07:00 cycle end date. A row
    // stored on the service date therefore represents the prior calendar day.
    storageWindowStart: shiftIsoDate(
      serviceDate,
      -PORTFOLIO_DASHBOARD_BASELINE_FALLBACK_DAYS,
    ),
    storageWindowEnd: serviceDate,
  };
}

export function portfolioDashboardBaselineWindowStart(
  serviceDate: string,
) {
  return resolvePortfolioDashboardBaselineWindow(serviceDate).storageWindowStart;
}

export function selectLatestPortfolioDashboardBaselineRows<
  TRow extends Readonly<{ snapshotDate: string }>,
>(rows: readonly TRow[], serviceDate: string) {
  const window = resolvePortfolioDashboardBaselineWindow(serviceDate);
  const eligibleRows = rows.filter(
    (row) =>
      row.snapshotDate >= window.storageWindowStart &&
      row.snapshotDate <= window.storageWindowEnd,
  );
  const storageSnapshotDate = eligibleRows.reduce<string | null>(
    (latest, row) =>
      latest === null || row.snapshotDate > latest ? row.snapshotDate : latest,
    null,
  );
  const baselineReferenceDate =
    storageSnapshotDate === null
      ? null
      : shiftIsoDate(storageSnapshotDate, -1);

  return {
    storageSnapshotDate,
    baselineReferenceDate,
    rows:
      storageSnapshotDate === null
        ? []
        : eligibleRows.filter(
            (row) => row.snapshotDate === storageSnapshotDate,
          ),
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
