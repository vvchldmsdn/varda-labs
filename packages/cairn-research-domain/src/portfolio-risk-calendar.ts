const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export type ServiceDatedObservation = {
  serviceDate: string;
};

// Historical risk calculations trust a stored positive close as market-open
// evidence. They intentionally do not consult the snapshot forecast calendar.
export function mapRiskEvidenceDateToServiceDate(sourceDate: string) {
  return shiftRiskDate(sourceDate, 1);
}

export function shiftRiskDate(date: string, deltaDays: number) {
  const value = parseDateOnly(date);
  value.setUTCDate(value.getUTCDate() + deltaDays);
  return value.toISOString().slice(0, 10);
}

export function riskCalendarDayDistance(earlier: string, later: string) {
  const earlierMs = parseDateOnly(earlier).getTime();
  const laterMs = parseDateOnly(later).getTime();
  return Math.round((laterMs - earlierMs) / DAY_MS);
}

export function latestRiskObservationOnOrBefore<
  T extends ServiceDatedObservation,
>(series: readonly T[], serviceDate: string) {
  let low = 0;
  let high = series.length - 1;
  let selected: T | null = null;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = series[middle];
    if (candidate.serviceDate <= serviceDate) {
      selected = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  if (!selected) return null;

  return {
    row: selected,
    carryDays: riskCalendarDayDistance(selected.serviceDate, serviceDate),
  };
}

export function isRiskDate(value: string) {
  if (!ISO_DATE_PATTERN.test(value)) return false;

  try {
    return parseDateOnly(value).toISOString().slice(0, 10) === value;
  } catch {
    return false;
  }
}

function parseDateOnly(date: string) {
  if (!ISO_DATE_PATTERN.test(date)) {
    throw new TypeError(`Invalid ISO date: ${date}`);
  }

  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.toISOString().slice(0, 10) !== date) {
    throw new TypeError(`Invalid ISO date: ${date}`);
  }
  return value;
}
